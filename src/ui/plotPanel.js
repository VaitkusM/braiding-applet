/**
 * @file plotPanel.js — the "Plots" tab: live charts of the run.
 *
 *  1. Braid angle |α| along the mandrel: simulated (+ / − families), quasi-static prediction,
 *     geodesic from the selected fell point (Clairaut), jamming limit.
 *  2. Convergence length h(t): simulated, quasi-static, Du & Popper transient (cylinder).
 *  3. Selected yarn (small multiples, same x): κₙ, κ_g and the slip ratio |κ_g/κₙ| against μ.
 *  4. Cover factor CF(z) (flat-strip ideal) with the jamming level.
 * Series colours follow the entity everywhere: + family orange, − family aqua, quasi-static blue,
 * geodesic yellow; references and thresholds are dashed muted ink.
 */

import { LinePlot } from "./plots.js";
import { INK, SERIES } from "../view/colormaps.js";
import {
  coverFactor,
  duPopperConvergenceLength,
  jammingAngle,
  quasiStaticAngle,
  quasiStaticConvergenceLength,
} from "../core/analysis.js";
import { FLAG } from "../core/yarnPath.js";
import { copyShareLink, downloadDataUrl, exportYarnCsv } from "./export.js";

const DEG = 180 / Math.PI;
const BINS = 160;

export class PlotPanel {
  /**
   * @param {HTMLElement} host
   * @param {{screenshot:()=>string}} hooks
   */
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks;

    const bar = document.createElement("div");
    bar.className = "row";
    const mk = (label, fn, title) => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      bar.appendChild(b);
      return b;
    };
    mk(
      "Selected yarn → CSV",
      () => this.sim && exportYarnCsv(this.sim, this.selected),
      "All deposited samples of the selected yarn",
    );
    mk(
      "3D view → PNG",
      () => downloadDataUrl(hooks.screenshot(), "braiding-3d.png"),
      "Screenshot of the 3D view",
    );
    const share = mk("Copy share link", async () => {
      share.textContent = (await copyShareLink())
        ? "Link copied ✓"
        : "Copy failed — use the address bar";
      setTimeout(() => (share.textContent = "Copy share link"), 2500);
    }, "The URL contains all parameters");
    host.appendChild(bar);
    this.selInfo = document.createElement("p");
    this.selInfo.className = "note";
    host.appendChild(this.selInfo);

    this.alpha = new LinePlot(host, {
      title: "Braid angle along the mandrel",
      xLabel: "z [mm]",
      yLabel: "|α| [°]",
      yMin: 0,
      yMax: 90,
      file: "braid-angle",
      series: [
        { key: "plus", label: "simulated +", color: SERIES.plus },
        { key: "minus", label: "simulated −", color: SERIES.minus },
        { key: "qs", label: "quasi-static", color: SERIES.quasiStatic },
        { key: "geo", label: "geodesic (Clairaut)", color: SERIES.geodesic },
        { key: "jam", label: "jamming limit", color: INK.muted, dashed: true },
      ],
    });
    this.conv = new LinePlot(host, {
      title: "Convergence length",
      xLabel: "t [s]",
      yLabel: "h [mm]",
      yMin: 0,
      file: "convergence-length",
      series: [
        { key: "plus", label: "simulated +", color: SERIES.plus, digits: 1 },
        { key: "minus", label: "simulated −", color: SERIES.minus, digits: 1 },
        { key: "qs", label: "quasi-static", color: SERIES.quasiStatic, digits: 1 },
        { key: "dp", label: "Du & Popper (cylinder)", color: INK.muted, dashed: true, digits: 1 },
      ],
    });
    this.kn = new LinePlot(host, {
      title: "Normal curvature κn",
      subtitle: "selected yarn",
      xLabel: "z [mm]",
      yLabel: "κn [1/m]",
      height: 130,
      file: "normal-curvature",
      series: [{ key: "v", label: "κn", color: SERIES.plus }],
    });
    this.kg = new LinePlot(host, {
      title: "Geodesic curvature κg",
      subtitle: "selected yarn",
      xLabel: "z [mm]",
      yLabel: "κg [1/m]",
      height: 130,
      file: "geodesic-curvature",
      series: [{ key: "v", label: "κg", color: SERIES.plus }],
    });
    this.slip = new LinePlot(host, {
      title: "Slip ratio |κg / κn|",
      subtitle: "selected yarn · slips above μ",
      xLabel: "z [mm]",
      yLabel: "|κg/κn|",
      yMin: 0,
      height: 140,
      file: "slip-ratio",
      series: [
        { key: "v", label: "|κg/κn|", color: SERIES.plus, digits: 3 },
        { key: "mu", label: "friction μ", color: INK.muted, dashed: true },
      ],
    });
    this.cover = new LinePlot(host, {
      title: "Cover factor",
      subtitle: "flat-strip ideal (round yarns jam near CF ≈ 0.82)",
      xLabel: "z [mm]",
      yLabel: "CF",
      yMin: 0,
      yMax: 1.05,
      height: 150,
      file: "cover-factor",
      series: [
        { key: "cf", label: "cover factor CF", color: INK.secondary, digits: 3 },
        {
          key: "k",
          label: "per-family coverage k",
          color: INK.secondary,
          tooltipOnly: true,
          digits: 3,
        },
        { key: "full", label: "k = 1: jammed", color: INK.muted, dashed: true },
      ],
    });
    this.selected = 0;
  }

  reset(sim, display) {
    this.sim = sim;
    this.selected = display.selectedYarn;
    this.update(sim, display);
  }

  onSelect(k) {
    this.selected = k;
    if (this.sim) this.update(this.sim);
  }

  show(sim, display) {
    if (sim) this.update(sim, display);
  }

  /** Recomputes and redraws all charts. */
  update(sim, _display, overlay) {
    this.sim = sim;
    const c = sim.config, prof = sim.profile, L = prof.length;
    const k = Math.min(this.selected, sim.yarns.length - 1);
    const ysel = sim.yarns[k];
    const famColor = ysel.family === 1 ? SERIES.plus : SERIES.minus;
    for (const p of [this.kn, this.kg, this.slip]) p.o.series[0].color = famColor;
    this.selInfo.textContent =
      `Selected yarn: ${ysel.family === 1 ? "+" : "−"} family, carrier ${ysel.index} ` +
      `(click a carrier or yarn in the 3D view to change).`;

    // ── 1. Braid angle along z ──
    const P = sim.machine.perFamily;
    const fams = {
      plus: sim.symmetric ? [0] : range(0, P),
      minus: sim.symmetric ? [P] : range(P, 2 * P),
    };
    const zc = [], acc = {};
    for (let b = 0; b < BINS; b++) zc.push(((b + 0.5) / BINS) * L);
    for (const [key, ks] of Object.entries(fams)) acc[key] = binAbsAlpha(sim, ks, L);
    const all = sim.symmetric ? null : binAbsAlpha(sim, range(0, 2 * P), L);
    const fell = sim.yarns[k];
    const fz = fell.zp[fell.last];
    const cClair = overlay && Number.isFinite(overlay.clairaut) ? Math.abs(overlay.clairaut) : NaN;
    this.alpha.setData({
      x: zc.map((z) => z * 1e3),
      xMin: 0,
      xMax: L * 1e3,
      y: {
        plus: acc.plus.mean.map((a) => a * DEG),
        minus: acc.minus.mean.map((a) => a * DEG),
        qs: zc.map((z) => quasiStaticAngle(prof, z, c.omega, c.takeUp) * DEG),
        geo: zc.map((z) => {
          if (z < fz || !Number.isFinite(cClair)) return NaN;
          const r = prof.evaluate(z).r;
          return cClair <= r ? Math.asin(cClair / r) * DEG : NaN;
        }),
        jam: zc.map((z) => jammingAngle(c.carriers, c.yarnWidth, prof.evaluate(z).r) * DEG),
      },
      band: all
        ? { lo: all.min.map((a) => a * DEG), hi: all.max.map((a) => a * DEG), color: INK.muted }
        : null,
    });

    // ── 2. Convergence length ──
    const s = sim.series, stride = Math.max(1, Math.ceil(s.t.length / 1200));
    const idx = [];
    for (let i = 0; i < s.t.length; i += stride) idx.push(i);
    const isCyl = prof.kind === "cylinder" && sim.symmetric && sim.wrapStart;
    this.conv.setData({
      x: idx.map((i) => s.t[i]),
      y: {
        plus: idx.map((i) => s.hPlus[i] * 1e3),
        minus: idx.map((i) => s.hMinus[i] * 1e3),
        qs: idx.map((i) =>
          quasiStaticConvergenceLength(prof, s.zFell[i], c.omega, c.takeUp, c.ringRadius) * 1e3
        ),
        dp: idx.map((i) =>
          isCyl && s.t[i] >= sim.wrapStart.time
            ? duPopperConvergenceLength(s.t[i] - sim.wrapStart.time, {
              h0: sim.wrapStart.h,
              r: prof.evaluate(0).r,
              ringRadius: c.ringRadius,
              omega: c.omega,
              v: c.takeUp,
            }) * 1e3
            : NaN
        ),
      },
      band: sim.symmetric ? null : {
        lo: idx.map((i) => s.hMin[i] * 1e3),
        hi: idx.map((i) => s.hMax[i] * 1e3),
        color: INK.muted,
      },
    });
    const same = sim.symmetric
      ? "+ and − coincide (centred mandrel)"
      : "band: min–max over all yarns";
    this.alpha.setSubtitle(same);
    this.conv.setSubtitle(
      prof.kind === "cylinder" && !sim.symmetric
        ? `${same}; Du & Popper needs a centred mandrel`
        : same,
    );

    // ── 3. Selected yarn curvatures ──
    const n = ysel.count, st = Math.max(1, Math.ceil(n / 900));
    const xs = [], kn = [], kg = [], sl = [];
    for (let i = 0; i < n; i += st) {
      xs.push(ysel.zp[i] * 1e3);
      const bridged = ysel.flags[i] & (FLAG.TIE | FLAG.BRIDGE);
      kn.push(bridged ? NaN : ysel.kn[i]);
      kg.push(ysel.kg[i]);
      sl.push(Math.abs(ysel.slip[i]));
    }
    const xr = { xMin: 0, xMax: L * 1e3 };
    this.kn.setData({ x: xs, y: { v: kn }, ...xr });
    this.kg.setData({ x: xs, y: { v: kg }, ...xr });
    this.slip.setData({ x: xs, y: { v: sl, mu: xs.map(() => c.friction) }, ...xr });

    // ── 4. Cover factor (from the mean braid angle of the + family) ──
    const axialCount = c.triaxial ? sim.machine.gearCount : 0;
    const cf = [], kk = [];
    zc.forEach((z, b) => {
      const a = acc.plus.mean[b];
      if (!Number.isFinite(a)) {
        cf.push(NaN);
        kk.push(NaN);
        return;
      }
      const res = coverFactor({
        carriers: c.carriers,
        width: c.yarnWidth,
        r: prof.evaluate(z).r,
        alpha: a,
        axialCount,
        axialWidth: c.axialWidth,
      });
      cf.push(res.cover);
      kk.push(res.k);
    });
    this.cover.setData({
      x: zc.map((z) => z * 1e3),
      y: { cf, k: kk, full: zc.map(() => 1) },
      ...xr,
    });
  }
}

/** Integer range [a, b). */
function range(a, b) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

/** Mean / min / max of |α| per z-bin over the given yarns (tie samples excluded). */
function binAbsAlpha(sim, ks, L) {
  const sum = new Float64Array(BINS), cnt = new Uint32Array(BINS);
  const mn = new Float64Array(BINS).fill(Infinity), mx = new Float64Array(BINS).fill(-Infinity);
  for (const k of ks) {
    const y = sim.yarns[k];
    for (let i = 0; i < y.count; i++) {
      if (y.flags[i] & FLAG.TIE) continue;
      const a = Math.abs(y.alpha[i]);
      if (!Number.isFinite(a)) continue;
      const b = Math.floor((y.zp[i] / L) * BINS);
      if (b < 0 || b >= BINS) continue;
      sum[b] += a;
      cnt[b]++;
      if (a < mn[b]) mn[b] = a;
      if (a > mx[b]) mx[b] = a;
    }
  }
  const mean = [], min = [], max = [];
  for (let b = 0; b < BINS; b++) {
    mean.push(cnt[b] ? sum[b] / cnt[b] : NaN);
    min.push(cnt[b] ? mn[b] : NaN);
    max.push(cnt[b] ? mx[b] : NaN);
  }
  return { mean, min, max };
}
