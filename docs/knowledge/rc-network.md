# RC Network Estimate

## Purpose

The plate stack is an RC ladder. Each bias plate node sees capacitance to ground through the high-permittivity washer overlap, resistance to neighboring bias plates through the central resistive element, and unwanted parasitic capacitance to neighboring bias plates through the core material plus epoxy around the core.

The input and inter-stage bias resistances are high-value controls expressed in Mohm. The output series resistance is a separate ohm-valued control because the normal readout-side value is 50 ohms; the web app defaults it to 50 ohms and passes that value to both the browser and backend SPICE models without a megaohm conversion.

Manual numeric entries accept case-sensitive engineering prefixes with or without a space or trailing unit text: `T`, `G`, `M`, `k`, `m`, `u`/`µ`, `n`, `p`, and `f`. Thus `100M`, `100 M`, and `100 MOhm` all enter 100 Mohm in a resistance control, while `100f` enters 100 fF in a capacitance control. A value without a prefix remains in the control's displayed unit.

At high frequency, the resistor no longer sets the divider by itself. The ratio of bias-to-bias parasitic capacitance to bias-to-ground capacitance becomes an important feedthrough estimate.

## Web Estimates

The web interface uses simple parallel-plate formulas. These are first-pass circuit estimates, not field-extracted capacitances.

Single adjacent HV-ground gap capacitance:

```text
r_overlap_inner = max(washer_id, ground_plate_id) / 2
r_overlap_outer = min(washer_od, bias_plate_od) / 2
C_gap ~= epsilon0 epsr_washer pi (r_overlap_outer^2 - r_overlap_inner^2) / plate_gap
```

The washer is treated as a flat annular slab in the axial gaps between plate
faces. By default the washer ID follows the ground plate ID and the washer OD
follows the bias plate OD. If a smaller custom washer is selected, the newly
exposed radial pockets are potting epoxy instead of washer dielectric. If a
larger custom washer is selected, only the portion overlapping both electrodes
contributes to the rough bias-to-ground capacitance estimate.

Single-stage bias-node capacitance to ground:

```text
C_g_stage ~= 2 C_gap
```

This is the capacitance from one bias plate to its two adjacent ground plates. It assumes the bias plate is between two ground plates, which is true for the interior bias nodes in the current stack.

Total two-terminal capacitance estimate:

```text
C_g_total ~= 2 N_pairs C_gap
```

This is the browser estimate for the capacitance from all HV plates/core to the grounded plates/tube when the whole HV conductor set is treated as one terminal. After a FEniCSx solve, the designer readout prefers the energy-extracted value:

```text
C_fea = 2 U / V^2
U = 1/2 integral 2 pi r epsilon0 epsilonr |grad V|^2 dr dz
```

Adjacent bias-to-bias parasitic capacitance:

```text
d_hv_hv ~= plate_thickness + 2 plate_gap
C_parasitic ~= epsilon0 (epsr_core A_core + epsr_epoxy A_core_epoxy) / d_hv_hv
```

where:

```text
A_core = pi r_core^2
A_core_epoxy = pi (r_ground_inner^2 - r_core^2)
```

For ferrite-like bulk cores, `epsr_core` is the selected core permittivity. For MELF 0204/0207 presets, direct stage resistance remains a direct resistor value, but `Cpar` is no longer a fixed package placeholder. The app models the MELF body as a ceramic substrate with a metal-film fill-factor correction:

```text
epsr_core = epsr_substrate / (1 - FF)
```

The default 0207 model uses `epsr_substrate = 9.8` and `FF = 0.50`, giving `epsr_core = 19.6`. This is a first-draft effective-medium approximation for a high-value spiral-trimmed metal-film resistor. It avoids pretending the proprietary film path is known while still letting the capacitance scale with geometry. The old direct `Resistor Cpar` input remains available for non-MELF direct-stage models such as a deliberately lumped potted resistor chain.

After a matching FEniCSx solve, the Designer tab also reports `FEA Cpar`. This is a separate local three-bias-plate energy-difference estimate, not a value extracted from the all-HV total-capacitance solve:

```text
Cpar_adjacent ~= (C_middle_to_all_zero - C_all_bias_to_ground / 3) / 2
```

The division by two accounts for the middle bias plate coupling to two adjacent bias plates in the local model. Treat it as a sanity check until a full capacitance-matrix charge extraction is implemented.

Resistance between adjacent bias plates:

```text
A_core = pi r_core^2
R_total ~= rho_core stack_length / A_core
R_stage ~= rho_core (plate_thickness + 2 plate_gap) / A_core
```

`R_stage` uses the face-to-face bias-plate separation through the intervening gap, ground plate, and second gap. It intentionally excludes the bias-plate thickness because that section is shorted to the bias node.

In the web app, `rho_core` is entered in ohm-cm while geometry is in mm, so the implementation converts `L/A` as `(length_mm / 10) / (area_mm2 / 100)`.

When `Direct stage RC inputs` is enabled, the app instead shows a direct `Direct stage R` input. The total core-chain readout is then the entered stage resistance times the number of adjacent-bias stages, rather than a bulk-resistivity calculation from core geometry.

Stage corner estimate:

```text
f_stage ~= 1 / (2 pi R_stage C_g_stage)
```

High-frequency capacitive feedthrough indicator:

```text
feedthrough ~= C_parasitic / C_g_stage
```

Parasitic reactance takeover point:

```text
f_parasitic ~= 1 / (2 pi R_stage C_parasitic)
```

This marks the frequency where the adjacent-bias parasitic capacitance has the same reactance magnitude as the adjacent-bias ohmic path. Above this point, the resistor is no longer the dominant bias-to-bias path for AC noise, and the parasitic capacitance increasingly determines feedthrough.

Two-terminal shunt admittance estimate:

```text
G_load = I_load / V_bias
Y(f) = G_load + j 2 pi f C_g_total
```

The designer uses the load-current slider for `I_load`, defaulting to 1 nA. Before an FEA solve, `C_g_total` is the washer-overlap estimate above. After a matching FEniCSx solve, `C_g_total` is the energy-extracted capacitance from the solved geometry.

The web slide plots the ladder transfer as voltage-noise attenuation:

```text
attenuation_dB = -20 log10(|Vout / Vin|)
```

This uses the usual power-dB convention for equal impedances, so a factor-of-10 voltage-noise reduction is shown as 20 dB attenuation.

The displayed attenuation and SPICE-style ladder sweeps are intentionally limited to 1 Hz through 100 MHz. Power-line noise is the low-frequency feature that matters most here, so the plot starts far enough below 50/60 Hz to make the low-frequency rolloff clear without spending much visual space on slower drift. The high end is capped at 100 MHz because the DAQ sample rate is only around 200 MS/s, making higher-frequency response less useful for this design screen.

The designer tab reports the same single-stage attenuation values numerically:

- Attenuation at 50 Hz, calculated from the one-stage divider using `R_stage`, `C_g_stage`, and `C_parasitic`.
- High-frequency attenuation limit, calculated from the `C_parasitic / C_g_stage` feedthrough ratio.

The RC ladder slide also labels the 50 Hz attenuation point on the plotted transfer curve and draws the high-frequency attenuation ceiling implied by that same single-stage `C_parasitic / C_g_stage` ratio.

Washer dielectric comparison:

```text
C_gain_vs_FR4 ~= epsr_washer / 4.4
```

This is only valid for the simple parallel-plate washer-overlap estimate, but it is useful for estimating how much capacitance a better dielectric buys before sourcing or machining ceramic washers.

With the current browser defaults (`epsr_washer = 10` alumina-like, MELF 0207 direct-stage resistance, `epsr_core = 19.6` effective MELF core, 2.2 mm core OD, two plate pairs, 6.6 mm washer ID, 18.8 mm washer OD, 1.4 mm washer thickness, and 22.8 mm tube ID), the estimate is roughly:

- `C_gap`: about 15.4 pF.
- `C_g_stage`: about 30.8 pF per bias plate.
- `C_parasitic`: about 0.37 pF between adjacent bias plates in the analytic/SPICE estimate.
- `FEA Cpar`: about 0.14 pF in the current three-bias FEniCSx smoke test.
- `R_stage`: 12 Mohm for the default 0207 direct stage.

The default capacitance estimates correspond to:

```text
C_gap ~= epsilon0 * 10 * pi * (9.4^2 - 3.3^2) / 1.4
C_g_stage ~= 2 C_gap
C_parasitic ~= epsilon0 * (19.6 * pi * 1.1^2 + 3.4 * pi * (3.3^2 - 1.1^2)) / 4.3
```

## Assumptions And Gaps

- Edge correction is ignored for capacitance.
- Outer tube capacitance is ignored in the circuit estimate; this is expected to be smaller when the washer overlap has much larger area and permittivity.
- The admittance readout is a quasi-static shunt estimate. It does not yet solve a lossy complex-permittivity FEM problem.
- The parasitic estimate focuses on the selected core/conductor material and epoxy around the core inside the ground-plate inner diameter.
- FR4/G10, alumina, zirconia/ZTA, and high-permittivity electroceramics can differ strongly in loss, leakage, voltage coefficient, microphonics, and practical surface finish; the RC estimate only uses `epsr`.
- A later FEA extraction should separately report washer capacitance to ground, tube/fringe capacitance to ground, and a true capacitance-matrix bias-to-bias parasitic capacitance.
