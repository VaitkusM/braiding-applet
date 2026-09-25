> **Status (2026-09-25): implemented.** The final design is documented in `docs/ARCHITECTURE.md`
> and `docs/THEORY.md`. Additions beyond this plan: obstacle "contact jumps" (a free yarn
> catching on a bulge ahead of the fell point), a sample-count memory guard, and a pixel-level
> recolouring check in the smoke test.

# Plan — Braiding Applet (3D circular-braiding / mandrel differential-geometry explorer)

## Context
`tasks.md` asks for a visually pleasing, informative 3D web applet that shows how an idealized **circular
(maypole) braiding machine** lays yarns onto a mandrel, and how this relates to the **differential geometry**
of the surface and yarn paths and the **physics** of the yarns. The code must be clearly structured and commented for
humans and future agents. It must be tracked in git, pushed to GitHub, and hosted on GitHub Pages. The folder currently contains
only `tasks.md`. "Create /plan first" is met by this plan-mode plan, which is also committed as `docs/PLAN.md`.

User decisions:
- Repo: **public `VaitkusM/braiding-applet`**, MIT license, Pages at https://vaitkusm.github.io/braiding-applet/.
- **Full idealized model**:
  - quasi-static kinematics;
  - time-stepped convergence-zone model;
  - geodesic (Clairaut) comparison;
  - friction/slip check;
  - cover factor and jamming.
- Mandrels:
  - axisymmetric presets;
  - **custom profile editor**;
  - concave and saddle shapes, with bridging flagged;
  - **off-axis** mandrel (offset and/or tilt).
- Braids:
  - diamond 1/1, regular 2/2 and Hercules 3/3 patterns, shown as yarn undulation;
  - **triaxial** axial yarns;
  - **serpentine carrier animation**.

Environment:
- `gh` is logged in as VaitkusM with repo and workflow scopes. The GitHub repo does not exist yet.
- **Deno 2.6.10** and **Chrome 154** are installed. **There is no Node.**
- Python 3 with numpy and scipy is available, used for an independent test fixture.

Two review passes were done during planning:
1. A literature check against the primary papers.
2. An independent re-derivation of all formulas, with a scipy check on a curved cone. The closed-form curvatures matched finite differences to 5 significant figures.

The corrections from both are built into this plan.

## Technology (buildless and static, so there is no build step to break)
- Plain **ES modules**. Pinned dependencies come from jsDelivr through an **import map**. Every URL is verified to return 200 before it is used.
  - `three` maps to `three@<ver>/build/three.module.js` and `three/addons/` to `examples/jsm/`. Never use `+esm`, which creates duplicate three instances.
  - **lil-gui** for the parameter panel.
  - **KaTeX** for the theory panel.
  - Plots use a small in-house canvas plotter.
  - All site URLs are relative, because the site is served under `/braiding-applet/`.
- **Deno** tooling through `deno.json` tasks:
  - `test`: unit tests of the pure core.
  - `lint`: excludes `no-window` and `no-window-prefix`, and code uses `globalThis`.
  - `fmt`: lineWidth 100, `proseWrap: preserve`.
  - `serve`: the std file server.
  - `smoke`: `jsr:@astral/astral` driving the **system Chrome** via `path`. It fails on exceptions, console errors, and HTTP ≥ 400, which catches bad CDN pins. It reads the `globalThis.__braid` hook and saves screenshots.
- **GitHub Actions** (`.github/workflows/deploy.yml`):
  - Deno is pinned to 2.6.10. The job runs lint, fmt --check and test, then deploys with `actions/upload-pages-artifact` and `actions/deploy-pages`. The versions of both actions are checked at implementation time.
  - The workflow needs `pages: write` and `id-token: write` permissions, the `github-pages` environment, and the `main` branch.

## Model (SI internally; the UI shows mm, rpm and degrees)
### Frames and conventions
This is one "Conventions" block, repeated verbatim in `THEORY.md` and in the header of `surface.js`.

**Machine frame**
- The guide-ring plane is z = 0 and the machine axis is z.
- ω is the carriers' revolution rate about the machine axis, not the horn-gear rpm.

**Mandrel frame**
- The axis is z_M, measured from the leading end. The surface is S(z,θ) = (r cosθ, r sinθ, z).
- The outward normal is n = normalize(S_θ × S_z), so (z,θ) is left-handed with respect to n.
- Curvatures are **convex-positive**:
  - κₙ = −II(t,t)/I(t,t)
  - k_m = −r″/(1+r′²)^{3/2}
  - k_p = 1/(r√(1+r′²))
  - K = −r″/(r(1+r′²)²)
  - H = (k_m + k_p)/2
- In code, use `g_zz`, `g_tt`, `ii_zz` and `ii_tt` (not E, F, G, L, M, N). This avoids name clashes with the guide point G, the free length L, and the carrier count N.

**Pose (mandrel frame to machine frame)**
- T(t) = T₀ ∘ translation(v·t·e_zM). T₀ holds the offset e and the tilt τ, and the mandrel moves along its own axis.
- Only points fixed in the machine (the ring and the axial guides) keep constant x_M and y_M.
- The ring clearance check is R_g > |e| + r_max/cos τ, plus a margin.

### Model components
1. **Machine**
   - Carrier angles are φ₊ⱼ = jΔ + ωt and φ₋ᵢ = iΔ + Δ/2 − ωt, with Δ = 4π/N. Guide points are Gⱼ = R_g(cosφ, sinφ, 0).
   - Pattern m/m requires **2m | N**.
   - Horn gears:
     - There are N/m gears, with centres at c_q = (2π/N)·m(q + ½) and sides σ_q = (−1)^q.
     - Gear tangency points sit at integer multiples of 2π/N.
     - Carriers pass each other at (2π/N)(k + ½), on opposite sides, and never collide.
     - The pitch radius is R_h = R_t sin(πm/N). R_t scales with N so the bobbins don't overlap.
   - The carrier radius is R_t + R_h·σ·√(1−u²), where u is the local gear coordinate.
   - Outer carrier means its yarn goes **over**.
   - Axial guides sit at the gear centres.
2. **Deposition** (the Kessels & Akkerman 2002 fell-point model)
   - The free yarn is straight from G to F. The fell point F moves along the free yarn direction t on the surface.
   - The yarn is tangent at F, and sticks once deposited.
   - Contact is unilateral: g = (G−F)·n ≥ 0.
     - If g(0) ≥ −1e-12 m, F is **pinned** (start-up tie ring, or **lift-off**, which is flagged).
     - Otherwise, solve g(s) = 0 by a safeguarded Newton/bisection root search along the surface.
     - The bracket starts at 1.5× the predicted s and doubles as needed.
     - The tolerance is |g| ≤ 1e-9 m, with at most 40 iterations.
   - **Second-order Heun step**:
     1. Solve along d_n.
     2. Re-evaluate the direction d* at the predicted F* using G_{n+1}.
     3. Re-solve from F_n along ½(d_n + d*).
   - The step is Δt = min(Δφ_max/ω, Δs_max/√(ω²r² + v²(1+r′²))), with defaults Δs ≤ 0.5 mm, Δφ ≤ 0.5° and a turn of t ≤ 1° per step.
   - θ is kept unwrapped in float64.
   - **Bridging** (κₙ·r < 1e-3, or no root found locally):
     - search for the first −→+ sign change, store a suspended straight chord, and flag it;
     - samples therefore store 3D mandrel-frame positions plus (z,θ) and an on-surface flag.
   - A **segment clearance test** checks ~16 samples on the G–F segment against the mandrel radius. This catches waist or bulge interference.
   - A yarn stops at either end of the mandrel's z range, or when the segment test fails.
   - **On-axis symmetry**:
     - All + yarns are rotations of one + yarn, and all − yarns are rotations of one − yarn.
     - The same general solver runs on 2 representative yarns, and views get rotated copies.
     - Off-axis, all N yarns are solved, time-sliced to about 8 ms per frame. There is no Worker.
   - **Closed forms at deposition** (verified), with b = n × t:
     - λ = −(Ġ·n)/(Lκₙ)
     - κ_g = (Ġ·b)/(λL)
     - κₙ = −(Ġ·n)/(λL)
     - slip ratio κ_g/κₙ = −(Ġ·b)/(Ġ·n)
3. **Quasi-static reference**
   - tan α = ωr/(v√(1+r′²)), with α measured from the meridian in the tangent plane.
   - The theory panel also shows the exact on-axis identity tan α = r(ω−β̇)/((v−ḣ)√(1+r′²)) and the other angle conventions (3D angle to the axis).
   - The quasi-static h is a 1D root: the tangent line at angle α reaches the ring radius. On a cylinder this gives h = √(R_g²−r²)/tan α.
4. **Geodesics**
   - An RK4 geodesic ODE using the Christoffel symbols:
     - Γ^z_zz = r′r″/(1+r′²)
     - Γ^z_θθ = −rr′/(1+r′²)
     - Γ^θ_zθ = r′/r
   - The Clairaut invariant r·sinα is the check.
   - The α_geo(z) comparison curve stops at the turning point (r = c), which gets a marker.
5. **Yarn mechanics**
   - Contact pressure is p = T·κₙ.
   - No slip requires |κ_g| ≤ μκₙ (Akkerman & Villa Rodríguez 2007).
   - Each sample has flags for slip, bridging, lift-off and jamming.
6. **Coverage**
   - k = N·w/(4πr cos α); CF = 2k − k², clamped to 1 when k > 1.
   - Triaxial: k_a = (N/m)·w_a/(2πr), CF = 1 − (1−k)²(1−k_a).
   - Jamming: α_jam = arccos(Nw/(4πr)). If Nw/(4πr) ≥ 1, the braid is jammed at every angle.
   - The UI notes that this is the flat-strip ideal; real round yarns jam at about CF 0.82 (Zhang et al. 1997).
7. **Interlacing and undulation**
   - Crossings are detected incrementally in the (z_M, θ_M) chart using a spatial hash near the fell zone.
   - Over/under at each crossing of the pair (+j, −i):
     - use the carrier side at that pair's most recent passing before the crossing;
     - passings occur at t_p = ((i−j)Δ + Δ/2 + 2πp)/(2ω), so the latest one is unambiguous because β < 90°;
     - this also holds off-axis and in transients.
   - Bias–axial crossings use the carrier side at the gear centre.
   - Height along each yarn = c + a·σ_k at crossing k, with cosine blends between sign changes. The tail is updated when the next crossing appears.
   - Heights in units of the yarn thickness t_y:
     - biaxial: c = 1 and a = ½;
     - triaxial: c = 1.5 and a = 1, with the axial yarn at 1.5.
   - Some clipping near transitions is unavoidable as k → 1; this is documented.
   - On-axis, the result must equal the closed-form θ_M rule. This is a test.
   - Axial yarns lie on fixed-θ_M meridians, which are geodesics. They extend to the bias fell curve.
8. **Profiles**
   - Presets are C², analytic, and each comes with parameter sliders:
     - cylinder;
     - cone;
     - cylinder–taper–cylinder using a smootherstep blend;
     - bulge using the bump (1−x²)³;
     - hourglass waist with K < 0.
   - The custom profile is a natural cubic spline, checked on a dense grid for r ≥ r_min and |r′| ≤ 3, with a warning otherwise.
   - A z-graph profile cannot represent domes or poles. This is documented.

**Literature** (cite in THEORY.md):
- Kessels & Akkerman 2002, *Compos. A* 33:1073 — core model, Eqs. 3–5.
- van Ravenhorst & Akkerman 2014, *Compos. A* 64:147, and 2016, *Compos. A* 81:254 — H formula.
- Du & Popper 1994, *J. Text. Inst.* 85:316 — cylinder transient:
  - h(t) = h∞ + (h₀−h∞)·exp(−λ_r ωt/√(1−λ_r²)), with λ_r = r/R_g;
  - equivalently dh/dt = v − ωrh/√(R_g²−r²).
- Ko 1987 — classical tan α = ωr/v.
- Akkerman & Villa Rodríguez 2007 — slip criterion.
- Wang et al. 2011 — slippage coefficient.
- Zhang et al. 1997 — round-yarn jamming.
- do Carmo — Clairaut.

## Code layout
```
index.html  styles/main.css  deno.json  README.md  AGENTS.md  CLAUDE.md(→AGENTS.md)  LICENSE  .gitignore
src/main.js         entry → App; WebGL/CDN failure overlay
src/app.js          owns params, Simulation, Viewer, UI; rAF loop with time-sliced stepping; debounced reset
src/params.js       schema: defaults, ranges, units, presets, validation (2m|N, clearance, profile limits); URL-hash state
src/core/  (pure JS; no DOM, no three.js; unit-tested)
  vec.js  numeric.js (safeguarded roots, RK4, natural cubic spline)  profiles.js  surface.js  pose.js
  machine.js (carriers, gears, sides, passings)  deposition.js (fell-point solver)  crossings.js (interlacing)
  analysis.js (α, κ, slip, pressure, quasi-static, cover)  geodesic.js  simulation.js (state for views)
src/view/  scene.js mandrelView.js machineView.js yarnView.js overlayView.js colormaps.js
src/ui/    controls.js plots.js plotPanel.js profileEditor.js theoryPanel.js statusBar.js export.js
tests/*.test.js  tests/fixtures/ (scipy reference data + generator script)  tools/smoke.js
docs/PLAN.md  docs/THEORY.md  docs/ARCHITECTURE.md   .github/workflows/deploy.yml
```
Every file starts with a header comment covering its purpose, its inputs and outputs, and conventions. Every export has JSDoc with units.

## UI / visuals
- **3D view**
  - Full-window, on a dark gradient.
  - The mandrel uses a PBR metal material with RoomEnvironment lighting.
  - Yarns use a custom BufferGeometry with flat elliptical tapes framed by the surface (n, b), not TubeGeometry frames.
  - Colours: + family amber, − family teal, axial ivory.
  - Buffers are preallocated and grow via `setDrawRange` and `addUpdateRange`, with `frustumCulled = false`.
  - Yarn meshes are children of the mandrel object.
  - LOD:
    - render spacing ≈ clamp(crossing spacing/6, 0.5 mm, 3 mm);
    - above a vertex budget of about 1.5M, flat layered tapes replace undulation.
  - The thickness exaggeration factor is adjustable. The device pixel ratio is capped at 2.
  - Machine: track plate with horn gears and serpentine grooves, bobbin carriers, a chrome guide ring, the free yarns (carrier → ring → fell point), the fell line, and an optional convergence cone.
- **lil-gui panel**
  - Simulation: play, pause, reset, speed, run-to-end with progress.
  - Machine: N, ω, v, R_g, pattern, triaxial, and "v from target α".
  - Mandrel: preset and its parameters, offset, tilt, and an edit-profile button.
  - Yarn: w, t_y, T, μ, thickness exaggeration.
  - Display:
    - yarn colour by family, α, slip ratio, κₙ, κ_g or pressure;
    - mandrel colour by metal, K or H (diverging colour map centred at 0, with colour bars and units);
    - overlays: Darboux frame (t, n, b) at the selected fell point, principal directions, geodesic from the selected fell point;
    - camera follow.
- **Tabbed panel**
  - **Plots**, each with export to CSV or PNG:
    - α(z): simulated vs quasi-static vs geodesic vs α_jam;
    - h(t): simulated vs quasi-static vs the Du–Popper transient;
    - κₙ, κ_g and |κ_g/κₙ| against μ along the selected yarn;
    - CF(z).
  - **Theory**: KaTeX formulas with live values at the selected fell point.
  - **Profile**: a drag editor for r(z) points, coloured by K.
- **Status and interaction**
  - Status badges for jamming, slip, bridging and lift-off.
  - Select a yarn by clicking a carrier (raycast) or the nearest centreline sample, or from a dropdown.
  - Keyboard: Space toggles play, R resets.
  - Share link via the URL hash.
  - The layout is responsive, and panels stack on narrow screens.

## Milestones (commit and push after each; commits end with the Co-Authored-By line)
0. **Scaffold**
   - Run `git init -b main`. Add README stub, LICENSE, .gitignore, deno.json, docs/PLAN.md, the workflow and a placeholder index.html.
   - `gh repo create VaitkusM/braiding-applet --public` without pushing.
   - `gh api -X POST repos/VaitkusM/braiding-applet/pages -f build_type=workflow`.
   - Then push, and confirm the Pages URL serves before building further.
1. **Core geometry**: numeric, profiles, surface, geodesic, pose, plus tests.
2. **Core physics**: machine, deposition, crossings, analysis, simulation, plus the validation tests below.
3. **3D view**: scene, mandrel, machine, yarns, free yarns, main loop, controls. Smoke test and screenshots.
4. **Panels and overlays**: plots, theory panel, profile editor, overlays, colour modes and colour bars, badges, selection, URL state, export.
5. **Docs and release**: THEORY, ARCHITECTURE, AGENTS, README (with screenshots), polish, final deploy.

## Verification
- **`deno task test`**
  - Geometry:
    - r′ and r″ match finite differences for every preset. The spline is C² at its knots.
    - K, H and κₙ are exact on a cylinder and at the bulge crest. κₙ matches Euler's formula.
    - The Clairaut invariant is conserved to 1e-8 on analytic profiles and 1e-6 on splines.
  - Cylinder steady state:
    - α → atan(ωr/v) and h → √(R_g²−r²)/tan α within 0.1%.
    - κ_g → 0.
    - h(t) after wrap-start matches the Du–Popper exponential.
  - Solver accuracy (a cylinder test cannot reveal scheme error, so these use curved profiles):
    - Grid refinement shows second-order convergence.
    - Results match a scipy-generated fixture of the exact on-axis scalar ODE.
    - The closed-form κ_g and κₙ match finite differences of the deposited polyline.
  - Symmetry:
    - Zero offset and tilt give the same result as the on-axis case.
    - Yarns within a family are rotations of each other.
    - Mirror symmetry about θ = π/N holds.
  - Machine:
    - 2m | N is validated.
    - Sides are opposite at every passing, and carriers never collide at tangent points.
    - Each yarn shows the m-over/m-under blocks.
    - Crossing signs match the θ_M closed form on-axis.
  - The waist profile triggers the bridging flag, and a steep cone triggers the slip flag.
  - Cover factor, triaxial cover and jamming match their formulas.
- `deno task lint` and `deno fmt --check` pass. CI runs the same checks.
- **`deno task smoke`** on the local server:
  - There are no exceptions, console errors or HTTP failures.
  - `__braid` shows the simulation advancing.
  - Screenshots of cylinder, taper, hourglass, off-axis and triaxial runs are inspected visually.
- **After the push**
  - The Actions run is green.
  - The Pages URL returns 200.
  - `deno task smoke --url https://vaitkusm.github.io/braiding-applet/` passes.
