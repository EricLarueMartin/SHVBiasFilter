const defaults = {
  units: "mm",
  bias_voltage_v: 6000,
  core_volume_resistivity_log10_ohm_cm: 8,
  use_direct_stage_circuit: true,
  use_direct_stage_capacitance: false,
  melf_stage_resistance_mohm: 12,
  melf_stage_resistance_log10_ohm: Math.log10(12e6),
  melf_stage_parasitic_pf: 0.3,
  melf_substrate_epsr: 9.8,
  melf_metal_fill_factor: 0.5,
  input_series_resistance_mohm: 12,
  output_series_resistance_ohm: 50,
  input_series_matches_stage: true,
  output_series_matches_stage: false,
  load_current_na: 1,
  load_cable_length_m: 10,
  load_cable_impedance_ohm: 50,
  load_cable_velocity_factor: 0.66,
  detector_capacitance_pf: 10,
  core_resistance_gohm: 0.01,
  core_od_mm: 2.2,
  core_material: "mmb0207_melf",
  ferrite_epsr: 6,
  core_to_ground_gap_mm: 2.2,
  hv_to_tube_gap_mm: 2,
  hv_plate_od_mm: 18.8,
  ground_plate_inner_diameter_mm: 6.6,
  washer_id_mm: 6.6,
  washer_od_mm: 18.8,
  washer_id_matches_ground: true,
  washer_od_matches_bias: true,
  ground_plate_od_mm: 22.8,
  tube_id_mm: 22.8,
  plate_gap_mm: 1.4,
  plate_thickness_mm: 1.5,
  bias_plate_thickness_mm: 1.5,
  ground_plate_thickness_mm: 1.5,
  ground_matches_bias_thickness: true,
  edge_diameter_percent: 100,
  washer_material: "alumina",
  washer_epsr: 10,
  epoxy_material: "mg_9510",
  epoxy_epsr: 3.4,
  plate_material: "copper",
  plate_conductivity_log10_s_per_m: Math.log10(5.8e7),
  plate_relative_permeability: 1,
  tube_material: "copper",
  tube_conductivity_log10_s_per_m: Math.log10(5.8e7),
  tube_relative_permeability: 1,
  rf_compare_frequency_log10_mhz: 0,
  plate_pairs: 2,
  include_ground_tube: true,
  field_solver: "backend_auto",
  mesh_edge_radius_ratio: 0.2,
  tube_wall_thickness_mm: 1,
  domain_margin_mm: 4,
  // Browser fallback solver controls. These match the finite-difference
  // backend defaults so a static local page gives the same screening result
  // when the Python service is unavailable.
  grid_r_count: 90,
  grid_z_count: 150,
  solver_iterations: 700,
  solver_tolerance_v: 0.01,
  solve_strategy: "full_stack"
};

const FIELD_SOLVER_ENDPOINT = "/api/field-solve";
const GEOMETRY_ENDPOINT = "/api/geometry";
const SPICE_LADDER_ENDPOINT = "/api/spice-ladder";
const FIELD_SOLVER_CONNECT_TIMEOUT_MS = 1800;
const GEOMETRY_CONNECT_TIMEOUT_MS = 900;
const SPICE_CONNECT_TIMEOUT_MS = 1800;
const FIELD_SOLVER_POLL_MS = 850;
const FIELD_SOLVER_JOB_TIMEOUT_MS = 120000;
const FIELD_ADAPTIVE_PROBE_SWEEPS = 90;
const FIELD_ADAPTIVE_MAX_POINTS = 18;
const FIELD_ADAPTIVE_THRESHOLD_FRACTION = 0.45;
const SUPPORTED_PEAK_PERCENTILE = 0.75;
const SUPPORTED_PEAK_OUTLIER_RATIO = 1.35;
const MIN_RADIAL_OVERLAP_MM = 1;
const MIN_HV_PLATE_OD_MM = 12;
const MIN_WASHER_RADIAL_WIDTH_MM = 0.1;
const MAX_BACKEND_RADIAL_GAP_MM = 50;
const SPEED_OF_LIGHT_M_PER_S = 299792458;
const ATTENUATION_PLOT_FMIN_HZ = 1;
const ATTENUATION_PLOT_FMAX_HZ = 100e6;
const CUSTOM_SPACING_RANGE_MM = { min: 0.4, max: 4 };
const BREAKDOWN_DESIGN_FACTOR_MAX = 10;
const fieldSolverOptions = {
  browser_js: {
    label: "Browser JS adaptive",
    modelLabel: "Browser adaptive FD",
    backendSolver: null
  },
  backend_auto: {
    label: "Backend auto",
    modelLabel: "Backend auto",
    backendSolver: "auto"
  },
  backend_fd: {
    label: "Backend adaptive FD",
    modelLabel: "Backend adaptive FD",
    backendSolver: "fd"
  },
  backend_fenicsx: {
    label: "FEniCSx required",
    modelLabel: "FEniCSx",
    backendSolver: "fenicsx"
  }
};

let params = structuredClone(defaults);
let lastResult = null;
let slideResultCache = null;
let backendGeometryCache = null;
let backendGeometryRequestId = 0;
let backendGeometryPendingKey = null;
let backendGeometryDisabled = false;
let spiceLadderCache = null;
let spiceLadderRequestId = 0;
let spiceLadderPendingKey = null;
let spiceLadderDisabled = false;
const customControlRanges = {};
const defaultControlRanges = {};
const defaultCadView = {
  yaw: -0.52,
  pitch: -0.86,
  zoom: 1,
  panX: 0,
  panY: 0,
  cutaway: true
};

let cadView = structuredClone(defaultCadView);

const ids = [
  "bias_voltage_v",
  "core_volume_resistivity_log10_ohm_cm",
  "melf_stage_resistance_mohm",
  "melf_stage_parasitic_pf",
  "melf_substrate_epsr",
  "melf_metal_fill_factor",
  "input_series_resistance_mohm",
  "output_series_resistance_ohm",
  "load_current_na",
  "load_cable_length_m",
  "load_cable_impedance_ohm",
  "load_cable_velocity_factor",
  "detector_capacitance_pf",
  "ferrite_epsr",
  "washer_epsr",
  "epoxy_epsr",
  "rf_compare_frequency_log10_mhz",
  "plate_conductivity_log10_s_per_m",
  "plate_relative_permeability",
  "tube_conductivity_log10_s_per_m",
  "tube_relative_permeability",
  "core_od_mm",
  "hv_plate_od_mm",
  "washer_id_mm",
  "washer_od_mm",
  "core_to_ground_gap_mm",
  "hv_to_tube_gap_mm",
  "plate_gap_mm",
  "bias_plate_thickness_mm",
  "ground_plate_thickness_mm",
  "edge_diameter_percent",
  "mesh_edge_radius_ratio",
  "plate_pairs"
];

const units = {
  bias_voltage_v: " V",
  core_volume_resistivity_log10_ohm_cm: "",
  melf_stage_resistance_mohm: " MΩ",
  melf_stage_parasitic_pf: " pF",
  melf_substrate_epsr: "",
  melf_metal_fill_factor: "",
  load_current_na: " nA",
  load_cable_length_m: " m",
  load_cable_impedance_ohm: " Ω",
  load_cable_velocity_factor: "",
  detector_capacitance_pf: " pF",
  ferrite_epsr: "",
  washer_epsr: "",
  epoxy_epsr: "",
  rf_compare_frequency_log10_mhz: "",
  plate_conductivity_log10_s_per_m: "",
  plate_relative_permeability: "",
  tube_conductivity_log10_s_per_m: "",
  tube_relative_permeability: "",
  core_od_mm: " mm",
  hv_plate_od_mm: " mm",
  washer_id_mm: " mm",
  washer_od_mm: " mm",
  tube_id_mm: " mm",
  core_to_ground_gap_mm: " mm",
  hv_to_tube_gap_mm: " mm",
  plate_gap_mm: " mm",
  plate_thickness_mm: " mm",
  bias_plate_thickness_mm: " mm",
  ground_plate_thickness_mm: " mm",
  edge_diameter_percent: "%",
  mesh_edge_radius_ratio: "",
  plate_pairs: ""
};

const EPSILON_0_F_PER_M = 8.8541878128e-12;
const MU_0_H_PER_M = 4 * Math.PI * 1e-7;
const FR4_WASHER_EPSR = 4.4;
const DEFAULT_EPOXY_BREAKDOWN_KV_PER_MM = 15;
const DEFAULT_MELF0207_STAGE_RESISTANCE_OHM = 12e6;
const coreMaterialPresets = {
  type61: { label: "Fair-Rite 61 NiZn", epsr: 12, resistivityLog10: 8, componentName: "Type 61 core" },
  nizn: { label: "NiZn ferrite", epsr: 15, resistivityLog10: 8, componentName: "NiZn ferrite core" },
  mmb0204_melf: {
    label: "MELF 0204 10M",
    epsr: 6,
    melfSubstrateEpsr: 9.8,
    melfMetalFillFactor: 0.45,
    resistivityLog10: Math.log10(633000),
    coreOdMm: 1.4,
    minPairLengthMm: 3.6,
    stageResistanceOhm: 10e6,
    stageParasiticPf: 0.2,
    defaultDirectStageResistance: true,
    defaultDirectStageCapacitance: false,
    componentName: "0204 MELF core"
  },
  mmb0207_melf: {
    label: "MELF 0207 12M",
    epsr: 6,
    melfSubstrateEpsr: 9.8,
    melfMetalFillFactor: 0.5,
    resistivityLog10: Math.log10(633000),
    coreOdMm: 2.2,
    minPairLengthMm: 5.8,
    stageResistanceOhm: DEFAULT_MELF0207_STAGE_RESISTANCE_OHM,
    stageParasiticPf: 0.3,
    defaultDirectStageResistance: true,
    defaultDirectStageCapacitance: false,
    componentName: "0207 MELF core"
  },
  epoxy_chain: {
    label: "MELF chain in 9510",
    epsr: 3.4,
    resistivityLog10: 8.1,
    stageResistanceOhm: 240e6,
    stageParasiticPf: 0.5,
    defaultDirectStageResistance: true,
    defaultDirectStageCapacitance: true,
    componentName: "MELF/epoxy core"
  },
  conductive_epoxy: { label: "Conductive epoxy", epsr: 4, resistivityLog10: -3, componentName: "Conductive epoxy core" }
};
const washerMaterialPresets = {
  fr4: { label: "FR4/G10", epsr: FR4_WASHER_EPSR, breakdownKvPerMm: 20, componentName: "FR4/G10 washer" },
  macor: { label: "Macor", epsr: 6, breakdownKvPerMm: 40, componentName: "Macor washer" },
  alumina: { label: "Alumina", epsr: 10, breakdownKvPerMm: 13, componentName: "Alumina washer" },
  rutile_tio2: { label: "Rutile TiO₂", epsr: 100, breakdownKvPerMm: null, componentName: "Rutile TiO₂ washer" },
  strontium_titanate: { label: "Strontium titanate SrTiO₃", epsr: 300, breakdownKvPerMm: null, componentName: "SrTiO₃ washer" },
  zirconia: { label: "Zirconia/ZTA", epsr: 25, breakdownKvPerMm: 10, componentName: "Zirconia/ZTA washer" },
  high_k: { label: "High-K screen only", epsr: 100, breakdownKvPerMm: null, componentName: "High-K screening washer" }
};
const epoxyMaterialPresets = {
  mg_9510: { label: "MG Chemicals 9510", epsr: 3.4, breakdownKvPerMm: DEFAULT_EPOXY_BREAKDOWN_KV_PER_MM, componentName: "MG 9510 epoxy fill" },
  generic_potting: { label: "Generic potting epoxy", epsr: 3.2, breakdownKvPerMm: DEFAULT_EPOXY_BREAKDOWN_KV_PER_MM, componentName: "Generic epoxy fill" },
  low_k_epoxy: { label: "Low-k epoxy", epsr: 2.8, breakdownKvPerMm: DEFAULT_EPOXY_BREAKDOWN_KV_PER_MM, componentName: "Low-k epoxy fill" }
};
const conductorMaterialPresets = {
  copper: { label: "Copper", conductivity: 5.8e7, mur: 1 },
  aluminum: { label: "Aluminum", conductivity: 3.5e7, mur: 1 },
  brass: { label: "Brass", conductivity: 1.6e7, mur: 1 },
  stainless_316: { label: "316 stainless", conductivity: 1.35e6, mur: 1.02 }
};
const hvSpacingControlIds = [
  "core_to_ground_gap_mm",
  "hv_to_tube_gap_mm",
  "plate_gap_mm",
  "bias_plate_thickness_mm",
  "ground_plate_thickness_mm"
];

function isDynamicallyConstrainedControl(id) {
  return hvSpacingControlIds.includes(id)
    || id === "hv_plate_od_mm"
    || id === "washer_id_mm"
    || id === "washer_od_mm";
}

function corePresetForElectrical(epsr, resistivityLog10) {
  const match = Object.entries(coreMaterialPresets)
    .find(([, preset]) => Math.abs(preset.epsr - epsr) < 0.05 && Math.abs(preset.resistivityLog10 - resistivityLog10) < 0.05);
  return match ? match[0] : "custom";
}

function usesDirectStageCircuit(p) {
  return Boolean(p.use_direct_stage_circuit);
}

function usesDirectStageCapacitance(p) {
  return Boolean(p.use_direct_stage_capacitance);
}

function usesMelfCoreModel(p) {
  return String(p.core_material || "").startsWith("mmb020");
}

function melfEffectiveEpsr(p) {
  const substrate = clamp(Number(p.melf_substrate_epsr) || 9.8, 1, 1000);
  const fillFactor = clamp(Number(p.melf_metal_fill_factor) || 0, 0, 0.95);
  return substrate / Math.max(0.05, 1 - fillFactor);
}

function coreCapacitanceEpsr(p) {
  return usesMelfCoreModel(p) ? melfEffectiveEpsr(p) : p.ferrite_epsr;
}

function applyDirectStageDefaultsForMaterial(p) {
  const preset = coreMaterialPresets[p.core_material];
  if (!preset) return;
  if (Number.isFinite(preset.stageResistanceOhm)) {
    p.melf_stage_resistance_mohm = preset.stageResistanceOhm / 1e6;
    p.melf_stage_resistance_log10_ohm = Math.log10(preset.stageResistanceOhm);
  }
  if (Number.isFinite(preset.stageParasiticPf)) {
    p.melf_stage_parasitic_pf = preset.stageParasiticPf;
  }
  if (Number.isFinite(preset.melfSubstrateEpsr)) {
    p.melf_substrate_epsr = preset.melfSubstrateEpsr;
  }
  if (Number.isFinite(preset.melfMetalFillFactor)) {
    p.melf_metal_fill_factor = preset.melfMetalFillFactor;
  }
}

function washerPresetForEpsr(epsr) {
  const match = Object.entries(washerMaterialPresets)
    .find(([, preset]) => Math.abs(preset.epsr - epsr) < 0.05);
  return match ? match[0] : "custom";
}

function epoxyPresetForEpsr(epsr) {
  const match = Object.entries(epoxyMaterialPresets)
    .find(([, preset]) => Math.abs(preset.epsr - epsr) < 0.05);
  return match ? match[0] : "custom";
}

function conductorPresetForElectrical(conductivityLog10, mur) {
  const match = Object.entries(conductorMaterialPresets)
    .find(([, preset]) => Math.abs(Math.log10(preset.conductivity) - conductivityLog10) < 0.035 && Math.abs(preset.mur - mur) < 0.05);
  return match ? match[0] : "custom";
}

function coreComponentName(p) {
  return coreMaterialPresets[p.core_material]?.componentName || "Custom core";
}

function washerComponentName(p) {
  return washerMaterialPresets[p.washer_material]?.componentName || "Custom washer";
}

function epoxyComponentName(p) {
  return epoxyMaterialPresets[p.epoxy_material]?.componentName || "Custom epoxy fill";
}

function plateConductorName(p) {
  return conductorMaterialPresets[p.plate_material]?.label || "Custom conductor";
}

function tubeConductorName(p) {
  return conductorMaterialPresets[p.tube_material]?.label || "Custom conductor";
}

function washerGapIntervals(p) {
  const plates = plateCenters(p);
  const intervals = [];
  for (let index = 0; index < plates.length - 1; index += 1) {
    const [leftKind, leftZ] = plates[index];
    const [rightKind, rightZ] = plates[index + 1];
    if (leftKind === rightKind) continue;
    const z0 = leftZ + plateThicknessMm(p, leftKind) / 2;
    const z1 = rightZ - plateThicknessMm(p, rightKind) / 2;
    if (z1 > z0) intervals.push([z0, z1]);
  }
  return intervals;
}

function washerRadialBounds(p) {
  const tubeInner = p.tube_id_mm / 2;
  const inner = (p.washer_id_matches_ground ? p.ground_plate_inner_diameter_mm : p.washer_id_mm) / 2;
  const outer = (p.washer_od_matches_bias ? p.hv_plate_od_mm : p.washer_od_mm) / 2;
  const clampedInner = clamp(inner, 0, Math.max(0, tubeInner));
  const clampedOuter = clamp(outer, 0, Math.max(0, tubeInner));
  return {
    inner: clampedInner,
    outer: clampedOuter,
    hasWasher: clampedOuter > clampedInner
  };
}

function isInWasherGap(p, zStack) {
  return washerGapIntervals(p).some(([z0, z1]) => zStack >= z0 && zStack <= z1);
}

function materialRegion(p, r, zStack = null) {
  const washerBounds = washerRadialBounds(p);
  if (
    washerBounds.hasWasher
    && r >= washerBounds.inner
    && r <= washerBounds.outer
    && zStack !== null
    && isInWasherGap(p, zStack)
  ) return "washer";
  return "epoxy";
}

function dielectricDefinitions(p) {
  return [
    {
      key: "washer",
      shortLabel: "Washer",
      label: washerComponentName(p),
      breakdownKvPerMm: washerMaterialPresets[p.washer_material]?.breakdownKvPerMm ?? null
    },
    {
      key: "epoxy",
      shortLabel: "Epoxy",
      label: epoxyComponentName(p),
      breakdownKvPerMm: epoxyMaterialPresets[p.epoxy_material]?.breakdownKvPerMm ?? null
    }
  ];
}

function stackLength(p) {
  const nGround = p.plate_pairs + 1;
  const nHv = p.plate_pairs;
  return nGround * groundPlateThicknessMm(p) + nHv * biasPlateThicknessMm(p) + (nGround + nHv - 1) * p.plate_gap_mm;
}

function plateCenters(p) {
  const centers = [];
  let lastThickness = groundPlateThicknessMm(p);
  let z = lastThickness / 2;
  centers.push(["ground", z]);
  for (let i = 0; i < p.plate_pairs; i += 1) {
    z += lastThickness / 2 + p.plate_gap_mm + biasPlateThicknessMm(p) / 2;
    centers.push(["hv", z]);
    lastThickness = biasPlateThicknessMm(p);
    z += lastThickness / 2 + p.plate_gap_mm + groundPlateThicknessMm(p) / 2;
    centers.push(["ground", z]);
    lastThickness = groundPlateThicknessMm(p);
  }
  return centers;
}

function biasPlateThicknessMm(p) {
  return Number.isFinite(p.bias_plate_thickness_mm)
    ? p.bias_plate_thickness_mm
    : Number.isFinite(p.plate_thickness_mm)
      ? p.plate_thickness_mm
      : defaults.bias_plate_thickness_mm;
}

function groundPlateThicknessMm(p) {
  if (p.ground_matches_bias_thickness) return biasPlateThicknessMm(p);
  return Number.isFinite(p.ground_plate_thickness_mm)
    ? p.ground_plate_thickness_mm
    : Number.isFinite(p.plate_thickness_mm)
      ? p.plate_thickness_mm
      : defaults.ground_plate_thickness_mm;
}

function plateThicknessMm(p, kind) {
  return kind === "hv" ? biasPlateThicknessMm(p) : groundPlateThicknessMm(p);
}

function edgeRadiusMm(p, kind = null) {
  const rawPercent = Number.isFinite(p.edge_diameter_percent)
    ? p.edge_diameter_percent
    : defaults.edge_diameter_percent;
  const percent = Math.max(0, Math.min(100, rawPercent));
  if (kind) return (plateThicknessMm(p, kind) * percent) / 200;
  return Math.min(edgeRadiusMm(p, "hv"), edgeRadiusMm(p, "ground"));
}

function melfMinPairLengthMm(p) {
  const minPairLength = coreMaterialPresets[p.core_material]?.minPairLengthMm;
  return Number.isFinite(minPairLength) ? minPairLength : null;
}

function platePairAxialLengthMm(p) {
  return biasPlateThicknessMm(p) + groundPlateThicknessMm(p) + 2 * p.plate_gap_mm;
}

function minimumMelfPlateGapMm(p) {
  const minLength = melfMinPairLengthMm(p);
  if (!Number.isFinite(minLength)) return 0;
  return Math.max(0, (minLength - biasPlateThicknessMm(p) - groundPlateThicknessMm(p)) / 2);
}

function setModelStatus(text) {
  document.getElementById("modelStatus").textContent = text;
}

function clientId() {
  const key = "shv_bias_filter_client_id";
  try {
    let value = window.localStorage.getItem(key);
    if (!value) {
      value = window.crypto?.randomUUID?.() || `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return "browser";
  }
}

function backendParameters(p) {
  const backendParams = structuredClone(p);
  backendParams.plate_thickness_mm = biasPlateThicknessMm(p);
  backendParams.bias_plate_thickness_mm = biasPlateThicknessMm(p);
  backendParams.ground_plate_thickness_mm = groundPlateThicknessMm(p);
  backendParams.edge_radius_mm = edgeRadiusMm(p);
  backendParams.bias_edge_radius_mm = edgeRadiusMm(p, "hv");
  backendParams.ground_edge_radius_mm = edgeRadiusMm(p, "ground");
  delete backendParams.field_solver;
  return backendParams;
}

function comparableResultParameters(p) {
  return JSON.stringify(backendParameters(p));
}

function selectedFieldSolver() {
  return fieldSolverOptions[params.field_solver] || fieldSolverOptions.backend_auto;
}

function backendSolverForRequest() {
  return selectedFieldSolver().backendSolver;
}

function clamp(value, min, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, value));
}

function numericAttribute(input, name, fallback) {
  const value = Number.parseFloat(input.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function controlRange(id, fallbackMin = Number.NEGATIVE_INFINITY, fallbackMax = Number.POSITIVE_INFINITY) {
  const custom = customControlRanges[id];
  if (custom && Number.isFinite(custom.min) && Number.isFinite(custom.max)) {
    const customMin = Math.min(custom.min, custom.max);
    const customMax = Math.max(custom.min, custom.max);
    const constrainCustom = isDynamicallyConstrainedControl(id);
    const min = constrainCustom && Number.isFinite(fallbackMin) ? Math.max(customMin, fallbackMin) : customMin;
    const max = constrainCustom && Number.isFinite(fallbackMax) ? Math.min(customMax, fallbackMax) : customMax;
    return min <= max ? { min, max } : { min, max: min };
  }
  if (Number.isFinite(fallbackMin) || Number.isFinite(fallbackMax)) {
    return { min: fallbackMin, max: fallbackMax };
  }
  const base = defaultControlRanges[id];
  if (base) return { min: base.min, max: base.max };
  const input = document.getElementById(id);
  if (!input) return { min: fallbackMin, max: fallbackMax };
  return {
    min: numericAttribute(input, "min", fallbackMin),
    max: numericAttribute(input, "max", fallbackMax)
  };
}

function setRangeInputBounds(id, min, max, step = null) {
  const input = document.getElementById(id);
  if (!input) return;
  const custom = customControlRanges[id];
  const constrainCustom = isDynamicallyConstrainedControl(id);
  const lower = custom
    ? (constrainCustom ? Math.max(Math.min(custom.min, custom.max), min) : Math.min(custom.min, custom.max))
    : min;
  const upper = custom
    ? (constrainCustom ? Math.min(Math.max(custom.min, custom.max), max) : Math.max(custom.min, custom.max))
    : max;
  input.min = Math.min(lower, upper);
  input.max = Math.max(input.min, upper);
  if (step !== null) input.step = step;
  const manual = document.getElementById(`${id}_manual`);
  if (manual) {
    manual.min = input.min;
    manual.max = input.max;
    manual.step = input.step;
  }
}

function spacingRangeForWasher(p) {
  const preset = washerMaterialPresets[p.washer_material];
  if (!Number.isFinite(preset?.breakdownKvPerMm)) {
    return { ...CUSTOM_SPACING_RANGE_MM };
  }
  const min = Math.max(0.1, Math.ceil((p.bias_voltage_v / 1000 / preset.breakdownKvPerMm) * 10) / 10);
  return {
    min,
    max: Math.round(min * BREAKDOWN_DESIGN_FACTOR_MAX * 10) / 10
  };
}

function minHvPlateOdForGeometry(p) {
  const groundInner = p.core_od_mm + 2 * p.core_to_ground_gap_mm;
  return Math.max(MIN_HV_PLATE_OD_MM, groundInner + 2 * MIN_RADIAL_OVERLAP_MM);
}

function derivedGeometry(p) {
  const tubeId = p.hv_plate_od_mm + 2 * p.hv_to_tube_gap_mm;
  return {
    groundPlateInnerDiameter: p.core_od_mm + 2 * p.core_to_ground_gap_mm,
    tubeId,
    groundPlateOd: tubeId
  };
}

function minimumSpacingForMaterial(preset, biasVoltageV) {
  if (!Number.isFinite(preset?.breakdownKvPerMm)) return CUSTOM_SPACING_RANGE_MM.min;
  return Math.max(0.1, Math.ceil((biasVoltageV / 1000 / preset.breakdownKvPerMm) * 10) / 10);
}

function coreGroundGapRange(p) {
  const min = minimumSpacingForMaterial(epoxyMaterialPresets[p.epoxy_material], p.bias_voltage_v);
  const geometryMax = (p.hv_plate_od_mm - p.core_od_mm - 2 * MIN_RADIAL_OVERLAP_MM) / 2;
  return {
    min,
    max: Math.max(min, Math.min(MAX_BACKEND_RADIAL_GAP_MM, geometryMax))
  };
}

function applyDerivedGeometry(p) {
  const derived = derivedGeometry(p);
  p.ground_plate_inner_diameter_mm = derived.groundPlateInnerDiameter;
  p.tube_id_mm = derived.tubeId;
  p.ground_plate_od_mm = derived.groundPlateOd;
}

function applyWasherGeometry(p) {
  const minWidthDiameter = 2 * MIN_WASHER_RADIAL_WIDTH_MM;
  const minId = Math.max(0.1, p.core_od_mm);
  const maxOd = Math.max(p.hv_plate_od_mm, p.tube_id_mm);
  p.washer_id_matches_ground = p.washer_id_matches_ground !== false;
  p.washer_od_matches_bias = p.washer_od_matches_bias !== false;
  if (!Number.isFinite(p.washer_id_mm)) p.washer_id_mm = p.ground_plate_inner_diameter_mm;
  if (!Number.isFinite(p.washer_od_mm)) p.washer_od_mm = p.hv_plate_od_mm;

  if (p.washer_id_matches_ground) p.washer_id_mm = p.ground_plate_inner_diameter_mm;
  if (p.washer_od_matches_bias) p.washer_od_mm = p.hv_plate_od_mm;

  if (!p.washer_id_matches_ground) {
    const maxId = Math.max(minId, p.washer_od_mm - minWidthDiameter);
    p.washer_id_mm = clamp(p.washer_id_mm, minId, maxId);
  }
  if (!p.washer_od_matches_bias) {
    const minOd = p.washer_id_mm + minWidthDiameter;
    p.washer_od_mm = clamp(p.washer_od_mm, minOd, Math.max(minOd, maxOd));
  }
}

function syncDynamicRanges() {
  const spacingRange = spacingRangeForWasher(params);
  const coreGapRange = coreGroundGapRange(params);
  for (const id of hvSpacingControlIds) {
    const min = id === "core_to_ground_gap_mm"
      ? coreGapRange.min
      : id === "plate_gap_mm"
        ? Math.max(spacingRange.min, minimumMelfPlateGapMm(params))
        : spacingRange.min;
    const max = id === "core_to_ground_gap_mm" ? coreGapRange.max : spacingRange.max;
    setRangeInputBounds(id, min, max, 0.1);
  }
  const hvOdInput = document.getElementById("hv_plate_od_mm");
  const hvOdBaseMax = defaultControlRanges.hv_plate_od_mm?.max ?? numericAttribute(hvOdInput, "max", 56);
  setRangeInputBounds("hv_plate_od_mm", minHvPlateOdForGeometry(params), hvOdBaseMax, 0.5);
  const washerIdMax = Math.max(params.core_od_mm, params.washer_od_mm - 2 * MIN_WASHER_RADIAL_WIDTH_MM);
  setRangeInputBounds("washer_id_mm", params.core_od_mm, washerIdMax, 0.1);
  const washerOdMin = params.washer_id_mm + 2 * MIN_WASHER_RADIAL_WIDTH_MM;
  setRangeInputBounds("washer_od_mm", washerOdMin, Math.max(washerOdMin, params.tube_id_mm), 0.1);
}

const engineeringPrefixMultipliers = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  m: 1e-3,
  u: 1e-6,
  "µ": 1e-6,
  "μ": 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15
};

function controlInternalUnitInSi(id) {
  if (id.endsWith("_resistance_mohm")) return 1e6;
  if (id.endsWith("_resistance_ohm") || id.endsWith("_impedance_ohm")) return 1;
  if (id.endsWith("_pf")) return 1e-12;
  if (id.endsWith("_na")) return 1e-9;
  if (id.endsWith("_mm")) return 1e-3;
  if (id.endsWith("_length_m")) return 1;
  if (id.endsWith("_voltage_v")) return 1;
  return null;
}

function controlValueFromInput(id, value) {
  const text = String(value).trim();
  if (id === "plate_pairs") return Number.parseInt(text, 10);
  const match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([TGMkKmuµμnpf])?\s*(?:[a-zA-ZΩΩ]+)?$/);
  if (!match) return Number.NaN;
  const number = Number.parseFloat(match[1]);
  const prefix = match[2];
  if (!prefix) return number;
  const internalUnitInSi = controlInternalUnitInSi(id);
  if (!Number.isFinite(internalUnitInSi)) return Number.NaN;
  return number * engineeringPrefixMultipliers[prefix] / internalUnitInSi;
}

function updateMaterialSelectionsForControl(id) {
  if (id === "ferrite_epsr" || id === "core_volume_resistivity_log10_ohm_cm") {
    params.core_material = corePresetForElectrical(params.ferrite_epsr, params.core_volume_resistivity_log10_ohm_cm);
  }
  if (id === "washer_epsr") params.washer_material = washerPresetForEpsr(params.washer_epsr);
  if (id === "epoxy_epsr") params.epoxy_material = epoxyPresetForEpsr(params.epoxy_epsr);
  if (id === "plate_conductivity_log10_s_per_m" || id === "plate_relative_permeability") {
    params.plate_material = conductorPresetForElectrical(params.plate_conductivity_log10_s_per_m, params.plate_relative_permeability);
  }
  if (id === "tube_conductivity_log10_s_per_m" || id === "tube_relative_permeability") {
    params.tube_material = conductorPresetForElectrical(params.tube_conductivity_log10_s_per_m, params.tube_relative_permeability);
  }
}

function applyControlValue(id, value) {
  const parsed = controlValueFromInput(id, value);
  if (!Number.isFinite(parsed)) return;
  const range = controlRange(id);
  if (parsed < range.min || parsed > range.max) {
    customControlRanges[id] = {
      min: Math.min(range.min, parsed),
      max: Math.max(range.max, parsed)
    };
  }
  params[id] = parsed;
  updateMaterialSelectionsForControl(id);
  normalizeParams();
  syncControls();
  drawCadModel();
  drawGeometry();
  clearField();
}

function decimalsFromStep(step) {
  const text = String(step || "");
  if (!text.includes(".")) return 0;
  return Math.min(6, text.split(".")[1].length);
}

function formatManualControlValue(id, value) {
  if (!Number.isFinite(value)) return "";
  if (id === "plate_pairs") return `${Math.round(value)}`;
  return Number(value.toPrecision(12)).toString();
}

function setupManualControlInput(id) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}_out`);
  if (!input || !output || document.getElementById(`${id}_manual`)) return;
  defaultControlRanges[id] = {
    min: numericAttribute(input, "min", Number.NEGATIVE_INFINITY),
    max: numericAttribute(input, "max", Number.POSITIVE_INFINITY),
    step: input.step || "any"
  };

  const valueWrap = document.createElement("span");
  valueWrap.className = "control-value-edit";
  output.replaceWith(valueWrap);
  valueWrap.appendChild(output);

  const manual = document.createElement("input");
  manual.id = `${id}_manual`;
  manual.className = "control-number";
  manual.type = "text";
  manual.inputMode = "decimal";
  manual.step = input.step || "any";
  manual.min = input.min;
  manual.max = input.max;
  manual.value = formatManualControlValue(id, params[id]);
  manual.title = "Enter an exact value. Engineering prefixes T, G, M, k, m, u/µ, n, p, and f are supported.";
  valueWrap.appendChild(manual);

  manual.addEventListener("change", () => applyControlValue(id, manual.value));
  manual.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyControlValue(id, manual.value);
      manual.blur();
    }
  });

  input.title = `${input.title ? `${input.title} ` : ""}Right-click to edit slider min/max.`;
  input.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openRangeEditor(id, event.clientX, event.clientY);
  });
}

function rangeEditorElement() {
  let editor = document.getElementById("rangeEditor");
  if (editor) return editor;
  editor = document.createElement("form");
  editor.id = "rangeEditor";
  editor.className = "range-editor";
  editor.innerHTML = `
    <strong>Slider range</strong>
    <label>Min <input id="rangeEditorMin" type="text" inputmode="decimal"></label>
    <label>Max <input id="rangeEditorMax" type="text" inputmode="decimal"></label>
    <div>
      <button type="submit">Apply</button>
      <button type="button" id="rangeEditorReset">Reset</button>
      <button type="button" id="rangeEditorClose">Close</button>
    </div>
  `;
  document.body.appendChild(editor);
  document.getElementById("rangeEditorClose").addEventListener("click", closeRangeEditor);
  document.getElementById("rangeEditorReset").addEventListener("click", () => {
    const id = editor.dataset.controlId;
    if (!id) return;
    delete customControlRanges[id];
    closeRangeEditor();
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = editor.dataset.controlId;
    const min = controlValueFromInput(id, document.getElementById("rangeEditorMin").value);
    const max = controlValueFromInput(id, document.getElementById("rangeEditorMax").value);
    if (!id || !Number.isFinite(min) || !Number.isFinite(max)) return;
    customControlRanges[id] = { min: Math.min(min, max), max: Math.max(min, max) };
    closeRangeEditor();
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });
  return editor;
}

function openRangeEditor(id, clientX, clientY) {
  const input = document.getElementById(id);
  if (!input) return;
  const editor = rangeEditorElement();
  editor.dataset.controlId = id;
  document.getElementById("rangeEditorMin").value = input.min;
  document.getElementById("rangeEditorMax").value = input.max;
  editor.style.left = `${Math.min(clientX, window.innerWidth - 250)}px`;
  editor.style.top = `${Math.min(clientY, window.innerHeight - 180)}px`;
  editor.hidden = false;
  document.getElementById("rangeEditorMin").focus();
}

function closeRangeEditor() {
  const editor = document.getElementById("rangeEditor");
  if (editor) editor.hidden = true;
}

function settingsFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `shv-bias-filter-settings-${stamp}.json`;
}

function exportedSettingsPayload() {
  return {
    format: "shv-bias-filter-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: structuredClone(params),
    ui: {
      customControlRanges: structuredClone(customControlRanges)
    }
  };
}

function downloadTextFile(filename, text, mimeType = "application/json") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setSettingsStatus(message, isError = false) {
  const status = document.getElementById("settingsStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function importedSettingsPayload(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Settings file must contain a JSON object.");
  }
  const ranges = json.ui?.customControlRanges || json.customControlRanges || {};
  if (json.settings && typeof json.settings === "object" && !Array.isArray(json.settings)) {
    return { settings: json.settings, ranges };
  }
  return { settings: json, ranges };
}

function replaceCustomControlRanges(ranges) {
  Object.keys(customControlRanges).forEach((key) => {
    delete customControlRanges[key];
  });
  if (!ranges || typeof ranges !== "object" || Array.isArray(ranges)) return;
  Object.entries(ranges).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const min = Number.parseFloat(value.min);
    const max = Number.parseFloat(value.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    customControlRanges[key] = { min: Math.min(min, max), max: Math.max(min, max) };
  });
}

function applyImportedSettings(imported, ranges = {}) {
  replaceCustomControlRanges(ranges);
  const next = { ...structuredClone(defaults), ...imported };
  if (!Object.prototype.hasOwnProperty.call(imported, "use_direct_stage_capacitance")) {
    const importedMelf = String(next.core_material || "").startsWith("mmb020");
    next.use_direct_stage_capacitance = Boolean(next.use_direct_stage_circuit && !importedMelf);
  }
  params = next;
  lastResult = null;
  normalizeParams();
  syncControls();
  drawCadModel();
  drawGeometry();
  clearField();
}

function exportSettingsToFile() {
  const text = JSON.stringify(exportedSettingsPayload(), null, 2);
  downloadTextFile(settingsFileName(), `${text}\n`);
  setSettingsStatus("Settings exported.");
}

async function importSettingsFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const payload = importedSettingsPayload(json);
    applyImportedSettings(payload.settings, payload.ranges);
    setSettingsStatus(`Imported ${file.name}.`);
  } catch (error) {
    setSettingsStatus(`Import failed: ${error.message}`, true);
  }
}

function parallelPlateCapacitancePf(epsr, areaMm2, separationMm) {
  if (epsr <= 0 || areaMm2 <= 0 || separationMm <= 0) return 0;
  return EPSILON_0_F_PER_M * epsr * (areaMm2 / separationMm) * 1e9;
}

function coreVolumeResistivityOhmCm(p) {
  return 10 ** p.core_volume_resistivity_log10_ohm_cm;
}

function coreCrossSectionAreaMm2(p) {
  return Math.PI * (p.core_od_mm / 2) ** 2;
}

function coreResistanceForLengthOhm(p, lengthMm) {
  const areaMm2 = coreCrossSectionAreaMm2(p);
  if (areaMm2 <= 0 || lengthMm <= 0) return Number.NaN;
  // rho is in ohm-cm. Geometry is in mm, so L/A becomes
  // (length_mm / 10) / (area_mm2 / 100) = 10 * length_mm / area_mm2.
  return coreVolumeResistivityOhmCm(p) * (10 * lengthMm / areaMm2);
}

function directStageResistanceOhm(p) {
  if (Number.isFinite(p.melf_stage_resistance_mohm)) {
    return p.melf_stage_resistance_mohm * 1e6;
  }
  return 10 ** p.melf_stage_resistance_log10_ohm;
}

function directStageParasiticPf(p) {
  return Math.max(0, p.melf_stage_parasitic_pf);
}

function stageResistanceOhmForCircuit(p, biasBiasSeparationMm) {
  if (usesDirectStageCircuit(p)) return directStageResistanceOhm(p);
  return coreResistanceForLengthOhm(p, biasBiasSeparationMm);
}

function stageResistanceReferenceOhm(p) {
  return stageResistanceOhmForCircuit(p, groundPlateThicknessMm(p) + 2 * p.plate_gap_mm);
}

function matchedSeriesResistanceMohm(p) {
  const ohms = stageResistanceReferenceOhm(p);
  return Number.isFinite(ohms) && ohms >= 0 ? ohms / 1e6 : 0;
}

function inputSeriesResistanceOhm(circuit, p) {
  const mohms = p.input_series_matches_stage ? circuit.stageResistanceOhm / 1e6 : p.input_series_resistance_mohm;
  return Math.max(0, Number(mohms) || 0) * 1e6;
}

function outputSeriesResistanceOhm(circuit, p) {
  const ohms = p.output_series_matches_stage ? circuit.stageResistanceOhm : p.output_series_resistance_ohm;
  return Math.max(0, Number(ohms) || 0);
}

function activeSeriesSectionCount(circuit, p, includeOutput = true) {
  const values = [
    inputSeriesResistanceOhm(circuit, p),
    ...Array.from({ length: Math.max(0, Math.floor(p.plate_pairs) - 1) }, () => circuit.stageResistanceOhm)
  ];
  if (includeOutput) values.push(outputSeriesResistanceOhm(circuit, p));
  return values.filter((ohms) => Number.isFinite(ohms) && ohms > 0).length;
}

function totalCoreResistanceOhm(p) {
  if (usesDirectStageCircuit(p)) {
    const stageResistance = directStageResistanceOhm(p);
    const inputResistanceOhm = p.input_series_matches_stage ? stageResistance : Math.max(0, p.input_series_resistance_mohm || 0) * 1e6;
    const outputResistanceOhm = p.output_series_matches_stage ? stageResistance : Math.max(0, p.output_series_resistance_ohm || 0);
    const internalStageCount = Math.max(0, p.plate_pairs - 1);
    const totalOhm = internalStageCount * stageResistance + inputResistanceOhm + outputResistanceOhm;
    return totalOhm > 0 ? totalOhm : Number.NaN;
  }
  return coreResistanceForLengthOhm(p, stackLength(p));
}

function applyDerivedElectrical(p) {
  p.core_resistance_gohm = totalCoreResistanceOhm(p) / 1e9;
}

function formatResistivity(ohmCm) {
  if (!Number.isFinite(ohmCm) || ohmCm <= 0) return "--";
  const exponent = Math.floor(Math.log10(ohmCm));
  const mantissa = ohmCm / (10 ** exponent);
  const mantissaText = Math.abs(mantissa - 1) < 0.005
    ? "1"
    : mantissa.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${mantissaText} × 10<sup>${exponent}</sup> Ω·cm`;
}

function formatScientificHtml(value, unit, digits = 2) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / (10 ** exponent);
  const mantissaText = Math.abs(mantissa - 1) < 0.005
    ? "1"
    : mantissa.toLocaleString(undefined, { maximumFractionDigits: digits });
  return `${mantissaText} × 10<sup>${exponent}</sup> ${unit}`;
}

function formatConductivity(siemensPerMeter) {
  return formatScientificHtml(siemensPerMeter, "S/m");
}

function formatFrequencyControl(logMhz) {
  const hz = rfFrequencyHzFromLogMhz(logMhz);
  return formatFrequency(hz);
}

function formatControlOutput(id, value) {
  if (id === "core_volume_resistivity_log10_ohm_cm") {
    return formatResistivity(10 ** value);
  }
  if (id === "melf_stage_resistance_mohm" || id === "input_series_resistance_mohm") {
    return formatResistance(value * 1e6);
  }
  if (id === "output_series_resistance_ohm") return formatResistance(value);
  if (id === "melf_stage_parasitic_pf") {
    return formatCapacitance(value);
  }
  if (id === "melf_metal_fill_factor") {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (id === "load_current_na") {
    return formatCurrentFromNa(value);
  }
  if (id === "detector_capacitance_pf") {
    return formatCapacitance(value);
  }
  if (id === "load_cable_velocity_factor") {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (id === "plate_conductivity_log10_s_per_m" || id === "tube_conductivity_log10_s_per_m") {
    return formatConductivity(10 ** value);
  }
  if (id === "rf_compare_frequency_log10_mhz") {
    return formatFrequencyControl(value);
  }
  if (id === "mesh_edge_radius_ratio") {
    const divisor = value > 0 ? 1 / value : Number.NaN;
    const divisorText = Number.isFinite(divisor)
      ? `r/${divisor.toLocaleString(undefined, { maximumFractionDigits: 1 })}`
      : "r/--";
    return `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} x r (${divisorText})`;
  }
  if (id === "plate_relative_permeability" || id === "tube_relative_permeability") {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${units[id]}`;
}

function formatCapacitance(pf) {
  if (!Number.isFinite(pf)) return "--";
  if (pf >= 1000) return `${(pf / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} nF`;
  if (pf >= 100) return `${pf.toLocaleString(undefined, { maximumFractionDigits: 0 })} pF`;
  if (pf >= 10) return `${pf.toLocaleString(undefined, { maximumFractionDigits: 1 })} pF`;
  if (pf >= 1) return `${pf.toLocaleString(undefined, { maximumFractionDigits: 2 })} pF`;
  return `${(pf * 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} fF`;
}

function formatResistance(ohms) {
  if (!Number.isFinite(ohms)) return "--";
  if (ohms >= 1e12) return `${(ohms / 1e12).toLocaleString(undefined, { maximumFractionDigits: 2 })} TΩ`;
  if (ohms >= 1e9) return `${(ohms / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} GΩ`;
  if (ohms >= 1e6) return `${(ohms / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MΩ`;
  if (ohms >= 1e3) return `${(ohms / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })} kΩ`;
  if (ohms >= 1) return `${ohms.toLocaleString(undefined, { maximumFractionDigits: 2 })} Ω`;
  if (ohms >= 1e-3) return `${(ohms * 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} mΩ`;
  return `${ohms.toLocaleString(undefined, { maximumFractionDigits: 0 })} Ω`;
}

function formatCurrentFromNa(currentNa) {
  if (!Number.isFinite(currentNa)) return "--";
  const magnitude = Math.abs(currentNa);
  if (magnitude >= 1e6) return `${(currentNa / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} mA`;
  if (magnitude >= 1e3) return `${(currentNa / 1e3).toLocaleString(undefined, { maximumFractionDigits: 2 })} uA`;
  if (magnitude >= 1) return `${currentNa.toLocaleString(undefined, { maximumFractionDigits: 2 })} nA`;
  return `${(currentNa * 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} pA`;
}

function formatAdmittance(siemens) {
  if (!Number.isFinite(siemens)) return "--";
  const magnitude = Math.abs(siemens);
  if (magnitude >= 1) return `${siemens.toLocaleString(undefined, { maximumFractionDigits: 3 })} S`;
  if (magnitude >= 1e-3) return `${(siemens * 1e3).toLocaleString(undefined, { maximumFractionDigits: 3 })} mS`;
  if (magnitude >= 1e-6) return `${(siemens * 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 })} uS`;
  if (magnitude >= 1e-9) return `${(siemens * 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 })} nS`;
  if (magnitude >= 1e-12) return `${(siemens * 1e12).toLocaleString(undefined, { maximumFractionDigits: 3 })} pS`;
  if (magnitude >= 1e-15) return `${(siemens * 1e15).toLocaleString(undefined, { maximumFractionDigits: 3 })} fS`;
  return formatScientificHtml(siemens, "S");
}

function formatFrequency(hz) {
  if (!Number.isFinite(hz)) return "--";
  if (hz >= 1e6) return `${(hz / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toLocaleString(undefined, { maximumFractionDigits: 2 })} kHz`;
  if (hz >= 1) return `${hz.toLocaleString(undefined, { maximumFractionDigits: 2 })} Hz`;
  return `${(hz * 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} mHz`;
}

function formatLength(lengthMm) {
  if (!Number.isFinite(lengthMm)) return "--";
  if (lengthMm >= 1) return `${lengthMm.toLocaleString(undefined, { maximumFractionDigits: 3 })} mm`;
  const micrometers = lengthMm * 1000;
  if (micrometers >= 1) return `${micrometers.toLocaleString(undefined, { maximumFractionDigits: 2 })} µm`;
  const nanometers = micrometers * 1000;
  return `${nanometers.toLocaleString(undefined, { maximumFractionDigits: 1 })} nm`;
}

function formatKvPerMm(kvPerMm) {
  if (!Number.isFinite(kvPerMm)) return "--";
  return `${kvPerMm.toLocaleString(undefined, { maximumFractionDigits: 2 })} kV/mm`;
}

function formatFieldVPerMm(vPerMm) {
  if (!Number.isFinite(vPerMm) || vPerMm <= 0) return "--";
  return `${(vPerMm / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kV/mm`;
}

function formatMargin(margin) {
  if (!Number.isFinite(margin)) return "--";
  if (margin >= 100) return `${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })}×`;
  if (margin >= 10) return `${margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`;
  return `${margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
}

function washerElectrodeOverlapBounds(p) {
  const washerBounds = washerRadialBounds(p);
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const inner = Math.max(washerBounds.inner, groundInner);
  const outer = Math.min(washerBounds.outer, hvOuter);
  return {
    inner,
    outer,
    hasOverlap: washerBounds.hasWasher && outer > inner
  };
}

function circuitEstimates(p) {
  const core = p.core_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const overlapBounds = washerElectrodeOverlapBounds(p);
  const overlapArea = overlapBounds.hasOverlap
    ? Math.PI * Math.max(0, overlapBounds.outer ** 2 - overlapBounds.inner ** 2)
    : 0;
  const pairCapPf = parallelPlateCapacitancePf(p.washer_epsr, overlapArea, p.plate_gap_mm);
  const fr4PairCapPf = parallelPlateCapacitancePf(FR4_WASHER_EPSR, overlapArea, p.plate_gap_mm);
  const shuntCapPf = 2 * pairCapPf;
  const totalGroundCapPf = 2 * Math.max(1, Math.floor(p.plate_pairs)) * pairCapPf;

  const biasBiasSeparation = groundPlateThicknessMm(p) + 2 * p.plate_gap_mm;
  const ferriteArea = Math.PI * core ** 2;
  const coreEpoxyArea = Math.PI * Math.max(0, groundInner ** 2 - core ** 2);
  const coreEpsr = coreCapacitanceEpsr(p);
  const ferriteParasiticPf = parallelPlateCapacitancePf(coreEpsr, ferriteArea, biasBiasSeparation);
  const epoxyParasiticPf = parallelPlateCapacitancePf(p.epoxy_epsr, coreEpoxyArea, biasBiasSeparation);
  const directParasiticPf = directStageParasiticPf(p);
  const parasiticPf = p.plate_pairs > 1
    ? (usesDirectStageCapacitance(p) ? directParasiticPf + epoxyParasiticPf : ferriteParasiticPf + epoxyParasiticPf)
    : Number.NaN;

  const totalResistanceOhm = totalCoreResistanceOhm(p);
  // Adjacent bias plates are separated by the dielectric gap, the intervening
  // ground-plate thickness, and the second dielectric gap. Do not include the
  // bias-plate thickness itself here: the bias plate shorts that core section
  // to the bias node, so it is not part of the bias-to-bias stage resistance.
  // For discrete MELF resistor stages, the app uses the entered per-stage
  // resistance instead of inventing an effective bulk resistivity.
  const stageResistanceOhm = stageResistanceOhmForCircuit(p, biasBiasSeparation);
  const cornerHz = Number.isFinite(stageResistanceOhm) && shuntCapPf > 0
    ? 1 / (2 * Math.PI * stageResistanceOhm * shuntCapPf * 1e-12)
    : Number.NaN;
  const parasiticTakeoverHz = Number.isFinite(stageResistanceOhm) && parasiticPf > 0
    ? 1 / (2 * Math.PI * stageResistanceOhm * parasiticPf * 1e-12)
    : Number.NaN;

  return {
    pairCapPf,
    shuntCapPf,
    totalGroundCapPf,
    parasiticPf,
    directParasiticPf,
    ferriteParasiticPf,
    coreParasiticPf: ferriteParasiticPf,
    coreCapacitanceEpsr: coreEpsr,
    epoxyParasiticPf,
    parasiticRatio: parasiticPf / shuntCapPf,
    washerCapGain: pairCapPf / fr4PairCapPf,
    totalResistanceOhm,
    stageResistanceOhm,
    cornerHz,
    parasiticTakeoverHz
  };
}

function normalizedCapacitancePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const totalPf = Number(payload.totalPf ?? payload.total_pf ?? payload.biasToGroundPf ?? payload.bias_to_ground_pf);
  if (!(totalPf > 0)) return null;
  const parasiticPf = Number(
    payload.parasiticPf
      ?? payload.parasitic_pf
      ?? payload.adjacentBiasPf
      ?? payload.adjacent_bias_pf
      ?? payload.biasToBiasPf
      ?? payload.bias_to_bias_pf
  );
  return {
    totalPf,
    parasiticPf: Number.isFinite(parasiticPf) && parasiticPf >= 0 ? parasiticPf : Number.NaN,
    method: payload.method || payload.source || "field solve",
    energyJoules: Number(payload.energyJoules ?? payload.energy_joules),
    voltageV: Number(payload.voltageV ?? payload.voltage_v)
  };
}

function solvedCapacitanceForCurrentDesign() {
  if (lastResult?.parameterKey !== comparableResultParameters(params)) return null;
  return normalizedCapacitancePayload(lastResult.capacitance);
}

function capacitanceForAdmittance(circuit, p) {
  const solved = solvedCapacitanceForCurrentDesign();
  if (solved) {
    return {
      capacitancePf: solved.totalPf,
      sourceLabel: solved.method === "fenicsx-energy" ? "FEniCSx energy" : solved.method
    };
  }
  return {
    capacitancePf: circuit.totalGroundCapPf,
    sourceLabel: `${2 * Math.max(1, Math.floor(p.plate_pairs))} x gap C est.`
  };
}

function loadConductanceS(p) {
  const currentA = Math.max(0, Number(p.load_current_na) || 0) * 1e-9;
  const voltage = Math.abs(Number(p.bias_voltage_v) || 0);
  return voltage > 0 ? currentA / voltage : 0;
}

function cableCapacitancePf(p) {
  const lengthM = Math.max(0, Number(p.load_cable_length_m) || 0);
  const impedanceOhm = Math.max(1e-9, Number(p.load_cable_impedance_ohm) || 0);
  const velocityFactor = Math.max(1e-9, Number(p.load_cable_velocity_factor) || 0);
  return lengthM / (impedanceOhm * velocityFactor * SPEED_OF_LIGHT_M_PER_S) * 1e12;
}

function detectorCapacitancePf(p) {
  return Math.max(0, Number(p.detector_capacitance_pf) || 0);
}

function loadCapacitancePf(p) {
  return cableCapacitancePf(p) + detectorCapacitancePf(p);
}

function loadAdmittanceAtFrequency(p, frequencyHz) {
  return c(
    loadConductanceS(p),
    2 * Math.PI * frequencyHz * loadCapacitancePf(p) * 1e-12
  );
}

function admittanceAtFrequency(capacitancePf, p, frequencyHz) {
  const conductanceS = loadConductanceS(p);
  const susceptanceS = 2 * Math.PI * frequencyHz * Math.max(0, capacitancePf || 0) * 1e-12;
  const magnitudeS = Math.hypot(conductanceS, susceptanceS);
  return {
    frequencyHz,
    capacitancePf,
    conductanceS,
    susceptanceS,
    magnitudeS,
    phaseDeg: magnitudeS > 0 ? Math.atan2(susceptanceS, conductanceS) * 180 / Math.PI : Number.NaN,
    loadResistanceOhm: conductanceS > 0 ? 1 / conductanceS : Number.POSITIVE_INFINITY
  };
}

function singleStageTransferMagnitude(circuit, frequencyHz, loadConductance = 0, loadCapPf = 0) {
  if (!Number.isFinite(circuit.stageResistanceOhm) || !(circuit.stageResistanceOhm > 0)) {
    return Number.NaN;
  }
  const shuntCapPf = Math.max(0, circuit.shuntCapPf || 0);
  const loadConductanceS = Math.max(0, Number(loadConductance) || 0);
  const externalCapPf = Math.max(0, Number(loadCapPf) || 0);
  if (!(shuntCapPf > 0) && !(loadConductanceS > 0) && !(externalCapPf > 0)) return Number.NaN;
  const omega = 2 * Math.PI * frequencyHz;
  const yR = 1 / circuit.stageResistanceOhm;
  const yPar = c(yR, omega * Math.max(0, circuit.parasiticPf || 0) * 1e-12);
  const yGround = c(loadConductanceS, omega * (shuntCapPf + externalCapPf) * 1e-12);
  return cAbs(cDiv(yPar, cAdd(yPar, yGround)));
}

function attenuationDbFromMagnitude(magnitude) {
  if (!Number.isFinite(magnitude) || magnitude <= 0) return Number.NaN;
  return -20 * Math.log10(Math.max(1e-12, magnitude));
}

function singleStageAttenuationDb(circuit, frequencyHz, loadConductance = 0, loadCapPf = 0) {
  return attenuationDbFromMagnitude(singleStageTransferMagnitude(circuit, frequencyHz, loadConductance, loadCapPf));
}

function highFrequencyCapRatioAttenuationDb(circuit) {
  return circuit.parasiticRatio > 0 && circuit.parasiticRatio < 1
    ? -20 * Math.log10(circuit.parasiticRatio)
    : Number.NaN;
}

function rfFrequencyHzFromLogMhz(logMhz) {
  return (10 ** logMhz) * 1e6;
}

function conductorElectricalValues(p, prefix) {
  const conductivity = 10 ** p[`${prefix}_conductivity_log10_s_per_m`];
  const mur = p[`${prefix}_relative_permeability`];
  return { conductivity, mur };
}

function skinDepthMm(frequencyHz, conductivity, mur) {
  if (!(frequencyHz > 0) || !(conductivity > 0) || !(mur > 0)) return Number.NaN;
  return Math.sqrt(2 / (2 * Math.PI * frequencyHz * MU_0_H_PER_M * mur * conductivity)) * 1000;
}

function rfMaterialEstimates(p) {
  const frequencyHz = rfFrequencyHzFromLogMhz(p.rf_compare_frequency_log10_mhz);
  const plate = conductorElectricalValues(p, "plate");
  const tube = conductorElectricalValues(p, "tube");
  return {
    frequencyHz,
    plate: {
      ...plate,
      material: conductorMaterialPresets[p.plate_material]?.label || "Custom",
      skinDepthMm: skinDepthMm(frequencyHz, plate.conductivity, plate.mur)
    },
    tube: {
      ...tube,
      material: conductorMaterialPresets[p.tube_material]?.label || "Custom",
      skinDepthMm: skinDepthMm(frequencyHz, tube.conductivity, tube.mur)
    }
  };
}

function roundedOuterPlate(p, r, z, zc, rInner, rOuter) {
  const half = biasPlateThicknessMm(p) / 2;
  if (z < zc - half || z > zc + half || r < rInner || r > rOuter) return false;
  const rad = Math.max(0, Math.min(edgeRadiusMm(p, "hv"), half, (rOuter - rInner) / 2));
  if (rad === 0) return true;
  const dz = Math.abs(z - zc);
  if (r <= rOuter - rad || dz <= half - rad) return true;
  return (r - (rOuter - rad)) ** 2 + (dz - (half - rad)) ** 2 <= rad ** 2;
}

function roundedInnerPlate(p, r, z, zc, rInner, rOuter) {
  const half = groundPlateThicknessMm(p) / 2;
  if (z < zc - half || z > zc + half || r < rInner || r > rOuter) return false;
  const rad = Math.max(0, Math.min(edgeRadiusMm(p, "ground"), half, (rOuter - rInner) / 2));
  if (rad === 0) return true;
  const dz = Math.abs(z - zc);
  if (r >= rInner + rad || dz <= half - rad) return true;
  return (r - (rInner + rad)) ** 2 + (dz - (half - rad)) ** 2 <= rad ** 2;
}

function roundedOuterProfile(rInner, rOuter, z0, z1, radius, steps = 8) {
  const rad = Math.max(0, Math.min(radius, (z1 - z0) / 2, (rOuter - rInner) / 2));
  if (rad === 0) return [[rInner, z0], [rOuter, z0], [rOuter, z1], [rInner, z1]];
  const points = [[rInner, z0], [rOuter - rad, z0]];
  let cx = rOuter - rad;
  let cz = z0 + rad;
  for (let step = 1; step <= steps; step += 1) {
    const theta = -Math.PI / 2 + (Math.PI / 2) * step / steps;
    points.push([cx + rad * Math.cos(theta), cz + rad * Math.sin(theta)]);
  }
  points.push([rOuter, z1 - rad]);
  cz = z1 - rad;
  for (let step = 1; step <= steps; step += 1) {
    const theta = (Math.PI / 2) * step / steps;
    points.push([cx + rad * Math.cos(theta), cz + rad * Math.sin(theta)]);
  }
  points.push([rInner, z1]);
  return points;
}

function roundedInnerProfile(rInner, rOuter, z0, z1, radius, steps = 8) {
  const rad = Math.max(0, Math.min(radius, (z1 - z0) / 2, (rOuter - rInner) / 2));
  if (rad === 0) return [[rInner, z0], [rOuter, z0], [rOuter, z1], [rInner, z1]];
  const points = [[rInner + rad, z0], [rOuter, z0], [rOuter, z1], [rInner + rad, z1]];
  let cx = rInner + rad;
  let cz = z1 - rad;
  for (let step = 1; step <= steps; step += 1) {
    const theta = Math.PI / 2 + (Math.PI / 2) * step / steps;
    points.push([cx + rad * Math.cos(theta), cz + rad * Math.sin(theta)]);
  }
  points.push([rInner, z0 + rad]);
  cz = z0 + rad;
  for (let step = 1; step <= steps; step += 1) {
    const theta = Math.PI + (Math.PI / 2) * step / steps;
    points.push([cx + rad * Math.cos(theta), cz + rad * Math.sin(theta)]);
  }
  return points;
}

function componentProfiles(p) {
  const length = stackLength(p);
  const core = p.core_od_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const groundOuter = p.ground_plate_od_mm / 2;
  const tubeInner = p.tube_id_mm / 2;
  const tubeOuter = tubeInner + p.tube_wall_thickness_mm;
  const washerBounds = washerRadialBounds(p);
  const components = [
    { name: coreComponentName(p), material: "ferrite", color: "#8a5b30", alpha: 0.72, profile: [[0, 0], [core, 0], [core, length], [0, length]] },
    { name: epoxyComponentName(p), material: "epoxy", color: "#9bc6c2", alpha: 0.16, profile: [[core, 0], [tubeInner, 0], [tubeInner, length], [core, length]] }
  ];
  if (washerBounds.hasWasher) {
    washerGapIntervals(p).forEach(([z0, z1], index) => {
      components.push({
        name: `${washerComponentName(p)} ${index + 1}`,
        material: "washer",
        color: "#d6b75d",
        alpha: 0.45,
        profile: [[washerBounds.inner, z0], [washerBounds.outer, z0], [washerBounds.outer, z1], [washerBounds.inner, z1]]
      });
    });
  }
  if (p.include_ground_tube) {
    components.push({ name: `${tubeConductorName(p)} grounded tube`, material: "ground", color: "#384b2b", alpha: 0.98, profile: [[tubeInner, 0], [tubeOuter, 0], [tubeOuter, length], [tubeInner, length]] });
  }
  for (const [kind, zc] of plateCenters(p)) {
    const half = plateThicknessMm(p, kind) / 2;
    const z0 = zc - half;
    const z1 = zc + half;
    if (kind === "hv") {
      components.push({
        name: `${plateConductorName(p)} HV plate`,
        material: "hv",
        color: "#b73e3e",
        alpha: 1,
        profile: roundedOuterProfile(core, hvOuter, z0, z1, edgeRadiusMm(p, "hv"))
      });
    } else {
      components.push({
        name: `${plateConductorName(p)} ground plate`,
        material: "ground",
        color: "#557a38",
        alpha: 1,
        profile: roundedInnerProfile(groundInner, groundOuter, z0, z1, edgeRadiusMm(p, "ground"))
      });
    }
  }
  return components;
}

function materialEpsr(p, r, zStack = null) {
  // The browser fallback treats the washer as flat annular slabs between
  // adjacent plate faces, bounded by the explicit washer ID/OD. The core body
  // is not a dielectric region in this solve; classifyPoint() fixes it at the
  // HV potential before the material map is consulted.
  const region = materialRegion(p, r, zStack);
  if (region === "washer") return p.washer_epsr;
  return p.epoxy_epsr;
}

function coth(value) {
  return 1 / Math.tanh(value);
}

function analyticClearanceCases(p) {
  const core = p.core_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const tubeInner = p.tube_id_mm / 2;
  const edgeRadius = Math.max(edgeRadiusMm(p), 0.001);
  const cases = [
    {
      id: "axial",
      label: "Axial plate gap",
      shortLabel: "Axial",
      clearance: p.plate_gap_mm,
      clearanceLabel: "axial plate",
      innerConductorRadius: Number.NaN,
      edgeMajorRadius: Number.NaN,
      note: "parallel plate baseline"
    },
    {
      id: "core",
      label: "Ground inner edge to HV core",
      shortLabel: "Core side",
      clearance: groundInner - core,
      clearanceLabel: "radial core-ground",
      innerConductorRadius: core,
      edgeMajorRadius: groundInner + edgeRadius,
      note: "smaller-radius coaxial gap"
    }
  ];
  if (p.include_ground_tube) {
    cases.push({
      id: "tube",
      label: "HV outer edge to ground tube",
      shortLabel: "Tube side",
      clearance: tubeInner - hvOuter,
      clearanceLabel: "radial HV-tube",
      innerConductorRadius: hvOuter,
      edgeMajorRadius: hvOuter - edgeRadius,
      note: "larger-radius coaxial gap"
    });
  }
  return cases.filter((entry) => Number.isFinite(entry.clearance) && entry.clearance > 0);
}

function nearestEdgeClearance(p) {
  const clearances = analyticClearanceCases(p)
    .map((entry) => ({ label: entry.clearanceLabel, value: entry.clearance }));
  return clearances
    .sort((a, b) => a.value - b.value)[0] || { label: "axial plate", value: p.plate_gap_mm };
}

function radiusGapBound(p) {
  const edgeRadius = Math.max(edgeRadiusMm(p), 0.001);
  const coreRadius = Number.isFinite(p.core_od_mm) && p.core_od_mm > 0
    ? p.core_od_mm / 2
    : defaults.core_od_mm / 2;
  const radius = [
    { label: "edge radius", value: edgeRadius },
    { label: "core radius", value: coreRadius }
  ]
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => a.value - b.value)[0] || { label: "edge radius", value: edgeRadius };
  const voltage = Number.isFinite(p.bias_voltage_v) ? p.bias_voltage_v : defaults.bias_voltage_v;
  const gaps = [
    { label: "plate gap", value: p.plate_gap_mm },
    { label: "core-ground", value: p.core_to_ground_gap_mm },
    { label: "HV-tube", value: p.hv_to_tube_gap_mm }
  ]
    .map((entry) => ({ ...entry, value: Number(entry.value) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => a.value - b.value);
  const gap = gaps[0] || { label: "plate gap", value: defaults.plate_gap_mm };
  return {
    radius: radius.value,
    radiusLabel: radius.label,
    voltage,
    gap,
    field: voltage * (radius.value + gap.value) / (radius.value * gap.value),
    factor: (radius.value + gap.value) / radius.value
  };
}

function cylinderPlaneEdgeField(voltage, edgeRadius, clearance) {
  const xi = Math.acosh(1 + clearance / edgeRadius);
  return (voltage / (edgeRadius * xi)) * coth(xi / 2);
}

function coaxialShellEdgeField(voltage, edgeRadius, clearance) {
  return voltage / (edgeRadius * Math.log1p(clearance / edgeRadius));
}

function sphereShellEdgeField(voltage, edgeRadius, clearance) {
  return voltage * (edgeRadius + clearance) / (edgeRadius * clearance);
}

function coaxialRadialField(voltage, innerRadius, clearance) {
  if (!(innerRadius > 0) || !(clearance > 0)) return Number.NaN;
  return voltage / (innerRadius * Math.log1p(clearance / innerRadius));
}

function analyticCaseEstimate(p, entry, edgeRadius) {
  const gap = Math.max(entry.clearance, 0.001);
  const idealField = p.bias_voltage_v / gap;
  const cylinderPlaneField = cylinderPlaneEdgeField(p.bias_voltage_v, edgeRadius, gap);
  const coaxialShellField = coaxialShellEdgeField(p.bias_voltage_v, edgeRadius, gap);
  const sphereShellField = sphereShellEdgeField(p.bias_voltage_v, edgeRadius, gap);
  const coaxialField = coaxialRadialField(p.bias_voltage_v, entry.innerConductorRadius, gap);
  const edgeCylinderField = Math.max(cylinderPlaneField, coaxialShellField);
  const torusRatio = Number.isFinite(entry.edgeMajorRadius) ? entry.edgeMajorRadius / edgeRadius : Number.NaN;
  const estimatedField = sphereShellField;
  return {
    ...entry,
    clearance: { label: entry.clearanceLabel, value: entry.clearance },
    idealField,
    cylinderPlaneField,
    coaxialShellField,
    sphereShellField,
    edgeCylinderField,
    coaxialField,
    torusRatio,
    radiusGapBoundField: sphereShellField,
    estimatedField,
    edgeFactor: estimatedField / idealField
  };
}

function analyticEdgeEstimate(p) {
  const edgeRadius = Math.max(edgeRadiusMm(p), 0.001);
  const cases = analyticClearanceCases(p).map((entry) => analyticCaseEstimate(p, entry, edgeRadius));
  const controlling = cases
    .slice()
    .sort((a, b) => b.estimatedField - a.estimatedField)[0]
    || analyticCaseEstimate(p, {
      id: "axial",
      label: "Axial plate gap",
      shortLabel: "Axial",
      clearance: p.plate_gap_mm,
      clearanceLabel: "axial plate",
      innerConductorRadius: Number.NaN,
      edgeMajorRadius: Number.NaN,
      note: "parallel plate baseline"
    }, edgeRadius);
  return {
    cases,
    controlling,
    clearance: controlling.clearance,
    idealField: controlling.idealField,
    edgeFactor: controlling.edgeFactor,
    estimatedField: controlling.estimatedField,
    cylinderPlaneField: controlling.cylinderPlaneField,
    coaxialShellField: controlling.coaxialShellField,
    sphereShellField: controlling.sphereShellField,
    edgeCylinderField: controlling.edgeCylinderField,
    coaxialField: controlling.coaxialField,
    torusRatio: controlling.torusRatio
  };
}

function classifyPoint(p, r, z) {
  // This function is the "geometry sampler" used by the field solver. At each
  // r-z grid node it decides whether that node is a fixed-potential conductor
  // or a free dielectric node whose voltage should be solved.
  //
  // Important limitation: the rounded plate profiles are sampled on a
  // structured r-z grid. There is no conforming mesh, no curved finite
  // elements, and no sub-cell boundary reconstruction. The grid is locally
  // refined around rounded edges, but peak fields are still screening numbers.
  const core = p.core_od_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const groundOuter = p.ground_plate_od_mm / 2;
  const tubeInner = p.tube_id_mm / 2;
  const tubeOuter = tubeInner + p.tube_wall_thickness_mm;
  const length = stackLength(p);
  const zStack = Math.max(0, Math.min(length, z));

  if (r <= core) return { kind: "hv", value: p.bias_voltage_v };
  if (p.include_ground_tube && r >= tubeInner) return { kind: "ground", value: 0 };

  for (const [kind, zc] of plateCenters(p)) {
    if (kind === "hv" && roundedOuterPlate(p, r, zStack, zc, core, hvOuter)) {
      return { kind: "hv", value: p.bias_voltage_v };
    }
    if (kind === "ground" && roundedInnerPlate(p, r, zStack, zc, groundInner, groundOuter)) {
      return { kind: "ground", value: 0 };
    }
  }
  return { kind: "dielectric", value: null };
}

function geometryBounds(p) {
  const length = stackLength(p);
  const rMax = p.tube_id_mm / 2 + p.tube_wall_thickness_mm + p.domain_margin_mm;
  return { length, rMax, zMin: -p.domain_margin_mm, zMax: length + p.domain_margin_mm };
}

function setupControlTabs() {
  const tabs = Array.from(document.querySelectorAll(".control-tab"));
  const panels = Array.from(document.querySelectorAll(".control-panel"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const selected = tab.dataset.controlTab;
      tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel) => {
        const active = panel.dataset.controlPanel === selected;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    });
  });
}

function setupControls() {
  setupControlTabs();

  const coreMaterial = document.getElementById("core_material");
  coreMaterial.value = params.core_material;
  coreMaterial.addEventListener("change", () => {
    params.core_material = coreMaterial.value;
    const preset = coreMaterialPresets[params.core_material];
    if (preset) {
      params.ferrite_epsr = preset.epsr;
      params.core_volume_resistivity_log10_ohm_cm = preset.resistivityLog10;
      params.use_direct_stage_circuit = Boolean(preset.defaultDirectStageResistance);
      params.use_direct_stage_capacitance = Boolean(preset.defaultDirectStageCapacitance);
      applyDirectStageDefaultsForMaterial(params);
      if (Number.isFinite(preset.coreOdMm)) params.core_od_mm = preset.coreOdMm;
    }
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const washerMaterial = document.getElementById("washer_material");
  washerMaterial.value = params.washer_material;
  washerMaterial.addEventListener("change", () => {
    params.washer_material = washerMaterial.value;
    const preset = washerMaterialPresets[params.washer_material];
    if (preset) params.washer_epsr = preset.epsr;
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const epoxyMaterial = document.getElementById("epoxy_material");
  epoxyMaterial.value = params.epoxy_material;
  epoxyMaterial.addEventListener("change", () => {
    params.epoxy_material = epoxyMaterial.value;
    const preset = epoxyMaterialPresets[params.epoxy_material];
    if (preset) params.epoxy_epsr = preset.epsr;
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const plateMaterial = document.getElementById("plate_material");
  plateMaterial.value = params.plate_material;
  plateMaterial.addEventListener("change", () => {
    params.plate_material = plateMaterial.value;
    const preset = conductorMaterialPresets[params.plate_material];
    if (preset) {
      params.plate_conductivity_log10_s_per_m = Math.log10(preset.conductivity);
      params.plate_relative_permeability = preset.mur;
    }
    normalizeParams();
    syncControls();
    clearField();
  });

  const tubeMaterial = document.getElementById("tube_material");
  tubeMaterial.value = params.tube_material;
  tubeMaterial.addEventListener("change", () => {
    params.tube_material = tubeMaterial.value;
    const preset = conductorMaterialPresets[params.tube_material];
    if (preset) {
      params.tube_conductivity_log10_s_per_m = Math.log10(preset.conductivity);
      params.tube_relative_permeability = preset.mur;
    }
    normalizeParams();
    syncControls();
    clearField();
  });

  const fieldSolver = document.getElementById("field_solver");
  fieldSolver.value = params.field_solver;
  fieldSolver.addEventListener("change", () => {
    params.field_solver = fieldSolver.value;
    clearField();
  });

  const directStageCircuit = document.getElementById("use_direct_stage_circuit");
  directStageCircuit.checked = params.use_direct_stage_circuit;
  directStageCircuit.addEventListener("change", () => {
    params.use_direct_stage_circuit = directStageCircuit.checked;
    if (params.use_direct_stage_circuit) applyDirectStageDefaultsForMaterial(params);
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const directStageCapacitance = document.getElementById("use_direct_stage_capacitance");
  directStageCapacitance.checked = params.use_direct_stage_capacitance;
  directStageCapacitance.addEventListener("change", () => {
    params.use_direct_stage_capacitance = directStageCapacitance.checked;
    if (params.use_direct_stage_capacitance) applyDirectStageDefaultsForMaterial(params);
    normalizeParams();
    syncControls();
    clearField();
  });

  const groundMatchesBiasThickness = document.getElementById("ground_matches_bias_thickness");
  groundMatchesBiasThickness.checked = params.ground_matches_bias_thickness;
  groundMatchesBiasThickness.addEventListener("change", () => {
    params.ground_matches_bias_thickness = groundMatchesBiasThickness.checked;
    if (params.ground_matches_bias_thickness) {
      params.ground_plate_thickness_mm = params.bias_plate_thickness_mm;
    }
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const inputSeriesMatchesStage = document.getElementById("input_series_matches_stage");
  inputSeriesMatchesStage.checked = params.input_series_matches_stage;
  inputSeriesMatchesStage.addEventListener("change", () => {
    params.input_series_matches_stage = inputSeriesMatchesStage.checked;
    normalizeParams();
    syncControls();
    clearField();
  });

  const outputSeriesMatchesStage = document.getElementById("output_series_matches_stage");
  outputSeriesMatchesStage.checked = params.output_series_matches_stage;
  outputSeriesMatchesStage.addEventListener("change", () => {
    params.output_series_matches_stage = outputSeriesMatchesStage.checked;
    normalizeParams();
    syncControls();
    clearField();
  });

  const washerIdMatchesGround = document.getElementById("washer_id_matches_ground");
  washerIdMatchesGround.checked = params.washer_id_matches_ground;
  washerIdMatchesGround.addEventListener("change", () => {
    params.washer_id_matches_ground = washerIdMatchesGround.checked;
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  const washerOdMatchesBias = document.getElementById("washer_od_matches_bias");
  washerOdMatchesBias.checked = params.washer_od_matches_bias;
  washerOdMatchesBias.addEventListener("change", () => {
    params.washer_od_matches_bias = washerOdMatchesBias.checked;
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
  });

  for (const id of ids) {
    const input = document.getElementById(id);
    setupManualControlInput(id);
    input.value = params[id];
    input.addEventListener("input", () => {
      applyControlValue(id, input.value);
    });
  }
  const tube = document.getElementById("include_ground_tube");
  tube.checked = params.include_ground_tube;
  tube.addEventListener("change", () => {
    params.include_ground_tube = tube.checked;
    drawCadModel();
    drawGeometry();
    clearField();
  });
  document.getElementById("solve").addEventListener("click", () => {
    solveAndDraw();
  });
  document.getElementById("reset").addEventListener("click", () => {
    params = structuredClone(defaults);
    lastResult = null;
    normalizeParams();
    syncControls();
    drawCadModel();
    drawGeometry();
    clearField();
    setSettingsStatus("Reset to defaults.");
  });
  document.getElementById("exportSettings").addEventListener("click", () => {
    exportSettingsToFile();
  });
  const settingsFile = document.getElementById("settingsFile");
  document.getElementById("importSettings").addEventListener("click", () => {
    settingsFile.click();
  });
  settingsFile.addEventListener("change", () => {
    importSettingsFromFile(settingsFile.files?.[0]);
    settingsFile.value = "";
  });
}

function setupCadViewer() {
  const canvas = document.getElementById("cadCanvas");
  const reset = document.getElementById("cadReset");
  const cutaway = document.getElementById("cadCutaway");
  let drag = null;

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      y: event.clientY,
      mode: event.button === 2 || event.shiftKey ? "pan" : "rotate"
    };
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.mode === "pan") {
      cadView.panX += dx;
      cadView.panY += dy;
    } else {
      cadView.yaw += dx * 0.008;
      cadView.pitch = Math.max(-1.2, Math.min(1.25, cadView.pitch + dy * 0.008));
    }
    drawCadModel();
  });
  canvas.addEventListener("pointerup", () => {
    drag = null;
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
  });
  canvas.addEventListener("wheel", (event) => {
    cadView.zoom = Math.max(0.45, Math.min(2.8, cadView.zoom * Math.exp(-event.deltaY * 0.001)));
    drawCadModel();
    event.preventDefault();
  }, { passive: false });

  reset.addEventListener("click", () => {
    cadView = { ...structuredClone(defaultCadView), cutaway: cadView.cutaway };
    drawCadModel();
  });
  cutaway.addEventListener("click", () => {
    cadView.cutaway = !cadView.cutaway;
    cutaway.classList.toggle("active", cadView.cutaway);
    cutaway.textContent = cadView.cutaway ? "Cutaway" : "Full";
    drawCadModel();
  });
  cutaway.classList.toggle("active", cadView.cutaway);
}

function normalizeParams() {
  const spacingRange = spacingRangeForWasher(params);
  const coreGapRange = coreGroundGapRange(params);
  const genericRangeIds = [
    "bias_voltage_v",
    "core_volume_resistivity_log10_ohm_cm",
    "load_current_na",
    "load_cable_length_m",
    "load_cable_impedance_ohm",
    "load_cable_velocity_factor",
    "detector_capacitance_pf",
    "input_series_resistance_mohm",
    "output_series_resistance_ohm",
    "ferrite_epsr",
    "melf_substrate_epsr",
    "melf_metal_fill_factor",
    "washer_epsr",
    "epoxy_epsr",
    "core_od_mm",
    "washer_id_mm",
    "washer_od_mm",
    "bias_plate_thickness_mm",
    "ground_plate_thickness_mm",
    "plate_pairs"
  ];
  for (const id of genericRangeIds) {
    const range = controlRange(id);
    params[id] = clamp(params[id], range.min, range.max);
  }
  params.plate_pairs = Math.round(params.plate_pairs);
  if (!Number.isFinite(params.melf_stage_resistance_mohm) && Number.isFinite(params.melf_stage_resistance_log10_ohm)) {
    params.melf_stage_resistance_mohm = (10 ** params.melf_stage_resistance_log10_ohm) / 1e6;
  }
  const edgeRange = controlRange("edge_diameter_percent", 0, 100);
  const rfRange = controlRange("rf_compare_frequency_log10_mhz", -3, 4);
  const melfRRange = controlRange("melf_stage_resistance_mohm", 1, 1000);
  const melfCRange = controlRange("melf_stage_parasitic_pf", 0.001, 5);
  const melfSubstrateRange = controlRange("melf_substrate_epsr", 3, 30);
  const melfFillRange = controlRange("melf_metal_fill_factor", 0, 0.9);
  const inputSeriesRange = controlRange("input_series_resistance_mohm", 0, 1000);
  const outputSeriesRange = controlRange("output_series_resistance_ohm", 0, 1000);
  const plateSigmaRange = controlRange("plate_conductivity_log10_s_per_m", 5, 8.2);
  const tubeSigmaRange = controlRange("tube_conductivity_log10_s_per_m", 5, 8.2);
  const plateMuRange = controlRange("plate_relative_permeability", 1, 50);
  const tubeMuRange = controlRange("tube_relative_permeability", 1, 50);
  const meshRatioRange = controlRange("mesh_edge_radius_ratio", 0.05, 0.5);
  params.use_direct_stage_circuit = Boolean(params.use_direct_stage_circuit);
  params.use_direct_stage_capacitance = Boolean(params.use_direct_stage_capacitance);
  params.ground_matches_bias_thickness = Boolean(params.ground_matches_bias_thickness);
  params.input_series_matches_stage = params.input_series_matches_stage !== false;
  params.output_series_matches_stage = Boolean(params.output_series_matches_stage);
  params.washer_id_matches_ground = params.washer_id_matches_ground !== false;
  params.washer_od_matches_bias = params.washer_od_matches_bias !== false;
  if (params.ground_matches_bias_thickness) {
    params.ground_plate_thickness_mm = params.bias_plate_thickness_mm;
  }
  params.edge_diameter_percent = clamp(params.edge_diameter_percent, edgeRange.min, edgeRange.max);
  params.rf_compare_frequency_log10_mhz = clamp(params.rf_compare_frequency_log10_mhz, rfRange.min, rfRange.max);
  params.melf_stage_resistance_mohm = clamp(params.melf_stage_resistance_mohm, melfRRange.min, melfRRange.max);
  params.melf_stage_resistance_log10_ohm = Math.log10(params.melf_stage_resistance_mohm * 1e6);
  params.melf_stage_parasitic_pf = clamp(params.melf_stage_parasitic_pf, melfCRange.min, melfCRange.max);
  params.melf_substrate_epsr = clamp(params.melf_substrate_epsr, melfSubstrateRange.min, melfSubstrateRange.max);
  params.melf_metal_fill_factor = clamp(params.melf_metal_fill_factor, melfFillRange.min, melfFillRange.max);
  if (!Number.isFinite(params.input_series_resistance_mohm)) params.input_series_resistance_mohm = params.input_series_matches_stage ? matchedSeriesResistanceMohm(params) : 0;
  if (!Number.isFinite(params.output_series_resistance_ohm)) params.output_series_resistance_ohm = params.output_series_matches_stage ? stageResistanceReferenceOhm(params) : 50;
  params.input_series_resistance_mohm = clamp(params.input_series_resistance_mohm, inputSeriesRange.min, inputSeriesRange.max);
  params.output_series_resistance_ohm = clamp(params.output_series_resistance_ohm, outputSeriesRange.min, outputSeriesRange.max);
  params.plate_conductivity_log10_s_per_m = clamp(params.plate_conductivity_log10_s_per_m, plateSigmaRange.min, plateSigmaRange.max);
  params.tube_conductivity_log10_s_per_m = clamp(params.tube_conductivity_log10_s_per_m, tubeSigmaRange.min, tubeSigmaRange.max);
  params.plate_relative_permeability = clamp(params.plate_relative_permeability, plateMuRange.min, plateMuRange.max);
  params.tube_relative_permeability = clamp(params.tube_relative_permeability, tubeMuRange.min, tubeMuRange.max);
  params.mesh_edge_radius_ratio = clamp(params.mesh_edge_radius_ratio, meshRatioRange.min, meshRatioRange.max);
  for (const id of hvSpacingControlIds) {
    const min = id === "core_to_ground_gap_mm"
      ? coreGapRange.min
      : id === "plate_gap_mm"
        ? Math.max(spacingRange.min, minimumMelfPlateGapMm(params))
        : spacingRange.min;
    const max = id === "core_to_ground_gap_mm" ? coreGapRange.max : spacingRange.max;
    const range = controlRange(id, min, max);
    params[id] = clamp(params[id], range.min, range.max);
  }
  if (params.ground_matches_bias_thickness) {
    params.ground_plate_thickness_mm = params.bias_plate_thickness_mm;
  }

  const hvOdRange = controlRange("hv_plate_od_mm", minHvPlateOdForGeometry(params), 56);
  params.hv_plate_od_mm = clamp(params.hv_plate_od_mm, Math.max(hvOdRange.min, minHvPlateOdForGeometry(params)), hvOdRange.max);
  applyDerivedGeometry(params);
  applyWasherGeometry(params);
  if (params.input_series_matches_stage) params.input_series_resistance_mohm = clamp(matchedSeriesResistanceMohm(params), inputSeriesRange.min, inputSeriesRange.max);
  if (params.output_series_matches_stage) params.output_series_resistance_ohm = clamp(stageResistanceReferenceOhm(params), outputSeriesRange.min, outputSeriesRange.max);
  applyDerivedElectrical(params);
}

function syncCoreCircuitModeControls() {
  const directResistance = usesDirectStageCircuit(params);
  const directCapacitance = usesDirectStageCapacitance(params);
  const melf = usesMelfCoreModel(params);
  const coreResistivityControl = document.getElementById("core_resistivity_control");
  const directResistanceControl = document.getElementById("melf_stage_resistance_control");
  const coreEpsrControl = document.getElementById("core_epsr_control");
  const directCapacitanceControl = document.getElementById("melf_stage_parasitic_control");
  const melfControls = [
    document.getElementById("melf_substrate_epsr_control"),
    document.getElementById("melf_metal_fill_factor_control")
  ];
  const visibility = [
    [coreResistivityControl, !directResistance],
    [directResistanceControl, directResistance],
    [coreEpsrControl, !directCapacitance && !melf],
    [directCapacitanceControl, directCapacitance]
  ];
  for (const [label, visible] of visibility) {
    label.hidden = !visible;
    label.querySelectorAll("input").forEach((input) => {
      input.disabled = label.hidden;
    });
  }
  for (const label of melfControls) {
    label.hidden = !melf || directCapacitance;
    label.querySelectorAll("input").forEach((input) => {
      input.disabled = label.hidden;
    });
  }
}

function syncControls() {
  document.getElementById("core_material").value = params.core_material;
  document.getElementById("washer_material").value = params.washer_material;
  document.getElementById("epoxy_material").value = params.epoxy_material;
  document.getElementById("plate_material").value = params.plate_material;
  document.getElementById("tube_material").value = params.tube_material;
  document.getElementById("field_solver").value = params.field_solver;
  document.getElementById("use_direct_stage_circuit").checked = params.use_direct_stage_circuit;
  document.getElementById("use_direct_stage_capacitance").checked = params.use_direct_stage_capacitance;
  document.getElementById("ground_matches_bias_thickness").checked = params.ground_matches_bias_thickness;
  document.getElementById("input_series_matches_stage").checked = params.input_series_matches_stage;
  document.getElementById("output_series_matches_stage").checked = params.output_series_matches_stage;
  document.getElementById("washer_id_matches_ground").checked = params.washer_id_matches_ground;
  document.getElementById("washer_od_matches_bias").checked = params.washer_od_matches_bias;
  syncDynamicRanges();
  for (const id of ids) {
    if (isDynamicallyConstrainedControl(id)) continue;
    const base = defaultControlRanges[id];
    if (base) setRangeInputBounds(id, base.min, base.max, base.step);
  }
  for (const id of ids) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}_out`);
    const manual = document.getElementById(`${id}_manual`);
    input.value = params[id];
    output.innerHTML = formatControlOutput(id, params[id]);
    if (manual) {
      manual.value = formatManualControlValue(id, params[id]);
      manual.min = input.min;
      manual.max = input.max;
      manual.step = input.step || "any";
    }
  }
  const groundThicknessInput = document.getElementById("ground_plate_thickness_mm");
  const groundThicknessManual = document.getElementById("ground_plate_thickness_mm_manual");
  if (groundThicknessInput) groundThicknessInput.disabled = params.ground_matches_bias_thickness;
  if (groundThicknessManual) groundThicknessManual.disabled = params.ground_matches_bias_thickness;
  const inputSeriesInput = document.getElementById("input_series_resistance_mohm");
  const inputSeriesManual = document.getElementById("input_series_resistance_mohm_manual");
  const outputSeriesInput = document.getElementById("output_series_resistance_ohm");
  const outputSeriesManual = document.getElementById("output_series_resistance_ohm_manual");
  if (inputSeriesInput) inputSeriesInput.disabled = params.input_series_matches_stage;
  if (inputSeriesManual) inputSeriesManual.disabled = params.input_series_matches_stage;
  if (outputSeriesInput) outputSeriesInput.disabled = params.output_series_matches_stage;
  if (outputSeriesManual) outputSeriesManual.disabled = params.output_series_matches_stage;
  const washerIdInput = document.getElementById("washer_id_mm");
  const washerIdManual = document.getElementById("washer_id_mm_manual");
  const washerOdInput = document.getElementById("washer_od_mm");
  const washerOdManual = document.getElementById("washer_od_mm_manual");
  if (washerIdInput) washerIdInput.disabled = params.washer_id_matches_ground;
  if (washerIdManual) washerIdManual.disabled = params.washer_id_matches_ground;
  if (washerOdInput) washerOdInput.disabled = params.washer_od_matches_bias;
  if (washerOdManual) washerOdManual.disabled = params.washer_od_matches_bias;
  syncCoreCircuitModeControls();
  document.getElementById("core_resistance_gohm_out").textContent = formatResistance(totalCoreResistanceOhm(params));
  document.getElementById("ground_plate_inner_diameter_mm_out").textContent = `${params.ground_plate_inner_diameter_mm.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`;
  document.getElementById("tube_id_mm_out").textContent = `${params.tube_id_mm.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`;
  document.getElementById("ground_plate_od_mm_out").textContent = `${params.ground_plate_od_mm.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`;
  document.getElementById("include_ground_tube").checked = params.include_ground_tube;
  updateBreakdownReadouts();
  updateRfMaterialReadouts();
  updateEdgeEstimate();
  updateCircuitEstimates();
  drawSlideGraphics();
}

function updateBreakdownReadouts() {
  for (const definition of dielectricDefinitions(params)) {
    document.getElementById(`${definition.key}_breakdown_out`).textContent = formatKvPerMm(definition.breakdownKvPerMm);
  }
}

function updateEdgeEstimate() {
  const bound = radiusGapBound(params);
  document.getElementById("edgeApprox").textContent = `${(bound.field / 1000).toFixed(2)} kV/mm`;
  document.getElementById("edgeFactor").textContent = `${bound.factor.toFixed(2)}x`;
  document.getElementById("edgeGap").textContent = `${bound.gap.value.toFixed(2)} mm ${bound.gap.label}`;
  document.getElementById("radiusGapBound").textContent =
    `E = V(r + d)/(r d), V ${bound.voltage.toFixed(0)} V, r ${bound.radius.toFixed(2)} mm ${bound.radiusLabel}, d ${bound.gap.value.toFixed(2)} mm`;
}

function updateCircuitEstimates() {
  const circuit = circuitEstimates(params);
  const admittanceCap = capacitanceForAdmittance(circuit, params);
  const feaCap = feaCapacitanceForCurrentDesign();
  const cableCapPf = cableCapacitancePf(params);
  const detectorCapPf = detectorCapacitancePf(params);
  const externalLoadCapPf = cableCapPf + detectorCapPf;
  const admittance = admittanceAtFrequency(
    admittanceCap.capacitancePf + externalLoadCapPf,
    params,
    rfFrequencyHzFromLogMhz(params.rf_compare_frequency_log10_mhz)
  );
  document.getElementById("pairCapacitance").textContent = formatCapacitance(circuit.pairCapPf);
  document.getElementById("shuntCapacitance").textContent = formatCapacitance(circuit.shuntCapPf);
  document.getElementById("totalGroundCapacitance").textContent = formatCapacitance(admittanceCap.capacitancePf);
  document.getElementById("totalGroundCapSource").textContent = admittanceCap.sourceLabel;
  document.getElementById("parasiticCapacitance").textContent = formatCapacitance(circuit.parasiticPf);
  const hasFeaParasitic = feaCap && Number.isFinite(feaCap.parasiticPf);
  document.getElementById("feaParasiticCapacitance").textContent = hasFeaParasitic
    ? formatCapacitance(feaCap.parasiticPf)
    : (feaCap ? "not available" : "not solved");
  document.getElementById("feaParasiticCapacitanceSource").textContent = hasFeaParasitic
    ? feaCap.solverLabel
    : (feaCap ? "backend did not return Cpar" : "run matching FEA solve");
  document.getElementById("parasiticRatio").textContent = Number.isFinite(circuit.parasiticRatio)
    ? `${(100 * circuit.parasiticRatio).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : "--";
  document.getElementById("stageAttenuation50Hz").textContent = formatAttenuationDb(singleStageAttenuationDb(circuit, 50));
  document.getElementById("stageAttenuationHighFrequency").textContent = formatAttenuationDb(highFrequencyCapRatioAttenuationDb(circuit));
  document.getElementById("washerGain").textContent = Number.isFinite(circuit.washerCapGain)
    ? `${circuit.washerCapGain.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`
    : "--";
  document.getElementById("stageResistance").textContent = formatResistance(circuit.stageResistanceOhm);
  document.getElementById("stageCorner").textContent = formatFrequency(circuit.cornerHz);
  document.getElementById("parasiticTakeover").textContent = formatFrequency(circuit.parasiticTakeoverHz);
  document.getElementById("loadResistance").textContent = Number.isFinite(admittance.loadResistanceOhm)
    ? formatResistance(admittance.loadResistanceOhm)
    : "open";
  document.getElementById("loadCurrentSummary").textContent = `Iload = ${formatCurrentFromNa(params.load_current_na)}`;
  document.getElementById("loadCapacitance").textContent = formatCapacitance(externalLoadCapPf);
  document.getElementById("loadCapacitanceSummary").textContent = `${formatCapacitance(cableCapPf)} cable + ${formatCapacitance(detectorCapPf)} det.`;
  document.getElementById("loadAdmittance").textContent = formatAdmittance(admittance.magnitudeS);
  document.getElementById("loadAdmittancePhase").textContent = `${formatFrequency(admittance.frequencyHz)}, phase ${Number.isFinite(admittance.phaseDeg) ? admittance.phaseDeg.toFixed(1) : "--"} deg`;
}

function updateRfMaterialReadouts() {
  const rf = rfMaterialEstimates(params);
  document.getElementById("rfFrequency").textContent = formatFrequency(rf.frequencyHz);
  document.getElementById("plateMaterialSummary").textContent = rf.plate.material;
  document.getElementById("tubeMaterialSummary").textContent = rf.tube.material;
  document.getElementById("plateConductorSummary").innerHTML = `σ ${formatConductivity(rf.plate.conductivity)}, μ<sub>r</sub> ${rf.plate.mur.toLocaleString(undefined, { maximumFractionDigits: 2 })}, δ ${formatLength(rf.plate.skinDepthMm)}`;
  document.getElementById("tubeConductorSummary").innerHTML = `σ ${formatConductivity(rf.tube.conductivity)}, μ<sub>r</sub> ${rf.tube.mur.toLocaleString(undefined, { maximumFractionDigits: 2 })}, δ ${formatLength(rf.tube.skinDepthMm)}`;
  document.getElementById("plate_skin_depth_out").textContent = formatLength(rf.plate.skinDepthMm);
  document.getElementById("tube_skin_depth_out").textContent = formatLength(rf.tube.skinDepthMm);
  document.getElementById("rfBackendStatus").textContent = "Planned";
}

function emptyDielectricPeak(key) {
  return {
    key,
    maxField: 0,
    maxLocation: null
  };
}

function normalizedDielectricPeaks(rawPeaks = {}) {
  const peaks = {
    washer: emptyDielectricPeak("washer"),
    epoxy: emptyDielectricPeak("epoxy")
  };
  for (const [rawKey, rawPeak] of Object.entries(rawPeaks || {})) {
    // Older browser/backend code used "core" for the solved dielectric gap
    // next to the conductive core. Treat that as epoxy so mixed-version backend
    // results still land in the physically relevant breakdown bucket.
    const key = rawKey === "core" || rawKey === "core_adjacent" || rawKey === "core-adjacent"
      ? "epoxy"
      : rawKey;
    if (!Object.hasOwn(peaks, key)) continue;
    const maxField = Number(rawPeak?.maxField ?? rawPeak?.max_field_v_per_mm ?? 0);
    if (!(maxField > peaks[key].maxField)) continue;
    peaks[key] = {
      key,
      maxField,
      maxLocation: rawPeak?.maxLocation ?? rawPeak?.max_location_mm ?? null
    };
  }
  return peaks;
}

function updateDielectricMarginReadouts(summaries = null) {
  for (const definition of dielectricDefinitions(params)) {
    const summary = summaries?.[definition.key] || {
      maxField: Number.NaN,
      margin: Number.NaN,
      breakdownKvPerMm: definition.breakdownKvPerMm
    };
    const emax = formatFieldVPerMm(summary.maxField);
    const margin = formatMargin(summary.margin);
    document.getElementById(`${definition.key}DielectricMargin`).textContent =
      margin === "--" ? `${emax} / --` : `${emax} / ${margin}`;
    document.getElementById(`${definition.key}DielectricBreakdown`).innerHTML =
      `E<sub>bd</sub> ${formatKvPerMm(summary.breakdownKvPerMm)}`;
  }
}

function canvasMetrics(canvas, p, options = {}) {
  const bounds = geometryBounds(p);
  const reservedLeftPx = Math.max(0, options.reservedLeftPx || 0);
  const pad = { left: 46 + reservedLeftPx, right: 22, top: 22, bottom: 34 };
  const plotWidth = canvas.width - pad.left - pad.right;
  const plotHeight = canvas.height - pad.top - pad.bottom;
  const zSpan = bounds.zMax - bounds.zMin;
  const scale = Math.min(plotWidth / zSpan, plotHeight / bounds.rMax);
  const extraX = Math.max(0, plotWidth - zSpan * scale) / 2;
  const extraY = Math.max(0, plotHeight - bounds.rMax * scale) / 2;
  const originX = pad.left + extraX;
  const originY = canvas.height - pad.bottom - extraY;
  return {
    bounds,
    sx: scale,
    sy: scale,
    x: (z) => originX + (z - bounds.zMin) * scale,
    y: (r) => originY - r * scale,
    pad,
    reservedLeftPx
  };
}

function visualForGeometryMaterial(material) {
  const normalized = material === "core" ? "ferrite" : material;
  const visuals = {
    epoxy: { material: "epoxy", color: "#9bc6c2", alpha: 0.16 },
    washer: { material: "washer", color: "#d6b75d", alpha: 0.45 },
    ferrite: { material: "ferrite", color: "#8a5b30", alpha: 0.72 },
    ground: { material: "ground", color: "#557a38", alpha: 1 },
    hv: { material: "hv", color: "#b73e3e", alpha: 1 }
  };
  return visuals[normalized] || { material: normalized, color: "#8a8f95", alpha: 0.6 };
}

function componentsFromGeometrySummary(summary) {
  if (!Array.isArray(summary?.components)) return null;
  const components = [];
  for (const component of summary.components) {
    const rawProfile = component.profile_mm || component.profile;
    if (!Array.isArray(rawProfile) || rawProfile.length < 3) continue;
    const profile = rawProfile.map((point) => {
      if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
      return [Number(point.r), Number(point.z)];
    }).filter(([r, z]) => Number.isFinite(r) && Number.isFinite(z));
    if (profile.length < 3) continue;
    const visual = visualForGeometryMaterial(component.material);
    components.push({
      name: component.name || visual.material,
      material: visual.material,
      color: visual.color,
      alpha: visual.alpha,
      profile
    });
  }
  return components.length ? components : null;
}

function canUseBackendGeometry(canvas) {
  return canvas?.id === "geometryCanvas"
    && !backendGeometryDisabled
    && window.location?.protocol !== "file:";
}

function geometryComponentsForCanvas(canvas, p) {
  const key = comparableResultParameters(p);
  if (canvas?.id === "geometryCanvas" && backendGeometryCache?.key === key) {
    return backendGeometryCache.components;
  }
  return componentProfiles(p);
}

async function refreshBackendGeometry(p, key, requestId) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GEOMETRY_CONNECT_TIMEOUT_MS);
  try {
    const payload = await fetchJson(GEOMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parameters: backendParameters(p) }),
      signal: controller.signal
    });
    const components = componentsFromGeometrySummary(payload.geometry || payload);
    if (requestId !== backendGeometryRequestId || comparableResultParameters(params) !== key || !components) return;
    backendGeometryCache = { key, components };
    backendGeometryPendingKey = null;
    drawGeometry();
  } catch {
    if (requestId === backendGeometryRequestId) {
      backendGeometryPendingKey = null;
      backendGeometryDisabled = true;
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

function requestBackendGeometry(canvas, p) {
  if (!canUseBackendGeometry(canvas)) return;
  const key = comparableResultParameters(p);
  if (backendGeometryCache?.key === key || backendGeometryPendingKey === key) return;
  backendGeometryPendingKey = key;
  const requestId = backendGeometryRequestId + 1;
  backendGeometryRequestId = requestId;
  refreshBackendGeometry(structuredClone(p), key, requestId);
}

function drawRoundedPlate(ctx, m, p, zc, r0, r1, fill, roundedEdge) {
  const kind = roundedEdge === "outer" ? "hv" : "ground";
  const t = plateThicknessMm(p, kind);
  const z0 = zc - t / 2;
  const rad = Math.max(0, Math.min(edgeRadiusMm(p, kind), t / 2));
  const x = m.x(z0);
  const y = m.y(r1);
  const w = t * m.sx;
  const h = (r1 - r0) * m.sy;
  const rr = Math.max(0, rad * Math.min(m.sx, m.sy));
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (roundedEdge === "inner") {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }
  ctx.fill();
}

function drawGeometry(canvas = document.getElementById("geometryCanvas"), p = params, showLegend = true, options = {}) {
  const ctx = canvas.getContext("2d");
  const m = canvasMetrics(canvas, p, options);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawOrder = ["epoxy", "washer", "ferrite", "ground", "hv"];
  const components = geometryComponentsForCanvas(canvas, p);
  for (const material of drawOrder) {
    for (const component of components) {
      if (component.material !== material) continue;
      ctx.save();
      ctx.globalAlpha = component.alpha ?? 1;
      ctx.fillStyle = component.color;
      drawRzProfileFill(ctx, m, component.profile);
      ctx.restore();
    }
  }

  drawAxes(ctx, canvas, m);
  if (showLegend) drawLegend(ctx);
  requestBackendGeometry(canvas, p);
}

function drawRzProfileFill(ctx, m, profile) {
  ctx.beginPath();
  profile.forEach(([r, z], index) => {
    const px = m.x(z);
    const py = m.y(r);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

function drawConductorFills(ctx, m, p = params, voltageColors = false) {
  for (const component of componentProfiles(p)) {
    if (!["hv", "ground", "ferrite"].includes(component.material)) continue;
    ctx.save();
    ctx.globalAlpha = component.material === "ferrite" ? 0.86 : 1;
    ctx.fillStyle = voltageColors && component.material === "ferrite" ? "#b73e3e" : component.color;
    drawRzProfileFill(ctx, m, component.profile);
    ctx.restore();
  }
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function shadedColor(hex, shade, alpha) {
  const rgb = hexToRgb(hex);
  const mix = (value) => Math.round(Math.max(0, Math.min(255, value * shade)));
  return `rgba(${mix(rgb.r)}, ${mix(rgb.g)}, ${mix(rgb.b)}, ${alpha})`;
}

function latheFaces(component, segments = 54, cutaway = true) {
  const faces = [];
  const profile = component.profile;
  const rings = [];
  const thetaSpan = cutaway ? Math.PI * 1.56 : Math.PI * 2;
  const thetaStart = -thetaSpan / 2;
  const ringCount = cutaway ? segments + 1 : segments;
  for (let segment = 0; segment < ringCount; segment += 1) {
    const theta = cutaway ? thetaStart + (thetaSpan * segment) / segments : (2 * Math.PI * segment) / segments;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    rings.push(profile.map(([r, z]) => ({ x: r * cos, y: r * sin, z })));
  }
  const faceSegments = cutaway ? segments : ringCount;
  for (let segment = 0; segment < faceSegments; segment += 1) {
    const nextSegment = cutaway ? segment + 1 : (segment + 1) % ringCount;
    for (let index = 0; index < profile.length; index += 1) {
      const nextIndex = (index + 1) % profile.length;
      if (profile[index][0] === 0 && profile[nextIndex][0] === 0) continue;
      const points = [
        rings[segment][index],
        rings[nextSegment][index],
        rings[nextSegment][nextIndex],
        rings[segment][nextIndex]
      ];
      faces.push({ points, color: component.color, alpha: component.alpha, material: component.material });
    }
  }
  return faces;
}

function drawCadModel(canvas = document.getElementById("cadCanvas"), view = cadView, showHelp = true) {
  const ctx = canvas.getContext("2d");
  const bounds = geometryBounds(params);
  const faces = componentProfiles(params).flatMap((component) => latheFaces(component, 54, view.cutaway));
  const length = bounds.length;
  const rMax = bounds.rMax;
  const scale = Math.min(canvas.width / (length + rMax * 2.2), canvas.height / (rMax * 2.7)) * view.zoom;
  const originX = canvas.width / 2 + view.panX;
  const originY = canvas.height / 2 + view.panY;
  const camera = 130;

  function transform(point) {
    const x0 = point.z - length / 2;
    const y0 = point.x;
    const z0 = point.y;
    const x1 = x0 * Math.cos(view.yaw) + z0 * Math.sin(view.yaw);
    const z1 = -x0 * Math.sin(view.yaw) + z0 * Math.cos(view.yaw);
    const y2 = y0 * Math.cos(view.pitch) - z1 * Math.sin(view.pitch);
    const z2 = y0 * Math.sin(view.pitch) + z1 * Math.cos(view.pitch);
    const perspective = camera / (camera - z2);
    const screenX = originX + x1 * scale * perspective;
    const screenY = originY - y2 * scale * perspective;
    return { x: screenX, y: screenY, depth: z2, vx: x1, vy: y2, vz: z2 };
  }

  function normal(points) {
    const a = points[0];
    const b = points[1];
    const c = points[2];
    const ux = b.vx - a.vx;
    const uy = b.vy - a.vy;
    const uz = b.vz - a.vz;
    const vx = c.vx - b.vx;
    const vy = c.vy - b.vy;
    const vz = c.vz - b.vz;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mag = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / mag, y: ny / mag, z: nz / mag };
  }

  const projected = faces.map((face) => {
    const pts = face.points.map(transform);
    const depth = pts.reduce((sum, point) => sum + point.depth, 0) / pts.length;
    const n = normal(pts);
    const light = Math.max(0.18, n.x * -0.28 + n.y * 0.42 + Math.abs(n.z) * 0.72);
    const shade = 0.56 + light * 0.62;
    return { ...face, pts, depth, shade };
  }).sort((a, b) => a.depth - b.depth);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (showHelp) {
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText("Drag to rotate. Wheel zooms. Shift/right-drag pans. Model is generated from exported r-z CAD profiles.", 22, 24);
  }

  for (const face of projected) {
    ctx.beginPath();
    ctx.moveTo(face.pts[0].x, face.pts[0].y);
    for (let i = 1; i < face.pts.length; i += 1) ctx.lineTo(face.pts[i].x, face.pts[i].y);
    ctx.closePath();
    ctx.fillStyle = shadedColor(face.color, face.shade, face.alpha);
    ctx.fill();
    if (face.material === "hv" || face.material === "ground") {
      ctx.strokeStyle = "rgba(23, 32, 42, 0.28)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }
  drawCadAxes(ctx, canvas, view);
}

function drawCadAxes(ctx, canvas, view = cadView) {
  const x0 = canvas.width - 84;
  const y0 = canvas.height - 58;
  const axisLength = 35;

  function orientVector(point) {
    const x0p = point.z;
    const y0p = point.x;
    const z0p = point.y;
    const x1 = x0p * Math.cos(view.yaw) + z0p * Math.sin(view.yaw);
    const z1 = -x0p * Math.sin(view.yaw) + z0p * Math.cos(view.yaw);
    const y2 = y0p * Math.cos(view.pitch) - z1 * Math.sin(view.pitch);
    return { x: x1, y: -y2 };
  }

  function drawAxis(vector, color, label) {
    const mag = Math.hypot(vector.x, vector.y) || 1;
    const x1 = x0 + (vector.x / mag) * axisLength;
    const y1 = y0 + (vector.y / mag) * axisLength;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(label, x1 + 5, y1 + 4);
  }

  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "11px Arial";
  ctx.fillStyle = "rgba(255, 253, 248, 0.82)";
  ctx.fillRect(x0 - 44, y0 - 48, 112, 78);
  ctx.strokeStyle = "rgba(23, 32, 42, 0.16)";
  ctx.strokeRect(x0 - 44, y0 - 48, 112, 78);
  drawAxis(orientVector({ x: 0, y: 0, z: 1 }), "#b73e3e", "z");
  drawAxis(orientVector({ x: 1, y: 0, z: 0 }), "#557a38", "r");
  ctx.restore();
}

function drawAxes(ctx, canvas, m) {
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(m.x(m.bounds.zMin), m.y(0));
  ctx.lineTo(m.x(m.bounds.zMax), m.y(0));
  ctx.moveTo(m.x(0), m.y(0));
  ctx.lineTo(m.x(0), m.y(m.bounds.rMax));
  ctx.stroke();
  ctx.fillStyle = "#5b6670";
  ctx.font = "13px Arial";
  ctx.fillText("z", canvas.width - 38, canvas.height - 12);
  ctx.fillText("r", 18, 26);
}

function drawLegend(ctx) {
  const items = [
    ["#b73e3e", "HV"],
    ["#557a38", "Cu ground"],
    ["#8a5b30", "Core"],
    ["#d6b75d", "Washer"],
    ["#d9e4e2", "Epoxy"]
  ];
  ctx.font = "12px Arial";
  let x = 56;
  for (const [color, label] of items) {
    ctx.fillStyle = color;
    ctx.fillRect(x, 12, 14, 10);
    ctx.fillStyle = "#17202a";
    ctx.fillText(label, x + 19, 22);
    x += 82;
  }
}

function drawSlideLabel(ctx, text, x, y, color = "#17202a") {
  ctx.fillStyle = color;
  ctx.font = "22px Arial";
  ctx.fillText(text, x, y);
}

function drawWrappedLines(ctx, lines, x, y, lineHeight, color = "#5b6670", font = "19px Arial", maxWidth = null) {
  ctx.fillStyle = color;
  ctx.font = font;
  let lineIndex = 0;
  for (const line of lines) {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex += 1;
      continue;
    }
    const words = String(line).split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        ctx.fillText(current, x, y + lineIndex * lineHeight);
        lineIndex += 1;
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) {
      ctx.fillText(current, x, y + lineIndex * lineHeight);
      lineIndex += 1;
    }
  }
}

function fontSizePx(font) {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]) : 16;
}

function fontWithSize(font, sizePx) {
  return font.replace(/(\d+(?:\.\d+)?)px/, `${sizePx}px`);
}

function drawSubscriptText(ctx, segments, x, y, options = {}) {
  const {
    align = "left",
    color = "#17202a",
    font = "19px Arial",
    background = null,
    paddingX = 6,
    paddingY = 4
  } = options;
  const baseSize = fontSizePx(font);
  const subFont = fontWithSize(font, baseSize * 0.68);
  const subOffset = baseSize * 0.28;

  ctx.save();
  const width = segments.reduce((sum, segment) => {
    ctx.font = segment.sub ? subFont : font;
    return sum + ctx.measureText(segment.text).width;
  }, 0);
  const x0 = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(x0 - paddingX, y - baseSize - paddingY, width + 2 * paddingX, baseSize + subOffset + 2 * paddingY);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cursor = x0;
  segments.forEach((segment) => {
    ctx.font = segment.sub ? subFont : font;
    ctx.fillText(segment.text, cursor, y + (segment.sub ? subOffset : 0));
    cursor += ctx.measureText(segment.text).width;
  });
  ctx.restore();
  return width;
}

function drawArrow(ctx, x0, y0, x1, y1, color = "#17202a") {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 10;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMaterialSlide(canvas) {
  const labelGutterPx = 300;
  drawGeometry(canvas, params, false, { reservedLeftPx: labelGutterPx });
  const ctx = canvas.getContext("2d");
  const m = canvasMetrics(canvas, params, { reservedLeftPx: labelGutterPx });
  const length = stackLength(params);
  const core = params.core_od_mm / 2;
  const hvOuter = params.hv_plate_od_mm / 2;
  const groundInner = params.ground_plate_inner_diameter_mm / 2;
  const groundOuter = params.ground_plate_od_mm / 2;
  const tubeInner = params.tube_id_mm / 2;
  const washerBounds = washerRadialBounds(params);
  const dielectricGapZ = groundPlateThicknessMm(params) + params.plate_gap_mm / 2;
  const centers = plateCenters(params);
  const groundPlateCenter = centers.find(([kind]) => kind === "ground")?.[1] ?? groundPlateThicknessMm(params) / 2;
  const biasPlateCenter = centers.find(([kind]) => kind === "hv")?.[1] ?? dielectricGapZ;
  const labelX = 54;
  const arrowStartX = labelGutterPx - 36;
  const targetX = m.x(dielectricGapZ);
  const coreY = m.y(core * 0.55);
  const groundPlateY = m.y((groundInner + groundOuter) / 2);
  const biasPlateY = m.y((core + hvOuter) / 2);
  const washerY = m.y((washerBounds.inner + washerBounds.outer) / 2);
  const epoxyY = m.y((hvOuter + tubeInner) / 2);
  const labels = [
    { text: "Ground plate", color: "#557a38", targetX: m.x(groundPlateCenter), targetY: groundPlateY },
    { text: "Bias plate", color: "#b73e3e", targetX: m.x(biasPlateCenter), targetY: biasPlateY },
    { text: coreComponentName(params), color: "#8a5b30", targetX, targetY: coreY },
    { text: washerComponentName(params), color: "#8a6a18", targetX, targetY: washerY },
    { text: epoxyComponentName(params), color: "#35736f", targetX, targetY: epoxyY }
  ].sort((a, b) => a.targetY - b.targetY);

  ctx.save();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, labelGutterPx, canvas.height);
  ctx.strokeStyle = "#d8d0bf";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(labelGutterPx, 26);
  ctx.lineTo(labelGutterPx, canvas.height - 34);
  ctx.stroke();
  const labelTop = 92;
  const labelBottom = canvas.height - 64;
  const labelGap = labels.length > 1 ? (labelBottom - labelTop) / (labels.length - 1) : 0;
  labels.forEach((label, index) => {
    const labelY = labelTop + index * labelGap;
    ctx.fillStyle = label.color;
    ctx.fillRect(labelX, labelY - 18, 16, 12);
    drawSlideLabel(ctx, label.text, labelX + 26, labelY - 6, label.color);
    drawArrow(ctx, arrowStartX, labelY - 12, label.targetX, label.targetY, label.color);
  });
  ctx.restore();
}

function drawProfilePolygon(ctx, profile, rToX, zToY) {
  ctx.beginPath();
  profile.forEach(([r, z], index) => {
    const px = rToX(r);
    const py = zToY(z);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

function drawDoubleArrow(ctx, x0, y0, x1, y1, color = "#17202a") {
  drawArrow(ctx, x0, y0, x1, y1, color);
  drawArrow(ctx, x1, y1, x0, y0, color);
}

function drawAnalyticRadialCase(ctx, entry, x, y, width, height, orientation) {
  const targetKind = orientation === "core" ? "ground" : "hv";
  const edgeRadius = Math.max(edgeRadiusMm(params, targetKind), 0.001);
  const thickness = plateThicknessMm(params, targetKind);
  const half = thickness / 2;
  const core = params.core_od_mm / 2;
  const groundInner = params.ground_plate_inner_diameter_mm / 2;
  const hvOuter = params.hv_plate_od_mm / 2;
  const tubeInner = params.tube_id_mm / 2;
  const tubeOuter = tubeInner + params.tube_wall_thickness_mm;
  const centers = plateCenters(params);
  const zc = centers.find(([kind]) => kind === targetKind)?.[1] ?? thickness / 2;
  const z0 = zc - half;
  const z1 = zc + half;
  const radialPad = Math.max(0.45, edgeRadius * 0.85);
  const zPad = Math.max(0.35, edgeRadius * 0.75);
  const bodyTop = y + 76;
  const bodyHeight = height - 160;
  const bodyLeft = x + 34;
  const bodyWidth = width - 68;
  const zMin = z0 - zPad;
  const zMax = z1 + zPad;
  const rMin = orientation === "core"
    ? core - radialPad
    : hvOuter - Math.max(edgeRadius * 3.0, 0.9);
  const rMax = orientation === "core"
    ? groundInner + Math.max(edgeRadius * 3.0, 0.9)
    : Math.max(tubeOuter, tubeInner + Math.max(edgeRadius * 2.0, 0.9));
  const scale = Math.min(bodyWidth / Math.max(rMax - rMin, 0.001), bodyHeight / Math.max(zMax - zMin, 0.001));
  const innerWidth = (rMax - rMin) * scale;
  const innerHeight = (zMax - zMin) * scale;
  const originX = bodyLeft + (bodyWidth - innerWidth) / 2;
  const originY = bodyTop + (bodyHeight - innerHeight) / 2;
  const rToX = (r) => originX + (r - rMin) * scale;
  const zToY = (z) => originY + (zMax - z) * scale;

  ctx.save();
  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#17202a";
  ctx.font = "21px Arial";
  ctx.fillText(entry.shortLabel, x + 18, y + 32);
  ctx.fillStyle = "#5b6670";
  ctx.font = "15px Arial";
  ctx.fillText(entry.note, x + 18, y + 55);
  ctx.font = "13px Arial";
  ctx.fillText(`${entry.clearance.value.toFixed(2)} mm ${entry.clearance.label}`, x + width - 174, y + 32);
  drawSubscriptText(ctx, [
    { text: "r" },
    { text: ` = ${edgeRadius.toFixed(2)} mm` }
  ], x + width - 174, y + 54, { color: "#1f6f78", font: "13px Arial" });

  const labelY = y + height - 49;
  const radiusY = y + height - 28;
  const arrowY = y + height - 76;
  const labelX = (value) => Math.max(x + 60, Math.min(x + width - 60, value));
  const drawBottomLabel = (anchorX, label, radiusText) => {
    ctx.textAlign = "center";
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText(label, labelX(anchorX), labelY);
    ctx.fillText(radiusText, labelX(anchorX), radiusY);
    ctx.textAlign = "left";
  };

  if (orientation === "core") {
    ctx.fillStyle = "#b73e3e";
    ctx.fillRect(rToX(rMin), zToY(zMax), rToX(core) - rToX(rMin), zToY(zMin) - zToY(zMax));
    ctx.fillStyle = "#557a38";
    drawProfilePolygon(ctx, roundedInnerProfile(groundInner, rMax, z0, z1, edgeRadius, 18), rToX, zToY);
    ctx.strokeStyle = "rgba(23, 32, 42, 0.36)";
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.arc(rToX(groundInner + edgeRadius), zToY(zc), edgeRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1f6f78";
    ctx.lineWidth = 2;
    drawDoubleArrow(ctx, rToX(groundInner), zToY(zc), rToX(groundInner + edgeRadius), zToY(zc), "#1f6f78");
    drawBottomLabel(rToX(core), "HV core", `r=${core.toFixed(2)} mm`);
    drawBottomLabel(rToX(groundInner), "ground inner fillet", `r=${groundInner.toFixed(2)} mm`);
    drawDoubleArrow(ctx, rToX(core) + 8, arrowY, rToX(groundInner) - 8, arrowY, "#17202a");
  } else {
    ctx.fillStyle = "#b73e3e";
    drawProfilePolygon(ctx, roundedOuterProfile(rMin, hvOuter, z0, z1, edgeRadius, 18), rToX, zToY);
    ctx.fillStyle = "#557a38";
    ctx.fillRect(rToX(tubeInner), zToY(zMax), rToX(rMax) - rToX(tubeInner), zToY(zMin) - zToY(zMax));
    ctx.strokeStyle = "rgba(23, 32, 42, 0.36)";
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.arc(rToX(hvOuter - edgeRadius), zToY(zc), edgeRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#1f6f78";
    ctx.lineWidth = 2;
    drawDoubleArrow(ctx, rToX(hvOuter - edgeRadius), zToY(zc), rToX(hvOuter), zToY(zc), "#1f6f78");
    drawBottomLabel(rToX(hvOuter), "HV outer fillet", `r=${hvOuter.toFixed(2)} mm`);
    drawBottomLabel(rToX(tubeInner), "ground tube", `r=${tubeInner.toFixed(2)} mm`);
    drawDoubleArrow(ctx, rToX(hvOuter) + 8, arrowY, rToX(tubeInner) - 8, arrowY, "#17202a");
  }
  ctx.restore();
}

function drawAnalyticComparisonTable(ctx, edge, x, y, width) {
  const rowH = 28;
  const ordered = ["core", "tube", "axial"]
    .map((id) => edge.cases.find((entry) => entry.id === id))
    .filter(Boolean);
  ctx.save();
  ctx.font = "13px Arial";
  ctx.fillStyle = "#17202a";
  ctx.fillText("Case", x, y);
  drawSubscriptText(ctx, [
    { text: "R" },
    { text: "maj", sub: true },
    { text: "/r" },
  ], x + width * 0.14, y, { color: "#17202a", font: "13px Arial" });
  ctx.fillText("d", x + width * 0.29, y);
  ctx.fillText("local 2D", x + width * 0.42, y);
  ctx.fillText("axis coax", x + width * 0.60, y);
  ctx.fillText("r,d bound", x + width * 0.80, y);
  ctx.strokeStyle = "#c9c1b0";
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x + width, y + 8);
  ctx.stroke();

  ordered.forEach((entry, index) => {
    const yy = y + 32 + index * rowH;
    const isControl = entry.id === edge.controlling.id;
    ctx.fillStyle = isControl ? "#17202a" : "#5b6670";
    ctx.font = isControl ? "bold 13px Arial" : "13px Arial";
    ctx.fillText(entry.shortLabel, x, yy);
    ctx.fillText(Number.isFinite(entry.torusRatio) ? `${entry.torusRatio.toFixed(1)}` : "--", x + width * 0.17, yy);
    ctx.fillText(`${entry.clearance.value.toFixed(2)}`, x + width * 0.29, yy);
    ctx.fillText(formatFieldVPerMm(entry.edgeCylinderField), x + width * 0.42, yy);
    ctx.fillText(Number.isFinite(entry.coaxialField) ? formatFieldVPerMm(entry.coaxialField) : "--", x + width * 0.60, yy);
    ctx.fillText(formatFieldVPerMm(entry.estimatedField), x + width * 0.80, yy);
  });
  ctx.fillStyle = "#5b6670";
  ctx.font = "12px Arial";
  ctx.fillText("R major / r is torus center radius divided by minimum local radius. The local 2D column does not use it.", x, y + 128);
  ctx.restore();
}

function drawEdgeSlide(canvas) {
  const ctx = canvas.getContext("2d");
  const edge = analyticEdgeEstimate(params);
  const bound = radiusGapBound(params);
  const coreCase = edge.cases.find((entry) => entry.id === "core");
  const tubeCase = edge.cases.find((entry) => entry.id === "tube");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);

  if (coreCase) drawAnalyticRadialCase(ctx, coreCase, 52, 74, 480, 310, "core");
  if (tubeCase) drawAnalyticRadialCase(ctx, tubeCase, 568, 74, 480, 310, "tube");
  const radialRatios = edge.cases
    .filter((entry) => Number.isFinite(entry.torusRatio))
    .map((entry) => entry.torusRatio);
  const minTorusRatio = radialRatios.length ? Math.min(...radialRatios) : Number.NaN;

  ctx.fillStyle = "#17202a";
  ctx.font = "30px Arial";
  ctx.fillText(`${formatFieldVPerMm(bound.field)} radius-gap bound`, 62, 430);
  ctx.font = "19px Arial";
  ctx.fillStyle = "#5b6670";
  ctx.fillText(`${bound.gap.label}: ${bound.factor.toFixed(2)}x local V/d`, 62, 462);
  ctx.fillText(`Minimum radius r = ${bound.radius.toFixed(2)} mm (${bound.radiusLabel})`, 62, 492);
  ctx.fillText(`Emax = V(r+d)/(r d), d = ${bound.gap.value.toFixed(2)} mm`, 62, 522);
  if (Number.isFinite(minTorusRatio)) {
    drawSubscriptText(ctx, [
      { text: "Smallest R" },
      { text: "maj", sub: true },
      { text: "/r" },
      { text: ` on radial sides: ${minTorusRatio.toFixed(1)}` }
    ], 62, 552, { color: "#5b6670", font: "19px Arial" });
  }

  drawAnalyticComparisonTable(ctx, edge, 560, 425, 480);

  drawWrappedLines(ctx, [
    "The bound assumes every exposed conductor feature has radius at least r and every opposite-conductor gap is at least d.",
    "Use FEA to confirm the drawn geometry respects those assumptions and to measure the actual margin."
  ], 62, 582, 22, "#5b6670", "16px Arial");
}

function drawDeformationSlide(canvas) {
  const ctx = canvas.getContext("2d");
  const bound = radiusGapBound(params);
  const radius = bound.radius;
  const gap = bound.gap.value;
  const w = canvas.width;
  const h = canvas.height;
  const y = h * 0.44;
  const sphereX = w * 0.19;
  const stretchX = w * 0.50;
  const filterX = w * 0.80;
  const shellR = 112;
  const innerR = 42;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(85, 122, 56, 0.15)";
  ctx.strokeStyle = "#557a38";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(sphereX, y, shellR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#b73e3e";
  ctx.beginPath();
  ctx.arc(sphereX, y, innerR, 0, Math.PI * 2);
  ctx.fill();
  drawArrow(ctx, sphereX + innerR, y + shellR + 28, sphereX + shellR, y + shellR + 28, "#17202a");
  drawArrow(ctx, sphereX + shellR, y + shellR + 28, sphereX + innerR, y + shellR + 28, "#17202a");
  drawSlideLabel(ctx, "minimum gap d", sphereX - 56, y + shellR + 62);

  ctx.fillStyle = "rgba(85, 122, 56, 0.13)";
  ctx.strokeStyle = "#557a38";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(stretchX, y, 135, 74, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#b73e3e";
  ctx.beginPath();
  ctx.ellipse(stretchX, y, 120, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(23, 32, 42, 0.35)";
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(stretchX + 120, y, innerR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(217, 228, 226, 0.85)";
  ctx.fillRect(filterX - 126, y - 82, 252, 164);
  ctx.fillStyle = "#557a38";
  ctx.fillRect(filterX + 114, y - 104, 26, 208);
  ctx.fillStyle = "#b73e3e";
  ctx.beginPath();
  ctx.moveTo(filterX - 142, y - 27);
  ctx.lineTo(filterX + 58, y - 27);
  ctx.quadraticCurveTo(filterX + 84, y - 27, filterX + 84, y);
  ctx.quadraticCurveTo(filterX + 84, y + 27, filterX + 58, y + 27);
  ctx.lineTo(filterX - 142, y + 27);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(23, 32, 42, 0.35)";
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(filterX + 57, y, 27, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  drawArrow(ctx, sphereX + shellR + 24, y, stretchX - 166, y, "#1f6f78");
  drawArrow(ctx, stretchX + 156, y, filterX - 172, y, "#1f6f78");

  ctx.fillStyle = "#17202a";
  ctx.font = "24px Arial";
  ctx.fillText("1. Limiting sphere", sphereX - 92, h * 0.16);
  ctx.fillText("2. Larger-area shape", stretchX - 106, h * 0.16);
  ctx.fillText("3. Filter rim check", filterX - 92, h * 0.16);

  drawWrappedLines(ctx, [
    `Bound: Emax = V(r+d)/(r d), V = ${bound.voltage.toFixed(0)} V, r = ${radius.toFixed(2)} mm, d = ${gap.toFixed(2)} mm`,
    `Minimum radius: ${bound.radiusLabel}; minimum gap: ${bound.gap.label}; current bound: ${(bound.field / 1000).toFixed(2)} kV/mm`,
    "Constraint: every exposed conductor feature has radius >= r and every opposite-conductor gap is >= d.",
    "FEA is still the geometry audit: it checks that no modeled fillet, lip, or tolerance violates the bound inputs."
  ], w * 0.10, h * 0.78, 28, "#5b6670", "20px Arial");
}

function packingShapeFactor(x) {
  if (!(x > 0)) return 0;
  return x / ((1 + x) * (1 + 2 * x));
}

function drawPackingSlide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const optimum = 1 / Math.sqrt(2);
  const optimumValue = packingShapeFactor(optimum);
  const gap = Number.isFinite(params.plate_gap_mm) && params.plate_gap_mm > 0
    ? params.plate_gap_mm
    : defaults.plate_gap_mm;
  const currentRatio = gap > 0 ? edgeRadiusMm(params) / gap : Number.NaN;
  const currentValue = packingShapeFactor(currentRatio);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#17202a";
  ctx.font = "30px Arial";
  ctx.fillText("Field-limited capacitance packing", 56, 62);

  ctx.fillStyle = "#f4efe3";
  ctx.strokeStyle = "#d7cbb5";
  ctx.lineWidth = 1.5;
  ctx.fillRect(50, 92, 455, 405);
  ctx.strokeRect(50, 92, 455, 405);

  drawWrappedLines(ctx, [
    "Assumptions",
    "plate thickness = 2r",
    "gap = d",
    "C ∝ 1/d",
    "L = d + 2r",
    "Eₘₐₓ uses radius-gap limit"
  ], 74, 132, 28, "#5b6670", "20px Arial");

  ctx.fillStyle = "#17202a";
  ctx.font = "24px Georgia";
  ctx.fillText("FOM = C / (L Eₘₐₓ)", 74, 316);
  ctx.font = "21px Georgia";
  ctx.fillStyle = "#5b6670";
  ctx.fillText("FOM ∝ r / ((r + d)(d + 2r))", 74, 354);
  ctx.fillText("x = r/d", 74, 392);
  ctx.fillStyle = "#17202a";
  ctx.font = "24px Georgia";
  ctx.fillText("shape factor = x / ((1 + x)(1 + 2x))", 74, 430);
  ctx.fillText("x* = 1/√2 = 0.707", 74, 470);

  const plotX = 590;
  const plotY = 104;
  const plotW = 430;
  const plotH = 330;
  const xMax = 3;
  const yMax = optimumValue * 1.16;
  const xToPx = (x) => plotX + (x / xMax) * plotW;
  const yToPx = (y) => plotY + plotH - (y / yMax) * plotH;

  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotX, plotY);
  ctx.lineTo(plotX, plotY + plotH);
  ctx.lineTo(plotX + plotW, plotY + plotH);
  ctx.stroke();

  ctx.fillStyle = "#5b6670";
  ctx.font = "14px Arial";
  ctx.fillText("r/d", plotX + plotW - 28, plotY + plotH + 34);
  ctx.fillText("FOM shape", plotX - 10, plotY - 18);
  [0, 0.5, 1, 1.5, 2, 2.5, 3].forEach((tick) => {
    const x = xToPx(tick);
    ctx.strokeStyle = "#e2d8c4";
    ctx.beginPath();
    ctx.moveTo(x, plotY + plotH);
    ctx.lineTo(x, plotY + plotH + 6);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.fillText(`${tick}`, x - 8, plotY + plotH + 24);
  });

  ctx.strokeStyle = "#1f6f78";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 180; i += 1) {
    const x = 0.02 + (xMax - 0.02) * i / 180;
    const px = xToPx(x);
    const py = yToPx(packingShapeFactor(x));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  const optX = xToPx(optimum);
  const optY = yToPx(optimumValue);
  ctx.strokeStyle = "#b73e3e";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.moveTo(optX, plotY + plotH);
  ctx.lineTo(optX, optY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#b73e3e";
  ctx.beginPath();
  ctx.arc(optX, optY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "17px Arial";
  ctx.fillText("x* = 1/√2", optX + 12, optY - 10);

  if (Number.isFinite(currentRatio) && currentRatio > 0 && currentRatio <= xMax) {
    const currentX = xToPx(currentRatio);
    const currentY = yToPx(currentValue);
    const currentLabel = `current ${currentRatio.toFixed(2)}`;
    ctx.fillStyle = "#8a5b30";
    ctx.beginPath();
    ctx.arc(currentX, currentY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "17px Arial";
    const labelWidth = ctx.measureText(currentLabel).width;
    const useUpperLeft = !(currentX < plotX + 155 && currentY < plotY + 92);
    const labelX = useUpperLeft ? plotX + 18 : plotX + plotW - labelWidth - 18;
    const labelY = plotY + 42;
    ctx.strokeStyle = "rgba(138, 91, 48, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(labelX + (useUpperLeft ? labelWidth + 8 : -8), labelY - 8);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
    drawRcLabel(ctx, currentLabel, labelX, labelY, {
      color: "#8a5b30",
      font: "17px Arial",
      background: "#fffdf8"
    });
  }

  drawWrappedLines(ctx, [
    "Field stress is taken from the radius-gap limit for the most limiting local geometry.",
    "This FOM rewards capacitance, penalizes stack length, and also penalizes electric-field stress.",
    "It is a shape metric; absolute performance still scales with material permittivity, area, and allowed voltage margin."
  ], 64, 532, 24, "#5b6670", "18px Arial", 960);
}

function c(re, im = 0) {
  return { re, im };
}

function cAdd(a, b) {
  return c(a.re + b.re, a.im + b.im);
}

function cSub(a, b) {
  return c(a.re - b.re, a.im - b.im);
}

function cMul(a, b) {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function cDiv(a, b) {
  const denom = b.re * b.re + b.im * b.im;
  if (denom === 0) return c(0, 0);
  return c((a.re * b.re + a.im * b.im) / denom, (a.im * b.re - a.re * b.im) / denom);
}

function cAbs(a) {
  return Math.hypot(a.re, a.im);
}

function solveComplexLinear(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row) => row.map((value) => c(value.re, value.im)));
  const b = rhs.map((value) => c(value.re, value.im));

  for (let pivot = 0; pivot < n; pivot += 1) {
    let best = pivot;
    let bestAbs = cAbs(a[pivot][pivot]);
    for (let row = pivot + 1; row < n; row += 1) {
      const candidate = cAbs(a[row][pivot]);
      if (candidate > bestAbs) {
        best = row;
        bestAbs = candidate;
      }
    }
    if (bestAbs < 1e-30) return null;
    if (best !== pivot) {
      [a[pivot], a[best]] = [a[best], a[pivot]];
      [b[pivot], b[best]] = [b[best], b[pivot]];
    }

    const pivotValue = a[pivot][pivot];
    for (let col = pivot; col < n; col += 1) {
      a[pivot][col] = cDiv(a[pivot][col], pivotValue);
    }
    b[pivot] = cDiv(b[pivot], pivotValue);

    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot];
      if (cAbs(factor) < 1e-30) continue;
      for (let col = pivot; col < n; col += 1) {
        a[row][col] = cSub(a[row][col], cMul(factor, a[pivot][col]));
      }
      b[row] = cSub(b[row], cMul(factor, b[pivot]));
    }
  }
  return b;
}

function ladderTransferMagnitude(circuit, p, frequencyHz, options = {}) {
  const stages = Math.max(1, Math.floor(p.plate_pairs));
  const omega = 2 * Math.PI * frequencyHz;
  const yPar = c(
    Number.isFinite(circuit.stageResistanceOhm) && circuit.stageResistanceOhm > 0 ? 1 / circuit.stageResistanceOhm : 0,
    omega * Math.max(0, circuit.parasiticPf || 0) * 1e-12
  );
  const yGround = c(0, omega * Math.max(0, circuit.shuntCapPf || 0) * 1e-12);
  const yLoad = options.includeLoad ? loadAdmittanceAtFrequency(p, frequencyHz) : c(0, 0);
  const inputOhm = inputSeriesResistanceOhm(circuit, p);
  const outputOhm = outputSeriesResistanceOhm(circuit, p);
  const includeOutputNode = outputOhm > 0 && cAbs(yLoad) > 0;
  const outputNode = includeOutputNode ? stages : stages - 1;
  const allNodes = Array.from({ length: stages + (includeOutputNode ? 1 : 0) }, (_, index) => index);
  const fixed = new Map();
  fixed.set(-1, c(1, 0));
  if (!(inputOhm > 0)) fixed.set(0, c(1, 0));
  const unknownNodes = allNodes.filter((node) => !fixed.has(node));
  const unknownIndex = new Map(unknownNodes.map((node, index) => [node, index]));
  if (!unknownNodes.length) return cAbs(fixed.get(outputNode) || c(1, 0));

  const matrix = Array.from({ length: unknownNodes.length }, () => Array.from({ length: unknownNodes.length }, () => c(0, 0)));
  const rhs = Array.from({ length: unknownNodes.length }, () => c(0, 0));
  const addShunt = (node, y) => {
    if (cAbs(y) <= 0 || fixed.has(node)) return;
    const row = unknownIndex.get(node);
    matrix[row][row] = cAdd(matrix[row][row], y);
  };
  const addBranch = (a, b, y) => {
    if (cAbs(y) <= 0) return;
    const aFixed = fixed.get(a);
    const bFixed = fixed.get(b);
    const aRow = unknownIndex.get(a);
    const bRow = unknownIndex.get(b);
    if (aRow !== undefined) {
      matrix[aRow][aRow] = cAdd(matrix[aRow][aRow], y);
      if (bRow !== undefined) matrix[aRow][bRow] = cSub(matrix[aRow][bRow], y);
      else if (bFixed) rhs[aRow] = cAdd(rhs[aRow], cMul(y, bFixed));
    }
    if (bRow !== undefined) {
      matrix[bRow][bRow] = cAdd(matrix[bRow][bRow], y);
      if (aRow !== undefined) matrix[bRow][aRow] = cSub(matrix[bRow][aRow], y);
      else if (aFixed) rhs[bRow] = cAdd(rhs[bRow], cMul(y, aFixed));
    }
  };
  const resistorY = (ohms) => (Number.isFinite(ohms) && ohms > 0 ? c(1 / ohms, 0) : c(0, 0));

  for (let node = 0; node < stages; node += 1) addShunt(node, yGround);
  addBranch(0, -1, resistorY(inputOhm));
  for (let node = 1; node < stages; node += 1) addBranch(node - 1, node, yPar);
  if (includeOutputNode) {
    addBranch(stages - 1, outputNode, resistorY(outputOhm));
    addShunt(outputNode, yLoad);
  } else {
    addShunt(stages - 1, yLoad);
  }

  const solution = solveComplexLinear(matrix, rhs);
  if (!solution) return Number.NaN;
  if (fixed.has(outputNode)) return cAbs(fixed.get(outputNode));
  return cAbs(solution[unknownIndex.get(outputNode)]);
}

function attenuationSamples(circuit, p) {
  const fMin = ATTENUATION_PLOT_FMIN_HZ;
  const fMax = ATTENUATION_PLOT_FMAX_HZ;
  const samples = [];
  const steps = 140;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const frequency = fMin * (fMax / fMin) ** t;
    const magnitude = Math.max(1e-12, singleStageTransferMagnitude(circuit, frequency));
    samples.push({
      frequency,
      magnitude,
      attenuationDb: -20 * Math.log10(magnitude)
    });
  }
  return { samples, fMin, fMax };
}

function formatAttenuationDb(db) {
  if (!Number.isFinite(db)) return "--";
  if (Math.abs(db) >= 100) return `${db.toFixed(0)} dB`;
  return `${db.toFixed(1)} dB`;
}

function drawRcCapacitor(ctx, x, nodeY, groundY) {
  const plateWidth = 58;
  const plateGap = 18;
  const capCenterY = (nodeY + groundY) / 2;
  const upperPlateY = capCenterY - plateGap / 2;
  const lowerPlateY = capCenterY + plateGap / 2;

  ctx.save();
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, nodeY);
  ctx.lineTo(x, upperPlateY);
  ctx.moveTo(x - plateWidth / 2, upperPlateY);
  ctx.lineTo(x + plateWidth / 2, upperPlateY);
  ctx.moveTo(x - plateWidth / 2, lowerPlateY);
  ctx.lineTo(x + plateWidth / 2, lowerPlateY);
  ctx.moveTo(x, lowerPlateY);
  ctx.lineTo(x, groundY);
  ctx.stroke();
  ctx.restore();
}

function drawRcResistor(ctx, x0, y, x1) {
  const leadLength = Math.min(34, Math.max(18, (x1 - x0) * 0.18));
  const zigStart = x0 + leadLength;
  const zigEnd = x1 - leadLength;
  const amplitude = 17;
  const peaks = 8;

  ctx.save();
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(zigStart, y);
  for (let peak = 0; peak < peaks; peak += 1) {
    const x = zigStart + (zigEnd - zigStart) * (peak + 0.5) / peaks;
    const yy = y + (peak % 2 === 0 ? -amplitude : amplitude);
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(zigEnd, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function drawRcLabel(ctx, text, x, y, options = {}) {
  const {
    align = "left",
    color = "#17202a",
    font = "24px Arial",
    background = "#fffdf8",
    paddingX = 6,
    paddingY = 4
  } = options;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = parseInt(font, 10) || 20;
  const x0 = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  ctx.fillStyle = background;
  ctx.fillRect(x0 - paddingX, y - height - paddingY, width + 2 * paddingX, height + 2 * paddingY);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawRcParasiticCapacitor(ctx, x0, nodeY, x1, branchY) {
  const capX = (x0 + x1) / 2;
  const plateGap = 26;
  const plateHeight = 42;
  const leftPlateX = capX - plateGap / 2;
  const rightPlateX = capX + plateGap / 2;

  ctx.save();
  ctx.strokeStyle = "#1f6f78";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(x0, nodeY - 14);
  ctx.lineTo(x0, branchY);
  ctx.lineTo(leftPlateX, branchY);
  ctx.moveTo(rightPlateX, branchY);
  ctx.lineTo(x1, branchY);
  ctx.lineTo(x1, nodeY - 14);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(leftPlateX, branchY - plateHeight / 2);
  ctx.lineTo(leftPlateX, branchY + plateHeight / 2);
  ctx.moveTo(rightPlateX, branchY - plateHeight / 2);
  ctx.lineTo(rightPlateX, branchY + plateHeight / 2);
  ctx.stroke();
  ctx.restore();

  return { capX, labelX: rightPlateX + 22, labelY: branchY - 16 };
}

function drawRcDiagram(canvas) {
  const ctx = canvas.getContext("2d");
  const circuit = circuitEstimates(params);
  const w = canvas.width;
  const h = canvas.height;
  const y = h * 0.27;
  const groundY = h * 0.49;
  const xs = [w * 0.18, w * 0.43];
  const capCenterY = (y + 14 + groundY) / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 4;

  for (const x of xs) {
    ctx.fillStyle = "#b73e3e";
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#17202a";
    drawRcCapacitor(ctx, x, y + 14, groundY);
  }

  drawRcResistor(ctx, xs[0] + 14, y, xs[1] - 14);

  const cparLabel = drawRcParasiticCapacitor(ctx, xs[0], y, xs[1], y - 106);

  ctx.strokeStyle = "#557a38";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w * 0.1, groundY);
  ctx.lineTo(w * 0.62, groundY);
  ctx.stroke();

  drawSubscriptText(ctx, [
    { text: "R" },
    { text: "stage", sub: true },
    { text: ` ${formatResistance(circuit.stageResistanceOhm)}` }
  ], w * 0.18, y - 38, { font: "24px Arial", background: "#fffdf8" });
  drawSubscriptText(ctx, [
    { text: "C" },
    { text: "g", sub: true },
    { text: " stage" },
    { text: ` ${formatCapacitance(circuit.shuntCapPf)}` }
  ], xs[1] + 56, capCenterY + 4, { font: "24px Arial", background: "#fffdf8" });
  drawSubscriptText(ctx, [
    { text: "C" },
    { text: "par", sub: true },
    { text: ` ${formatCapacitance(circuit.parasiticPf)}` }
  ], cparLabel.labelX, cparLabel.labelY, { font: "24px Arial", background: "#fffdf8" });
  drawRcLabel(ctx, `RC corner ${formatFrequency(circuit.cornerHz)}`, w * 0.66, y - 38);
  drawSubscriptText(ctx, [
    { text: "C" },
    { text: "par", sub: true },
    { text: "/C" },
    { text: "g", sub: true },
    { text: ` ${(100 * circuit.parasiticRatio).toFixed(2)}%` }
  ], w * 0.66, y - 6, { color: "#5b6670", font: "19px Arial", background: "#fffdf8" });
  drawSubscriptText(ctx, [
    { text: "|X" },
    { text: "C,par", sub: true },
    { text: "| = R" },
    { text: "stage", sub: true },
    { text: ` at ${formatFrequency(circuit.parasiticTakeoverHz)}` }
  ], w * 0.66, y + 28, { color: "#5b6670", font: "19px Arial", background: "#fffdf8" });

  drawAttenuationPlot(ctx, circuit, params, w * 0.10, h * 0.59, w * 0.78, h * 0.32);
}

function drawAttenuationPlot(ctx, circuit, p, x, y, width, height) {
  const { samples, fMin, fMax } = attenuationSamples(circuit, p);
  const capRatioLimitDb = highFrequencyCapRatioAttenuationDb(circuit);
  const fiftyHzAttenuationDb = singleStageAttenuationDb(circuit, 50);
  const plottedMax = Math.max(
    ...samples.map((sample) => sample.attenuationDb),
    Number.isFinite(capRatioLimitDb) ? capRatioLimitDb : 0,
    Number.isFinite(fiftyHzAttenuationDb) ? fiftyHzAttenuationDb : 0
  );
  const maxDb = Math.max(20, Math.ceil(plottedMax / 10) * 10);
  const yTicks = [0, maxDb / 2, maxDb];
  const xFor = (frequency) => x + ((Math.log10(frequency) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * width;
  const yFor = (db) => y + height - (db / maxDb) * height;

  ctx.save();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  for (const tick of yTicks) {
    const yy = yFor(tick);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.8)";
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "15px Arial";
    ctx.fillText(`${tick.toFixed(0)} dB`, x - 58, yy + 5);
  }

  const decadeStart = Math.ceil(Math.log10(fMin));
  const decadeEnd = Math.floor(Math.log10(fMax));
  for (let decade = decadeStart; decade <= decadeEnd; decade += 1) {
    const frequency = 10 ** decade;
    const xx = xFor(frequency);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.55)";
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + height);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "14px Arial";
    ctx.fillText(formatFrequency(frequency), xx - 22, y + height + 22);
  }

  ctx.strokeStyle = "#1f6f78";
  ctx.lineWidth = 4;
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const xx = xFor(sample.frequency);
    const yy = yFor(sample.attenuationDb);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.stroke();

  if (Number.isFinite(capRatioLimitDb)) {
    const yy = yFor(capRatioLimitDb);
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    const labelY = Math.min(y + height - 8, yy + 24);
    drawSubscriptText(ctx, [
      { text: "HF C" },
      { text: "par", sub: true },
      { text: "/C" },
      { text: "g", sub: true },
      { text: ` limit ${formatAttenuationDb(capRatioLimitDb)}` }
    ], x + width - 300, labelY, { color: "#8b5a2b", font: "16px Arial", background: "#fffdf8" });
  }

  if (Number.isFinite(fiftyHzAttenuationDb) && 50 >= fMin && 50 <= fMax) {
    const xx = xFor(50);
    const yy = yFor(fiftyHzAttenuationDb);
    ctx.fillStyle = "#b73e3e";
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(xx, yy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.strokeStyle = "#b73e3e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xx + 8, yy - 8);
    ctx.lineTo(xx + 62, yy - 38);
    ctx.stroke();
    drawRcLabel(ctx, `50 Hz ${formatAttenuationDb(fiftyHzAttenuationDb)}`, xx + 68, yy - 34, {
      color: "#b73e3e",
      font: "16px Arial",
      background: "#fffdf8"
    });
  }

  if (Number.isFinite(circuit.cornerHz) && circuit.cornerHz >= fMin && circuit.cornerHz <= fMax) {
    const xx = xFor(circuit.cornerHz);
    ctx.strokeStyle = "#557a38";
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "16px Arial";
    const label = "RC corner";
    const labelWidth = ctx.measureText(label).width;
    const labelX = Math.max(x + 8, xx - labelWidth - 14);
    drawRcLabel(ctx, label, labelX, y + 34, {
      color: "#557a38",
      font: "16px Arial",
      background: "#fffdf8"
    });
  }

  if (Number.isFinite(circuit.parasiticTakeoverHz) && circuit.parasiticTakeoverHz >= fMin && circuit.parasiticTakeoverHz <= fMax) {
    const xx = xFor(circuit.parasiticTakeoverHz);
    ctx.strokeStyle = "#b73e3e";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + height);
    ctx.stroke();
    ctx.setLineDash([]);
    drawSubscriptText(ctx, [
      { text: "|X" },
      { text: "C,par", sub: true },
      { text: "| = R" },
      { text: "stage", sub: true }
    ], xx + 8, y + 74, { color: "#b73e3e", font: "16px Arial", background: "#fffdf8" });
  }

  ctx.fillStyle = "#17202a";
  ctx.font = "20px Arial";
  drawSubscriptText(ctx, [
    { text: "Attenuation dB, -20 log" },
    { text: "10", sub: true },
    { text: "(|V" },
    { text: "out", sub: true },
    { text: "/V" },
    { text: "in", sub: true },
    { text: "|)" }
  ], x, y - 14, { color: "#17202a", font: "20px Arial" });
  ctx.fillStyle = "#5b6670";
  ctx.font = "15px Arial";
  ctx.fillText("10× voltage noise reduction = 20 dB", x + width - 280, y - 14);
  ctx.restore();
}

function biasPlateCount(p) {
  return Math.max(1, Math.floor(p.plate_pairs));
}

function feaCapacitanceForCurrentDesign() {
  const solved = solvedCapacitanceForCurrentDesign();
  if (!solved || !lastResult) return null;
  return {
    ...solved,
    solverLabel: resultSolverLabel(lastResult)
  };
}

function equivalentCircuitWithTotalCap(circuit, p, totalCapPf) {
  const plates = biasPlateCount(p);
  const shuntCapPf = totalCapPf > 0 ? totalCapPf / plates : Number.NaN;
  const cornerHz = Number.isFinite(circuit.stageResistanceOhm) && shuntCapPf > 0
    ? 1 / (2 * Math.PI * circuit.stageResistanceOhm * shuntCapPf * 1e-12)
    : Number.NaN;
  return {
    ...circuit,
    shuntCapPf,
    parasiticRatio: circuit.parasiticPf / shuntCapPf,
    cornerHz
  };
}

function scaledSingleStageAttenuationDb(circuit, p, frequencyHz, includeLoad = false) {
  const sections = activeSeriesSectionCount(circuit, p, includeLoad);
  if (sections <= 0) return 0;
  const oneStage = singleStageAttenuationDb(
    circuit,
    frequencyHz,
    includeLoad ? loadConductanceS(p) : 0,
    includeLoad ? loadCapacitancePf(p) : 0
  );
  return Number.isFinite(oneStage) ? sections * oneStage : Number.NaN;
}

function admittanceSweep(capacitancePf, p, fMin, fMax, steps = 140) {
  const samples = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const frequency = fMin * (fMax / fMin) ** t;
    samples.push(admittanceAtFrequency(capacitancePf, p, frequency));
  }
  return samples;
}

function logScaleBounds(values, padding = 0.25) {
  const positives = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!positives.length) return { min: 1e-15, max: 1e-9 };
  const min = Math.min(...positives);
  const max = Math.max(...positives);
  return {
    min: 10 ** Math.floor(Math.log10(min) - padding),
    max: 10 ** Math.ceil(Math.log10(max) + padding)
  };
}

function drawLogPlotFrame(ctx, x, y, width, height, fMin, fMax, yMin, yMax, options = {}) {
  const xFor = (frequency) => x + ((Math.log10(frequency) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * width;
  const yFor = (value) => y + height - ((Math.log10(value) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * height;

  ctx.save();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  const fStart = Math.ceil(Math.log10(fMin));
  const fEnd = Math.floor(Math.log10(fMax));
  for (let decade = fStart; decade <= fEnd; decade += 1) {
    const frequency = 10 ** decade;
    const xx = xFor(frequency);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.55)";
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + height);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText(formatFrequency(frequency), xx - 22, y + height + 22);
  }

  const yStart = Math.ceil(Math.log10(yMin));
  const yEnd = Math.floor(Math.log10(yMax));
  for (let decade = yStart; decade <= yEnd; decade += 1) {
    const value = 10 ** decade;
    const yy = yFor(value);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.75)";
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(options.yFormatter ? options.yFormatter(value) : value.toExponential(0), x - 10, yy + 4);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = "#17202a";
  ctx.font = "19px Arial";
  if (options.title) ctx.fillText(options.title, x, y - 18);
  if (options.yLabel) ctx.fillText(options.yLabel, x - 66, y - 18);
  ctx.restore();
  return { xFor, yFor };
}

function drawLogCurve(ctx, samples, xFor, yFor, valueKey, color, options = {}) {
  const valid = samples.filter((sample) => Number.isFinite(sample.frequencyHz ?? sample.frequency) && Number.isFinite(sample[valueKey]) && sample[valueKey] > 0);
  if (!valid.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = options.lineWidth || 4;
  if (options.dashed) ctx.setLineDash(options.dashed);
  ctx.beginPath();
  valid.forEach((sample, index) => {
    const frequency = sample.frequencyHz ?? sample.frequency;
    const xx = xFor(frequency);
    const yy = yFor(sample[valueKey]);
    if (index === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.stroke();
  ctx.restore();
}

function wrappedLegendLines(ctx, text, maxWidth) {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [String(text)];
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [String(text)];
}

function drawSlideLegend(ctx, entries, x, y, options = {}) {
  ctx.save();
  let yy = y;
  const font = options.font || "17px Arial";
  const lineHeight = options.lineHeight || 20;
  const rowGap = options.rowGap || 8;
  const labelX = x + 46;
  const labelWidth = Number.isFinite(options.maxWidth) ? options.maxWidth : null;
  entries.forEach((entry) => {
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = 4;
    if (entry.dashed) ctx.setLineDash(entry.dashed);
    ctx.beginPath();
    ctx.moveTo(x, yy - 6);
    ctx.lineTo(x + 34, yy - 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = entry.color;
    ctx.font = font;
    const lines = wrappedLegendLines(ctx, entry.label, labelWidth);
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, labelX, yy + lineIndex * lineHeight);
    });
    yy += Math.max(28, lines.length * lineHeight + rowGap);
  });
  ctx.restore();
}

function drawFeaSanitySlide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const circuit = circuitEstimates(params);
  const plates = biasPlateCount(params);
  const analyticTotalCapPf = circuit.totalGroundCapPf;
  const feaCap = feaCapacitanceForCurrentDesign();
  const feaTotalRatio = feaCap ? feaCap.totalPf / analyticTotalCapPf : Number.NaN;
  const analyticParasiticPf = circuit.parasiticPf;
  const feaParasiticPf = feaCap ? feaCap.parasiticPf : Number.NaN;
  const feaParasiticRatio = Number.isFinite(feaParasiticPf) && analyticParasiticPf > 0
    ? feaParasiticPf / analyticParasiticPf
    : Number.NaN;
  const formatRatioText = (ratio) => (Number.isFinite(ratio)
    ? `${ratio.toLocaleString(undefined, { maximumFractionDigits: 3 })}x`
    : "--");

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#17202a";
  ctx.font = "22px Arial";
  ctx.fillText("FEA capacitance sanity check", 92, 54);

  const capRows = [
    ["Analytic Ctotal", formatCapacitance(analyticTotalCapPf), `Cg per bias plate x ${plates}`],
    ["FEA Ctotal", feaCap ? formatCapacitance(feaCap.totalPf) : "not solved", feaCap ? feaCap.solverLabel : "run FEniCSx required"],
    ["FEA / analytic", formatRatioText(feaTotalRatio), "total Cg sanity ratio"]
  ];
  capRows.forEach((row, index) => {
    const x = 92 + index * 300;
    const y = 88;
    ctx.fillStyle = "#f5f2ea";
    ctx.strokeStyle = "#c9c1b0";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, 260, 96);
    ctx.strokeRect(x, y, 260, 96);
    ctx.fillStyle = "#5b6670";
    ctx.font = "15px Arial";
    ctx.fillText(row[0], x + 18, y + 28);
    ctx.fillStyle = "#17202a";
    ctx.font = "27px Arial";
    ctx.fillText(row[1], x + 18, y + 62);
    ctx.fillStyle = "#5b6670";
    ctx.font = "14px Arial";
    ctx.fillText(row[2], x + 18, y + 84);
  });

  const tableX = 92;
  const tableY = 240;
  const tableW = 900;
  const rowH = 54;
  const colW = [260, 200, 200, 180];
  const rows = [
    ["Quantity", "Analytic", "FEA", "FEA / analytic"],
    ["Total Cg to ground", formatCapacitance(analyticTotalCapPf), feaCap ? formatCapacitance(feaCap.totalPf) : "not solved", formatRatioText(feaTotalRatio)],
    ["Adjacent-bias Cpar", formatCapacitance(analyticParasiticPf), Number.isFinite(feaParasiticPf) ? formatCapacitance(feaParasiticPf) : "not available", formatRatioText(feaParasiticRatio)]
  ];
  rows.forEach((row, rowIndex) => {
    const yy = tableY + rowIndex * rowH;
    ctx.fillStyle = rowIndex === 0 ? "#e9e3d6" : (rowIndex % 2 ? "#fffdf8" : "#f5f2ea");
    ctx.fillRect(tableX, yy, tableW, rowH);
    ctx.strokeStyle = "#c9c1b0";
    ctx.strokeRect(tableX, yy, tableW, rowH);
    let xx = tableX;
    row.forEach((cell, colIndex) => {
      ctx.fillStyle = rowIndex === 0 ? "#17202a" : (colIndex === 0 ? "#5b6670" : "#17202a");
      ctx.font = rowIndex === 0 ? "16px Arial" : (colIndex === 0 ? "15px Arial" : "20px Arial");
      ctx.fillText(cell, xx + 16, yy + (rowIndex === 0 ? 33 : 34));
      if (colIndex > 0) {
        ctx.strokeStyle = "rgba(201, 193, 176, 0.8)";
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx, yy + rowH);
        ctx.stroke();
      }
      xx += colW[colIndex];
    });
  });

  drawWrappedLines(ctx, [
    "This is a capacitance sanity check, not a direct attenuation solve.",
    "FEA Ctotal comes from the existing two-terminal energy integral with all bias conductors tied together against ground.",
    Number.isFinite(feaParasiticPf)
      ? "FEA Cpar uses three local energy solves: middle only, both neighbors only, and all bias plates driven. Energy polarization cancels ground capacitance; the core remains dielectric."
      : "Run a matching FEniCSx solve to fill Cpar; the estimate is separate from the all-HV total-capacitance solve.",
    usesDirectStageCapacitance(params)
      ? "Analytic Cpar uses the entered resistor/package value plus calculated epoxy coupling; FEA remains a geometric material-model comparison."
      : usesMelfCoreModel(params)
        ? `MELF core model: eps_eff = eps_substrate/(1 - FF) = ${coreCapacitanceEpsr(params).toLocaleString(undefined, { maximumFractionDigits: 1 })}.`
        : "For non-MELF cores, the parasitic estimate uses the selected core permittivity plus epoxy around the core.",
    "The analytic epsilon A/d estimate does not include shielding by the intervening ground-plate inner edge, so it can overstate epoxy coupling when the hole radius is comparable to the bias-stage spacing.",
    "Type 61 limiting check: FEA/analytic rises from 0.42 at 2 mm radial gap to 0.94 at 50 mm, approaching the expected axial-field limit."
  ], 92, 450, 24, "#5b6670", "17px Arial", 910);
}

function loadedLadderSamples(circuit, p, fMin, fMax, steps = 150) {
  const loaded = [];
  const unloaded = [];
  const scaled = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const frequency = fMin * (fMax / fMin) ** t;
    loaded.push({
      frequency,
      attenuationDb: attenuationDbFromMagnitude(ladderTransferMagnitude(circuit, p, frequency, { includeLoad: true }))
    });
    unloaded.push({
      frequency,
      attenuationDb: attenuationDbFromMagnitude(ladderTransferMagnitude(circuit, p, frequency))
    });
    scaled.push({
      frequency,
      attenuationDb: scaledSingleStageAttenuationDb(circuit, p, frequency, true)
    });
  }
  return { loaded, unloaded, scaled };
}

function drawDbFrequencyFrame(ctx, x, y, width, height, fMin, fMax, maxDb, title) {
  const xFor = (frequency) => x + ((Math.log10(frequency) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) * width;
  const yFor = (db) => y + height - (Math.max(0, db) / maxDb) * height;
  ctx.save();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  [0, maxDb / 2, maxDb].forEach((tick) => {
    const yy = yFor(tick);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.75)";
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`${tick.toFixed(0)} dB`, x - 10, yy + 4);
    ctx.textAlign = "left";
  });

  for (let decade = Math.ceil(Math.log10(fMin)); decade <= Math.floor(Math.log10(fMax)); decade += 1) {
    const frequency = 10 ** decade;
    const xx = xFor(frequency);
    ctx.strokeStyle = "rgba(201, 193, 176, 0.55)";
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + height);
    ctx.stroke();
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText(formatFrequency(frequency), xx - 22, y + height + 22);
  }

  ctx.fillStyle = "#17202a";
  ctx.font = "19px Arial";
  ctx.fillText(title, x, y - 18);
  ctx.restore();
  return { xFor, yFor };
}

function drawLoadedLadderSlide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const circuit = circuitEstimates(params);
  const sections = activeSeriesSectionCount(circuit, params, true);
  const cableCapPf = cableCapacitancePf(params);
  const detectorCapPf = detectorCapacitancePf(params);
  const externalLoadCapPf = cableCapPf + detectorCapPf;
  const loadG = loadConductanceS(params);
  const fMin = ATTENUATION_PLOT_FMIN_HZ;
  const fMax = ATTENUATION_PLOT_FMAX_HZ;
  const samples = loadedLadderSamples(circuit, params, fMin, fMax);
  const fiftyLoaded = attenuationDbFromMagnitude(ladderTransferMagnitude(circuit, params, 50, { includeLoad: true }));
  const fiftyScaled = scaledSingleStageAttenuationDb(circuit, params, 50, true);
  const plottedValues = [
    ...samples.loaded.map((sample) => sample.attenuationDb),
    ...samples.unloaded.map((sample) => sample.attenuationDb),
    ...samples.scaled.map((sample) => sample.attenuationDb),
    fiftyLoaded,
    fiftyScaled
  ].filter((value) => Number.isFinite(value) && value >= 0);
  const maxDb = Math.max(5, Math.ceil(Math.max(...plottedValues, 1) / 10) * 10);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#17202a";
  ctx.font = "22px Arial";
  ctx.fillText("Loaded RC ladder", 88, 52);

  const plot = drawDbFrequencyFrame(ctx, 88, 104, 735, 330, fMin, fMax, maxDb, "|Vout/Vin| attenuation");
  drawLogCurve(ctx, samples.unloaded, plot.xFor, plot.yFor, "attenuationDb", "#8a5b30", { dashed: [4, 6], lineWidth: 3 });
  drawLogCurve(ctx, samples.scaled, plot.xFor, plot.yFor, "attenuationDb", "#1f6f78", { dashed: [9, 7] });
  drawLogCurve(ctx, samples.loaded, plot.xFor, plot.yFor, "attenuationDb", "#b73e3e");

  const fiftyX = plot.xFor(50);
  ctx.strokeStyle = "#557a38";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(fiftyX, 104);
  ctx.lineTo(fiftyX, 434);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#557a38";
  ctx.font = "14px Arial";
  ctx.fillText("50 Hz", fiftyX + 8, 128);

  drawSlideLegend(ctx, [
    { label: "Full ladder + load", color: "#b73e3e" },
    { label: `${sections} section${sections === 1 ? "" : "s"} x one-stage + load`, color: "#1f6f78", dashed: [9, 7] },
    { label: "Full ladder unloaded", color: "#8a5b30", dashed: [4, 6] }
  ], 850, 132, { maxWidth: 190 });

  const cardRows = [
    ["Load C", formatCapacitance(externalLoadCapPf), `${formatCapacitance(cableCapPf)} cable + ${formatCapacitance(detectorCapPf)} det.`],
    ["Load G", formatAdmittance(loadG), `Iload ${formatCurrentFromNa(params.load_current_na)}`],
    ["50 Hz", formatAttenuationDb(fiftyLoaded), `scaled ${formatAttenuationDb(fiftyScaled)}`]
  ];
  cardRows.forEach((row, index) => {
    const x = 88 + index * 315;
    const y = 482;
    ctx.fillStyle = "#f5f2ea";
    ctx.strokeStyle = "#c9c1b0";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, 280, 84);
    ctx.strokeRect(x, y, 280, 84);
    ctx.fillStyle = "#5b6670";
    ctx.font = "14px Arial";
    ctx.fillText(row[0], x + 16, y + 25);
    ctx.fillStyle = "#17202a";
    ctx.font = "24px Arial";
    ctx.fillText(row[1], x + 16, y + 55);
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText(row[2], x + 16, y + 74);
  });

  drawWrappedLines(ctx, [
    `Cable model is lumped: C = length/(Z0 vf c), using ${params.load_cable_length_m.toLocaleString(undefined, { maximumFractionDigits: 1 })} m, ${params.load_cable_impedance_ohm.toLocaleString(undefined, { maximumFractionDigits: 0 })} ohm, vf ${params.load_cable_velocity_factor.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
    "At frequencies where the cable is electrically long, replace this lumped load with a transmission-line termination."
  ], 850, 252, 21, "#5b6670", "15px Arial", 220);
}

async function requestSpiceLadderResult(key) {
  const requestId = spiceLadderRequestId + 1;
  spiceLadderRequestId = requestId;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SPICE_CONNECT_TIMEOUT_MS);
  try {
    const payload = await fetchJson(SPICE_LADDER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parameters: backendParameters(params) }),
      signal: controller.signal
    });
    if (requestId !== spiceLadderRequestId || comparableResultParameters(params) !== key) return;
    spiceLadderCache = { key, payload };
    spiceLadderPendingKey = null;
    drawSpiceLadderSlide(document.getElementById("slideSpiceLadderCanvas"));
  } catch (error) {
    if (requestId === spiceLadderRequestId) {
      spiceLadderPendingKey = null;
      spiceLadderDisabled = true;
      drawSpiceLadderSlide(document.getElementById("slideSpiceLadderCanvas"));
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

function spiceLadderResultForCurrentDesign() {
  if (spiceLadderDisabled) return null;
  const key = comparableResultParameters(params);
  if (spiceLadderCache?.key === key) return spiceLadderCache.payload;
  if (spiceLadderPendingKey !== key) {
    spiceLadderPendingKey = key;
    requestSpiceLadderResult(key);
  }
  return null;
}

function backendSpiceCurve(samples, key) {
  return (samples || [])
    .map((sample) => ({
      frequency: sample.frequencyHz,
      attenuationDb: sample[key]?.attenuationDb
    }))
    .filter((sample) => Number.isFinite(sample.frequency) && Number.isFinite(sample.attenuationDb));
}

function shortSpicePackageLabel(label) {
  const text = String(label || "").trim();
  const ngspice = text.match(/ngspice[-\s]*[0-9][^\s:]*/i);
  if (ngspice) return ngspice[0].replace(/\s+/, "-");
  return text || "internal MNA";
}

function drawSpiceLadderSlide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const payload = spiceLadderResultForCurrentDesign();

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#17202a";
  ctx.font = "22px Arial";
  ctx.fillText("SPICE-style ladder backend", 88, 52);

  if (!payload?.samples?.length) {
    ctx.fillStyle = "#5b6670";
    ctx.font = "18px Arial";
    drawWrappedLines(ctx, [
      spiceLadderDisabled
        ? "Backend SPICE-style endpoint is not available from this page load."
        : "Waiting for the Pi backend SPICE-style solve.",
      "The backend endpoint is POST /api/spice-ladder. It returns a generated netlist and an AC sweep for the ladder, transmission line, and load."
    ], 88, 118, 26, "#5b6670", "18px Arial", 880);
    return;
  }

  const tlineSamples = backendSpiceCurve(payload.samples, "fullTline");
  const lumpedSamples = backendSpiceCurve(payload.samples, "fullLumped");
  const scaledSamples = backendSpiceCurve(payload.samples, "scaledStage");
  const allValues = [...tlineSamples, ...lumpedSamples, ...scaledSamples]
    .map((sample) => sample.attenuationDb)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const fMin = Math.min(...tlineSamples.map((sample) => sample.frequency));
  const fMax = Math.max(...tlineSamples.map((sample) => sample.frequency));
  const maxDb = Math.max(5, Math.ceil(Math.max(...allValues, 1) / 10) * 10);
  const plot = drawDbFrequencyFrame(ctx, 88, 104, 735, 330, fMin, fMax, maxDb, "|Vout/Vin| attenuation");
  drawLogCurve(ctx, scaledSamples, plot.xFor, plot.yFor, "attenuationDb", "#1f6f78", { dashed: [9, 7] });
  drawLogCurve(ctx, lumpedSamples, plot.xFor, plot.yFor, "attenuationDb", "#8a5b30", { dashed: [4, 6], lineWidth: 3 });
  drawLogCurve(ctx, tlineSamples, plot.xFor, plot.yFor, "attenuationDb", "#b73e3e");

  const fiftyX = plot.xFor(50);
  if (50 >= fMin && 50 <= fMax) {
    ctx.strokeStyle = "#557a38";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(fiftyX, 104);
    ctx.lineTo(fiftyX, 434);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#557a38";
    ctx.font = "14px Arial";
    ctx.fillText("50 Hz", fiftyX + 8, 128);
  }

  drawSlideLegend(ctx, [
    { label: "Backend full ladder + T-line", color: "#b73e3e" },
    { label: "Backend full ladder + lumped C", color: "#8a5b30", dashed: [4, 6] },
    { label: "Section-count approximation", color: "#1f6f78", dashed: [9, 7] }
  ], 845, 126, { maxWidth: 190 });

  const summary50 = payload.summary?.at50Hz || {};
  const circuit = payload.circuit || {};
  const cardRows = [
    ["50 Hz T-line", formatAttenuationDb(summary50.fullTlineAttenuationDb), "backend MNA"],
    ["Cable delay", Number.isFinite(circuit.cableDelayS) ? `${(circuit.cableDelayS * 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} ns` : "--", `${formatCapacitance(circuit.cableCapPf)} lumped equiv.`],
    ["Backend", shortSpicePackageLabel(payload.spicePackage), payload.method || payload.source]
  ];
  cardRows.forEach((row, index) => {
    const x = 88 + index * 315;
    const y = 482;
    ctx.fillStyle = "#f5f2ea";
    ctx.strokeStyle = "#c9c1b0";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, 280, 84);
    ctx.strokeRect(x, y, 280, 84);
    ctx.fillStyle = "#5b6670";
    ctx.font = "14px Arial";
    ctx.fillText(row[0], x + 16, y + 25);
    ctx.fillStyle = "#17202a";
    ctx.font = "23px Arial";
    ctx.fillText(row[1], x + 16, y + 55);
    ctx.fillStyle = "#5b6670";
    ctx.font = "13px Arial";
    ctx.fillText(String(row[2] || ""), x + 16, y + 74);
  });

  drawWrappedLines(ctx, [
    "The Pi backend runs ngspice batch AC analysis when available, with an internal MNA fallback.",
    "The returned netlist uses R, C, and T-line terms so it can also be inspected or reused directly."
  ], 845, 318, 21, "#5b6670", "15px Arial", 230);
}

function slideResultParameters() {
  const p = structuredClone(params);
  p.grid_r_count = Math.min(p.grid_r_count, 58);
  p.grid_z_count = Math.min(p.grid_z_count, 86);
  p.solver_iterations = Math.min(p.solver_iterations, 240);
  p.solver_tolerance_v = Math.max(p.solver_tolerance_v, 0.08);
  return p;
}

function fieldInsetMetrics(result, x, y, width, height) {
  const bounds = result.grid.bounds;
  const zMin = bounds.zMin;
  const zMax = bounds.zMax;
  const rMax = bounds.rMax;
  return {
    sx: width / Math.max(zMax - zMin, 0.001),
    sy: height / Math.max(rMax, 0.001),
    x: (z) => x + (z - zMin) * width / Math.max(zMax - zMin, 0.001),
    y: (r) => y + height - r * height / Math.max(rMax, 0.001)
  };
}

function drawFieldMapInset(ctx, result, p, x, y, width, height) {
  const g = result.grid;
  const m = fieldInsetMetrics(result, x, y, width, height);
  const scaleMax = fieldScaleMaxForDisplay(result, p);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(x, y, width, height);
  for (let i = 1; i < g.nr - 1; i += 1) {
    const rBounds = nodeCellBounds(g.rCoords, i, 0, g.bounds.rMax);
    const r = gridR(g, i);
    const yTop = rBounds ? m.y(rBounds.hi) : m.y(r);
    const cellH = rBounds ? Math.max(1, (rBounds.hi - rBounds.lo) * m.sy + 0.5) : Math.max(1, g.dr * m.sy + 0.5);
    for (let j = 1; j < g.nz - 1; j += 1) {
      const zBounds = nodeCellBounds(g.zCoords, j, g.bounds.zMin, g.bounds.zMax);
      const z = gridZ(g, j);
      const xLeft = zBounds ? m.x(zBounds.lo) : m.x(z);
      const cellW = zBounds ? Math.max(1, (zBounds.hi - zBounds.lo) * m.sx + 0.5) : Math.max(1, g.dz * m.sx + 0.5);
      ctx.fillStyle = fieldDisplayColor(result, g, i, j, scaleMax);
      ctx.fillRect(xLeft, yTop, cellW, cellH);
    }
  }
  drawConductorFills(ctx, m, p, true);
  drawConductorOutlines(ctx, m, p);
  drawMaxFieldMarker(ctx, m, result, 10);
  ctx.restore();

  ctx.strokeStyle = "#c9c1b0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#5b6670";
  ctx.font = "14px Arial";
  ctx.fillText("z", x + width - 22, y + height - 10);
  ctx.fillText("r", x + 10, y + 18);
}

function fieldBreakdownDefinitions(p) {
  const definitions = dielectricDefinitions(p)
    .filter((definition) => Number.isFinite(definition.breakdownKvPerMm))
    .map((definition) => ({
      ...definition,
      breakdownVPerMm: definition.breakdownKvPerMm * 1000
    }));
  return definitions;
}

function fieldScaleMaxForDisplay(result, p = null) {
  const expectedGapField = p?.plate_gap_mm > 0 ? p.bias_voltage_v / p.plate_gap_mm : Number.NaN;
  const candidates = [
    result?.maxField,
    result?.rawMaxField,
    expectedGapField
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (!candidates.length) return 1;
  return Math.max(...candidates);
}

function drawFieldColorbar(ctx, x, y, width, height, maxField, options = {}) {
  const scaleMax = Number.isFinite(maxField) && maxField > 0 ? maxField : 1;
  const gradient = ctx.createLinearGradient(x, y + height, x, y);
  [0, 0.33, 0.66, 1].forEach((stop) => gradient.addColorStop(stop, fieldColor(stop * scaleMax, scaleMax)));
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#c9c1b0";
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#5b6670";
  ctx.font = "13px Arial";
  ctx.textAlign = "right";
  ctx.fillText("E", x - 8, y - 8);
  ctx.fillText("0", x - 8, y + height);
  ctx.fillText(formatFieldVPerMm(scaleMax / 2), x - 8, y + height / 2 + 4);
  ctx.fillText(formatFieldVPerMm(scaleMax), x - 8, y + 4);
  ctx.textAlign = "left";

  const breakdownDefs = options.breakdownDefinitions || [];
  for (const definition of breakdownDefs) {
    const yBreak = y + height - (definition.breakdownVPerMm / scaleMax) * height;
    if (yBreak < y - 0.5 || yBreak > y + height + 0.5) continue;
    ctx.strokeStyle = definition.key === "washer" ? "#8a6a18" : "#35736f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3, yBreak);
    ctx.lineTo(x + width + 5, yBreak);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`${definition.shortLabel || definition.label} bd`, x + width + 8, yBreak + 4);
  }
  if (options.caption) {
    ctx.fillStyle = "#5b6670";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(options.caption, x + width + 8, y + height + 16);
  }
  ctx.textAlign = "left";
}

function drawMaxFieldMarker(ctx, m, result, radius = 9) {
  if (!result.maxLocation) return;
  const px = m.x(result.maxLocation.z);
  const py = m.y(result.maxLocation.r);
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#b73e3e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function resultSolverLabel(result) {
  const effective = result.solverStatus?.effective || result.solver;
  if (effective === "fenicsx") return "Backend FEniCSx";
  if (effective === "fd") return "Backend adaptive FD";
  if (result.source === "js-local") return result.adaptive?.enabled ? "Browser JS adaptive" : "Browser JS";
  if (result.source === "js-fallback") return "Backend fallback: JS adaptive";
  if (result.source === "js-slide-screening") return "Slide preview: JS screening";
  if (String(result.source || "").startsWith("js")) return "Browser JS screening";
  if (result.source) return String(result.source);
  return "Field solve";
}

function captureResultParameters(result, p) {
  result.parameters = structuredClone(p);
  result.parameterKey = comparableResultParameters(p);
  return result;
}

function currentSolvedResultForSlides() {
  const currentKey = comparableResultParameters(params);
  if (lastResult?.parameterKey === currentKey) {
    return {
      result: lastResult,
      parameters: lastResult.parameters || params,
      mode: "last-run",
      blurb: `Displaying the last solved field result for this exact design: ${resultSolverLabel(lastResult)}.`
    };
  }
  return null;
}

function slidePreviewResult() {
  const previewParams = slideResultParameters();
  const cacheKey = comparableResultParameters(previewParams);
  let result = slideResultCache?.key === cacheKey ? slideResultCache.result : null;
  if (!result) {
    result = solveField(previewParams);
    result.source = "js-slide-screening";
    captureResultParameters(result, previewParams);
    slideResultCache = { key: cacheKey, result };
  }
  return {
    result,
    parameters: previewParams,
    mode: "preview",
    blurb: "No current solved result is available for this exact design; displaying a reduced JS screening preview for the slide."
  };
}

function drawSimulationResultsSlide(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, w, h);

  const slideResult = currentSolvedResultForSlides() || slidePreviewResult();
  const result = slideResult.result;
  const resultParams = slideResult.parameters;

  const mapX = 48;
  const mapY = 86;
  const mapW = 552;
  const mapH = 390;
  drawFieldMapInset(ctx, result, resultParams, mapX, mapY, mapW, mapH);
  const breakdownDefinitions = fieldBreakdownDefinitions(resultParams);
  drawFieldColorbar(ctx, 700, mapY + 30, 18, mapH - 60, fieldScaleMaxForDisplay(result, resultParams), {
    breakdownDefinitions,
    caption: "absolute E scale"
  });

  const panelX = 835;
  ctx.fillStyle = "#17202a";
  ctx.font = "30px Arial";
  ctx.fillText("Field Screening", panelX, 104);
  ctx.fillStyle = "#5b6670";
  ctx.font = "17px Arial";
  ctx.fillText(resultSolverLabel(result), panelX, 134);
  ctx.font = "14px Arial";
  drawWrappedLines(ctx, [slideResult.blurb], panelX, 158, 18, "#5b6670", "14px Arial", 250);

  ctx.fillStyle = "#17202a";
  ctx.font = "21px Arial";
  ctx.fillText("Supported E", panelX, 216);
  ctx.font = "32px Arial";
  ctx.fillText(formatFieldVPerMm(result.maxField), panelX, 254);
  ctx.fillStyle = "#5b6670";
  ctx.font = "16px Arial";
  ctx.fillText(`r ${result.maxLocation.r.toFixed(2)} mm, z ${result.maxLocation.z.toFixed(2)} mm`, panelX, 284);
  ctx.fillText(rawMaxFieldSummary(result), panelX, 310);
  ctx.fillText(Number.isFinite(result.iterations) ? `${result.iterations} solver sweeps/iterations` : "solver iterations unavailable", panelX, 336);
  ctx.fillText(result.adaptive?.enabled ? "refined nonuniform grid" : "solver grid from displayed result", panelX, 362);

  const margins = dielectricMarginSummaries(result, resultParams);
  const marginRows = [
    ["Washer", margins.washer],
    ["Epoxy", margins.epoxy]
  ];
  ctx.font = "20px Arial";
  ctx.fillStyle = "#17202a";
  ctx.fillText("Dielectric checks", panelX, 394);
  marginRows.forEach(([label, summary], index) => {
    const yy = 432 + index * 58;
    ctx.fillStyle = index === 0 ? "#8a6a18" : "#35736f";
    ctx.font = "18px Arial";
    ctx.fillText(label, panelX, yy);
    ctx.fillStyle = "#17202a";
    ctx.font = "16px Arial";
    ctx.fillText(`${formatFieldVPerMm(summary.maxField)} supported`, panelX + 88, yy);
    ctx.fillStyle = "#5b6670";
    ctx.font = "14px Arial";
    const marginText = Number.isFinite(summary.margin) ? `${summary.margin.toFixed(1)}× margin` : "breakdown TBD";
    drawSubscriptText(ctx, [
      { text: `${marginText}; E` },
      { text: "bd", sub: true },
      { text: ` ${formatKvPerMm(summary.breakdownKvPerMm)}` }
    ], panelX + 88, yy + 22, { color: "#5b6670", font: "14px Arial" });
  });

  drawWrappedLines(ctx, [
    slideResult.mode === "last-run"
      ? "This slide is using the field result that was actually run in the Designer tab."
      : "Preview mode uses a reduced browser solve; run a field solve to replace this with the latest result.",
    "Color scale is absolute field magnitude; breakdown markers use placeholder Ebd where available."
  ], 52, 560, 23, "#5b6670", "17px Arial");
}

function drawSlideGraphics() {
  const slideCad = document.getElementById("slideCadCanvas");
  if (!slideCad) return;
  const slideView = { ...defaultCadView, zoom: 1.16, panY: 10 };
  drawCadModel(slideCad, slideView, false);
  drawMaterialSlide(document.getElementById("slideMaterialCanvas"));
  drawSimulationResultsSlide(document.getElementById("slideResultsCanvas"));
  drawEdgeSlide(document.getElementById("slideEdgeCanvas"));
  drawDeformationSlide(document.getElementById("slideDeformationCanvas"));
  drawPackingSlide(document.getElementById("slidePackingCanvas"));
  drawRcDiagram(document.getElementById("slideRcCanvas"));
  drawFeaSanitySlide(document.getElementById("slideFeaSanityCanvas"));
  drawLoadedLadderSlide(document.getElementById("slideLoadedLadderCanvas"));
  drawSpiceLadderSlide(document.getElementById("slideSpiceLadderCanvas"));
}

function sortedUniqueCoords(values, lower, upper) {
  const clamped = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(lower, Math.min(upper, value)))
    .sort((a, b) => a - b);
  const coords = [];
  for (const value of clamped) {
    if (!coords.length || Math.abs(value - coords[coords.length - 1]) > 1e-6) {
      coords.push(value);
    }
  }
  if (coords[0] !== lower) coords.unshift(lower);
  if (coords[coords.length - 1] !== upper) coords.push(upper);
  return coords;
}

function addUniformCoords(values, lower, upper, count) {
  const n = Math.max(2, Math.floor(count));
  for (let index = 0; index < n; index += 1) {
    const t = index / (n - 1);
    values.push(lower + t * (upper - lower));
  }
}

function addLocalCoords(values, center, radius, lower, upper) {
  if (!(radius > 0)) return;
  const start = Math.max(lower, center - radius);
  const end = Math.min(upper, center + radius);
  if (end <= start) return;
  // The browser fallback is still only a screening solve, but the rounded edge
  // itself should never be represented by one or two huge cells. This injects
  // local coordinates with spacing no larger than one tenth of the physical
  // edge radius across the fillet neighborhood.
  const targetStep = radius / 10;
  const intervals = Math.max(1, Math.ceil((end - start) / targetStep));
  for (let index = 0; index <= intervals; index += 1) {
    values.push(start + (index / intervals) * (end - start));
  }
}

function addProbeCoords(values, center, radius, lower, upper) {
  if (!(radius > 0)) return;
  for (const scale of [-1, -0.35, 0, 0.35, 1]) {
    values.push(Math.max(lower, Math.min(upper, center + scale * radius)));
  }
}

function edgeRefinementCenters(p) {
  const core = p.core_od_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const groundOuter = p.ground_plate_od_mm / 2;
  const centers = [];
  for (const [kind, zc] of plateCenters(p)) {
    const radius = edgeRadiusMm(p, kind);
    if (!(radius > 0)) continue;
    const half = plateThicknessMm(p, kind) / 2;
    const radialSpan = kind === "hv" ? hvOuter - core : groundOuter - groundInner;
    const rad = Math.max(0, Math.min(radius, half, radialSpan / 2));
    if (!(rad > 0)) continue;
    const rCenter = kind === "hv" ? hvOuter - rad : groundInner + rad;
    const zOffset = half - rad;
    centers.push({ r: rCenter, z: zc - zOffset, radius: rad });
    centers.push({ r: rCenter, z: zc + zOffset, radius: rad });
  }
  return centers;
}

function dielectricProbeRefinementCenters(p) {
  const core = p.core_od_mm / 2;
  const hvOuter = p.hv_plate_od_mm / 2;
  const groundInner = p.ground_plate_inner_diameter_mm / 2;
  const groundOuter = p.ground_plate_od_mm / 2;
  const tubeInner = p.tube_id_mm / 2;
  const overlapWidth = hvOuter - groundInner;
  const centers = [];

  function offsetIntoDielectric(clearance, radius) {
    if (!(clearance > 0)) return null;
    return Math.min(clearance * 0.35, Math.max(clearance * 0.15, radius * 0.5));
  }

  function probeRadius(clearance, radius) {
    if (!(clearance > 0)) return radius;
    return Math.max(0.05, Math.min(clearance * 0.45, radius * 1.5));
  }

  for (const [kind, zc] of plateCenters(p)) {
    const radius = Math.max(edgeRadiusMm(p, kind), 0.05);
    const half = plateThicknessMm(p, kind) / 2;
    const radialSpan = kind === "hv" ? hvOuter - core : groundOuter - groundInner;
    const localRadius = Math.max(0, Math.min(radius, half, radialSpan / 2));
    if (!(localRadius > 0)) continue;
    const zOffset = half - localRadius;
    if (kind === "hv") {
      const outerLimit = p.include_ground_tube ? tubeInner : hvOuter + p.domain_margin_mm;
      const clearance = outerLimit - hvOuter;
      const offset = offsetIntoDielectric(clearance, radius);
      if (offset !== null) {
        const r = hvOuter + offset;
        const rRadius = probeRadius(clearance, radius);
        centers.push({ type: "hv_outer_epoxy_probe", r, z: zc - zOffset, rRadius, zRadius: localRadius });
        centers.push({ type: "hv_outer_epoxy_probe", r, z: zc + zOffset, rRadius, zRadius: localRadius });
      }
    } else {
      const clearance = groundInner - core;
      const offset = offsetIntoDielectric(clearance, radius);
      if (offset !== null) {
        const r = groundInner - offset;
        const rRadius = probeRadius(clearance, radius);
        centers.push({ type: "ground_inner_epoxy_probe", r, z: zc - zOffset, rRadius, zRadius: localRadius });
        centers.push({ type: "ground_inner_epoxy_probe", r, z: zc + zOffset, rRadius, zRadius: localRadius });
      }
    }
  }

  if (overlapWidth > 0) {
    const radialSamples = [
      groundInner + overlapWidth * 0.25,
      groundInner + overlapWidth * 0.5,
      groundInner + overlapWidth * 0.75
    ];
    const plates = plateCenters(p);
    for (let index = 0; index < plates.length - 1; index += 1) {
      const [leftKind, leftZ] = plates[index];
      const [rightKind, rightZ] = plates[index + 1];
      if (leftKind === rightKind) continue;
      const leftHalf = plateThicknessMm(p, leftKind) / 2;
      const rightHalf = plateThicknessMm(p, rightKind) / 2;
      const z0 = leftZ + leftHalf;
      const z1 = rightZ - rightHalf;
      const gap = z1 - z0;
      if (!(gap > 0)) continue;
      const z = 0.5 * (z0 + z1);
      const radius = Math.max(edgeRadiusMm(p, leftKind), edgeRadiusMm(p, rightKind), 0.05);
      const zRadius = Math.max(0.05, Math.min(gap * 0.5, radius * 1.5));
      const rRadius = Math.max(0.05, Math.min(overlapWidth * 0.2, radius * 1.5));
      for (const r of radialSamples) {
        centers.push({ type: "washer_gap_probe", r, z, rRadius, zRadius });
      }
    }
  }

  return centers;
}

function buildGrid(p, adaptiveCoords = null) {
  // Build a fixed-potential, locally refined, axisymmetric r-z grid. This is
  // not FEA in the usual sense: no triangular/quadrilateral mesh is generated
  // and there are no basis functions. It is closer to a finite-volume
  // relaxation stencil on a structured grid.
  //
  // Coordinates:
  //   i indexes radius r from the symmetry axis to the outer model boundary.
  //   j indexes z along the stack length, including a margin at both ends.
  //
  // Arrays:
  //   v[i][j]      node voltage in volts.
  //   fixed[i][j]  true for conductor or imposed boundary nodes.
  //   eps[i][j]    relative permittivity sampled at the node.
  //   labels[i][j] rough material/conductor label for plotting and max-E scans.
  //   materials[i][j] dielectric region key: washer or epoxy.
  const bounds = geometryBounds(p);
  const rValues = [];
  const zValues = [];
  addUniformCoords(rValues, 0, bounds.rMax, p.grid_r_count);
  addUniformCoords(zValues, bounds.zMin, bounds.zMax, p.grid_z_count);

  const edgeCenters = edgeRefinementCenters(p);
  const dielectricProbeCenters = dielectricProbeRefinementCenters(p);
  for (const center of edgeCenters) {
    addLocalCoords(rValues, center.r, center.radius, 0, bounds.rMax);
    addLocalCoords(zValues, center.z, center.radius, bounds.zMin, bounds.zMax);
  }
  for (const center of dielectricProbeCenters) {
    addProbeCoords(rValues, center.r, center.rRadius, 0, bounds.rMax);
    addProbeCoords(zValues, center.z, center.zRadius, bounds.zMin, bounds.zMax);
  }
  if (adaptiveCoords) {
    rValues.push(...(adaptiveCoords.r || []));
    zValues.push(...(adaptiveCoords.z || []));
  }

  const rCoords = sortedUniqueCoords(rValues, 0, bounds.rMax);
  const zCoords = sortedUniqueCoords(zValues, bounds.zMin, bounds.zMax);
  const nr = rCoords.length;
  const nz = zCoords.length;
  const dr = bounds.rMax / (nr - 1);
  const dz = (bounds.zMax - bounds.zMin) / (nz - 1);
  const boundarySampleMinDistance = Math.max(0.01, edgeRadiusMm(p) / 10);
  const v = Array.from({ length: nr }, () => Array(nz).fill(p.bias_voltage_v * 0.5));
  const fixed = Array.from({ length: nr }, () => Array(nz).fill(false));
  const eps = Array.from({ length: nr }, () => Array(nz).fill(1));
  const labels = Array.from({ length: nr }, () => Array(nz).fill("dielectric"));
  const materials = Array.from({ length: nr }, () => Array(nz).fill("epoxy"));

  for (let i = 0; i < nr; i += 1) {
    const r = rCoords[i];
    for (let j = 0; j < nz; j += 1) {
      const z = zCoords[j];
      const zStack = Math.min(Math.max(z, 0), stackLength(p));
      eps[i][j] = materialEpsr(p, r, zStack);
      materials[i][j] = materialRegion(p, r, zStack);
      const c = classifyPoint(p, r, z);
      labels[i][j] = c.kind;
      if (c.value !== null) {
        // Conductors are Dirichlet nodes: high-voltage core/plates are fixed
        // at bias voltage and ground plates/tube are fixed at 0 V.
        v[i][j] = c.value;
        fixed[i][j] = true;
      } else if (i === nr - 1) {
        // The far radial edge of the computational box is grounded. This is a
        // crude outer boundary that usually over-constrains the fringe field;
        // the domain margin slider controls how far away that artificial wall is.
        v[i][j] = 0;
        fixed[i][j] = true;
      }
    }
  }
  return {
    nr,
    nz,
    dr,
    dz,
    rCoords,
    zCoords,
    bounds,
    v,
    fixed,
    eps,
    labels,
    materials,
    boundarySampleMinDistance,
    mesh: {
      type: "nonuniform-structured-fd",
      baseRCount: p.grid_r_count,
      baseZCount: p.grid_z_count,
      edgeRefinementCenters: edgeCenters.length,
      dielectricProbeCenters: dielectricProbeCenters.length,
      boundarySampleMinDistance,
      adaptiveRAdded: adaptiveCoords ? (adaptiveCoords.r || []).length : 0,
      adaptiveZAdded: adaptiveCoords ? (adaptiveCoords.z || []).length : 0,
      finalRCount: nr,
      finalZCount: nz
    }
  };
}

function lowerCoordIndex(coords, value) {
  if (value <= coords[0]) return 0;
  for (let index = 0; index < coords.length - 1; index += 1) {
    if (value >= coords[index] && value <= coords[index + 1]) return index;
  }
  return coords.length - 2;
}

function interpolatedVoltage(source, r, z) {
  const i0 = lowerCoordIndex(source.rCoords, r);
  const j0 = lowerCoordIndex(source.zCoords, z);
  const i1 = Math.min(i0 + 1, source.nr - 1);
  const j1 = Math.min(j0 + 1, source.nz - 1);
  const r0 = source.rCoords[i0];
  const r1 = source.rCoords[i1];
  const z0 = source.zCoords[j0];
  const z1 = source.zCoords[j1];
  const tr = r1 > r0 ? (r - r0) / (r1 - r0) : 0;
  const tz = z1 > z0 ? (z - z0) / (z1 - z0) : 0;
  const v00 = source.v[i0][j0];
  const v10 = source.v[i1][j0];
  const v01 = source.v[i0][j1];
  const v11 = source.v[i1][j1];
  const v0 = v00 + tr * (v10 - v00);
  const v1 = v01 + tr * (v11 - v01);
  return v0 + tz * (v1 - v0);
}

function seedGridFromPrevious(target, source) {
  for (let i = 0; i < target.nr; i += 1) {
    for (let j = 0; j < target.nz; j += 1) {
      if (!target.fixed[i][j]) {
        target.v[i][j] = interpolatedVoltage(source, target.rCoords[i], target.zCoords[j]);
      }
    }
  }
}

function relaxGrid(g, p, maxSweeps) {
  let lastDelta = 0;
  let sweeps = 0;
  while (sweeps < maxSweeps) {
    let maxDelta = 0;
    for (let i = 1; i < g.nr - 1; i += 1) {
      // Avoid the coordinate singularity at r = 0 inside the update equation.
      // The actual r = 0 row is handled after each sweep by symmetry.
      const r = Math.max(g.rCoords[i], (g.rCoords[i + 1] - g.rCoords[i - 1]) * 0.25);
      const hRp = g.rCoords[i + 1] - g.rCoords[i];
      const hRm = g.rCoords[i] - g.rCoords[i - 1];
      const rFaceP = 0.5 * (g.rCoords[i] + g.rCoords[i + 1]);
      const rFaceM = 0.5 * (g.rCoords[i] + g.rCoords[i - 1]);
      const radialVolume = 0.5 * (hRp + hRm);
      for (let j = 1; j < g.nz - 1; j += 1) {
        if (g.fixed[i][j]) continue;
        const hZp = g.zCoords[j + 1] - g.zCoords[j];
        const hZm = g.zCoords[j] - g.zCoords[j - 1];
        const axialVolume = 0.5 * (hZp + hZm);

        // Face permittivities. For example erp is epsilon halfway between this
        // node and the next radial node. Averaging keeps material jumps from
        // being completely ignored by the stencil, but it is still a rough
        // treatment of dielectric interfaces.
        const erp = 0.5 * (g.eps[i][j] + g.eps[i + 1][j]);
        const erm = 0.5 * (g.eps[i][j] + g.eps[i - 1][j]);
        const ezp = 0.5 * (g.eps[i][j] + g.eps[i][j + 1]);
        const ezm = 0.5 * (g.eps[i][j] + g.eps[i][j - 1]);

        // Discrete axisymmetric operator on a nonuniform structured grid. These
        // coefficients are face flux conductances divided by the local control
        // volume dimensions. With uniform spacing they reduce to the previous
        // fixed-dr/fixed-dz stencil.
        const arP = erp * rFaceP / (r * radialVolume * hRp);
        const arM = erm * rFaceM / (r * radialVolume * hRm);
        const azP = ezp / (axialVolume * hZp);
        const azM = ezm / (axialVolume * hZm);

        // Gauss-Seidel update: write the new voltage immediately, so later
        // nodes in this same sweep see the newest available neighbor values.
        const next = (arP * g.v[i + 1][j] + arM * g.v[i - 1][j] + azP * g.v[i][j + 1] + azM * g.v[i][j - 1]) / (arP + arM + azP + azM);
        const delta = Math.abs(next - g.v[i][j]);
        if (delta > maxDelta) maxDelta = delta;
        g.v[i][j] = next;
      }
    }

    // Boundary cleanup after each sweep:
    //   r = 0 is an axis of symmetry, so dV/dr = 0 and the first row copies the
    //   next radial row.
    //   z-min and z-max are open-ish ends, approximated by dV/dz = 0 unless a
    //   conductor already fixed that node.
    g.v[0] = [...g.v[1]];
    for (let i = 0; i < g.nr; i += 1) {
      if (!g.fixed[i][0]) g.v[i][0] = g.v[i][1];
      if (!g.fixed[i][g.nz - 1]) g.v[i][g.nz - 1] = g.v[i][g.nz - 2];
    }
    lastDelta = maxDelta;
    sweeps += 1;
    if (maxDelta < p.solver_tolerance_v) break;
  }
  return { sweeps, lastDelta };
}

function fieldFromGrid(g) {
  // Convert the solved potential into field magnitude using dielectric-side
  // face gradients. Central differences are tempting, but at fixed conductor
  // boundaries they span through the metal and can draw false high-field
  // stripes hugging a plate. Here each dielectric node only uses one-cell face
  // gradients to its immediate neighbors, so a conductor contributes as a
  // boundary value instead of as a sampled region to differentiate through.
  const field = Array.from({ length: g.nr }, () => Array(g.nz).fill(0));
  const dielectricPeaks = {
    washer: emptyDielectricPeak("washer"),
    epoxy: emptyDielectricPeak("epoxy")
  };
  let rawMaxField = 0;
  let rawMaxLocation = { r: 0, z: 0 };
  const boundarySampleMinDistance = g.boundarySampleMinDistance ?? 0;
  function gradientOption(ni, nj, distance, value) {
    if (!Number.isFinite(value) || !(distance > 0)) return null;
    const neighborLabel = g.labels?.[ni]?.[nj] || "dielectric";
    if (neighborLabel !== "dielectric" && distance < boundarySampleMinDistance) return null;
    return value;
  }
  for (let i = 1; i < g.nr - 1; i += 1) {
    for (let j = 1; j < g.nz - 1; j += 1) {
      if (g.labels[i][j] !== "dielectric") continue;
      const erOptions = [
        gradientOption(i + 1, j, g.rCoords[i + 1] - g.rCoords[i], -(g.v[i + 1][j] - g.v[i][j]) / (g.rCoords[i + 1] - g.rCoords[i])),
        gradientOption(i - 1, j, g.rCoords[i] - g.rCoords[i - 1], -(g.v[i][j] - g.v[i - 1][j]) / (g.rCoords[i] - g.rCoords[i - 1]))
      ].filter((value) => value !== null);
      const ezOptions = [
        gradientOption(i, j + 1, g.zCoords[j + 1] - g.zCoords[j], -(g.v[i][j + 1] - g.v[i][j]) / (g.zCoords[j + 1] - g.zCoords[j])),
        gradientOption(i, j - 1, g.zCoords[j] - g.zCoords[j - 1], -(g.v[i][j] - g.v[i][j - 1]) / (g.zCoords[j] - g.zCoords[j - 1]))
      ].filter((value) => value !== null);
      if (!erOptions.length) erOptions.push(0);
      if (!ezOptions.length) ezOptions.push(0);
      let e = 0;
      for (const er of erOptions) {
        for (const ez of ezOptions) {
          e = Math.max(e, Math.hypot(er, ez));
        }
      }
      field[i][j] = e;
      if (e > rawMaxField) {
        rawMaxField = e;
        rawMaxLocation = { r: g.rCoords[i], z: g.zCoords[j] };
      }
      const material = g.materials?.[i]?.[j] || "epoxy";
      const peak = dielectricPeaks[material];
      if (peak && e > peak.maxField) {
        peak.maxField = e;
        peak.maxLocation = { r: g.rCoords[i], z: g.zCoords[j] };
      }
    }
  }
  const supported = supportedFieldMetrics(g, field, rawMaxField, rawMaxLocation, dielectricPeaks);
  return {
    grid: g,
    field,
    maxField: supported.maxField,
    maxLocation: supported.maxLocation,
    rawMaxField,
    rawMaxLocation,
    dielectricPeaks: supported.dielectricPeaks,
    rawDielectricPeaks: dielectricPeaks,
    peakQuality: supported.peakQuality
  };
}

function addIntervalMidpoints(coords, values, index) {
  if (index > 0) values.push(0.5 * (coords[index - 1] + coords[index]));
  if (index < coords.length - 1) values.push(0.5 * (coords[index] + coords[index + 1]));
}

function adaptiveCoordsFromField(result, p) {
  if (!(result.maxField > 0)) return null;
  const g = result.grid;
  const threshold = result.maxField * FIELD_ADAPTIVE_THRESHOLD_FRACTION;
  const candidates = [];
  for (let i = 1; i < g.nr - 1; i += 1) {
    for (let j = 1; j < g.nz - 1; j += 1) {
      const e = result.field[i][j];
      if (g.labels[i][j] === "dielectric" && e >= threshold) {
        candidates.push({ i, j, e });
      }
    }
  }
  candidates.sort((a, b) => b.e - a.e);
  const r = [];
  const z = [];
  const accepted = [];
  const minimumSeparation = Math.max(edgeRadiusMm(p) * 0.5, 1e-6);
  for (const candidate of candidates) {
    if (accepted.length >= FIELD_ADAPTIVE_MAX_POINTS) break;
    const tooClose = accepted.some((prior) =>
      Math.abs(g.rCoords[prior.i] - g.rCoords[candidate.i]) < minimumSeparation
      && Math.abs(g.zCoords[prior.j] - g.zCoords[candidate.j]) < minimumSeparation
    );
    if (tooClose) continue;
    accepted.push(candidate);
    for (let di = -1; di <= 1; di += 1) {
      const ii = candidate.i + di;
      if (ii > 0 && ii < g.nr - 1) addIntervalMidpoints(g.rCoords, r, ii);
    }
    for (let dj = -1; dj <= 1; dj += 1) {
      const jj = candidate.j + dj;
      if (jj > 0 && jj < g.nz - 1) addIntervalMidpoints(g.zCoords, z, jj);
    }
  }
  return r.length || z.length ? { r, z, acceptedCount: accepted.length } : null;
}

function solveField(p) {
  // Browser-side fallback field solver.
  //
  // What it solves:
  //   Axisymmetric electrostatics with no theta dependence:
  //     div(epsilon * grad(V)) = 0
  //
  // How it solves:
  //   Repeated Gauss-Seidel-style relaxation sweeps over a structured r-z grid.
  //   The grid starts with base coordinates plus deterministic refinement near
  //   rounded conductor edges, dielectric-side edge probes, and washer gap
  //   probes between adjacent plates. A short probe solve then identifies
  //   high-field dielectric nodes, inserts midpoint coordinates around them,
  //   and runs the final relaxation on that refined grid.
  //
  // What the UI calls "Solver sweeps":
  //   One sweep means one full pass over all free grid nodes. It is not an FEA
  //   mesh count, and it is not a guarantee of convergence. The displayed count
  //   includes the probe sweeps plus the final refined solve sweeps.
  //
  // What this is good for:
  //   Fast qualitative field pictures and rough peak-field screening when the
  //   future backend is unavailable.
  //
  // What this is not good for:
  //   Qualification numbers near breakdown, accurate edge singularity/rounding
  //   behavior, extracted capacitance, tiny glue-line defects, or final design
  //   acceptance. Those need the planned axisymmetric FEA/backend workflow.
  const probeGrid = buildGrid(p);
  const probeLimit = Math.min(p.solver_iterations, FIELD_ADAPTIVE_PROBE_SWEEPS);
  const probeStats = relaxGrid(probeGrid, p, probeLimit);
  const adaptiveCoords = adaptiveCoordsFromField(fieldFromGrid(probeGrid), p);

  const remainingSweeps = Math.max(0, p.solver_iterations - probeStats.sweeps);
  const useAdaptiveGrid = Boolean(adaptiveCoords && remainingSweeps > 0);
  const g = useAdaptiveGrid ? buildGrid(p, adaptiveCoords) : probeGrid;
  if (useAdaptiveGrid) seedGridFromPrevious(g, probeGrid);
  const finalStats = useAdaptiveGrid
    ? relaxGrid(g, p, remainingSweeps)
    : { sweeps: 0, lastDelta: probeStats.lastDelta };
  return {
    ...fieldFromGrid(g),
    iterations: probeStats.sweeps + finalStats.sweeps,
    lastDelta: finalStats.lastDelta,
    adaptive: {
      enabled: useAdaptiveGrid,
      probeSweeps: probeStats.sweeps,
      addedR: useAdaptiveGrid ? adaptiveCoords.r.length : 0,
      addedZ: useAdaptiveGrid ? adaptiveCoords.z.length : 0,
      highFieldPoints: useAdaptiveGrid ? adaptiveCoords.acceptedCount : 0
    }
  };
}

function fieldColor(value, max) {
  const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stops = [
    [22, 32, 42],
    [31, 111, 120],
    [214, 183, 93],
    [183, 62, 62]
  ];
  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const u = scaled - idx;
  const rgb = stops[idx].map((v, n) => Math.round(v + (stops[idx + 1][n] - v) * u));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function percentileSorted(values, fraction) {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const x = Math.max(0, Math.min(1, fraction)) * (values.length - 1);
  const lower = Math.floor(x);
  const upper = Math.ceil(x);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (x - lower);
}

function supportedFieldMetrics(g, field, rawMaxField, rawMaxLocation, rawDielectricPeaks = null) {
  const dielectricPeaks = {
    washer: emptyDielectricPeak("washer"),
    epoxy: emptyDielectricPeak("epoxy")
  };
  let supportedMaxField = 0;
  let supportedMaxLocation = rawMaxLocation;
  for (let i = 1; i < g.nr - 1; i += 1) {
    for (let j = 1; j < g.nz - 1; j += 1) {
      if (g.labels?.[i]?.[j] !== "dielectric") continue;
      const value = field[i][j];
      if (!Number.isFinite(value) || !(value > 0)) continue;
      const material = g.materials?.[i]?.[j] || "epoxy";
      let neighbors = [];
      for (let di = -1; di <= 1; di += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
          const ni = i + di;
          const nj = j + dj;
          if (g.labels?.[ni]?.[nj] !== "dielectric") continue;
          if ((g.materials?.[ni]?.[nj] || "epoxy") !== material) continue;
          const neighborValue = field[ni][nj];
          if (Number.isFinite(neighborValue) && neighborValue > 0) neighbors.push(neighborValue);
        }
      }
      if (neighbors.length < 4) {
        neighbors = [];
        for (let ni = Math.max(1, i - 1); ni <= Math.min(g.nr - 2, i + 1); ni += 1) {
          for (let nj = Math.max(1, j - 1); nj <= Math.min(g.nz - 2, j + 1); nj += 1) {
            if (g.labels?.[ni]?.[nj] !== "dielectric") continue;
            const neighborValue = field[ni][nj];
            if (Number.isFinite(neighborValue) && neighborValue > 0) neighbors.push(neighborValue);
          }
        }
      }
      if (!neighbors.length) continue;
      neighbors.sort((a, b) => a - b);
      const supportedValue = Math.min(value, percentileSorted(neighbors, SUPPORTED_PEAK_PERCENTILE));
      if (supportedValue > supportedMaxField) {
        supportedMaxField = supportedValue;
        supportedMaxLocation = { r: gridR(g, i), z: gridZ(g, j) };
      }
      const peak = dielectricPeaks[material];
      if (peak && supportedValue > peak.maxField) {
        peak.maxField = supportedValue;
        peak.maxLocation = { r: gridR(g, i), z: gridZ(g, j) };
      }
    }
  }
  if (!(supportedMaxField > 0)) {
    supportedMaxField = rawMaxField;
    supportedMaxLocation = rawMaxLocation;
    if (rawDielectricPeaks) {
      for (const key of Object.keys(dielectricPeaks)) {
        dielectricPeaks[key] = rawDielectricPeaks[key] || dielectricPeaks[key];
      }
    }
  }
  const rawToSupportedRatio = supportedMaxField > 0 ? rawMaxField / supportedMaxField : 1;
  return {
    maxField: supportedMaxField,
    maxLocation: supportedMaxLocation,
    dielectricPeaks,
    peakQuality: {
      method: "same-material 3x3 neighborhood p75",
      percentile: SUPPORTED_PEAK_PERCENTILE,
      rawMaxField,
      rawMaxLocation,
      supportedMaxField,
      supportedMaxLocation,
      rawToSupportedRatio,
      outlierSuspected: rawToSupportedRatio > SUPPORTED_PEAK_OUTLIER_RATIO
    }
  };
}

function fieldDisplayColor(result, g, i, j, scaleMax = null) {
  const label = g.labels?.[i]?.[j] || "dielectric";
  if (label === "hv") return "#b73e3e";
  if (label === "ground") return "#557a38";
  return fieldColor(result.field[i][j], Number.isFinite(scaleMax) && scaleMax > 0 ? scaleMax : result.maxField);
}

function gridR(g, i) {
  return g.rCoords ? g.rCoords[i] : i * g.dr;
}

function gridZ(g, j) {
  return g.zCoords ? g.zCoords[j] : g.bounds.zMin + j * g.dz;
}

function nodeCellBounds(coords, index, lower, upper) {
  if (!coords) return null;
  const lo = index === 0 ? lower : 0.5 * (coords[index - 1] + coords[index]);
  const hi = index === coords.length - 1 ? upper : 0.5 * (coords[index] + coords[index + 1]);
  return { lo, hi };
}

function zoomCanvasMetrics(bounds, x, y, width, height) {
  const zSpan = Math.max(bounds.zMax - bounds.zMin, 0.001);
  const rSpan = Math.max(bounds.rMax - bounds.rMin, 0.001);
  return {
    bounds,
    sx: width / zSpan,
    sy: height / rSpan,
    x: (z) => x + (z - bounds.zMin) * width / zSpan,
    y: (r) => y + height - (r - bounds.rMin) * height / rSpan
  };
}

function clampedWindow(center, span, min, max) {
  const fullSpan = Math.max(max - min, 0.001);
  const windowSpan = Math.min(Math.max(span, 0.001), fullSpan);
  let lo = center - windowSpan / 2;
  let hi = center + windowSpan / 2;
  if (lo < min) {
    hi += min - lo;
    lo = min;
  }
  if (hi > max) {
    lo -= hi - max;
    hi = max;
  }
  return { min: Math.max(min, lo), max: Math.min(max, hi) };
}

function maxFieldZoomBounds(result, p) {
  if (!result.maxLocation) return null;
  const g = result.grid;
  const bounds = g.bounds;
  const edgeRadius = Math.max(edgeRadiusMm(p), 0.05);
  const localSpan = Math.max(1.2, p.plate_gap_mm * 2.6, edgeRadius * 5.0);
  const zWindow = clampedWindow(result.maxLocation.z, localSpan, bounds.zMin, bounds.zMax);
  const rWindow = clampedWindow(result.maxLocation.r, localSpan, 0, bounds.rMax);
  return {
    zMin: zWindow.min,
    zMax: zWindow.max,
    rMin: rWindow.min,
    rMax: rWindow.max
  };
}

function drawFieldZoomInset(ctx, result, p, x, y, width, height) {
  const zoomBounds = maxFieldZoomBounds(result, p);
  if (!zoomBounds) return;
  const g = result.grid;
  const m = zoomCanvasMetrics(zoomBounds, x, y, width, height);
  const scaleMax = fieldScaleMaxForDisplay(result, p);

  ctx.save();
  ctx.fillStyle = "rgba(255, 253, 248, 0.96)";
  ctx.fillRect(x - 8, y - 24, width + 16, height + 36);
  ctx.strokeStyle = "rgba(23, 32, 42, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 8, y - 24, width + 16, height + 36);
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(x, y, width, height);

  for (let i = 1; i < g.nr - 1; i += 1) {
    const rBounds = nodeCellBounds(g.rCoords, i, 0, g.bounds.rMax);
    const r = gridR(g, i);
    const rLo = rBounds ? rBounds.lo : r - g.dr / 2;
    const rHi = rBounds ? rBounds.hi : r + g.dr / 2;
    if (rHi < zoomBounds.rMin || rLo > zoomBounds.rMax) continue;
    const yTop = m.y(rHi);
    const cellH = Math.max(1, (rHi - rLo) * m.sy + 0.5);
    for (let j = 1; j < g.nz - 1; j += 1) {
      const zBounds = nodeCellBounds(g.zCoords, j, g.bounds.zMin, g.bounds.zMax);
      const z = gridZ(g, j);
      const zLo = zBounds ? zBounds.lo : z - g.dz / 2;
      const zHi = zBounds ? zBounds.hi : z + g.dz / 2;
      if (zHi < zoomBounds.zMin || zLo > zoomBounds.zMax) continue;
      ctx.fillStyle = fieldDisplayColor(result, g, i, j, scaleMax);
      ctx.fillRect(m.x(zLo), yTop, Math.max(1, (zHi - zLo) * m.sx + 0.5), cellH);
    }
  }
  drawConductorFills(ctx, m, p, true);
  drawMaxFieldMarker(ctx, m, result, 7);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#17202a";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#17202a";
  ctx.font = "13px Arial";
  ctx.fillText("Max-E zoom", x, y - 8);
  ctx.fillStyle = "#5b6670";
  ctx.font = "11px Arial";
  ctx.fillText(`${(zoomBounds.zMax - zoomBounds.zMin).toFixed(2)} mm window`, x + width - 96, y - 8);
  ctx.restore();
}

function fieldZoomInsetPlacement(canvas) {
  const reservedLeftPx = Math.min(270, Math.max(225, canvas.width * 0.29));
  const width = Math.max(174, reservedLeftPx - 42);
  const height = Math.min(150, Math.max(124, canvas.height * 0.32));
  const legendHeight = Math.min(104, Math.max(86, canvas.height * 0.23));
  const legendY = Math.min(canvas.height - legendHeight - 38, 58 + height + 58);
  return {
    reservedLeftPx,
    x: 18,
    y: 58,
    width,
    height,
    legendX: 104,
    legendY,
    legendWidth: 14,
    legendHeight
  };
}

function dielectricPeaksFromResult(result, p) {
  if (result.dielectricPeaks) return normalizedDielectricPeaks(result.dielectricPeaks);
  const g = result.grid;
  const peaks = {
    washer: emptyDielectricPeak("washer"),
    epoxy: emptyDielectricPeak("epoxy")
  };
  for (let i = 1; i < g.nr - 1; i += 1) {
    const r = gridR(g, i);
    for (let j = 1; j < g.nz - 1; j += 1) {
      const z = gridZ(g, j);
      const label = g.labels?.[i]?.[j] || classifyPoint(p, r, z).kind;
      if (label !== "dielectric") continue;
      const material = g.materials?.[i]?.[j] || materialRegion(p, r, z);
      const peak = peaks[material];
      const e = result.field?.[i]?.[j] ?? 0;
      if (peak && e > peak.maxField) {
        peak.maxField = e;
        peak.maxLocation = { r, z };
      }
    }
  }
  const supported = supportedFieldMetrics(
    g,
    result.field,
    result.rawMaxField ?? result.maxField ?? 0,
    result.rawMaxLocation ?? result.maxLocation ?? { r: 0, z: 0 },
    peaks
  );
  return normalizedDielectricPeaks(supported.dielectricPeaks);
}

function dielectricMarginSummaries(result, p) {
  const peaks = dielectricPeaksFromResult(result, p);
  return Object.fromEntries(dielectricDefinitions(p).map((definition) => {
    const peak = peaks[definition.key] || emptyDielectricPeak(definition.key);
    const breakdownVPerMm = Number.isFinite(definition.breakdownKvPerMm)
      ? definition.breakdownKvPerMm * 1000
      : Number.NaN;
    return [definition.key, {
      ...definition,
      maxField: peak.maxField,
      maxLocation: peak.maxLocation,
      margin: peak.maxField > 0 && Number.isFinite(breakdownVPerMm)
        ? breakdownVPerMm / peak.maxField
        : Number.NaN
    }];
  }));
}

function drawField(result, canvas = document.getElementById("fieldCanvas"), p = params) {
  const ctx = canvas.getContext("2d");
  const g = result.grid;
  const zoomInset = fieldZoomInsetPlacement(canvas);
  const m = canvasMetrics(canvas, p, { reservedLeftPx: zoomInset.reservedLeftPx });
  const scaleMax = fieldScaleMaxForDisplay(result, p);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 1; i < g.nr - 1; i += 1) {
    const rBounds = nodeCellBounds(g.rCoords, i, 0, g.bounds.rMax);
    const r = gridR(g, i);
    const yTop = rBounds ? m.y(rBounds.hi) : m.y(r);
    const cellH = rBounds ? Math.max(1, (rBounds.hi - rBounds.lo) * m.sy + 0.5) : Math.max(1, g.dr * m.sy + 0.5);
    for (let j = 1; j < g.nz - 1; j += 1) {
      const zBounds = nodeCellBounds(g.zCoords, j, g.bounds.zMin, g.bounds.zMax);
      const z = gridZ(g, j);
      const xLeft = zBounds ? m.x(zBounds.lo) : m.x(z);
      const cellW = zBounds ? Math.max(1, (zBounds.hi - zBounds.lo) * m.sx + 0.5) : Math.max(1, g.dz * m.sx + 0.5);
      ctx.fillStyle = fieldDisplayColor(result, g, i, j, scaleMax);
      ctx.fillRect(xLeft, yTop, cellW, cellH);
    }
  }
  drawConductorFills(ctx, m, p, true);
  drawConductorOutlines(ctx, m, p);
  drawMaxFieldMarker(ctx, m, result, 9);
  drawAxes(ctx, canvas, m);
  drawFieldZoomInset(ctx, result, p, zoomInset.x, zoomInset.y, zoomInset.width, zoomInset.height);
  drawFieldColorbar(ctx, zoomInset.legendX, zoomInset.legendY, zoomInset.legendWidth, zoomInset.legendHeight, scaleMax, {
    breakdownDefinitions: fieldBreakdownDefinitions(p),
    caption: "absolute E scale"
  });
}

function drawConductorOutlines(ctx, m, p = params) {
  const length = stackLength(p);
  const core = p.core_od_mm / 2;
  const tubeInner = p.tube_id_mm / 2;
  const tubeOuter = tubeInner + p.tube_wall_thickness_mm;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = 2;

  ctx.strokeRect(m.x(0), m.y(core), length * m.sx, core * m.sy);

  for (const [kind, zc] of plateCenters(p)) {
    const r0 = kind === "hv" ? p.core_od_mm / 2 : p.ground_plate_inner_diameter_mm / 2;
    const r1 = kind === "hv" ? p.hv_plate_od_mm / 2 : p.ground_plate_od_mm / 2;
    const thickness = plateThicknessMm(p, kind);
    ctx.strokeRect(m.x(zc - thickness / 2), m.y(r1), thickness * m.sx, (r1 - r0) * m.sy);
  }

  if (p.include_ground_tube) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(m.x(0), m.y(tubeOuter), length * m.sx, (tubeOuter - tubeInner) * m.sy);
    ctx.strokeStyle = "rgba(23, 32, 42, 0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(m.x(0), m.y(tubeOuter), length * m.sx, (tubeOuter - tubeInner) * m.sy);
  }
  ctx.restore();
}

function clearField() {
  const canvas = document.getElementById("fieldCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#5b6670";
  ctx.font = "16px Arial";
  ctx.fillText("Solve field to update this view", 32, 42);
  document.getElementById("maxField").textContent = "Not solved";
  document.getElementById("rawMaxField").textContent = "raw point not solved";
  document.getElementById("maxLocation").textContent = "--";
  document.getElementById("iterations").textContent = "--";
  setModelStatus("JS screening");
  updateEdgeEstimate();
  updateCircuitEstimates();
  updateDielectricMarginReadouts();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Field backend returned HTTP ${response.status}`);
  }
  return response.json();
}

function backendResultFromPayload(payload) {
  // The future backend can be a real FEA or otherwise stronger solver, but the
  // browser wants the same result shape either way so the field canvas and
  // metric strip do not care where the solve came from.
  const raw = payload.result || payload;
  if (!raw?.grid || !raw?.field) {
    throw new Error("Field backend response did not include a grid and field.");
  }

  const sourceGrid = raw.grid;
  const bounds = sourceGrid.bounds || {
    zMin: sourceGrid.z_min,
    zMax: sourceGrid.z_max,
    rMax: sourceGrid.r_max
  };
  const result = {
    grid: { ...sourceGrid, bounds },
    field: raw.field,
    maxField: raw.maxField ?? raw.max_field_v_per_mm,
    maxLocation: raw.maxLocation ?? raw.max_location_mm,
    rawMaxField: raw.rawMaxField ?? raw.raw_max_field_v_per_mm ?? raw.maxField ?? raw.max_field_v_per_mm,
    rawMaxLocation: raw.rawMaxLocation ?? raw.raw_max_location_mm ?? raw.maxLocation ?? raw.max_location_mm,
    dielectricPeaks: raw.dielectricPeaks ?? raw.dielectric_peaks,
    rawDielectricPeaks: raw.rawDielectricPeaks ?? raw.raw_dielectric_peaks,
    peakQuality: raw.peakQuality ?? raw.peak_quality,
    iterations: raw.iterations ?? raw.iterations_run,
    lastDelta: raw.lastDelta ?? raw.last_delta_v,
    adaptive: raw.adaptive,
    capacitance: raw.capacitance,
    admittance: raw.admittance,
    solver: raw.solver,
    solverStatus: raw.solverStatus,
    source: payload.source || raw.source || "fea-backend"
  };

  if (!Number.isFinite(result.maxField) || !result.maxLocation) {
    throw new Error("Field backend response was missing peak-field metrics.");
  }
  return result;
}

async function pollBackendJob(jobId, startTimeMs) {
  const encodedJob = encodeURIComponent(jobId);
  while (Date.now() - startTimeMs < FIELD_SOLVER_JOB_TIMEOUT_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, FIELD_SOLVER_POLL_MS));
    const payload = await fetchJson(`${FIELD_SOLVER_ENDPOINT}/${encodedJob}`);
    if (payload.status === "failed" || payload.error) {
      throw new Error(payload.error || "Field backend job failed.");
    }
    if (payload.status === "complete" || payload.result || payload.field) {
      return backendResultFromPayload(payload);
    }
  }
  throw new Error("Field backend job timed out.");
}

async function solveFieldWithBackend(p) {
  const backendSolver = backendSolverForRequest();
  if (!backendSolver) {
    throw new Error("Backend solver was not selected.");
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FIELD_SOLVER_CONNECT_TIMEOUT_MS);
  try {
    const payload = await fetchJson(FIELD_SOLVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId(),
        solver: backendSolver,
        parameters: backendParameters(p)
      }),
      signal: controller.signal
    });
    if (payload.job_id && payload.status !== "complete" && !payload.result) {
      return pollBackendJob(payload.job_id, Date.now());
    }
    return backendResultFromPayload(payload);
  } finally {
    window.clearTimeout(timeout);
  }
}

function rawMaxFieldSummary(result) {
  if (!Number.isFinite(result.rawMaxField)) return "raw point unavailable";
  const rawText = `raw point ${formatFieldVPerMm(result.rawMaxField)}`;
  const ratio = result.peakQuality?.rawToSupportedRatio;
  if (Number.isFinite(ratio) && ratio > SUPPORTED_PEAK_OUTLIER_RATIO) {
    return `${rawText}; outlier-suspect ${ratio.toFixed(2)}x`;
  }
  return rawText;
}

function drawSolvedResult(result) {
  drawField(result);
  const dielectricMargins = dielectricMarginSummaries(result, params);
  document.getElementById("maxField").textContent = `${(result.maxField / 1000).toFixed(3)} kV/mm`;
  document.getElementById("rawMaxField").textContent = rawMaxFieldSummary(result);
  document.getElementById("maxLocation").textContent = `r ${result.maxLocation.r.toFixed(2)} mm, z ${result.maxLocation.z.toFixed(2)} mm`;
  document.getElementById("iterations").textContent = Number.isFinite(result.iterations) ? `${result.iterations}` : "--";
  updateDielectricMarginReadouts(dielectricMargins);
  updateCircuitEstimates();
  const jsModelLabel = result.adaptive?.enabled ? "JS adaptive" : "JS fallback";
  const solverEffective = result.solverStatus?.effective;
  const backendModelLabel = solverEffective === "fenicsx"
    ? "Backend FEniCSx"
    : result.adaptive?.enabled
      ? "Backend adaptive FD"
      : "Backend solver";
  setModelStatus(result.source?.startsWith("js") ? jsModelLabel : backendModelLabel);
  drawSlideGraphics();
}

function reportSolveFailure(error) {
  clearField();
  document.getElementById("maxField").textContent = "Solve failed";
  document.getElementById("maxLocation").textContent = error.message.slice(0, 96);
}

function solveAndDraw() {
  const solveButton = document.getElementById("solve");
  solveButton.disabled = true;
  solveButton.textContent = "Solving...";
  const solver = selectedFieldSolver();
  setModelStatus(solver.modelLabel);
  window.setTimeout(async () => {
    try {
      if (!solver.backendSolver) {
        lastResult = solveField(params);
        lastResult.source = "js-local";
      } else {
        lastResult = await solveFieldWithBackend(params);
      }
      captureResultParameters(lastResult, params);
      drawSolvedResult(lastResult);
    } catch (error) {
      if (params.field_solver === "backend_fenicsx") {
        lastResult = null;
        reportSolveFailure(error);
        setModelStatus("FEniCSx unavailable");
      } else {
        lastResult = solveField(params);
        setModelStatus("Backend unavailable; JS fallback");
        lastResult.source = "js-fallback";
        captureResultParameters(lastResult, params);
        drawSolvedResult(lastResult);
      }
    } finally {
      solveButton.disabled = false;
      solveButton.textContent = "Solve field";
    }
  }, 20);
}

function redrawActiveViewerPanel(panelId) {
  if (panelId === "cadPanel") {
    drawCadModel();
  } else if (panelId === "geometryPanel") {
    drawGeometry();
  } else if (panelId === "fieldPanel") {
    if (lastResult) drawField(lastResult);
    else clearField();
  }
}

function setupViewerTabs() {
  document.querySelectorAll(".viewer-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const panelId = button.dataset.viewerPanel;
      document.querySelectorAll(".viewer-tab").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
        tab.setAttribute("aria-selected", tab === button ? "true" : "false");
      });
      document.querySelectorAll(".viewer-panel").forEach((panel) => {
        const active = panel.id === panelId;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
      redrawActiveViewerPanel(panelId);
    });
  });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.view).classList.add("active");
      const activeViewer = document.querySelector(".viewer-panel.active");
      if (activeViewer) redrawActiveViewerPanel(activeViewer.id);
      drawSlideGraphics();
    });
  });
}

setupTabs();
normalizeParams();
setupControls();
setupCadViewer();
setupViewerTabs();
syncControls();
drawCadModel();
drawGeometry();
drawSlideGraphics();
clearField();
