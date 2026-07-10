#!/usr/bin/env python3
"""Generate and solve a simple axisymmetric SHV bias-filter model.

The electrostatic solver uses a finite-difference r-z grid with spatially
varying relative permittivity. It is intended for early design screening, not
for final high-voltage qualification.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PARAMETERS = ROOT / "hardware" / "geometry" / "default-parameters.json"
DEFAULT_OUTPUT_DIR = ROOT / "simulations" / "axisymmetric" / "outputs"
DEFAULT_CAD_DIR = ROOT / "hardware" / "geometry" / "generated"
FIELD_ADAPTIVE_PROBE_SWEEPS = 90
FIELD_ADAPTIVE_MAX_POINTS = 24
FIELD_ADAPTIVE_THRESHOLD_FRACTION = 0.45
SUPPORTED_PEAK_PERCENTILE = 0.75
SUPPORTED_PEAK_OUTLIER_RATIO = 1.35


def load_parameters(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return normalize_parameters(json.load(handle))


def normalize_parameters(p: dict[str, Any]) -> dict[str, Any]:
    """Derive legacy fields from the current gap and resistivity controls."""
    if "use_direct_stage_capacitance" not in p:
        p["use_direct_stage_capacitance"] = bool(
            p.get("use_direct_stage_circuit")
            and not str(p.get("core_material", "")).startswith("mmb020")
        )
    else:
        p["use_direct_stage_capacitance"] = bool(p["use_direct_stage_capacitance"])
    if "bias_plate_thickness_mm" not in p:
        p["bias_plate_thickness_mm"] = p.get("plate_thickness_mm", 1.0)
    if p.get("ground_matches_bias_thickness", False):
        p["ground_plate_thickness_mm"] = p["bias_plate_thickness_mm"]
    elif "ground_plate_thickness_mm" not in p:
        p["ground_plate_thickness_mm"] = p.get("plate_thickness_mm", p["bias_plate_thickness_mm"])
    p["plate_thickness_mm"] = p["bias_plate_thickness_mm"]
    min_pair_length_by_material = {
        "mmb0204_melf": 3.6,
        "mmb0207_melf": 5.8,
    }
    min_pair_length = min_pair_length_by_material.get(str(p.get("core_material", "")))
    if min_pair_length is not None and "plate_gap_mm" in p:
        min_gap = max(0.0, (min_pair_length - bias_plate_thickness_mm(p) - ground_plate_thickness_mm(p)) / 2.0)
        p["plate_gap_mm"] = max(float(p["plate_gap_mm"]), min_gap)
    if "core_to_ground_gap_mm" in p:
        p["ground_plate_inner_diameter_mm"] = p["core_od_mm"] + 2.0 * p["core_to_ground_gap_mm"]
    if "hv_plate_od_mm" in p and "hv_to_tube_gap_mm" in p:
        p["tube_id_mm"] = p["hv_plate_od_mm"] + 2.0 * p["hv_to_tube_gap_mm"]
        p["ground_plate_od_mm"] = p["tube_id_mm"]
    elif "tube_id_mm" in p:
        p["ground_plate_od_mm"] = p["tube_id_mm"]
        if "hv_to_tube_gap_mm" in p:
            p["hv_plate_od_mm"] = p["tube_id_mm"] - 2.0 * p["hv_to_tube_gap_mm"]
    p["washer_id_matches_ground"] = p.get("washer_id_matches_ground", True) is not False
    p["washer_od_matches_bias"] = p.get("washer_od_matches_bias", True) is not False
    min_washer_width_diameter = 0.2
    min_washer_id = max(0.1, float(p.get("core_od_mm", 0.1)))
    max_washer_od = max(float(p.get("hv_plate_od_mm", 0.2)), float(p.get("tube_id_mm", p.get("hv_plate_od_mm", 0.2))))
    if p["washer_id_matches_ground"]:
        p["washer_id_mm"] = float(p["ground_plate_inner_diameter_mm"])
    else:
        p["washer_id_mm"] = float(p.get("washer_id_mm", p["ground_plate_inner_diameter_mm"]))
    if p["washer_od_matches_bias"]:
        p["washer_od_mm"] = float(p["hv_plate_od_mm"])
    else:
        p["washer_od_mm"] = float(p.get("washer_od_mm", p["hv_plate_od_mm"]))
    if not p["washer_id_matches_ground"]:
        max_washer_id = max(min_washer_id, p["washer_od_mm"] - min_washer_width_diameter)
        p["washer_id_mm"] = max(min_washer_id, min(float(p["washer_id_mm"]), max_washer_id))
    if not p["washer_od_matches_bias"]:
        min_washer_od = p["washer_id_mm"] + min_washer_width_diameter
        p["washer_od_mm"] = max(min_washer_od, min(float(p["washer_od_mm"]), max(max_washer_od, min_washer_od)))
    if "core_volume_resistivity_ohm_cm" not in p and "core_volume_resistivity_log10_ohm_cm" in p:
        p["core_volume_resistivity_ohm_cm"] = 10.0 ** p["core_volume_resistivity_log10_ohm_cm"]
    if p.get("use_direct_stage_circuit") and ("melf_stage_resistance_mohm" in p or "melf_stage_resistance_log10_ohm" in p):
        if "melf_stage_resistance_mohm" not in p:
            p["melf_stage_resistance_mohm"] = (10.0 ** p["melf_stage_resistance_log10_ohm"]) / 1e6
        p["melf_stage_resistance_log10_ohm"] = math.log10(p["melf_stage_resistance_mohm"] * 1e6)
        stage_count = max(0, int(p.get("plate_pairs", 1)) - 1)
        edge_resistance_mohm = 0.0
        p["input_series_matches_stage"] = p.get("input_series_matches_stage", True) is not False
        p["output_series_matches_stage"] = bool(p.get("output_series_matches_stage", False))
        if p["input_series_matches_stage"]:
            p["input_series_resistance_mohm"] = p["melf_stage_resistance_mohm"]
        else:
            p["input_series_resistance_mohm"] = max(0.0, float(p.get("input_series_resistance_mohm", 0.0)))
        if p["output_series_matches_stage"]:
            p["output_series_resistance_ohm"] = p["melf_stage_resistance_mohm"] * 1e6
        else:
            if "output_series_resistance_ohm" not in p and "output_series_resistance_mohm" in p:
                p["output_series_resistance_ohm"] = float(p["output_series_resistance_mohm"]) * 1e6
            p["output_series_resistance_ohm"] = max(0.0, float(p.get("output_series_resistance_ohm", 50.0)))
        edge_resistance_mohm = p["input_series_resistance_mohm"] + p["output_series_resistance_ohm"] / 1e6
        total_resistance_mohm = stage_count * p["melf_stage_resistance_mohm"] + edge_resistance_mohm
        if total_resistance_mohm > 0:
            p["core_resistance_gohm"] = total_resistance_mohm / 1000.0
    elif "core_volume_resistivity_ohm_cm" in p and "core_od_mm" in p:
        core_area_mm2 = math.pi * (p["core_od_mm"] / 2.0) ** 2
        if core_area_mm2 > 0.0:
            p["core_resistance_gohm"] = p["core_volume_resistivity_ohm_cm"] * (10.0 * stack_length_mm(p) / core_area_mm2) / 1e9
        p["input_series_matches_stage"] = p.get("input_series_matches_stage", True) is not False
        p["output_series_matches_stage"] = bool(p.get("output_series_matches_stage", False))
        p["input_series_resistance_mohm"] = max(0.0, float(p.get("input_series_resistance_mohm", 0.0)))
        if "output_series_resistance_ohm" not in p and "output_series_resistance_mohm" in p:
            p["output_series_resistance_ohm"] = float(p["output_series_resistance_mohm"]) * 1e6
        p["output_series_resistance_ohm"] = max(0.0, float(p.get("output_series_resistance_ohm", 50.0)))
    p["load_current_na"] = max(0.0, float(p.get("load_current_na", 1.0)))
    p["load_cable_length_m"] = max(0.0, float(p.get("load_cable_length_m", 10.0)))
    p["load_cable_impedance_ohm"] = max(1e-9, float(p.get("load_cable_impedance_ohm", 50.0)))
    p["load_cable_velocity_factor"] = max(1e-9, float(p.get("load_cable_velocity_factor", 0.66)))
    p["detector_capacitance_pf"] = max(0.0, float(p.get("detector_capacitance_pf", 10.0)))
    p["melf_substrate_epsr"] = max(1.0, min(1000.0, float(p.get("melf_substrate_epsr", 9.8))))
    p["melf_metal_fill_factor"] = max(0.0, min(0.95, float(p.get("melf_metal_fill_factor", 0.5))))
    return p


def uses_melf_core_model(p: dict[str, Any]) -> bool:
    return str(p.get("core_material", "")).startswith("mmb020")


def melf_effective_epsr(p: dict[str, Any]) -> float:
    substrate = max(1.0, min(1000.0, float(p.get("melf_substrate_epsr", 9.8))))
    fill_factor = max(0.0, min(0.95, float(p.get("melf_metal_fill_factor", 0.5))))
    return substrate / max(0.05, 1.0 - fill_factor)


def core_capacitance_epsr(p: dict[str, Any]) -> float:
    return melf_effective_epsr(p) if uses_melf_core_model(p) else float(p.get("ferrite_epsr", 12.0))


def bias_plate_thickness_mm(p: dict[str, Any]) -> float:
    return float(p.get("bias_plate_thickness_mm", p.get("plate_thickness_mm", 1.0)))


def ground_plate_thickness_mm(p: dict[str, Any]) -> float:
    if p.get("ground_matches_bias_thickness", False):
        return bias_plate_thickness_mm(p)
    return float(p.get("ground_plate_thickness_mm", p.get("plate_thickness_mm", bias_plate_thickness_mm(p))))


def plate_thickness_mm(p: dict[str, Any], kind: str) -> float:
    return bias_plate_thickness_mm(p) if kind == "hv" else ground_plate_thickness_mm(p)


def edge_radius_mm(p: dict[str, Any], kind: str | None = None) -> float:
    if kind == "hv" and "bias_edge_radius_mm" in p:
        return float(p["bias_edge_radius_mm"])
    if kind == "ground" and "ground_edge_radius_mm" in p:
        return float(p["ground_edge_radius_mm"])
    if "edge_diameter_percent" in p:
        percent = max(0.0, min(100.0, float(p["edge_diameter_percent"])))
        if kind is not None:
            return plate_thickness_mm(p, kind) * percent / 200.0
        return min(
            plate_thickness_mm(p, "hv") * percent / 200.0,
            plate_thickness_mm(p, "ground") * percent / 200.0,
        )
    legacy = float(p.get("edge_radius_mm", p.get("plate_thickness_mm", 1.0) / 2.0))
    if kind is not None:
        return min(legacy, plate_thickness_mm(p, kind) / 2.0)
    return min(legacy, plate_thickness_mm(p, "hv") / 2.0, plate_thickness_mm(p, "ground") / 2.0)


def stack_length_mm(p: dict[str, Any]) -> float:
    n_ground = int(p["plate_pairs"]) + 1
    n_hv = int(p["plate_pairs"])
    return (
        n_ground * ground_plate_thickness_mm(p)
        + n_hv * bias_plate_thickness_mm(p)
        + (n_ground + n_hv - 1) * p["plate_gap_mm"]
    )


def plate_centers(p: dict[str, Any]) -> list[tuple[str, float]]:
    centers: list[tuple[str, float]] = []
    ground_thickness = ground_plate_thickness_mm(p)
    bias_thickness = bias_plate_thickness_mm(p)
    z = ground_thickness / 2.0
    centers.append(("ground", z))
    for _ in range(int(p["plate_pairs"])):
        z += ground_thickness / 2.0 + p["plate_gap_mm"] + bias_thickness / 2.0
        centers.append(("hv", z))
        z += bias_thickness / 2.0 + p["plate_gap_mm"] + ground_thickness / 2.0
        centers.append(("ground", z))
    return centers


def washer_gap_intervals(p: dict[str, Any]) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    plates = plate_centers(p)
    for index in range(len(plates) - 1):
        left_kind, left_z = plates[index]
        right_kind, right_z = plates[index + 1]
        if left_kind == right_kind:
            continue
        z0 = left_z + plate_thickness_mm(p, left_kind) / 2.0
        z1 = right_z - plate_thickness_mm(p, right_kind) / 2.0
        if z1 > z0:
            intervals.append((z0, z1))
    return intervals


def washer_radial_bounds(p: dict[str, Any]) -> tuple[float, float]:
    tube_inner = p["tube_id_mm"] / 2.0
    inner = (p["ground_plate_inner_diameter_mm"] if p.get("washer_id_matches_ground", True) else p.get("washer_id_mm", p["ground_plate_inner_diameter_mm"])) / 2.0
    outer = (p["hv_plate_od_mm"] if p.get("washer_od_matches_bias", True) else p.get("washer_od_mm", p["hv_plate_od_mm"])) / 2.0
    inner = max(0.0, min(float(inner), tube_inner))
    outer = max(0.0, min(float(outer), tube_inner))
    return (inner, outer)


def is_in_washer_gap(p: dict[str, Any], z_stack: float) -> bool:
    return any(z0 <= z_stack <= z1 for z0, z1 in washer_gap_intervals(p))


def rounded_outer_plate(r: float, z: float, zc: float, r_inner: float, r_outer: float, thickness: float, radius: float) -> bool:
    half = thickness / 2.0
    if z < zc - half or z > zc + half or r < r_inner or r > r_outer:
        return False
    radius = max(0.0, min(radius, half, (r_outer - r_inner) / 2.0))
    if radius == 0.0:
        return True
    dz = abs(z - zc)
    if r <= r_outer - radius or dz <= half - radius:
        return True
    return (r - (r_outer - radius)) ** 2 + (dz - (half - radius)) ** 2 <= radius**2


def rounded_inner_plate(r: float, z: float, zc: float, r_inner: float, r_outer: float, thickness: float, radius: float) -> bool:
    half = thickness / 2.0
    if z < zc - half or z > zc + half or r < r_inner or r > r_outer:
        return False
    radius = max(0.0, min(radius, half, (r_outer - r_inner) / 2.0))
    if radius == 0.0:
        return True
    dz = abs(z - zc)
    if r >= r_inner + radius or dz <= half - radius:
        return True
    return (r - (r_inner + radius)) ** 2 + (dz - (half - radius)) ** 2 <= radius**2


def rounded_outer_profile(r_inner: float, r_outer: float, z0: float, z1: float, radius: float, steps: int = 8) -> list[tuple[float, float]]:
    radius = max(0.0, min(radius, (z1 - z0) / 2.0, (r_outer - r_inner) / 2.0))
    if radius == 0.0:
        return [(r_inner, z0), (r_outer, z0), (r_outer, z1), (r_inner, z1)]
    points = [(r_inner, z0), (r_outer - radius, z0)]
    cx = r_outer - radius
    cz = z0 + radius
    for step in range(1, steps + 1):
        theta = -math.pi / 2.0 + (math.pi / 2.0) * step / steps
        points.append((cx + radius * math.cos(theta), cz + radius * math.sin(theta)))
    points.append((r_outer, z1 - radius))
    cz = z1 - radius
    for step in range(1, steps + 1):
        theta = (math.pi / 2.0) * step / steps
        points.append((cx + radius * math.cos(theta), cz + radius * math.sin(theta)))
    points.append((r_inner, z1))
    return points


def rounded_inner_profile(r_inner: float, r_outer: float, z0: float, z1: float, radius: float, steps: int = 8) -> list[tuple[float, float]]:
    radius = max(0.0, min(radius, (z1 - z0) / 2.0, (r_outer - r_inner) / 2.0))
    if radius == 0.0:
        return [(r_inner, z0), (r_outer, z0), (r_outer, z1), (r_inner, z1)]
    points = [(r_inner + radius, z0), (r_outer, z0), (r_outer, z1), (r_inner + radius, z1)]
    cx = r_inner + radius
    cz = z1 - radius
    for step in range(1, steps + 1):
        theta = math.pi / 2.0 + (math.pi / 2.0) * step / steps
        points.append((cx + radius * math.cos(theta), cz + radius * math.sin(theta)))
    points.append((r_inner, z0 + radius))
    cz = z0 + radius
    for step in range(1, steps + 1):
        theta = math.pi + (math.pi / 2.0) * step / steps
        points.append((cx + radius * math.cos(theta), cz + radius * math.sin(theta)))
    return points


def component_profiles(p: dict[str, Any]) -> list[dict[str, Any]]:
    length = stack_length_mm(p)
    core_r = p["core_od_mm"] / 2.0
    hv_outer = p["hv_plate_od_mm"] / 2.0
    ground_inner = p["ground_plate_inner_diameter_mm"] / 2.0
    ground_outer = p["ground_plate_od_mm"] / 2.0
    tube_inner = p["tube_id_mm"] / 2.0
    tube_outer = tube_inner + p["tube_wall_thickness_mm"]
    components: list[dict[str, Any]] = [
        {
            "name": "core_region",
            "material": "core",
            "profile": [(0.0, 0.0), (core_r, 0.0), (core_r, length), (0.0, length)],
        },
        {
            "name": "epoxy_fill_envelope",
            "material": "epoxy",
            "profile": [(core_r, 0.0), (tube_inner, 0.0), (tube_inner, length), (core_r, length)],
        },
    ]
    washer_inner, washer_outer = washer_radial_bounds(p)
    if washer_outer > washer_inner:
        for index, (z0, z1) in enumerate(washer_gap_intervals(p)):
            components.append(
                {
                    "name": f"washer_dielectric_region_{index:02d}",
                    "material": "washer",
                    "profile": [(washer_inner, z0), (washer_outer, z0), (washer_outer, z1), (washer_inner, z1)],
                }
            )

    if p.get("include_ground_tube", True):
        components.append(
            {
                "name": "ground_tube",
                "material": "ground",
                "profile": [(tube_inner, 0.0), (tube_outer, 0.0), (tube_outer, length), (tube_inner, length)],
            }
        )

    for index, (kind, zc) in enumerate(plate_centers(p)):
        thickness = plate_thickness_mm(p, kind)
        z0 = zc - thickness / 2.0
        z1 = zc + thickness / 2.0
        if kind == "hv":
            profile = rounded_outer_profile(core_r, hv_outer, z0, z1, edge_radius_mm(p, kind))
            material = "hv"
        else:
            profile = rounded_inner_profile(ground_inner, ground_outer, z0, z1, edge_radius_mm(p, kind))
            material = "ground"
        components.append({"name": f"{kind}_plate_{index:02d}", "material": material, "profile": profile})
    return components


def material_epsr(p: dict[str, Any], r: float, z_stack: float | None = None) -> float:
    return p["washer_epsr"] if material_region(p, r, z_stack) == "washer" else p["epoxy_epsr"]


def material_region(p: dict[str, Any], r: float, z_stack: float | None = None) -> str:
    washer_inner, washer_outer = washer_radial_bounds(p)
    if washer_inner <= r <= washer_outer and z_stack is not None and is_in_washer_gap(p, z_stack):
        return "washer"
    return "epoxy"


def classify_point(p: dict[str, Any], r: float, z_stack: float) -> tuple[str, float | None]:
    core_r = p["core_od_mm"] / 2.0
    hv_r = p["hv_plate_od_mm"] / 2.0
    ground_inner = p["ground_plate_inner_diameter_mm"] / 2.0
    ground_outer = p["ground_plate_od_mm"] / 2.0
    tube_inner = p["tube_id_mm"] / 2.0
    tube_outer = tube_inner + p["tube_wall_thickness_mm"]

    if r <= core_r:
        return ("hv", p["bias_voltage_v"])

    if p.get("include_ground_tube", True) and r >= tube_inner:
        return ("ground", 0.0)

    for kind, zc in plate_centers(p):
        thickness = plate_thickness_mm(p, kind)
        edge_radius = edge_radius_mm(p, kind)
        if kind == "hv" and rounded_outer_plate(r, z_stack, zc, core_r, hv_r, thickness, edge_radius):
            return ("hv", p["bias_voltage_v"])
        if kind == "ground" and rounded_inner_plate(r, z_stack, zc, ground_inner, ground_outer, thickness, edge_radius):
            return ("ground", 0.0)
    return ("dielectric", None)


def geometry_bounds(p: dict[str, Any]) -> dict[str, float]:
    margin = p["domain_margin_mm"]
    length = stack_length_mm(p)
    r_max = p["tube_id_mm"] / 2.0 + p["tube_wall_thickness_mm"] + margin
    z_min = -margin
    z_max = length + margin
    return {"r_max": r_max, "z_min": z_min, "z_max": z_max}


def sorted_unique_coords(values: list[float], lower: float, upper: float, tolerance: float = 1e-9) -> list[float]:
    coords: list[float] = []
    for value in sorted(values):
        value = min(max(value, lower), upper)
        if not coords or abs(value - coords[-1]) > tolerance:
            coords.append(value)
    if not coords or abs(coords[0] - lower) > tolerance:
        coords.insert(0, lower)
    if abs(coords[-1] - upper) > tolerance:
        coords.append(upper)
    return coords


def add_uniform_coords(values: list[float], lower: float, upper: float, count: int) -> None:
    n = max(2, int(count))
    for index in range(n):
        t = index / (n - 1)
        values.append(lower + t * (upper - lower))


def add_local_coords(values: list[float], center: float, radius: float, lower: float, upper: float) -> None:
    if radius <= 0.0:
        return
    start = max(lower, center - radius)
    end = min(upper, center + radius)
    if end <= start:
        return
    target_step = radius / 10.0
    intervals = max(1, math.ceil((end - start) / target_step))
    for index in range(intervals + 1):
        values.append(start + (index / intervals) * (end - start))


def add_probe_coords(values: list[float], center: float, radius: float, lower: float, upper: float) -> None:
    if radius <= 0.0:
        return
    for scale in (-1.0, -0.35, 0.0, 0.35, 1.0):
        values.append(min(max(center + scale * radius, lower), upper))


def edge_refinement_centers(p: dict[str, Any]) -> list[dict[str, float]]:
    core_r = p["core_od_mm"] / 2.0
    hv_outer = p["hv_plate_od_mm"] / 2.0
    ground_inner = p["ground_plate_inner_diameter_mm"] / 2.0
    ground_outer = p["ground_plate_od_mm"] / 2.0
    centers: list[dict[str, float]] = []
    for kind, zc in plate_centers(p):
        radius = edge_radius_mm(p, kind)
        if radius <= 0.0:
            continue
        half = plate_thickness_mm(p, kind) / 2.0
        radial_span = hv_outer - core_r if kind == "hv" else ground_outer - ground_inner
        local_radius = max(0.0, min(radius, half, radial_span / 2.0))
        if local_radius <= 0.0:
            continue
        r_center = hv_outer - local_radius if kind == "hv" else ground_inner + local_radius
        z_offset = half - local_radius
        centers.append({"r": r_center, "z": zc - z_offset, "radius": local_radius})
        centers.append({"r": r_center, "z": zc + z_offset, "radius": local_radius})
    return centers


def dielectric_probe_refinement_centers(p: dict[str, Any]) -> list[dict[str, float]]:
    core_r = p["core_od_mm"] / 2.0
    hv_outer = p["hv_plate_od_mm"] / 2.0
    ground_inner = p["ground_plate_inner_diameter_mm"] / 2.0
    ground_outer = p["ground_plate_od_mm"] / 2.0
    tube_inner = p["tube_id_mm"] / 2.0
    overlap_width = hv_outer - ground_inner
    centers: list[dict[str, float]] = []

    def offset_into_dielectric(clearance: float, radius: float) -> float | None:
        if clearance <= 0.0:
            return None
        return min(clearance * 0.35, max(clearance * 0.15, radius * 0.5))

    def probe_radius(clearance: float, radius: float) -> float:
        if clearance <= 0.0:
            return radius
        return max(0.05, min(clearance * 0.45, radius * 1.5))

    for kind, zc in plate_centers(p):
        radius = max(edge_radius_mm(p, kind), 0.05)
        half = plate_thickness_mm(p, kind) / 2.0
        radial_span = hv_outer - core_r if kind == "hv" else ground_outer - ground_inner
        local_radius = max(0.0, min(radius, half, radial_span / 2.0))
        if local_radius <= 0.0:
            continue
        z_offset = half - local_radius
        if kind == "hv":
            outer_limit = tube_inner if p.get("include_ground_tube", True) else hv_outer + p["domain_margin_mm"]
            clearance = outer_limit - hv_outer
            offset = offset_into_dielectric(clearance, radius)
            if offset is not None:
                r_probe = hv_outer + offset
                r_radius = probe_radius(clearance, radius)
                centers.append({"r": r_probe, "z": zc - z_offset, "r_radius": r_radius, "z_radius": local_radius})
                centers.append({"r": r_probe, "z": zc + z_offset, "r_radius": r_radius, "z_radius": local_radius})
        else:
            clearance = ground_inner - core_r
            offset = offset_into_dielectric(clearance, radius)
            if offset is not None:
                r_probe = ground_inner - offset
                r_radius = probe_radius(clearance, radius)
                centers.append({"r": r_probe, "z": zc - z_offset, "r_radius": r_radius, "z_radius": local_radius})
                centers.append({"r": r_probe, "z": zc + z_offset, "r_radius": r_radius, "z_radius": local_radius})

    if overlap_width > 0.0:
        radial_samples = [
            ground_inner + overlap_width * 0.25,
            ground_inner + overlap_width * 0.5,
            ground_inner + overlap_width * 0.75,
        ]
        plates = plate_centers(p)
        for index in range(len(plates) - 1):
            left_kind, left_z = plates[index]
            right_kind, right_z = plates[index + 1]
            if left_kind == right_kind:
                continue
            z0 = left_z + plate_thickness_mm(p, left_kind) / 2.0
            z1 = right_z - plate_thickness_mm(p, right_kind) / 2.0
            gap = z1 - z0
            if gap <= 0.0:
                continue
            z_probe = 0.5 * (z0 + z1)
            radius = max(edge_radius_mm(p, left_kind), edge_radius_mm(p, right_kind), 0.05)
            z_radius = max(0.05, min(gap * 0.5, radius * 1.5))
            r_radius = max(0.05, min(overlap_width * 0.2, radius * 1.5))
            for r_probe in radial_samples:
                centers.append({"r": r_probe, "z": z_probe, "r_radius": r_radius, "z_radius": z_radius})

    return centers


def build_grid(p: dict[str, Any], adaptive_coords: dict[str, list[float]] | None = None) -> dict[str, Any]:
    bounds = geometry_bounds(p)
    r_values: list[float] = []
    z_values: list[float] = []
    add_uniform_coords(r_values, 0.0, bounds["r_max"], int(p["grid_r_count"]))
    add_uniform_coords(z_values, bounds["z_min"], bounds["z_max"], int(p["grid_z_count"]))

    edge_centers = edge_refinement_centers(p)
    dielectric_probe_centers = dielectric_probe_refinement_centers(p)
    for center in edge_centers:
        add_local_coords(r_values, center["r"], center["radius"], 0.0, bounds["r_max"])
        add_local_coords(z_values, center["z"], center["radius"], bounds["z_min"], bounds["z_max"])
    for center in dielectric_probe_centers:
        add_probe_coords(r_values, center["r"], center["r_radius"], 0.0, bounds["r_max"])
        add_probe_coords(z_values, center["z"], center["z_radius"], bounds["z_min"], bounds["z_max"])

    if adaptive_coords:
        r_values.extend(adaptive_coords.get("r", []))
        z_values.extend(adaptive_coords.get("z", []))

    r_coords = sorted_unique_coords(r_values, 0.0, bounds["r_max"])
    z_coords = sorted_unique_coords(z_values, bounds["z_min"], bounds["z_max"])
    nr = len(r_coords)
    nz = len(z_coords)
    dr = bounds["r_max"] / (nr - 1)
    dz = (bounds["z_max"] - bounds["z_min"]) / (nz - 1)
    length = stack_length_mm(p)
    boundary_sample_min_distance = max(0.01, edge_radius_mm(p) / 10.0)

    voltage = [[p["bias_voltage_v"] * 0.5 for _ in range(nz)] for _ in range(nr)]
    fixed = [[False for _ in range(nz)] for _ in range(nr)]
    epsr = [[1.0 for _ in range(nz)] for _ in range(nr)]
    labels = [["dielectric" for _ in range(nz)] for _ in range(nr)]
    materials = [["epoxy" for _ in range(nz)] for _ in range(nr)]

    for i in range(nr):
        r = r_coords[i]
        for j in range(nz):
            z = z_coords[j]
            z_stack = min(max(z, 0.0), length)
            epsr[i][j] = material_epsr(p, r, z_stack)
            materials[i][j] = material_region(p, r, z_stack)
            label, value = classify_point(p, r, z_stack)
            labels[i][j] = label
            if value is not None:
                voltage[i][j] = value
                fixed[i][j] = True
            elif i == nr - 1:
                voltage[i][j] = 0.0
                fixed[i][j] = True

    return {
        "nr": nr,
        "nz": nz,
        "dr": dr,
        "dz": dz,
        "z_min": bounds["z_min"],
        "z_max": bounds["z_max"],
        "r_max": bounds["r_max"],
        "r_coords": r_coords,
        "z_coords": z_coords,
        "voltage": voltage,
        "fixed": fixed,
        "epsr": epsr,
        "labels": labels,
        "materials": materials,
        "boundary_sample_min_distance": boundary_sample_min_distance,
        "mesh": {
            "type": "nonuniform-structured-fd",
            "base_r_count": int(p["grid_r_count"]),
            "base_z_count": int(p["grid_z_count"]),
            "edge_refinement_centers": len(edge_centers),
            "dielectric_probe_centers": len(dielectric_probe_centers),
            "boundary_sample_min_distance": boundary_sample_min_distance,
            "adaptive_r_added": len(adaptive_coords.get("r", [])) if adaptive_coords else 0,
            "adaptive_z_added": len(adaptive_coords.get("z", [])) if adaptive_coords else 0,
            "final_r_count": nr,
            "final_z_count": nz,
        },
    }


def relax_grid(grid: dict[str, Any], p: dict[str, Any], max_sweeps: int) -> dict[str, float | int]:
    nr = grid["nr"]
    nz = grid["nz"]
    r_coords = grid["r_coords"]
    z_coords = grid["z_coords"]
    v = grid["voltage"]
    fixed = grid["fixed"]
    epsr = grid["epsr"]
    tolerance = float(p["solver_tolerance_v"])
    last_delta = 0.0
    sweeps = 0

    for _ in range(max_sweeps):
        max_delta = 0.0
        for i in range(1, nr - 1):
            h_rp = r_coords[i + 1] - r_coords[i]
            h_rm = r_coords[i] - r_coords[i - 1]
            r = max(r_coords[i], (r_coords[i + 1] - r_coords[i - 1]) * 0.25)
            r_face_p = 0.5 * (r_coords[i] + r_coords[i + 1])
            r_face_m = 0.5 * (r_coords[i] + r_coords[i - 1])
            radial_volume = 0.5 * (h_rp + h_rm)
            for j in range(1, nz - 1):
                if fixed[i][j]:
                    continue
                h_zp = z_coords[j + 1] - z_coords[j]
                h_zm = z_coords[j] - z_coords[j - 1]
                axial_volume = 0.5 * (h_zp + h_zm)
                erp = 0.5 * (epsr[i][j] + epsr[i + 1][j])
                erm = 0.5 * (epsr[i][j] + epsr[i - 1][j])
                ezp = 0.5 * (epsr[i][j] + epsr[i][j + 1])
                ezm = 0.5 * (epsr[i][j] + epsr[i][j - 1])
                ar_p = erp * r_face_p / (r * radial_volume * h_rp)
                ar_m = erm * r_face_m / (r * radial_volume * h_rm)
                az_p = ezp / (axial_volume * h_zp)
                az_m = ezm / (axial_volume * h_zm)
                denom = ar_p + ar_m + az_p + az_m
                new_v = (
                    ar_p * v[i + 1][j]
                    + ar_m * v[i - 1][j]
                    + az_p * v[i][j + 1]
                    + az_m * v[i][j - 1]
                ) / denom
                delta = abs(new_v - v[i][j])
                if delta > max_delta:
                    max_delta = delta
                v[i][j] = new_v
        v[0] = v[1][:]
        for i in range(nr):
            if not fixed[i][0]:
                v[i][0] = v[i][1]
            if not fixed[i][nz - 1]:
                v[i][nz - 1] = v[i][nz - 2]
        last_delta = max_delta
        if max_delta < tolerance:
            break
        sweeps += 1
    else:
        return {"sweeps": max_sweeps, "last_delta": last_delta}

    return {"sweeps": sweeps + 1, "last_delta": last_delta}


def field_from_grid(grid: dict[str, Any]) -> dict[str, Any]:
    nr = grid["nr"]
    nz = grid["nz"]
    r_coords = grid["r_coords"]
    z_coords = grid["z_coords"]
    v = grid["voltage"]

    raw_max_field = 0.0
    raw_max_location = (0.0, 0.0)
    field = [[0.0 for _ in range(nz)] for _ in range(nr)]
    raw_dielectric_peaks = {
        "washer": {"key": "washer", "maxField": 0.0, "maxLocation": {"r": 0.0, "z": 0.0}},
        "epoxy": {"key": "epoxy", "maxField": 0.0, "maxLocation": {"r": 0.0, "z": 0.0}},
    }
    boundary_sample_min_distance = float(grid.get("boundary_sample_min_distance", 0.0))

    def gradient_option(ni: int, nj: int, distance: float, value: float) -> float | None:
        if not math.isfinite(value) or distance <= 0.0:
            return None
        if grid["labels"][ni][nj] != "dielectric" and distance < boundary_sample_min_distance:
            return None
        return value

    for i in range(1, nr - 1):
        for j in range(1, nz - 1):
            if grid["labels"][i][j] != "dielectric":
                continue
            # Use one-cell dielectric-side face gradients rather than central
            # differences. Central differences near fixed conductor nodes span
            # through metal and can create false plate-hugging maxima.
            er_options = [
                gradient_option(
                    i + 1,
                    j,
                    r_coords[i + 1] - r_coords[i],
                    -(v[i + 1][j] - v[i][j]) / (r_coords[i + 1] - r_coords[i]),
                ),
                gradient_option(
                    i - 1,
                    j,
                    r_coords[i] - r_coords[i - 1],
                    -(v[i][j] - v[i - 1][j]) / (r_coords[i] - r_coords[i - 1]),
                ),
            ]
            ez_options = [
                gradient_option(
                    i,
                    j + 1,
                    z_coords[j + 1] - z_coords[j],
                    -(v[i][j + 1] - v[i][j]) / (z_coords[j + 1] - z_coords[j]),
                ),
                gradient_option(
                    i,
                    j - 1,
                    z_coords[j] - z_coords[j - 1],
                    -(v[i][j] - v[i][j - 1]) / (z_coords[j] - z_coords[j - 1]),
                ),
            ]
            er_options = [value for value in er_options if value is not None] or [0.0]
            ez_options = [value for value in ez_options if value is not None] or [0.0]
            e_mag = max(math.sqrt(er * er + ez * ez) for er in er_options for ez in ez_options)
            field[i][j] = e_mag
            if e_mag > raw_max_field:
                raw_max_field = e_mag
                raw_max_location = (r_coords[i], z_coords[j])
            material = grid["materials"][i][j]
            peak = raw_dielectric_peaks.get(material)
            if peak is not None and e_mag > peak["maxField"]:
                peak["maxField"] = e_mag
                peak["maxLocation"] = {"r": r_coords[i], "z": z_coords[j]}

    supported = supported_field_metrics(grid, field, raw_max_field, raw_max_location, raw_dielectric_peaks)

    return {
        "grid": grid,
        "max_field_v_per_mm": supported["max_field_v_per_mm"],
        "max_field_kv_per_mm": supported["max_field_v_per_mm"] / 1000.0,
        "max_location_mm": supported["max_location_mm"],
        "raw_max_field_v_per_mm": raw_max_field,
        "raw_max_field_kv_per_mm": raw_max_field / 1000.0,
        "raw_max_location_mm": {"r": raw_max_location[0], "z": raw_max_location[1]},
        "dielectric_peaks": supported["dielectric_peaks"],
        "raw_dielectric_peaks": raw_dielectric_peaks,
        "peak_quality": supported["peak_quality"],
        "field": field,
    }


def percentile(sorted_values: list[float], fraction: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    x = min(max(fraction, 0.0), 1.0) * (len(sorted_values) - 1)
    lower = math.floor(x)
    upper = math.ceil(x)
    if lower == upper:
        return sorted_values[lower]
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (x - lower)


def empty_dielectric_peak(key: str) -> dict[str, Any]:
    return {"key": key, "maxField": 0.0, "maxLocation": {"r": 0.0, "z": 0.0}}


def supported_field_metrics(
    grid: dict[str, Any],
    field: list[list[float]],
    raw_max_field: float,
    raw_max_location: tuple[float, float],
    raw_dielectric_peaks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a neighborhood-supported peak field and keep raw point diagnostics.

    The field near rounded conductor edges should be supported by several nearby
    dielectric samples. A single-cell point maximum that is far above its local
    same-material neighborhood is reported as raw diagnostic data, but it does
    not set the design-screening maximum.
    """
    nr = grid["nr"]
    nz = grid["nz"]
    r_coords = grid["r_coords"]
    z_coords = grid["z_coords"]
    labels = grid["labels"]
    materials = grid.get("materials") or [["epoxy" for _ in range(nz)] for _ in range(nr)]
    peaks = {
        "washer": empty_dielectric_peak("washer"),
        "epoxy": empty_dielectric_peak("epoxy"),
    }
    supported_max = 0.0
    supported_location = raw_max_location

    for i in range(1, nr - 1):
        for j in range(1, nz - 1):
            if labels[i][j] != "dielectric":
                continue
            value = field[i][j]
            if not math.isfinite(value) or value <= 0.0:
                continue
            material = materials[i][j]
            neighbors: list[float] = []
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ni = i + di
                    nj = j + dj
                    if labels[ni][nj] != "dielectric" or materials[ni][nj] != material:
                        continue
                    neighbor_value = field[ni][nj]
                    if math.isfinite(neighbor_value) and neighbor_value > 0.0:
                        neighbors.append(neighbor_value)
            if len(neighbors) < 4:
                neighbors = [
                    field[ni][nj]
                    for ni in range(max(1, i - 1), min(nr - 1, i + 2))
                    for nj in range(max(1, j - 1), min(nz - 1, j + 2))
                    if labels[ni][nj] == "dielectric" and math.isfinite(field[ni][nj]) and field[ni][nj] > 0.0
                ]
            if not neighbors:
                continue
            neighbors.sort()
            supported_value = min(value, percentile(neighbors, SUPPORTED_PEAK_PERCENTILE))
            if supported_value > supported_max:
                supported_max = supported_value
                supported_location = (r_coords[i], z_coords[j])
            peak = peaks.get(material)
            if peak is not None and supported_value > peak["maxField"]:
                peak["maxField"] = supported_value
                peak["maxLocation"] = {"r": r_coords[i], "z": z_coords[j]}

    if supported_max <= 0.0:
        supported_max = raw_max_field
        supported_location = raw_max_location
        if raw_dielectric_peaks:
            peaks = raw_dielectric_peaks

    outlier_ratio = raw_max_field / supported_max if supported_max > 0.0 else 1.0
    return {
        "max_field_v_per_mm": supported_max,
        "max_location_mm": {"r": supported_location[0], "z": supported_location[1]},
        "dielectric_peaks": peaks,
        "peak_quality": {
            "method": "same-material 3x3 neighborhood p75",
            "percentile": SUPPORTED_PEAK_PERCENTILE,
            "rawMaxField": raw_max_field,
            "rawMaxLocation": {"r": raw_max_location[0], "z": raw_max_location[1]},
            "supportedMaxField": supported_max,
            "supportedMaxLocation": {"r": supported_location[0], "z": supported_location[1]},
            "rawToSupportedRatio": outlier_ratio,
            "outlierSuspected": outlier_ratio > SUPPORTED_PEAK_OUTLIER_RATIO,
        },
    }


def lower_coord_index(coords: list[float], value: float) -> int:
    if value <= coords[0]:
        return 0
    for index in range(len(coords) - 1):
        if coords[index] <= value <= coords[index + 1]:
            return index
    return len(coords) - 2


def interpolated_voltage(source: dict[str, Any], r: float, z: float) -> float:
    i0 = lower_coord_index(source["r_coords"], r)
    j0 = lower_coord_index(source["z_coords"], z)
    i1 = min(i0 + 1, source["nr"] - 1)
    j1 = min(j0 + 1, source["nz"] - 1)
    r0 = source["r_coords"][i0]
    r1 = source["r_coords"][i1]
    z0 = source["z_coords"][j0]
    z1 = source["z_coords"][j1]
    tr = (r - r0) / (r1 - r0) if r1 > r0 else 0.0
    tz = (z - z0) / (z1 - z0) if z1 > z0 else 0.0
    v00 = source["voltage"][i0][j0]
    v10 = source["voltage"][i1][j0]
    v01 = source["voltage"][i0][j1]
    v11 = source["voltage"][i1][j1]
    v0 = v00 + tr * (v10 - v00)
    v1 = v01 + tr * (v11 - v01)
    return v0 + tz * (v1 - v0)


def seed_grid_from_previous(target: dict[str, Any], source: dict[str, Any]) -> None:
    for i, r in enumerate(target["r_coords"]):
        for j, z in enumerate(target["z_coords"]):
            if not target["fixed"][i][j]:
                target["voltage"][i][j] = interpolated_voltage(source, r, z)


def add_interval_midpoints(coords: list[float], values: list[float], index: int) -> None:
    if index > 0:
        values.append(0.5 * (coords[index - 1] + coords[index]))
    if index < len(coords) - 1:
        values.append(0.5 * (coords[index] + coords[index + 1]))


def adaptive_coords_from_field(result: dict[str, Any], p: dict[str, Any]) -> dict[str, Any] | None:
    if result["max_field_v_per_mm"] <= 0.0:
        return None
    grid = result["grid"]
    threshold = result["max_field_v_per_mm"] * FIELD_ADAPTIVE_THRESHOLD_FRACTION
    candidates: list[dict[str, float | int]] = []
    for i in range(1, grid["nr"] - 1):
        for j in range(1, grid["nz"] - 1):
            e_mag = result["field"][i][j]
            if grid["labels"][i][j] == "dielectric" and e_mag >= threshold:
                candidates.append({"i": i, "j": j, "e": e_mag})
    candidates.sort(key=lambda candidate: float(candidate["e"]), reverse=True)

    r_values: list[float] = []
    z_values: list[float] = []
    accepted: list[dict[str, float | int]] = []
    minimum_separation = max(edge_radius_mm(p) * 0.5, 1e-6)
    for candidate in candidates:
        if len(accepted) >= FIELD_ADAPTIVE_MAX_POINTS:
            break
        candidate_i = int(candidate["i"])
        candidate_j = int(candidate["j"])
        too_close = any(
            abs(grid["r_coords"][int(prior["i"])] - grid["r_coords"][candidate_i]) < minimum_separation
            and abs(grid["z_coords"][int(prior["j"])] - grid["z_coords"][candidate_j]) < minimum_separation
            for prior in accepted
        )
        if too_close:
            continue
        accepted.append(candidate)
        for di in range(-1, 2):
            ii = candidate_i + di
            if 0 < ii < grid["nr"] - 1:
                add_interval_midpoints(grid["r_coords"], r_values, ii)
        for dj in range(-1, 2):
            jj = candidate_j + dj
            if 0 < jj < grid["nz"] - 1:
                add_interval_midpoints(grid["z_coords"], z_values, jj)

    if not r_values and not z_values:
        return None
    return {"r": r_values, "z": z_values, "accepted_count": len(accepted)}


def solve(p: dict[str, Any]) -> dict[str, Any]:
    iterations = int(p["solver_iterations"])
    probe_grid = build_grid(p)
    probe_limit = min(iterations, FIELD_ADAPTIVE_PROBE_SWEEPS)
    probe_stats = relax_grid(probe_grid, p, probe_limit)
    probe_result = field_from_grid(probe_grid)
    adaptive_coords = adaptive_coords_from_field(probe_result, p)
    remaining_sweeps = max(0, iterations - int(probe_stats["sweeps"]))
    use_adaptive_grid = adaptive_coords is not None and remaining_sweeps > 0

    if use_adaptive_grid:
        grid = build_grid(p, adaptive_coords)
        seed_grid_from_previous(grid, probe_grid)
        final_stats = relax_grid(grid, p, remaining_sweeps)
        result = field_from_grid(grid)
        total_sweeps = int(probe_stats["sweeps"]) + int(final_stats["sweeps"])
        last_delta = float(final_stats["last_delta"])
        adaptive_summary = {
            "enabled": True,
            "probeSweeps": int(probe_stats["sweeps"]),
            "addedR": len(adaptive_coords["r"]),
            "addedZ": len(adaptive_coords["z"]),
            "highFieldPoints": adaptive_coords["accepted_count"],
        }
    else:
        result = probe_result
        total_sweeps = int(probe_stats["sweeps"])
        last_delta = float(probe_stats["last_delta"])
        adaptive_summary = {
            "enabled": False,
            "probeSweeps": int(probe_stats["sweeps"]),
            "addedR": 0,
            "addedZ": 0,
            "highFieldPoints": 0,
        }

    return {
        "parameters": p,
        "grid": result["grid"],
        "iterations_run": total_sweeps,
        "last_delta_v": last_delta,
        "max_field_v_per_mm": result["max_field_v_per_mm"],
        "max_field_kv_per_mm": result["max_field_kv_per_mm"],
        "max_location_mm": result["max_location_mm"],
        "raw_max_field_v_per_mm": result.get("raw_max_field_v_per_mm", result["max_field_v_per_mm"]),
        "raw_max_field_kv_per_mm": result.get("raw_max_field_kv_per_mm", result["max_field_kv_per_mm"]),
        "raw_max_location_mm": result.get("raw_max_location_mm", result["max_location_mm"]),
        "dielectric_peaks": result["dielectric_peaks"],
        "raw_dielectric_peaks": result.get("raw_dielectric_peaks"),
        "peak_quality": result.get("peak_quality"),
        "field": result["field"],
        "adaptive": adaptive_summary,
    }


def geometry_summary(p: dict[str, Any]) -> dict[str, Any]:
    length = stack_length_mm(p)
    components = []
    for component in component_profiles(p):
        components.append(
            {
                "name": component["name"],
                "material": component["material"],
                "profile_mm": [{"r": r, "z": z} for r, z in component["profile"]],
            }
        )
    return {
        "units": "mm",
        "length_mm": length,
        "components": components,
        "plates": [{"kind": kind, "z_center_mm": zc} for kind, zc in plate_centers(p)],
        "radii_mm": {
            "core": p["core_od_mm"] / 2.0,
            "ground_inner": p["ground_plate_inner_diameter_mm"] / 2.0,
            "hv_outer": p["hv_plate_od_mm"] / 2.0,
            "ground_outer": p["ground_plate_od_mm"] / 2.0,
            "tube_inner": p["tube_id_mm"] / 2.0,
            "tube_outer": p["tube_id_mm"] / 2.0 + p["tube_wall_thickness_mm"],
        },
        "dielectrics": {
            "conductive_core_epsr_parameter": p["ferrite_epsr"],
            "core_adjacent_epoxy_epsr": p["epoxy_epsr"],
            "washer_overlap_epsr": p["washer_epsr"],
            "epoxy_fill_epsr": p["epoxy_epsr"],
        },
        "conductors": {
            "plate_material": p.get("plate_material", "copper"),
            "plate_conductivity_log10_s_per_m": p.get("plate_conductivity_log10_s_per_m"),
            "plate_relative_permeability": p.get("plate_relative_permeability"),
            "tube_material": p.get("tube_material", "copper"),
            "tube_conductivity_log10_s_per_m": p.get("tube_conductivity_log10_s_per_m"),
            "tube_relative_permeability": p.get("tube_relative_permeability"),
            "ground_tube_included": bool(p.get("include_ground_tube", True)),
            "ground_tube_boundary": "0 V Dirichlet conductor when included",
            "rf_compare_frequency_log10_mhz": p.get("rf_compare_frequency_log10_mhz"),
        },
        "notes": [
            "Axisymmetric r-z model.",
            "HV flow holes are omitted from this first-order field model.",
            "All HV conductors are held at the full bias voltage for local field screening.",
            "Current electrostatic solver treats conductors as equipotential boundaries; conductivity and permeability fields are carried for future RF/quasi-static backends.",
            "Ground plate OD is intended to contact the ground tube ID when the tube is included.",
            "HV plate rounding applies to the outer radial edge; ground plate rounding applies to the inner radial edge.",
        ],
    }


def scad_points(points: list[tuple[float, float]]) -> str:
    return "[" + ", ".join(f"[{r:.6g}, {z:.6g}]" for r, z in points) + "]"


def write_openscad(p: dict[str, Any], path: Path) -> None:
    colors = {
        "hv": [0.72, 0.24, 0.24, 1.0],
        "ground": [0.33, 0.48, 0.22, 1.0],
        "core": [0.54, 0.36, 0.19, 0.55],
        "washer": [0.84, 0.72, 0.36, 0.35],
        "epoxy": [0.73, 0.86, 0.84, 0.22],
    }
    lines = [
        "// Generated from hardware/geometry/default-parameters.json",
        "// Units: millimeters. Axis of revolution is OpenSCAD Z.",
        "$fn = 128;",
        "",
        "module rz_body(points) {",
        "  rotate_extrude(convexity = 10) polygon(points = points);",
        "}",
        "",
    ]
    for component in component_profiles(p):
        rgba = colors[component["material"]]
        color_text = ", ".join(f"{v:.3g}" for v in rgba)
        lines.append(f"// {component['name']}")
        lines.append(f"color([{color_text}]) rz_body({scad_points(component['profile'])});")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def profile_to_mesh(profile: list[tuple[float, float]], segments: int = 96) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    count = len(profile)
    for segment in range(segments):
        theta = 2.0 * math.pi * segment / segments
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        for r, z in profile:
            vertices.append((r * cos_t, r * sin_t, z))
    for segment in range(segments):
        next_segment = (segment + 1) % segments
        for index in range(count):
            next_index = (index + 1) % count
            a = segment * count + index
            b = next_segment * count + index
            c = next_segment * count + next_index
            d = segment * count + next_index
            if profile[index][0] == 0.0 and profile[next_index][0] == 0.0:
                continue
            faces.append((a, b, c))
            faces.append((a, c, d))
    return vertices, faces


def write_obj_and_stl(p: dict[str, Any], obj_path: Path, mtl_path: Path, stl_path: Path) -> None:
    material_colors = {
        "hv": (0.72, 0.24, 0.24),
        "ground": (0.33, 0.48, 0.22),
        "core": (0.54, 0.36, 0.19),
        "washer": (0.84, 0.72, 0.36),
        "epoxy": (0.73, 0.86, 0.84),
    }
    mtl_lines = []
    for material, color in material_colors.items():
        mtl_lines.extend([f"newmtl {material}", f"Kd {color[0]:.4f} {color[1]:.4f} {color[2]:.4f}", "Ka 0.0500 0.0500 0.0500", ""])
    mtl_path.write_text("\n".join(mtl_lines), encoding="utf-8")

    obj_lines = [f"mtllib {mtl_path.name}"]
    stl_lines = ["solid shv_bias_filter"]
    vertex_offset = 1
    for component in component_profiles(p):
        vertices, faces = profile_to_mesh(component["profile"])
        obj_lines.append(f"o {component['name']}")
        obj_lines.append(f"usemtl {component['material']}")
        for x, y, z in vertices:
            obj_lines.append(f"v {x:.6f} {y:.6f} {z:.6f}")
        for a, b, c in faces:
            obj_lines.append(f"f {a + vertex_offset} {b + vertex_offset} {c + vertex_offset}")
            p1 = vertices[a]
            p2 = vertices[b]
            p3 = vertices[c]
            stl_lines.append("  facet normal 0 0 0")
            stl_lines.append("    outer loop")
            stl_lines.append(f"      vertex {p1[0]:.6f} {p1[1]:.6f} {p1[2]:.6f}")
            stl_lines.append(f"      vertex {p2[0]:.6f} {p2[1]:.6f} {p2[2]:.6f}")
            stl_lines.append(f"      vertex {p3[0]:.6f} {p3[1]:.6f} {p3[2]:.6f}")
            stl_lines.append("    endloop")
            stl_lines.append("  endfacet")
        vertex_offset += len(vertices)
    stl_lines.append("endsolid shv_bias_filter")
    obj_path.write_text("\n".join(obj_lines), encoding="utf-8")
    stl_path.write_text("\n".join(stl_lines), encoding="utf-8")


def write_cad_outputs(p: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    write_openscad(p, output_dir / "latest-model.scad")
    write_obj_and_stl(
        p,
        output_dir / "latest-model.obj",
        output_dir / "latest-model.mtl",
        output_dir / "latest-model.stl",
    )


def svg_header(width: int, height: int) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n'


def write_geometry_svg(p: dict[str, Any], path: Path) -> None:
    width = 980
    height = 560
    margin = 44
    summary = geometry_summary(p)
    length = summary["length_mm"]
    r_max = summary["radii_mm"]["tube_outer"] + p["domain_margin_mm"]
    sx = (width - 2 * margin) / length
    sy = (height - 2 * margin) / r_max

    def x_for(z: float) -> float:
        return margin + z * sx

    def y_for(r: float) -> float:
        return height - margin - r * sy

    parts = [svg_header(width, height)]
    parts.append('<rect width="100%" height="100%" fill="#f7f5ef"/>\n')
    parts.append(f'<line x1="{margin}" y1="{y_for(0)}" x2="{width - margin}" y2="{y_for(0)}" stroke="#333" stroke-width="1"/>\n')

    core_r = p["core_od_mm"] / 2.0
    parts.append(f'<rect x="{x_for(0)}" y="{y_for(core_r)}" width="{length * sx}" height="{core_r * sy}" fill="#8a5b30" opacity="0.65"/>\n')

    for kind, zc in plate_centers(p):
        thickness = plate_thickness_mm(p, kind)
        z0 = zc - thickness / 2.0
        if kind == "hv":
            r0 = core_r
            r1 = p["hv_plate_od_mm"] / 2.0
            fill = "#b73e3e"
        else:
            r0 = p["ground_plate_inner_diameter_mm"] / 2.0
            r1 = p["ground_plate_od_mm"] / 2.0
            fill = "#557a38"
        parts.append(
            f'<rect x="{x_for(z0)}" y="{y_for(r1)}" width="{thickness * sx}" '
            f'height="{(r1 - r0) * sy}" rx="4" fill="{fill}" opacity="0.9"/>\n'
        )

    if p.get("include_ground_tube", True):
        tube_r = p["tube_id_mm"] / 2.0
        tube_outer = tube_r + p["tube_wall_thickness_mm"]
        parts.append(
            f'<rect x="{x_for(0)}" y="{y_for(tube_outer)}" width="{length * sx}" '
            f'height="{(tube_outer - tube_r) * sy}" fill="#384b2b" opacity="0.8"/>\n'
        )

    parts.append('<text x="44" y="28" font-family="Arial" font-size="18" fill="#1c2630">Axisymmetric half-section geometry</text>\n')
    parts.append("</svg>\n")
    path.write_text("".join(parts), encoding="utf-8")


def field_color(value: float, max_value: float) -> str:
    if max_value <= 0.0:
        return "#1f2933"
    t = min(1.0, max(0.0, value / max_value))
    if t < 0.5:
        u = t / 0.5
        r = int(31 + u * (43 - 31))
        g = int(87 + u * (111 - 87))
        b = int(103 + u * (109 - 103))
    else:
        u = (t - 0.5) / 0.5
        r = int(43 + u * (183 - 43))
        g = int(111 + u * (62 - 111))
        b = int(109 + u * (62 - 109))
    return f"#{r:02x}{g:02x}{b:02x}"


def field_display_color(grid: dict[str, Any], field: list[list[float]], max_field: float, i: int, j: int) -> str:
    label = grid.get("labels", [])[i][j]
    if label == "hv":
        return "#b73e3e"
    if label == "ground":
        return "#557a38"
    return field_color(field[i][j], max_field)


def write_field_svg(result: dict[str, Any], path: Path) -> None:
    grid = result["grid"]
    field = result["field"]
    nr = grid["nr"]
    nz = grid["nz"]
    width = 980
    height = 560
    margin = 44
    sx = (width - 2 * margin) / (grid["z_max"] - grid["z_min"])
    sy = (height - 2 * margin) / grid["r_max"]
    max_field = result["max_field_v_per_mm"]
    parts = [svg_header(width, height)]
    parts.append('<rect width="100%" height="100%" fill="#f7f5ef"/>\n')

    r_coords = grid.get("r_coords")
    z_coords = grid.get("z_coords")
    for i in range(1, nr - 1):
        if r_coords:
            r_lo = 0.5 * (r_coords[i - 1] + r_coords[i])
            r_hi = 0.5 * (r_coords[i] + r_coords[i + 1])
            y = height - margin - r_hi * sy
            cell_h = max(1.0, (r_hi - r_lo) * sy)
        else:
            y = height - margin - i * grid["dr"] * sy
            cell_h = max(1.0, sy * grid["dr"])
        for j in range(1, nz - 1):
            if z_coords:
                z_lo = 0.5 * (z_coords[j - 1] + z_coords[j])
                z_hi = 0.5 * (z_coords[j] + z_coords[j + 1])
                x = margin + (z_lo - grid["z_min"]) * sx
                cell_w = max(1.0, (z_hi - z_lo) * sx)
            else:
                x = margin + (grid["z_min"] + j * grid["dz"] - grid["z_min"]) * sx
                cell_w = max(1.0, sx * grid["dz"])
            color = field_display_color(grid, field, max_field, i, j)
            parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{cell_w:.2f}" height="{cell_h:.2f}" fill="{color}"/>\n')

    parts.append(
        f'<text x="44" y="28" font-family="Arial" font-size="18" fill="#1c2630">'
        f'Supported field {result["max_field_kv_per_mm"]:.3f} kV/mm '
        f'(raw point {result.get("raw_max_field_kv_per_mm", result["max_field_kv_per_mm"]):.3f} kV/mm)</text>\n'
    )
    parts.append("</svg>\n")
    path.write_text("".join(parts), encoding="utf-8")


def write_outputs(result: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "iterations_run": result["iterations_run"],
        "last_delta_v": result["last_delta_v"],
        "max_field_v_per_mm": result["max_field_v_per_mm"],
        "max_field_kv_per_mm": result["max_field_kv_per_mm"],
        "max_location_mm": result["max_location_mm"],
        "raw_max_field_v_per_mm": result.get("raw_max_field_v_per_mm"),
        "raw_max_field_kv_per_mm": result.get("raw_max_field_kv_per_mm"),
        "raw_max_location_mm": result.get("raw_max_location_mm"),
        "peak_quality": result.get("peak_quality"),
        "adaptive": result.get("adaptive"),
        "mesh": result["grid"].get("mesh"),
        "geometry": geometry_summary(result["parameters"]),
    }
    (output_dir / "latest-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_geometry_svg(result["parameters"], output_dir / "latest-geometry.svg")
    write_field_svg(result, output_dir / "latest-field.svg")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("export", "solve", "cad"))
    parser.add_argument("--parameters", type=Path, default=DEFAULT_PARAMETERS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--cad-dir", type=Path, default=DEFAULT_CAD_DIR)
    args = parser.parse_args()

    parameters = load_parameters(args.parameters)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.command == "export":
        summary = geometry_summary(parameters)
        (args.output_dir / "latest-geometry.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        write_geometry_svg(parameters, args.output_dir / "latest-geometry.svg")
        write_cad_outputs(parameters, args.cad_dir)
        print(json.dumps(summary, indent=2))
        return

    if args.command == "cad":
        write_cad_outputs(parameters, args.cad_dir)
        print(json.dumps({"cad_dir": str(args.cad_dir), "files": ["latest-model.scad", "latest-model.obj", "latest-model.mtl", "latest-model.stl"]}, indent=2))
        return

    result = solve(parameters)
    write_outputs(result, args.output_dir)
    write_cad_outputs(parameters, args.cad_dir)
    print(
        json.dumps(
            {
                "iterations_run": result["iterations_run"],
                "last_delta_v": result["last_delta_v"],
                "max_field_kv_per_mm": result["max_field_kv_per_mm"],
                "max_location_mm": result["max_location_mm"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
