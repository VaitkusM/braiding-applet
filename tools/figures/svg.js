/**
 * @file tools/figures/svg.js — a tiny SVG builder for the documentation figures (dev tool).
 *
 * Output is deterministic (coordinates rounded to 0.01 px) so regenerated figures only change when
 * the underlying computation changes. Every figure is drawn on an opaque light "paper" card, so it
 * reads the same in GitHub's light and dark themes and in the app's dark Theory tab.
 *
 * Text labels support a light markup for mathematical symbols: `x_y` or `x_{yz}` makes a subscript,
 * `x^y` / `x^{yz}` a superscript; with `math: true` single Latin letters (variables) are italic.
 */

/** Palette (the app's entity colours; neutral inks tuned for a white background). */
export const C = Object.freeze({
  paper: "#ffffff",
  border: "#d0d7de",
  ink: "#1f2328",
  muted: "#57606a",
  faint: "#8c959f",
  grid: "#eaeef2",
  mandrel: "#e7e9ec",
  mandrelEdge: "#8c959f",
  plus: "#d95926", // "+" yarn family (orange)
  minus: "#199e70", // "−" yarn family (aqua)
  quasiStatic: "#3987e5", // blue
  geodesic: "#c98500", // yellow
  critical: "#d03b3b",
  good: "#0ca30c",
  // Curvature-sign colours (the app's blue–green–red map, darkened for white paper).
  kNeg: "#1f3fd6",
  kZero: "#16a34a",
  kPos: "#d62828",
});

const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Rounds to 0.01 (deterministic, compact output). */
export const f = (x) => {
  if (!Number.isFinite(x)) throw new Error(`non-finite coordinate: ${x}`);
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Converts label markup into <tspan>s (sub/superscripts, optional italic Latin letters).
 * Shifts use `dy` (supported by every SVG renderer, unlike baseline-shift); every shifted run is
 * followed by a run that shifts back.
 */
function markup(label, math, size) {
  const runs = []; // [text, kind]
  let i = 0, buf = "";
  while (i < label.length) {
    const ch = label[i];
    if ((ch === "_" || ch === "^") && i + 1 < label.length) {
      if (buf) runs.push([buf, "base"]);
      buf = "";
      let run;
      if (label[i + 1] === "{") {
        const j = label.indexOf("}", i + 2);
        run = label.slice(i + 2, j);
        i = j + 1;
      } else {
        run = [...label.slice(i + 1)][0];
        i += 1 + run.length;
      }
      runs.push([run, ch === "_" ? "sub" : "sup"]);
    } else {
      buf += ch;
      i++;
    }
  }
  if (buf) runs.push([buf, "base"]);
  // Math mode: a SINGLE Latin letter (a variable) is italic; words ("tan", "mm", "CF") and
  // anything inside [unit brackets] stay upright.
  const isLatin = (c) => c !== undefined && /[A-Za-z]/.test(c);
  let bracket = 0;
  const body = (txt) => {
    const cs = [...txt];
    let html = "";
    cs.forEach((c, k) => {
      if (c === "[") bracket++;
      if (c === "]") bracket = Math.max(0, bracket - 1);
      const variable = math && bracket === 0 && isLatin(c) && !isLatin(cs[k - 1]) &&
        !isLatin(cs[k + 1]);
      html += variable ? `<tspan font-style="italic">${esc(c)}</tspan>` : esc(c);
    });
    return html;
  };
  const shift = { sub: 0.3 * size, sup: -0.4 * size, base: 0 };
  let cur = 0, out = "";
  for (const [txt, kind] of runs) {
    const dy = shift[kind] - cur;
    cur = shift[kind];
    const fs = kind === "base" ? "" : ` font-size="${f(0.75 * size)}"`;
    out += dy !== 0 || fs
      ? `<tspan${dy !== 0 ? ` dy="${f(dy)}"` : ""}${fs}>${body(txt)}</tspan>`
      : body(txt);
  }
  return out;
}

export class Svg {
  /**
   * @param {number} w @param {number} h size in px
   * @param {{title:string, desc:string}} meta accessible title and description
   */
  constructor(w, h, meta) {
    this.w = w;
    this.h = h;
    this.meta = meta;
    this.items = [];
    this.rect(0.5, 0.5, w - 1, h - 1, { fill: C.paper, stroke: C.border, rx: 8 });
  }

  /** Appends a raw element string. */
  raw(s) {
    this.items.push(s);
    return this;
  }

  /** Style attributes from an options object. */
  static style(o = {}) {
    const a = [];
    a.push(`fill="${o.fill ?? "none"}"`);
    if (o.stroke) a.push(`stroke="${o.stroke}"`);
    if (o.stroke) a.push(`stroke-width="${o.width ?? 1.5}"`);
    if (o.dash) a.push(`stroke-dasharray="${o.dash}"`);
    if (o.opacity !== undefined) a.push(`opacity="${o.opacity}"`);
    if (o.fillOpacity !== undefined) a.push(`fill-opacity="${o.fillOpacity}"`);
    if (o.cap) a.push(`stroke-linecap="${o.cap}"`);
    if (o.join) a.push(`stroke-linejoin="${o.join}"`);
    return a.join(" ");
  }

  rect(x, y, w, h, o = {}) {
    return this.raw(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${
        o.rx ? ` rx="${o.rx}"` : ""
      } ${Svg.style(o)}/>`,
    );
  }

  line(x1, y1, x2, y2, o = {}) {
    return this.raw(
      `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${
        Svg.style({ stroke: C.ink, cap: "round", ...o })
      }/>`,
    );
  }

  /** Polyline through [[x, y], …]; a NaN point breaks the line. */
  polyline(pts, o = {}) {
    const runs = [];
    let cur = [];
    for (const p of pts) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        if (cur.length > 1) runs.push(cur);
        cur = [];
      } else cur.push(p);
    }
    if (cur.length > 1) runs.push(cur);
    for (const r of runs) {
      this.raw(
        `<polyline points="${r.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" ${
          Svg.style({ stroke: C.ink, join: "round", cap: "round", ...o })
        }/>`,
      );
    }
    return this;
  }

  polygon(pts, o = {}) {
    return this.raw(
      `<polygon points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" ${Svg.style(o)}/>`,
    );
  }

  circle(cx, cy, r, o = {}) {
    return this.raw(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${Svg.style(o)}/>`);
  }

  /** Circular arc (screen angles in radians, counter-clockwise on screen = decreasing y). */
  arc(cx, cy, r, a0, a1, o = {}) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.05));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
    }
    return this.polyline(pts, o);
  }

  /** Arrow from (x1, y1) to (x2, y2) with a filled triangular head. */
  arrow(x1, y1, x2, y2, o = {}) {
    const color = o.color ?? C.ink, width = o.width ?? 1.5, head = o.head ?? 8;
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 1e-9) return this;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const bx = x2 - ux * head, by = y2 - uy * head;
    this.line(x1, y1, bx, by, { stroke: color, width, dash: o.dash });
    return this.polygon(
      [[x2, y2], [bx - uy * head * 0.45, by + ux * head * 0.45], [
        bx + uy * head * 0.45,
        by - ux * head * 0.45,
      ]],
      { fill: color },
    );
  }

  /** Double-headed dimension arrow with an optional label at its midpoint. */
  dimension(x1, y1, x2, y2, label, o = {}) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    this.arrow(mx, my, x1, y1, { ...o, head: 6, width: 1 });
    this.arrow(mx, my, x2, y2, { ...o, head: 6, width: 1 });
    if (label) {
      this.text(mx + (o.dx ?? 0), my + (o.dy ?? -6), label, {
        math: true,
        anchor: "middle",
        ...o.text,
      });
    }
    return this;
  }

  /**
   * Text label.
   * @param {{size?:number, anchor?:"start"|"middle"|"end", color?:string, weight?:number|string,
   *          math?:boolean, italic?:boolean, halo?:boolean}} [o]
   */
  text(x, y, label, o = {}) {
    const size = o.size ?? 13, anchor = o.anchor ?? "start", color = o.color ?? C.ink;
    const attrs =
      `x="${f(x)}" y="${f(y)}" font-family="${FONT}" font-size="${size}" text-anchor="${anchor}"` +
      (o.weight ? ` font-weight="${o.weight}"` : "") + (o.italic ? ` font-style="italic"` : "");
    const body = markup(String(label), !!o.math, size);
    if (o.halo !== false) {
      this.raw(
        `<text ${attrs} fill="${C.paper}" stroke="${C.paper}" stroke-width="3.5" stroke-linejoin="round">${body}</text>`,
      );
    }
    return this.raw(`<text ${attrs} fill="${color}">${body}</text>`);
  }

  /** Right-angle marker at corner (x, y) between unit directions u and v (screen coordinates). */
  rightAngle(x, y, u, v, s = 9, o = {}) {
    return this.polyline(
      [[x + u[0] * s, y + u[1] * s], [x + (u[0] + v[0]) * s, y + (u[1] + v[1]) * s], [
        x + v[0] * s,
        y + v[1] * s,
      ]],
      { stroke: o.stroke ?? C.ink, width: 1 },
    );
  }

  toString() {
    const t = esc(this.meta.title), d = esc(this.meta.desc);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" role="img" aria-labelledby="t d">\n` +
      `<title id="t">${t}</title>\n<desc id="d">${d}</desc>\n${this.items.join("\n")}\n</svg>\n`;
  }
}

/**
 * Plot area with linear axes. Returns mapping functions and draws a hairline grid, tick labels and
 * axis titles.
 * @param {Svg} s
 * @param {{x:number, y:number, w:number, h:number, xDomain:[number,number], yDomain:[number,number],
 *          xTicks:number[], yTicks:number[], xLabel:string, yLabel:string, xFmt?:Function, yFmt?:Function}} o
 */
export function axes(s, o) {
  const X = (v) => o.x + ((v - o.xDomain[0]) / (o.xDomain[1] - o.xDomain[0])) * o.w;
  const Y = (v) => o.y + o.h - ((v - o.yDomain[0]) / (o.yDomain[1] - o.yDomain[0])) * o.h;
  const num = (v) => String(v).replace("-", "−"); // true minus sign
  const xf = o.xFmt ?? num, yf = o.yFmt ?? num;
  for (const t of o.yTicks) {
    s.line(o.x, Y(t), o.x + o.w, Y(t), { stroke: C.grid, width: 1, cap: "butt" });
    s.text(o.x - 6, Y(t) + 4, yf(t), { size: 11, anchor: "end", color: C.muted, halo: false });
  }
  for (const t of o.xTicks) {
    s.line(X(t), o.y + o.h, X(t), o.y + o.h + 4, { stroke: C.faint, width: 1 });
    s.text(X(t), o.y + o.h + 17, xf(t), {
      size: 11,
      anchor: "middle",
      color: C.muted,
      halo: false,
    });
  }
  s.line(o.x, o.y + o.h, o.x + o.w, o.y + o.h, { stroke: C.faint, width: 1, cap: "butt" });
  s.text(o.x + o.w, o.y + o.h + 32, o.xLabel, {
    size: 12,
    anchor: "end",
    color: C.muted,
    math: true,
  });
  s.text(o.x, o.y - 8, o.yLabel, { size: 12, anchor: "start", color: C.muted, math: true });
  return { X, Y };
}
