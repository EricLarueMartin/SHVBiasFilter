#!/usr/bin/env python3
"""Tests for the staged field-solve backend."""

from __future__ import annotations

import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import field_backend
import fenicsx_solver
import axisymmetric_model
import spice_ladder


class FieldBackendTests(unittest.TestCase):
    def test_adjacent_pair_capacitance_energy_polarization_cancels_ground_terms(self) -> None:
        # Middle Cg = 33 pF, neighbor Cg total = 68 pF, and each of two
        # adjacent mutual capacitances is 0.4 pF.
        result = fenicsx_solver._adjacent_pair_capacitance_from_energies(
            middle_only_pf=33.8,
            neighbors_only_pf=68.8,
            all_bias_pf=101.0,
            neighbor_count=2,
        )
        self.assertAlmostEqual(result, 0.4)

    def test_parallel_plate_cpar_reference_matches_type61_limiting_case(self) -> None:
        params = axisymmetric_model.load_parameters(axisymmetric_model.DEFAULT_PARAMETERS)
        params.update({
            "core_material": "type61",
            "ferrite_epsr": 12.0,
            "use_direct_stage_circuit": False,
            "core_od_mm": 2.0,
            "core_to_ground_gap_mm": 2.0,
            "hv_plate_od_mm": 8.0,
        })
        self.assertAlmostEqual(
            fenicsx_solver._analytic_parallel_plate_cpar_pf(params),
            0.25358071031137513,
        )

    def test_direct_stage_resistance_and_capacitance_modes_are_independent(self) -> None:
        params = axisymmetric_model.load_parameters(axisymmetric_model.DEFAULT_PARAMETERS)
        calculated = spice_ladder.circuit_estimates(params)
        entered = spice_ladder.circuit_estimates(axisymmetric_model.normalize_parameters({
            **params,
            "use_direct_stage_capacitance": True,
            "melf_stage_parasitic_pf": 0.3,
        }))

        self.assertEqual(calculated["stageResistanceOhm"], 12e6)
        self.assertAlmostEqual(calculated["parasiticPf"], 0.36632062406919774)
        self.assertAlmostEqual(entered["parasiticPf"], 0.5129042943308157)

    def test_output_series_resistance_is_entered_in_ohms(self) -> None:
        params = field_backend.sanitized_parameters({"output_series_resistance_ohm": 50.0})
        circuit = spice_ladder.circuit_estimates(params)
        self.assertEqual(spice_ladder.series_resistance_ohm(params, circuit, "output"), 50.0)

        legacy = field_backend.sanitized_parameters({"output_series_resistance_mohm": 0.00005})
        legacy_circuit = spice_ladder.circuit_estimates(legacy)
        self.assertEqual(spice_ladder.series_resistance_ohm(legacy, legacy_circuit, "output"), 50.0)

    def test_femtofarad_scale_capacitance_is_preserved(self) -> None:
        params = field_backend.sanitized_parameters({
            "melf_stage_parasitic_pf": 0.001,
            "detector_capacitance_pf": 0.0001,
        })
        self.assertEqual(params["melf_stage_parasitic_pf"], 0.001)
        self.assertEqual(params["detector_capacitance_pf"], 0.0001)

    def test_sanitized_parameters_derive_geometry_and_clamp_solver_cost(self) -> None:
        params = field_backend.sanitized_parameters(
            {
                "core_od_mm": 6.0,
                "core_to_ground_gap_mm": 2.0,
                "tube_id_mm": 36.0,
                "hv_to_tube_gap_mm": 2.0,
                "grid_r_count": 9999,
                "grid_z_count": 9999,
                "solver_iterations": 999999,
                "edge_diameter_percent": 100,
                "load_current_na": 123.0,
            }
        )

        self.assertEqual(params["ground_plate_inner_diameter_mm"], 10.0)
        self.assertEqual(params["ground_plate_od_mm"], 36.0)
        self.assertEqual(params["hv_plate_od_mm"], 32.0)
        self.assertEqual(params["solve_strategy"], field_backend.SOLVE_STRATEGY_FULL_STACK)
        self.assertLessEqual(params["grid_r_count"], field_backend.MAX_GRID_R_COUNT)
        self.assertLessEqual(params["grid_z_count"], field_backend.MAX_GRID_Z_COUNT)
        self.assertLessEqual(params["solver_iterations"], field_backend.MAX_SOLVER_ITERATIONS)
        self.assertAlmostEqual(params["edge_radius_mm"], params["plate_thickness_mm"] / 2.0)
        self.assertEqual(params["load_current_na"], 123.0)
        self.assertFalse(params["use_direct_stage_capacitance"])

    def test_http_queue_returns_distinct_jobs_and_completed_result(self) -> None:
        with self._temporary_job_dir() as temp_dir:
            state = field_backend.BackendState(
                static_dir=field_backend.DEFAULT_STATIC_DIR,
                job_dir=Path(temp_dir),
                worker_count=1,
            )
            server = ThreadingHTTPServer(("127.0.0.1", 0), field_backend.make_handler(state))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"

            try:
                first = self._post_json(
                    base_url + "/api/field-solve",
                    {"client_id": "test-a", "solver": "auto", "parameters": self._small_parameters()},
                )
                second = self._post_json(
                    base_url + "/api/field-solve",
                    {"client_id": "test-b", "solver": "fd", "parameters": self._small_parameters()},
                )

                self.assertEqual(first["status"], "queued")
                self.assertEqual(second["status"], "queued")
                self.assertEqual(first["solver"], "auto")
                self.assertEqual(second["solver"], "fd")
                self.assertNotEqual(first["job_id"], second["job_id"])

                completed = self._wait_for_complete(base_url, first["job_id"])
                self.assertEqual(completed["status"], "complete")
                self.assertEqual(completed["solver"], "auto")
                result = completed["result"]
                self.assertEqual(result["solverStatus"]["requested"], "auto")
                self.assertIn(result["solverStatus"]["effective"], {"fd", "fenicsx"})
                expected_source = (
                    "fea-backend-fenicsx"
                    if result["solverStatus"]["effective"] == "fenicsx"
                    else "fea-backend-axisymmetric-fd"
                )
                self.assertEqual(result["source"], expected_source)
                self.assertEqual(completed["source"], expected_source)
                self.assertEqual(result["solveStrategy"], field_backend.SOLVE_STRATEGY_FULL_STACK)
                self.assertTrue(result["symmetryPlan"]["stack_is_mirror_symmetric"])
                self.assertIn(result["symmetryPlan"]["mirror_plate_kind"], {"ground", "hv"})
                self.assertTrue(result["symmetryValidation"]["required_before_using_reduced_strategy"])
                self.assertEqual(result["symmetryValidation"]["reference_strategy"], field_backend.SOLVE_STRATEGY_FULL_STACK)
                self.assertGreater(result["maxField"], 0)
                self.assertIn("bounds", result["grid"])
                self.assertIn("zMin", result["grid"]["bounds"])
                self.assertIn("zMax", result["grid"]["bounds"])
                self.assertIn("rMax", result["grid"]["bounds"])
                self.assertIn("rCoords", result["grid"])
                self.assertIn("zCoords", result["grid"])
                self.assertIn("mesh", result["grid"])
                self.assertEqual(len(result["grid"]["rCoords"]), result["grid"]["nr"])
                self.assertEqual(len(result["grid"]["zCoords"]), result["grid"]["nz"])
                expected_mesh_type = (
                    "gmsh-dolfinx-conforming"
                    if result["solverStatus"]["effective"] == "fenicsx"
                    else "nonuniform-structured-fd"
                )
                self.assertEqual(result["grid"]["mesh"]["type"], expected_mesh_type)
                if result["solverStatus"]["effective"] == "fd":
                    self.assertTrue(result["adaptive"]["enabled"])
                self.assertIn("r", result["maxLocation"])
                self.assertIn("z", result["maxLocation"])
                self.assertGreater(result["iterations"], 0)
                self.assertIn("lastDelta", result)
                self.assertEqual(len(result["field"]), result["grid"]["nr"])
                self.assertTrue((Path(temp_dir) / first["job_id"] / "result.json").is_file())

                health = self._get_json(base_url + "/api/health")
                self.assertEqual(health["status"], "ok")
            finally:
                server.shutdown()
                server.server_close()
                state.stop()
                thread.join(timeout=2.0)

    def test_static_serving_blocks_path_traversal(self) -> None:
        with self._temporary_job_dir() as temp_dir:
            state = field_backend.BackendState(field_backend.DEFAULT_STATIC_DIR, Path(temp_dir))
            server = ThreadingHTTPServer(("127.0.0.1", 0), field_backend.make_handler(state))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"

            try:
                index = urllib.request.urlopen(base_url + "/index.html", timeout=5).read().decode("utf-8")
                self.assertIn("SHV Bias Filter", index)

                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(base_url + "/../hardware/geometry/default-parameters.json", timeout=5)
                self.assertEqual(raised.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                state.stop()
                thread.join(timeout=2.0)

    def test_geometry_endpoint_returns_solver_component_profiles(self) -> None:
        with self._temporary_job_dir() as temp_dir:
            state = field_backend.BackendState(field_backend.DEFAULT_STATIC_DIR, Path(temp_dir))
            server = ThreadingHTTPServer(("127.0.0.1", 0), field_backend.make_handler(state))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"

            try:
                raw_parameters = self._small_parameters()
                payload = self._post_json(base_url + "/api/geometry", {"parameters": raw_parameters})
                self.assertEqual(payload["status"], "ok")
                geometry = payload["geometry"]
                self.assertEqual(geometry["units"], "mm")
                components = geometry["components"]
                washer_components = [component for component in components if component["material"] == "washer"]
                self.assertTrue(washer_components)

                params = field_backend.sanitized_parameters(raw_parameters)
                washer_inner, washer_outer = field_backend.axisymmetric_model.washer_radial_bounds(params)
                profile = washer_components[0]["profile_mm"]
                radii = {round(point["r"], 6) for point in profile}
                self.assertIn(round(washer_inner, 6), radii)
                self.assertIn(round(washer_outer, 6), radii)
                self.assertIn(round(params["ground_plate_inner_diameter_mm"] / 2.0, 6), radii)
                self.assertIn(round(params["hv_plate_od_mm"] / 2.0, 6), radii)
            finally:
                server.shutdown()
                server.server_close()
                state.stop()
                thread.join(timeout=2.0)

    def test_spice_ladder_endpoint_returns_transmission_line_sweep(self) -> None:
        with self._temporary_job_dir() as temp_dir:
            state = field_backend.BackendState(field_backend.DEFAULT_STATIC_DIR, Path(temp_dir))
            server = ThreadingHTTPServer(("127.0.0.1", 0), field_backend.make_handler(state))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"

            try:
                raw_parameters = self._small_parameters()
                raw_parameters.update(
                    {
                        "load_cable_length_m": 10.0,
                        "load_cable_impedance_ohm": 50.0,
                        "load_cable_velocity_factor": 0.66,
                        "detector_capacitance_pf": 10.0,
                    }
                )
                payload = self._post_json(base_url + "/api/spice-ladder", {"parameters": raw_parameters})
                self.assertEqual(payload["status"], "ok")
                self.assertIn(payload["source"], {"backend-spice-style-mna", "ngspice-ac"})
                self.assertIn(payload["method"], {"internal-spice-style-ac-mna", "ngspice-batch-ac"})
                self.assertIn("Tload", payload["netlist"])
                self.assertIn("Rin", payload["netlist"])
                self.assertIn("Rout", payload["netlist"])
                self.assertEqual(payload["circuit"]["stages"], raw_parameters["plate_pairs"])
                self.assertEqual(payload["circuit"]["internalResistiveSections"], raw_parameters["plate_pairs"] - 1)
                self.assertEqual(payload["circuit"]["resistiveSections"], raw_parameters["plate_pairs"] + 1)
                self.assertGreater(payload["circuit"]["inputSeriesResistanceOhm"], 0.0)
                self.assertEqual(payload["circuit"]["outputSeriesResistanceOhm"], 50.0)
                self.assertGreater(payload["circuit"]["cableCapPf"], 0.0)
                self.assertGreater(payload["circuit"]["detectorCapPf"], 0.0)
                self.assertGreater(len(payload["samples"]), 10)
                first = payload["samples"][0]
                self.assertIn("fullTline", first)
                self.assertIn("fullLumped", first)
                self.assertIn("scaledStage", first)
                self.assertGreaterEqual(payload["summary"]["at50Hz"]["fullTlineAttenuationDb"], 0.0)
            finally:
                server.shutdown()
                server.server_close()
                state.stop()
                thread.join(timeout=2.0)

    def test_symmetry_plan_marks_mirror_half_as_exact(self) -> None:
        params = self._small_parameters()
        params["plate_pairs"] = 5
        params = field_backend.sanitized_parameters(params)

        plan = field_backend.stack_symmetry_plan(params)
        strategies = {strategy["name"]: strategy for strategy in plan["available_strategies"]}

        self.assertTrue(plan["stack_is_mirror_symmetric"])
        self.assertAlmostEqual(plan["mirror_z_mm"], field_backend.axisymmetric_model.stack_length_mm(params) / 2.0)
        self.assertEqual(plan["recommended_default"], field_backend.SOLVE_STRATEGY_MIRROR_HALF)
        self.assertEqual(
            set(strategies),
            {field_backend.SOLVE_STRATEGY_FULL_STACK, field_backend.SOLVE_STRATEGY_MIRROR_HALF},
        )
        self.assertIn(field_backend.SOLVE_STRATEGY_FULL_STACK, strategies)
        self.assertIn(field_backend.SOLVE_STRATEGY_MIRROR_HALF, strategies)
        self.assertTrue(strategies[field_backend.SOLVE_STRATEGY_MIRROR_HALF]["is_exact_for_this_idealized_stack"])

    def test_symmetry_validation_plan_requires_full_stack_reference(self) -> None:
        params = field_backend.sanitized_parameters(self._small_parameters())
        validation = field_backend.symmetry_validation_plan(params)
        check_names = {check["name"] for check in validation["checks"]}

        self.assertTrue(validation["required_before_using_reduced_strategy"])
        self.assertEqual(validation["reference_strategy"], field_backend.SOLVE_STRATEGY_FULL_STACK)
        self.assertEqual(validation["validation_type"], "code_regression_for_exact_symmetry")
        self.assertEqual(validation["candidate_strategies"], [field_backend.SOLVE_STRATEGY_MIRROR_HALF])
        self.assertIn(field_backend.SOLVE_STRATEGY_MIRROR_HALF, validation["candidate_strategies"])
        self.assertIn("peak_field", check_names)
        self.assertIn("mirrored_field_map", check_names)

    def test_custom_washer_bounds_can_leave_rounded_edge_pockets_as_epoxy(self) -> None:
        raw_parameters = self._small_parameters()
        raw_parameters["washer_id_matches_ground"] = False
        raw_parameters["washer_od_matches_bias"] = False
        raw_parameters["washer_id_mm"] = raw_parameters["ground_plate_inner_diameter_mm"] + 1.0
        raw_parameters["washer_od_mm"] = raw_parameters["hv_plate_od_mm"] - 1.0
        params = field_backend.sanitized_parameters(raw_parameters)
        washer_inner, washer_outer = field_backend.axisymmetric_model.washer_radial_bounds(params)
        gap_z0, gap_z1 = field_backend.axisymmetric_model.washer_gap_intervals(params)[0]
        z_mid = 0.5 * (gap_z0 + gap_z1)

        self.assertGreater(washer_inner, params["ground_plate_inner_diameter_mm"] / 2.0)
        self.assertLess(washer_outer, params["hv_plate_od_mm"] / 2.0)
        self.assertEqual(field_backend.axisymmetric_model.material_region(params, washer_inner - 0.01, z_mid), "epoxy")
        self.assertEqual(field_backend.axisymmetric_model.material_region(params, washer_inner + 0.01, z_mid), "washer")
        self.assertEqual(field_backend.axisymmetric_model.material_region(params, washer_outer - 0.01, z_mid), "washer")
        self.assertEqual(field_backend.axisymmetric_model.material_region(params, washer_outer + 0.01, z_mid), "epoxy")

    def _small_parameters(self) -> dict[str, float | int | bool]:
        params = field_backend.load_default_parameters()
        params.update(
            {
                "grid_r_count": 24,
                "grid_z_count": 34,
                "solver_iterations": 120,
                "solver_tolerance_v": 0.2,
            }
        )
        return params

    def _temporary_job_dir(self):
        root = field_backend.ROOT / "simulations" / "axisymmetric" / "test_jobs_tmp"
        root.mkdir(parents=True, exist_ok=True)
        path = root / uuid.uuid4().hex
        path.mkdir()

        class ScratchDir:
            def __enter__(self) -> str:
                return str(path)

            def __exit__(self, exc_type, exc, traceback) -> bool:
                return False

        return ScratchDir()

    def _wait_for_complete(self, base_url: str, job_id: str) -> dict[str, object]:
        deadline = time.time() + 10.0
        while time.time() < deadline:
            payload = self._get_json(f"{base_url}/api/field-solve/{job_id}")
            if payload["status"] == "complete":
                return payload
            if payload["status"] == "failed":
                self.fail(str(payload.get("error", "job failed")))
            time.sleep(0.1)
        self.fail("Timed out waiting for backend job")

    def _post_json(self, url: str, payload: dict[str, object]) -> dict[str, object]:
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _get_json(self, url: str) -> dict[str, object]:
        with urllib.request.urlopen(url, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
