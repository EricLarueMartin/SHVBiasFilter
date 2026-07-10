"""SPICE-style AC ladder model for the SHV bias filter.

This module intentionally avoids third-party dependencies so the Pi backend can
serve the result immediately. The calculation is a modified-nodal AC solve with
the same linear components a SPICE netlist would contain: stage resistors,
stage-to-ground capacitors, bias-to-bias parasitic capacitors, a lossless coax
transmission-line input admittance, and the detector/load termination.
"""

from __future__ import annotations

import cmath
import importlib.util
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import axisymmetric_model


EPS0_F_PER_MM = 8.8541878128e-15
FR4_WASHER_EPSR = 4.3
SPEED_OF_LIGHT_M_PER_S = 299_792_458.0
NGSPICE_TIMEOUT_SECONDS = 20
ATTENUATION_SWEEP_FMIN_HZ = 1.0
ATTENUATION_SWEEP_FMAX_HZ = 100e6


def parallel_plate_capacitance_pf(epsr: float, area_mm2: float, separation_mm: float) -> float:
    if area_mm2 <= 0.0 or separation_mm <= 0.0:
        return 0.0
    return EPS0_F_PER_MM * epsr * area_mm2 / separation_mm * 1e12


def core_resistance_for_length_ohm(p: dict[str, Any], length_mm: float) -> float:
    area_mm2 = math.pi * (float(p["core_od_mm"]) / 2.0) ** 2
    if area_mm2 <= 0.0:
        return math.nan
    rho_ohm_cm = 10.0 ** float(p.get("core_volume_resistivity_log10_ohm_cm", 8.0))
    return rho_ohm_cm * (10.0 * length_mm / area_mm2)


def uses_direct_stage_circuit(p: dict[str, Any]) -> bool:
    return bool(p.get("use_direct_stage_circuit", False))


def uses_direct_stage_capacitance(p: dict[str, Any]) -> bool:
    return bool(p.get("use_direct_stage_capacitance", False))


def bias_plate_count(p: dict[str, Any]) -> int:
    return max(1, int(p["plate_pairs"]))


def resistive_section_count(p: dict[str, Any]) -> int:
    return max(0, int(p["plate_pairs"]) - 1)


def series_resistance_ohm(p: dict[str, Any], circuit: dict[str, float], prefix: str) -> float:
    if bool(p.get(f"{prefix}_series_matches_stage", False)):
        return max(0.0, float(circuit["stageResistanceOhm"]))
    if prefix == "output":
        if "output_series_resistance_ohm" in p:
            return max(0.0, float(p["output_series_resistance_ohm"]))
        # Compatibility with saved payloads from before output R used ohms.
        return max(0.0, float(p.get("output_series_resistance_mohm", 0.0))) * 1e6
    return max(0.0, float(p.get(f"{prefix}_series_resistance_mohm", 0.0))) * 1e6


def active_series_section_count(p: dict[str, Any], circuit: dict[str, float], include_output: bool = True) -> int:
    values = [series_resistance_ohm(p, circuit, "input")]
    values.extend([float(circuit["stageResistanceOhm"])] * resistive_section_count(p))
    if include_output:
        values.append(series_resistance_ohm(p, circuit, "output"))
    return sum(1 for value in values if math.isfinite(value) and value > 0.0)


def stage_resistance_ohm(p: dict[str, Any], bias_bias_separation_mm: float) -> float:
    if uses_direct_stage_circuit(p):
        return float(p.get("melf_stage_resistance_mohm", 12.0)) * 1e6
    return core_resistance_for_length_ohm(p, bias_bias_separation_mm)


def circuit_estimates(p: dict[str, Any]) -> dict[str, float]:
    core_radius = float(p["core_od_mm"]) / 2.0
    ground_inner = float(p["ground_plate_inner_diameter_mm"]) / 2.0
    washer_inner, washer_outer = axisymmetric_model.washer_radial_bounds(p)
    overlap_inner = max(washer_inner, ground_inner)
    overlap_outer = min(washer_outer, float(p["hv_plate_od_mm"]) / 2.0)
    overlap_area = math.pi * max(0.0, overlap_outer**2 - overlap_inner**2)

    pair_cap_pf = parallel_plate_capacitance_pf(float(p["washer_epsr"]), overlap_area, float(p["plate_gap_mm"]))
    fr4_pair_cap_pf = parallel_plate_capacitance_pf(FR4_WASHER_EPSR, overlap_area, float(p["plate_gap_mm"]))
    shunt_cap_pf = 2.0 * pair_cap_pf
    total_ground_cap_pf = 2.0 * bias_plate_count(p) * pair_cap_pf

    bias_bias_separation = axisymmetric_model.ground_plate_thickness_mm(p) + 2.0 * float(p["plate_gap_mm"])
    ferrite_area = math.pi * core_radius**2
    core_epoxy_area = math.pi * max(0.0, ground_inner**2 - core_radius**2)
    ferrite_parasitic_pf = parallel_plate_capacitance_pf(axisymmetric_model.core_capacitance_epsr(p), ferrite_area, bias_bias_separation)
    epoxy_parasitic_pf = parallel_plate_capacitance_pf(float(p["epoxy_epsr"]), core_epoxy_area, bias_bias_separation)
    direct_parasitic_pf = float(p.get("melf_stage_parasitic_pf", 0.3))
    if int(p["plate_pairs"]) > 1:
        parasitic_pf = (
            direct_parasitic_pf
            if uses_direct_stage_capacitance(p)
            else ferrite_parasitic_pf
        ) + epoxy_parasitic_pf
    else:
        parasitic_pf = 0.0

    r_stage = stage_resistance_ohm(p, bias_bias_separation)
    return {
        "pairCapPf": pair_cap_pf,
        "shuntCapPf": shunt_cap_pf,
        "totalGroundCapPf": total_ground_cap_pf,
        "parasiticPf": parasitic_pf,
        "stageResistanceOhm": r_stage,
        "washerCapGain": pair_cap_pf / fr4_pair_cap_pf if fr4_pair_cap_pf > 0.0 else math.nan,
    }


def load_conductance_s(p: dict[str, Any]) -> float:
    current_a = max(0.0, float(p.get("load_current_na", 1.0))) * 1e-9
    voltage = abs(float(p.get("bias_voltage_v", 0.0)))
    return current_a / voltage if voltage > 0.0 else 0.0


def detector_capacitance_pf(p: dict[str, Any]) -> float:
    return max(0.0, float(p.get("detector_capacitance_pf", 10.0)))


def cable_capacitance_pf(p: dict[str, Any]) -> float:
    length_m = max(0.0, float(p.get("load_cable_length_m", 10.0)))
    z0 = max(1e-9, float(p.get("load_cable_impedance_ohm", 50.0)))
    vf = max(1e-9, float(p.get("load_cable_velocity_factor", 0.66)))
    return length_m / (z0 * vf * SPEED_OF_LIGHT_M_PER_S) * 1e12


def detector_load_admittance(p: dict[str, Any], frequency_hz: float) -> complex:
    omega = 2.0 * math.pi * frequency_hz
    return complex(load_conductance_s(p), omega * detector_capacitance_pf(p) * 1e-12)


def transmission_line_input_admittance(p: dict[str, Any], frequency_hz: float) -> complex:
    length_m = max(0.0, float(p.get("load_cable_length_m", 10.0)))
    z0 = max(1e-9, float(p.get("load_cable_impedance_ohm", 50.0)))
    vf = max(1e-9, float(p.get("load_cable_velocity_factor", 0.66)))
    y_load = detector_load_admittance(p, frequency_hz)
    if length_m <= 0.0 or frequency_hz <= 0.0:
        return y_load
    y0 = 1.0 / z0
    beta_l = 2.0 * math.pi * frequency_hz * length_m / (vf * SPEED_OF_LIGHT_M_PER_S)
    t = 1j * math.tan(beta_l)
    denominator = y0 + y_load * t
    if abs(denominator) < 1e-30:
        return complex(math.copysign(1e30, denominator.real or 1.0), 0.0)
    return y0 * (y_load + y0 * t) / denominator


def lumped_load_admittance(p: dict[str, Any], frequency_hz: float) -> complex:
    omega = 2.0 * math.pi * frequency_hz
    cap_pf = detector_capacitance_pf(p) + cable_capacitance_pf(p)
    return complex(load_conductance_s(p), omega * cap_pf * 1e-12)


def solve_complex_linear(matrix: list[list[complex]], rhs: list[complex]) -> list[complex] | None:
    n = len(rhs)
    a = [row[:] for row in matrix]
    b = rhs[:]
    for pivot in range(n):
        best = max(range(pivot, n), key=lambda row: abs(a[row][pivot]))
        if abs(a[best][pivot]) < 1e-30:
            return None
        if best != pivot:
            a[pivot], a[best] = a[best], a[pivot]
            b[pivot], b[best] = b[best], b[pivot]
        pivot_value = a[pivot][pivot]
        for col in range(pivot, n):
            a[pivot][col] /= pivot_value
        b[pivot] /= pivot_value
        for row in range(n):
            if row == pivot:
                continue
            factor = a[row][pivot]
            if abs(factor) < 1e-30:
                continue
            for col in range(pivot, n):
                a[row][col] -= factor * a[pivot][col]
            b[row] -= factor * b[pivot]
    return b


def ladder_transfer(
    circuit: dict[str, float],
    p: dict[str, Any],
    frequency_hz: float,
    load_mode: str = "transmission_line",
) -> complex:
    stages = max(1, int(p["plate_pairs"]))
    omega = 2.0 * math.pi * frequency_hz
    y_par = complex(
        1.0 / circuit["stageResistanceOhm"] if circuit["stageResistanceOhm"] > 0.0 else 0.0,
        omega * max(0.0, circuit["parasiticPf"]) * 1e-12,
    )
    y_ground = complex(0.0, omega * max(0.0, circuit["shuntCapPf"]) * 1e-12)
    if load_mode == "transmission_line":
        y_load = transmission_line_input_admittance(p, frequency_hz)
    elif load_mode == "lumped":
        y_load = lumped_load_admittance(p, frequency_hz)
    else:
        y_load = 0.0 + 0.0j

    input_ohm = series_resistance_ohm(p, circuit, "input")
    output_ohm = series_resistance_ohm(p, circuit, "output")
    include_output_node = output_ohm > 0.0 and abs(y_load) > 0.0
    output_node = stages if include_output_node else stages - 1
    all_nodes = list(range(stages + (1 if include_output_node else 0)))
    fixed = {-1: 1.0 + 0.0j}
    if input_ohm <= 0.0:
        fixed[0] = 1.0 + 0.0j
    unknown_nodes = [node for node in all_nodes if node not in fixed]
    if not unknown_nodes:
        return fixed.get(output_node, 1.0 + 0.0j)
    unknown_index = {node: index for index, node in enumerate(unknown_nodes)}
    matrix = [[0.0 + 0.0j for _ in unknown_nodes] for _ in unknown_nodes]
    rhs = [0.0 + 0.0j for _ in unknown_nodes]

    def add_shunt(node: int, y: complex) -> None:
        if abs(y) <= 0.0 or node in fixed:
            return
        row = unknown_index[node]
        matrix[row][row] += y

    def add_branch(a: int, b: int, y: complex) -> None:
        if abs(y) <= 0.0:
            return
        a_row = unknown_index.get(a)
        b_row = unknown_index.get(b)
        if a_row is not None:
            matrix[a_row][a_row] += y
            if b_row is not None:
                matrix[a_row][b_row] -= y
            elif b in fixed:
                rhs[a_row] += y * fixed[b]
        if b_row is not None:
            matrix[b_row][b_row] += y
            if a_row is not None:
                matrix[b_row][a_row] -= y
            elif a in fixed:
                rhs[b_row] += y * fixed[a]

    def resistor_y(ohms: float) -> complex:
        return complex(1.0 / ohms, 0.0) if math.isfinite(ohms) and ohms > 0.0 else 0.0 + 0.0j

    for node in range(stages):
        add_shunt(node, y_ground)
    add_branch(0, -1, resistor_y(input_ohm))
    for node in range(1, stages):
        add_branch(node - 1, node, y_par)
    if include_output_node:
        add_branch(stages - 1, output_node, resistor_y(output_ohm))
        add_shunt(output_node, y_load)
    else:
        add_shunt(stages - 1, y_load)

    solution = solve_complex_linear(matrix, rhs)
    if not solution:
        return complex(math.nan, math.nan)
    if output_node in fixed:
        return fixed[output_node]
    return solution[unknown_index[output_node]]


def scaled_stage_transfer(circuit: dict[str, float], p: dict[str, Any], frequency_hz: float) -> complex:
    sections = active_series_section_count(p, circuit, include_output=True)
    if sections <= 0:
        return 1.0 + 0.0j
    omega = 2.0 * math.pi * frequency_hz
    y_par = complex(
        1.0 / circuit["stageResistanceOhm"] if circuit["stageResistanceOhm"] > 0.0 else 0.0,
        omega * max(0.0, circuit["parasiticPf"]) * 1e-12,
    )
    y_ground = complex(load_conductance_s(p), omega * (circuit["shuntCapPf"] + cable_capacitance_pf(p) + detector_capacitance_pf(p)) * 1e-12)
    one_stage = y_par / (y_par + y_ground) if abs(y_par + y_ground) > 0.0 else complex(math.nan, math.nan)
    magnitude = abs(one_stage) ** sections
    phase = cmath.phase(one_stage) * sections
    return cmath.rect(magnitude, phase)


def attenuation_db(value: complex) -> float:
    magnitude = abs(value)
    if not math.isfinite(magnitude) or magnitude <= 0.0:
        return math.nan
    return -20.0 * math.log10(max(1e-300, magnitude))


def sample_frequencies(p: dict[str, Any], count: int = 161) -> list[float]:
    f_min = ATTENUATION_SWEEP_FMIN_HZ
    f_max = ATTENUATION_SWEEP_FMAX_HZ
    return [f_min * (f_max / f_min) ** (index / (count - 1)) for index in range(count)]


def netlist_text(circuit: dict[str, float], p: dict[str, Any]) -> str:
    stages = max(1, int(p["plate_pairs"]))
    input_ohm = series_resistance_ohm(p, circuit, "input")
    output_ohm = series_resistance_ohm(p, circuit, "output")
    source_node = "src" if input_ohm > 0.0 else "n0"
    load_node = "out" if output_ohm > 0.0 else f"n{stages - 1}"
    lines = [
        "* SHV bias filter ladder, generated by backend",
        f"V1 {source_node} 0 AC 1",
    ]
    if input_ohm > 0.0:
        lines.append(f"Rin src n0 {input_ohm:.6g}")
    for stage in range(stages):
        lines.append(f"Cg{stage} n{stage} 0 {circuit['shuntCapPf'] * 1e-12:.6g}")
    for stage in range(1, stages):
        lines.append(f"R{stage} n{stage - 1} n{stage} {circuit['stageResistanceOhm']:.6g}")
        lines.append(f"Cpar{stage} n{stage - 1} n{stage} {circuit['parasiticPf'] * 1e-12:.6g}")
    if output_ohm > 0.0:
        lines.append(f"Rout n{stages - 1} out {output_ohm:.6g}")
    lines.append(f"Tload {load_node} 0 det 0 Z0={float(p.get('load_cable_impedance_ohm', 50.0)):.6g} TD={max(0.0, float(p.get('load_cable_length_m', 10.0))) / (max(1e-9, float(p.get('load_cable_velocity_factor', 0.66))) * SPEED_OF_LIGHT_M_PER_S):.6g}")
    lines.append(f"Cdet det 0 {detector_capacitance_pf(p) * 1e-12:.6g}")
    conductance = load_conductance_s(p)
    if conductance > 0.0:
        lines.append(f"Rload det 0 {1.0 / conductance:.6g}")
    lines.append(f".ac dec 50 {ATTENUATION_SWEEP_FMIN_HZ:.12g} {ATTENUATION_SWEEP_FMAX_HZ:.12g}")
    lines.append(".end")
    return "\n".join(lines)


def spice_runtime_status() -> dict[str, Any]:
    ngspice_path = shutil.which("ngspice")
    pyspice_available = importlib.util.find_spec("PySpice") is not None
    version = None
    if ngspice_path:
        try:
            completed = subprocess.run(
                [ngspice_path, "-v"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
            for line in (completed.stdout + completed.stderr).splitlines():
                if "ngspice-" in line:
                    version = line.strip().strip("* ")
                    break
        except Exception:
            version = None
    return {
        "ngspicePath": ngspice_path,
        "ngspiceVersion": version,
        "pyspiceAvailable": pyspice_available,
    }


def ngspice_controlled_netlist(circuit: dict[str, float], p: dict[str, Any], output_path: Path) -> str:
    base = netlist_text(circuit, p).splitlines()
    without_ac = [line for line in base if not line.lower().startswith(".ac ") and line.lower() != ".end"]
    stages = max(1, int(p["plate_pairs"]))
    output_node = "out" if series_resistance_ohm(p, circuit, "output") > 0.0 else f"n{stages - 1}"
    without_ac.extend(
        [
            ".control",
            "set filetype=ascii",
            f"ac dec 20 {ATTENUATION_SWEEP_FMIN_HZ:.12g} {ATTENUATION_SWEEP_FMAX_HZ:.12g}",
            f"wrdata {output_path.as_posix()} v({output_node})",
            "quit",
            ".endc",
            ".end",
        ]
    )
    return "\n".join(without_ac)


def parse_ngspice_wrdata(path: Path) -> list[tuple[float, complex]]:
    samples: list[tuple[float, complex]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            columns = [float(value) for value in line.split()]
        except ValueError:
            continue
        if len(columns) >= 3:
            frequency = columns[0]
            real = columns[-2]
            imag = columns[-1]
            if frequency > 0.0 and math.isfinite(real) and math.isfinite(imag):
                samples.append((frequency, complex(real, imag)))
    return samples


def ngspice_ac_sweep(circuit: dict[str, float], p: dict[str, Any]) -> dict[str, Any] | None:
    status = spice_runtime_status()
    ngspice_path = status["ngspicePath"]
    if not ngspice_path:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="shv_spice_") as temp_dir:
            temp = Path(temp_dir)
            data_path = temp / "ac.dat"
            netlist_path = temp / "ladder.cir"
            netlist_path.write_text(ngspice_controlled_netlist(circuit, p, data_path), encoding="utf-8")
            completed = subprocess.run(
                [ngspice_path, "-b", str(netlist_path)],
                check=False,
                capture_output=True,
                text=True,
                timeout=NGSPICE_TIMEOUT_SECONDS,
            )
            if completed.returncode != 0 or not data_path.is_file():
                return {
                    "error": (completed.stderr or completed.stdout or f"ngspice returned {completed.returncode}").strip()[-800:],
                    "runtime": status,
                }
            return {
                "samples": parse_ngspice_wrdata(data_path),
                "stdout": completed.stdout[-800:],
                "stderr": completed.stderr[-800:],
                "runtime": status,
            }
    except Exception as exc:
        return {
            "error": str(exc),
            "runtime": status,
        }


def internal_sample_rows(circuit: dict[str, float], p: dict[str, Any], frequencies: list[float]) -> list[dict[str, Any]]:
    rows = []
    for frequency in frequencies:
        full_tline = ladder_transfer(circuit, p, frequency, "transmission_line")
        full_lumped = ladder_transfer(circuit, p, frequency, "lumped")
        scaled = scaled_stage_transfer(circuit, p, frequency)
        rows.append(sample_row(frequency, full_tline, full_lumped, scaled))
    return rows


def sample_row(frequency: float, full_tline: complex, full_lumped: complex, scaled: complex) -> dict[str, Any]:
    return {
        "frequencyHz": frequency,
        "fullTline": {
            "magnitude": abs(full_tline),
            "attenuationDb": attenuation_db(full_tline),
            "phaseDeg": math.degrees(cmath.phase(full_tline)) if math.isfinite(abs(full_tline)) else math.nan,
        },
        "fullLumped": {
            "magnitude": abs(full_lumped),
            "attenuationDb": attenuation_db(full_lumped),
            "phaseDeg": math.degrees(cmath.phase(full_lumped)) if math.isfinite(abs(full_lumped)) else math.nan,
        },
        "scaledStage": {
            "magnitude": abs(scaled),
            "attenuationDb": attenuation_db(scaled),
            "phaseDeg": math.degrees(cmath.phase(scaled)) if math.isfinite(abs(scaled)) else math.nan,
        },
    }


def simulate(parameters: dict[str, Any]) -> dict[str, Any]:
    p = axisymmetric_model.normalize_parameters(parameters)
    circuit = circuit_estimates(p)
    ngspice_result = ngspice_ac_sweep(circuit, p)
    ngspice_samples = ngspice_result.get("samples") if ngspice_result else None
    if ngspice_samples:
        frequencies = [frequency for frequency, _ in ngspice_samples]
        samples = []
        for frequency, full_tline in ngspice_samples:
            full_lumped = ladder_transfer(circuit, p, frequency, "lumped")
            scaled = scaled_stage_transfer(circuit, p, frequency)
            samples.append(sample_row(frequency, full_tline, full_lumped, scaled))
        source = "ngspice-ac"
        method = "ngspice-batch-ac"
        spice_package = ngspice_result["runtime"]["ngspiceVersion"] or "ngspice"
    else:
        frequencies = sample_frequencies(p)
        samples = internal_sample_rows(circuit, p, frequencies)
        source = "backend-spice-style-mna"
        method = "internal-spice-style-ac-mna"
        spice_package = None

    def at_frequency(frequency: float) -> dict[str, Any]:
        full_tline = ladder_transfer(circuit, p, frequency, "transmission_line")
        full_lumped = ladder_transfer(circuit, p, frequency, "lumped")
        scaled = scaled_stage_transfer(circuit, p, frequency)
        return {
            "frequencyHz": frequency,
            "fullTlineAttenuationDb": attenuation_db(full_tline),
            "fullLumpedAttenuationDb": attenuation_db(full_lumped),
            "scaledStageAttenuationDb": attenuation_db(scaled),
        }

    return {
        "status": "ok",
        "source": source,
        "method": method,
        "spicePackage": spice_package,
        "spiceRuntime": ngspice_result.get("runtime") if ngspice_result else spice_runtime_status(),
        "spiceFallbackReason": ngspice_result.get("error") if ngspice_result and not ngspice_samples else None,
        "parameters": p,
        "circuit": {
            **circuit,
            "stages": bias_plate_count(p),
            "internalResistiveSections": resistive_section_count(p),
            "resistiveSections": active_series_section_count(p, circuit, include_output=True),
            "inputSeriesResistanceOhm": series_resistance_ohm(p, circuit, "input"),
            "outputSeriesResistanceOhm": series_resistance_ohm(p, circuit, "output"),
            "loadConductanceS": load_conductance_s(p),
            "cableCapPf": cable_capacitance_pf(p),
            "detectorCapPf": detector_capacitance_pf(p),
            "loadCapPfLumped": cable_capacitance_pf(p) + detector_capacitance_pf(p),
            "cableDelayS": max(0.0, float(p.get("load_cable_length_m", 10.0))) / (max(1e-9, float(p.get("load_cable_velocity_factor", 0.66))) * SPEED_OF_LIGHT_M_PER_S),
            "cableZ0Ohm": max(1e-9, float(p.get("load_cable_impedance_ohm", 50.0))),
        },
        "samples": samples,
        "summary": {
            "at50Hz": at_frequency(50.0),
            "atRfCompare": at_frequency((10.0 ** float(p.get("rf_compare_frequency_log10_mhz", 0.0))) * 1e6),
            "notes": [
                "Uses ngspice batch AC analysis when available; otherwise falls back to the same AC MNA equations that a small-signal SPICE deck would solve.",
                "The coax is represented as a lossless transmission-line input admittance terminated by detector capacitance and DC-load conductance.",
            ],
        },
        "netlist": netlist_text(circuit, p),
    }
