# Architecture

The applet is a static, buildless web app: plain ES modules and an HTML import map, with no bundler.
GitHub Pages serves the repository files as they are. The physics is a pure-JavaScript core that
runs unchanged in the browser and in Deno (unit tests).

## Layers and data flow

```
params (UI units)  ──validateParams / toSimConfig──▶  Simulation (SI, pure)  ──read-only──▶  views & panels
   ▲       src/params.js                                 src/core/*                          src/view/*, src/ui/*
   └──────────── lil-gui controls, profile editor, URL hash ◀───────────────── user ─────────┘
```

- **`src/core/`: physics and geometry.** No DOM, no three.js, SI units. It is deterministic for
  given parameters. Everything here is unit-tested (`tests/`).
- **`src/view/`: three.js rendering.** It reads the Simulation, never mutates it.
- **`src/ui/`: DOM panels.** Controls, plots, theory panel, profile editor, status bar, export.
- **`src/app.js`: orchestration.** Owns params, the Simulation and all views. It runs the
  animation loop and rebuilds everything when a simulation parameter changes (debounced). Display
  settings only reconfigure views.

A parameter change always creates a new `Simulation`: one run is one parameter set. The loop calls
`sim.advance(dt·speed, {budgetMs})` (time-sliced), then `syncViews()`.

## Frames

- **Machine frame = three.js world frame**, in metres. Machine axis is world $z$ (horizontal on
  screen), $y$ is up, and the guide ring lies in $z=0$.
- **Mandrel frame**: `MandrelView.group` gets the pose matrix every frame. Yarns and overlays are
  children of that group, so they are built once in mandrel coordinates and move with the mandrel.

See `docs/THEORY.md` §1 and §3.

## Core modules (`src/core/`)

| Module          | Responsibility                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `vec.js`        | 3-vector helpers on plain arrays                                                                                           |
| `numeric.js`    | Brent root finder, first-sign-change bracketing, golden section, RK4, natural cubic spline, smootherstep                   |
| `profiles.js`   | C² mandrel profiles r(z) (cylinder, cone, taper, bulge, hourglass, custom spline) and admissibility checks                 |
| `surface.js`    | `SurfaceOfRevolution`: frames, fundamental forms, convex-positive curvatures, braid angle, Darboux frame, clearance        |
| `geodesic.js`   | Geodesic ODE (Christoffel symbols, RK4), Clairaut relation                                                                 |
| `pose.js`       | `MandrelPose`: machine ↔ mandrel transforms, relative velocity, ring clearance                                             |
| `machine.js`    | `CircularBraider`: carriers, guide points, horn gears, sides, passings, over/under, figure-eight track                     |
| `yarnPath.js`   | `YarnPath`: growable typed-array storage of deposited samples, and `FLAG` bits                                             |
| `deposition.js` | `FellPointSolver`: the fell-point model (unilateral contact, Heun scheme, bridging, contact jumps, closed-form curvatures) |
| `crossings.js`  | `CrossingTracker` / `CrossingEvents`: interlacing detection and undulation side function                                   |
| `analysis.js`   | Quasi-static angle and convergence length, Du–Popper transient, cover factor, jamming, binning                             |
| `simulation.js` | `Simulation`: time stepping, step control, on-axis symmetry reduction, axial yarns, flags, time series                     |

`Simulation` public state for views:

| Field                                             | Contents                                      |
| ------------------------------------------------- | --------------------------------------------- |
| `yarns`                                           | bias `YarnPath`s: `0…N/2−1` are "+", then "−" |
| `axialYarns`                                      | axial `YarnPath`s (triaxial only)             |
| `fell`                                            | current fell points, mandrel frame            |
| `mode`                                            | per-yarn state: pinned / wrapping / ended     |
| `crossings.events`                                | per-yarn crossing events                      |
| `series`                                          | h(t), ring position, mean fell z              |
| `stats`, `currentFlags`                           | flag counts, and the latest flags per yarn    |
| `profile`, `surface`, `pose`, `machine`, `config` | the setup of this run                         |

**Symmetry.** For a centred, untilted mandrel only two representative yarns are solved. The others
are exact rotated copies, written into `yarns` as they are deposited. Views don't need to know.

## View modules (`src/view/`)

| Module           | Responsibility                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.js`       | Renderer (ACES tone mapping, RoomEnvironment), camera, OrbitControls, camera presets, projection helper                                                                                                                                              |
| `mandrelView.js` | Lathe mesh; colour modes metal / flat (matte, user colour) / K / H (diverging, auto or custom range); end caps, shaft; owns the mandrel group (pose matrix)                                                                                          |
| `machineView.js` | Track plate, instanced horn gears and carriers, figure-eight paths, guide ring, free yarns (`LineSegments2`)                                                                                                                                         |
| `yarnView.js`    | Deposited yarns: one controller (ring commits, crossing-based undulation, incremental updates, LOD, colour modes, picking) with two drawables, fat lines like the free yarns (`LineDrawable`, default) or surface-framed flat tapes (`TapeDrawable`) |
| `overlayView.js` | Fell line, Darboux frame and principal-direction arrows, geodesic from the selected fell point, HTML vector labels                                                                                                                                   |
| `colormaps.js`   | Validated palette: categorical slots, sequential indigo→magenta ramp (chosen by measured contrast against the rendered mandrel), blue–gray–red diverging (OKLab), status colours                                                                     |
| `scales.js`      | Pure colour-scale logic: per-colouring value, unit and full range; data / custom / full ranges (signed quantities pivot at 0); slider bounds and ordering of custom bounds; data-range tracker                                                       |

## UI modules (`src/ui/`)

| Module                         | Responsibility                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `controls.js`                  | lil-gui panel: machine, mandrel (+ shape sub-folder), yarn, display, numerics                              |
| `plots.js`                     | `LinePlot`: canvas line chart with crosshair tooltip, bands, dashed references, table view, CSV/PNG export |
| `plotPanel.js`                 | The charts of the Plots tab, and export buttons                                                            |
| `theoryPanel.js`               | KaTeX formulas and live values at the selected fell point                                                  |
| `profileEditor.js`             | Custom profile editor: drag, add and remove spline points; coloured by K                                   |
| `statusBar.js` / `colorbar.js` | Top-bar read-outs and badges / colour legends of the 3D view                                               |
| `export.js`                    | Yarn CSV, PNG download, share link                                                                         |
| `aboutPanel.js`                | Usage notes and suggested experiments                                                                      |

## Extending

- **New mandrel preset:**
  1. Add a case to `makeProfile` (`profiles.js`), keeping it C².
  2. Add default shape parameters in `defaultShapes()` and ranges in `SHAPE_RANGES` (`params.js`).
  3. Add a label in `MANDREL_LABELS`.
  4. Add the preset to the tests in `tests/geometry.test.js`.
- **New yarn colour mode:** add it to `YARN_COLOR_MODES` (`yarnView.js`). A continuous quantity
  also gets an entry in `YARN_SCALES` (`scales.js`: value, unit, sign, full range); it then gets
  the data / custom / full scale and the controls automatically. Categorical or status colourings
  go into `colorOf()` and `legend()`.
- **Non-axisymmetric mandrels:** implement the `SurfaceOfRevolution` interface for the new surface
  (`frame`, `normalCurvature`, `tangentToParam`, `paramToVector`, `darboux`, `braidAngle`,
  `clearance`, `projectRadially`, `principal`). `FellPointSolver` only uses that interface. Then
  update `geodesic.js`, the crossing chart (θ periodicity) and `mandrelView.js`.
- **Other machine types** (e.g. radial or non-circular tracks): replace `CircularBraider`, keeping
  `guidePoint`, `guideVelocity`, `latestPassing`, `crossingPlusOver`, `carrierTrackXY`.

## Tooling

| Command                                       | Purpose                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `deno task test`                              | Unit tests (`tests/*.test.js`, local asserts, no network)                                                                 |
| `deno task check`                             | `deno lint` + `deno fmt --check` + tests (what CI runs)                                                                   |
| `deno task serve`                             | Static server on http://127.0.0.1:8000/                                                                                   |
| `deno task smoke`                             | Headless-Chrome end-to-end test with screenshots in `screenshots/` (uses the local Chrome; `--url` to test the live site) |
| `python3 tests/fixtures/generate_fixtures.py` | Regenerates the SciPy reference solution                                                                                  |

**Deployment.** `.github/workflows/deploy.yml` runs lint, fmt and tests. It then copies
`index.html`, `src/`, `styles/` and `assets/` into `_site/` and deploys that to GitHub Pages.

**Pinned third-party modules** (import map in `index.html`), from jsDelivr:

| Package | Version |
| ------- | ------- |
| three   | 0.186.1 |
| lil-gui | 0.21.0  |
| KaTeX   | 0.18.9  |

When upgrading, check that every URL returns 200, then run the smoke test.
