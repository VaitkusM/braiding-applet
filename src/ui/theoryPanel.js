/**
 * @file theoryPanel.js — the "Theory" tab: the model in formulas (KaTeX) with live values at the
 * selected yarn's fell point. Formulas are rendered once; only the value table updates.
 * The full derivations are in docs/THEORY.md.
 */

import katex from "katex";
import {
  coverFactor,
  jammingAngle,
  quasiStaticAngle,
  quasiStaticConvergenceLength,
} from "../core/analysis.js";

const DEG = 180 / Math.PI;

/** Section content: [kind, payload] with kind "p" (text), "f" (display formula), "h3" (heading). */
const SECTIONS = [
  {
    title: "Machine kinematics",
    body: [
      [
        "p",
        "N carriers, half of each family, revolve about the machine axis at ω; the mandrel is taken up along its own axis at speed v. Each yarn passes an idealised guide point on the guide ring (radius R_g):",
      ],
      [
        "f",
        String
          .raw`\varphi_\pm(t)=\varphi_{\pm,0}\pm\omega t,\qquad G(t)=R_g\,(\cos\varphi,\ \sin\varphi,\ 0)`,
      ],
      [
        "p",
        "Pattern m/m: N/m horn gears; carriers pass each other on opposite sides of a gear and the yarn of the outer carrier goes over. Every yarn goes over m, under m crossings.",
      ],
    ],
  },
  {
    title: "Fell-point model (convergence zone)",
    body: [
      [
        "p",
        "The free yarn is a straight segment from G to the fell point F on the mandrel; deposited yarn sticks (Kessels & Akkerman 2002). With outward normal n, contact is unilateral:",
      ],
      ["f", String.raw`g=(G-F)\cdot n(F)\ \ge\ 0`],
      [
        "p",
        "If g > 0 the fell point stays put (tie ring, lift-off). When the guide point moves so that the yarn would cut into the mandrel, it wraps: F advances along the free-yarn direction t until the yarn is tangent again:",
      ],
      [
        "f",
        String
          .raw`\dot F=\lambda\,t,\qquad t=\frac{G-F}{L},\qquad \lambda=-\frac{\dot G\cdot n}{L\,\kappa_n},\qquad L=|G-F|`,
      ],
      [
        "p",
        "Differentiating t gives the geometry of the deposited curve in its Darboux frame (t, n, b = n × t) in closed form:",
      ],
      [
        "f",
        String
          .raw`\dot t=\frac{\dot G-t\,(t\cdot\dot G)}{L}\ \Rightarrow\ \kappa_g=\frac{\dot G\cdot b}{\lambda L},\quad \kappa_n=-\frac{\dot G\cdot n}{\lambda L},\quad \frac{\kappa_g}{\kappa_n}=-\frac{\dot G\cdot b}{\dot G\cdot n}`,
      ],
      [
        "p",
        "So the slip tendency of the laid yarn depends only on the direction of the guide point's relative velocity in the Darboux frame of the fell point.",
      ],
    ],
  },
  {
    title: "Steady state and quasi-static reference",
    body: [
      [
        "p",
        "If the fell point stayed fixed in the machine frame, it would move over the mandrel with parallel speed ωr and meridian speed v√(1+r′²):",
      ],
      ["f", String.raw`\tan\alpha_{qs}=\frac{\omega r}{v\sqrt{1+r'^2}}`],
      [
        "p",
        "The exact relation on a centred mandrel involves the rates of the lag angle β = φ − θ_F and of the convergence length h:",
      ],
      ["f", String.raw`\tan\alpha=\frac{r\,(\omega-\dot\beta)}{(v-\dot h)\sqrt{1+r'^2}}`],
      [
        "p",
        "On a cylinder the yarn stays tangent with lag cos β = r/R_g and h relaxes exponentially (Du & Popper 1994):",
      ],
      [
        "f",
        String
          .raw`h(t)=h_\infty+(h_0-h_\infty)\,e^{-\omega r t/\sqrt{R_g^2-r^2}},\qquad h_\infty=\frac{\sqrt{R_g^2-r^2}}{\tan\alpha}`,
      ],
      [
        "p",
        "On a changing radius the braid angle therefore lags behind the quasi-static prediction; compare the curves in the Plots tab.",
      ],
    ],
  },
  {
    title: "Surface geometry",
    body: [
      ["p", "The mandrel is a surface of revolution; curvatures are convex-positive."],
      [
        "f",
        String
          .raw`S(z,\theta)=(r\cos\theta,\ r\sin\theta,\ z),\qquad \mathrm{I}=(1+r'^2)\,dz^2+r^2\,d\theta^2`,
      ],
      ["f", String.raw`k_m=-\frac{r''}{(1+r'^2)^{3/2}},\qquad k_p=\frac{1}{r\sqrt{1+r'^2}}`],
      ["f", String.raw`K=k_mk_p=-\frac{r''}{r\,(1+r'^2)^2},\qquad H=\tfrac12(k_m+k_p)`],
      [
        "p",
        "Euler's formula gives the normal curvature along a yarn at braid angle α (from the meridian):",
      ],
      ["f", String.raw`\kappa_n(\alpha)=k_m\cos^2\alpha+k_p\sin^2\alpha`],
      [
        "p",
        "Where κn ≤ 0 along the yarn (concave, e.g. a waist with K < 0), a straight free yarn cannot lie on the surface: it bridges.",
      ],
    ],
  },
  {
    title: "Geodesics (frictionless reference)",
    body: [
      [
        "p",
        "A tensioned yarn on a frictionless surface follows a geodesic. On a surface of revolution geodesics obey Clairaut's relation:",
      ],
      ["f", String.raw`r\sin\alpha=c\quad\Rightarrow\quad \alpha_{geo}(z)=\arcsin\frac{c}{r(z)}`],
      [
        "p",
        "Braided yarns generally are not geodesics; the difference is what friction and interlacing must hold.",
      ],
    ],
  },
  {
    title: "Yarn mechanics",
    body: [
      [
        "p",
        "A flexible yarn with tension T on the surface presses with line load p and needs lateral friction per length Tκg:",
      ],
      ["f", String.raw`p=T\,\kappa_n,\qquad |\kappa_g|\le\mu\,\kappa_n\quad\text{(no slip)}`],
      ["p", "On a cylinder a helix has κn = sin²α / r and κg = 0 (it is a geodesic)."],
    ],
  },
  {
    title: "Coverage and jamming",
    body: [
      ["p", "Flat yarns of width w, N/2 per direction, at radius r and braid angle α:"],
      [
        "f",
        String
          .raw`k=\frac{N\,w}{4\pi r\cos\alpha},\qquad CF=1-(1-k)^2,\qquad \alpha_{jam}=\arccos\frac{N\,w}{4\pi r}`,
      ],
      ["f", String.raw`\text{triaxial: }CF=1-(1-k)^2(1-k_a),\qquad k_a=\frac{n_a w_a}{2\pi r}`],
      [
        "p",
        "This is the flat-strip ideal; round yarns jam earlier (max CF ≈ 0.82, Zhang et al. 1997).",
      ],
    ],
  },
];

const ASSUMPTIONS = [
  "Yarns are flexible and inextensible, with constant tension and width (no flattening or bending stiffness).",
  "The free yarn is straight from an idealised guide point; there is no friction before contact and no yarn–yarn friction in the convergence zone. Real inter-yarn friction shortens h (about 25 % for 144 carriers, van Ravenhorst & Akkerman 2016).",
  "Deposited yarn sticks. Slip is flagged (|κg| > μκn), not simulated.",
  "Carriers revolve uniformly; horn-gear speed variations are ignored.",
  "Concave stretches and obstacles are bridged by straight chords (flagged). The mandrel is a surface of revolution r(z), so poles and domes are not representable.",
  "Undulation is drawn from the computed crossings; flat tapes may clip slightly near side changes of almost jammed braids.",
];

const REFERENCES = [
  "Kessels J.F.A., Akkerman R. (2002). Prediction of the yarn trajectories on complex braided preforms. Composites Part A 33, 1073–1081. doi:10.1016/S1359-835X(02)00075-1",
  "Du G.-W., Popper P. (1994). Analysis of a circular braiding process for complex shapes. J. Textile Institute 85(3), 316–337. doi:10.1080/00405009408631277",
  "van Ravenhorst J.H., Akkerman R. (2014). Circular braiding take-up speed generation using inverse kinematics. Composites Part A 64, 147–158. doi:10.1016/j.compositesa.2014.04.020",
  "van Ravenhorst J.H., Akkerman R. (2016). A yarn interaction model for circular braiding. Composites Part A 81, 254–263. doi:10.1016/j.compositesa.2015.11.026",
  "Akkerman R., Villa Rodríguez B.H. (2007). Braiding simulation and slip evaluation for arbitrary mandrels. AIP Conf. Proc. 907, 1074–1079. doi:10.1063/1.2729657",
  "Ko F.K. (1987). Braiding. In: Engineered Materials Handbook, Vol. 1, ASM International, 519–528.",
  "Zhang Q., Beale D., Adanur S., Broughton R.M., Walker R.P. (1997). Structural analysis of a two-dimensional braided fabric. J. Textile Institute 88(1), 41–52. doi:10.1080/00405009708658528",
  "Wang R., Jiao W., Liu W., Yang F., He X. (2011). Slippage coefficient measurement for non-geodesic filament-winding process. Composites Part A 42(3), 303–309. doi:10.1016/j.compositesa.2010.12.002",
  "do Carmo M.P. (1976). Differential Geometry of Curves and Surfaces, §4-4 (Clairaut's relation).",
];

/** Live-value rows: [TeX label, unit, getter(ctx) → number | string]. */
const LIVE = [
  [String.raw`t`, "s", (c) => c.sim.time.toFixed(2)],
  [String.raw`z_F`, "mm", (c) => (c.i0.zp * 1e3).toFixed(1)],
  [String.raw`r,\ r'`, "mm, –", (c) => `${(c.e.r * 1e3).toFixed(2)}, ${c.e.dr.toFixed(3)}`],
  [String.raw`h`, "mm", (c) => (c.h * 1e3).toFixed(1)],
  [String.raw`h_{qs}`, "mm", (c) => (c.hqs * 1e3).toFixed(1)],
  [String.raw`L=|G-F|`, "mm", (c) => (c.i0.free * 1e3).toFixed(1)],
  [String.raw`|\alpha|`, "°", (c) => (Math.abs(c.i0.alpha) * DEG).toFixed(2)],
  [String.raw`\alpha_{qs}`, "°", (c) => (c.aqs * DEG).toFixed(2)],
  [String.raw`\kappa_n`, "1/m", (c) => fmt(c.i0.kn)],
  [String.raw`\kappa_g`, "1/m", (c) => fmt(c.i0.kg)],
  [
    String.raw`|\kappa_g/\kappa_n|\ \text{vs}\ \mu`,
    "–",
    (c) =>
      `${fmt(Math.abs(c.i0.slip), 3)} vs ${c.sim.config.friction}${
        Math.abs(c.i0.slip) > c.sim.config.friction ? " (slips)" : ""
      }`,
  ],
  [String.raw`p=T\kappa_n`, "N/m", (c) => fmt(c.sim.config.tension * c.i0.kn)],
  [String.raw`k_m,\ k_p`, "1/m", (c) => `${fmt(c.pr.k_m)}, ${fmt(c.pr.k_p)}`],
  [String.raw`K`, "1/m²", (c) => fmt(c.pr.K)],
  [String.raw`H`, "1/m", (c) => fmt(c.pr.H)],
  [String.raw`r\sin\alpha`, "mm", (c) => fmt(c.e.r * Math.abs(Math.sin(c.i0.alpha)) * 1e3)],
  [String.raw`k,\ CF`, "–", (c) => `${fmt(c.cov.k, 3)}, ${fmt(c.cov.cover, 3)}`],
  [String.raw`\alpha_{jam}`, "°", (c) => (c.ajam * DEG).toFixed(1)],
  [String.raw`\text{state}`, "", (c) => c.sim.mode[c.k]],
];

function fmt(v, d = 2) {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(2) : v.toFixed(d);
}

export class TheoryPanel {
  /** @param {HTMLElement} host */
  constructor(host) {
    this.host = host;
    const h = (tag, text, cls) => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (cls) el.className = cls;
      host.appendChild(el);
      return el;
    };
    h("h2", "Live values at the selected fell point");
    this.sel = h("p", "", "note");
    const table = h("table", "", "live-table");
    this.cells = LIVE.map(([tex, unit]) => {
      const tr = document.createElement("tr");
      const l = document.createElement("td"),
        v = document.createElement("td"),
        u = document.createElement("td");
      katex.render(tex, l, { throwOnError: false });
      v.className = "v";
      u.className = "u";
      u.textContent = unit;
      tr.append(l, v, u);
      table.appendChild(tr);
      return v;
    });
    for (const s of SECTIONS) {
      h("h2", s.title);
      for (const [kind, payload] of s.body) {
        if (kind === "p") h("p", payload);
        else {
          const div = h("div", "", "formula");
          katex.render(payload, div, { displayMode: true, throwOnError: false });
        }
      }
    }
    h("h2", "Assumptions and limitations");
    const ul = h("ul");
    for (const a of ASSUMPTIONS) {
      const li = document.createElement("li");
      li.textContent = a;
      ul.appendChild(li);
    }
    h("h2", "References");
    const ol = h("ol");
    for (const r of REFERENCES) {
      const li = document.createElement("li");
      li.textContent = r;
      li.className = "note";
      ol.appendChild(li);
    }
    const more = h("p", "", "note");
    more.textContent = "Full derivations: docs/THEORY.md in the repository.";
    this.selected = 0;
  }

  reset(sim, display) {
    this.selected = display.selectedYarn;
    this.update(sim);
  }

  onSelect(k) {
    this.selected = k;
  }

  show(sim) {
    if (sim) this.update(sim);
  }

  update(sim) {
    const k = Math.min(this.selected, sim.yarns.length - 1), y = sim.yarns[k];
    const i0 = y.get(y.last);
    const c = sim.config, prof = sim.profile;
    const e = prof.evaluate(i0.zp);
    const cov = coverFactor({
      carriers: c.carriers,
      width: c.yarnWidth,
      r: e.r,
      alpha: Math.abs(i0.alpha),
    });
    const ctx = {
      sim,
      k,
      i0,
      e,
      pr: sim.surface.principal(i0.zp),
      h: sim.convergenceLength(sim.fell[k], sim.time),
      hqs: quasiStaticConvergenceLength(prof, i0.zp, c.omega, c.takeUp, c.ringRadius),
      aqs: quasiStaticAngle(prof, i0.zp, c.omega, c.takeUp),
      cov,
      ajam: jammingAngle(c.carriers, c.yarnWidth, e.r),
    };
    this.sel.textContent = `${y.family === 1 ? "+" : "−"} family, carrier ${y.index}` +
      (i0.flags & 1 ? " (still at the tie point: no yarn deposited yet)" : "");
    LIVE.forEach(([, , get], j) => (this.cells[j].textContent = String(get(ctx))));
  }
}
