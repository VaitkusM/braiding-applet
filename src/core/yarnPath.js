/**
 * @file yarnPath.js — growable, typed-array storage for one deposited yarn.
 *
 * Every accepted solver step appends one SAMPLE: the new fell point and the local geometry /
 * mechanics evaluated there at the moment of deposition. Consecutive samples are joined by straight
 * segments (they are ≤ ~0.5 mm apart on the surface; a sample flagged BRIDGE ends a suspended
 * straight chord).
 *
 * Per-sample fields (all in the MANDREL frame, SI units):
 *   x, y, z      centre-line base point [m] (on the surface, or on a bridging chord)
 *   zp, th       surface parameters of the point (θ unwrapped) [m], [rad]
 *   tx, ty, tz   unit yarn tangent (direction of deposition)
 *   nx, ny, nz   outward surface normal at (zp, th)
 *   alpha        signed braid angle from the meridian [rad]
 *   kn, kg       normal / geodesic curvature of the deposited path [1/m] (kg = NaN if undefined)
 *   slip         slip ratio κ_g/κₙ (NaN if undefined)
 *   free         free-yarn length |G − F| at deposition [m]
 *   time, arc    deposition time [s], arc length along the yarn [m]
 *   flags        bit set of FLAG values
 */

/** Sample flags (bit mask). */
export const FLAG = Object.freeze({
  TIE: 1, // start-up tie point (not deposited by wrapping)
  BRIDGE: 2, // segment ending here is a suspended straight chord (non-convex region / obstacle)
  SLIP: 4, // |κ_g| > μ κₙ: friction cannot hold this path
  LIFTOFF: 8, // yarn lifted off the surface (free yarn no longer tangent) before this sample
  JAM: 16, // local cover k ≥ 1: yarns of one family would overlap (jamming)
  CONTACT: 32, // the free yarn caught on an obstacle (bulge) — fell point jumped forward
});

const F64_FIELDS = ["x", "y", "z", "zp", "th", "time", "arc"];
const F32_FIELDS = ["tx", "ty", "tz", "nx", "ny", "nz", "alpha", "kn", "kg", "slip", "free"];

export class YarnPath {
  /**
   * @param {{family:1|-1, index:number, kind?:"bias"|"axial"}} id  identity of the yarn
   * @param {number} [capacity=1024] initial capacity (grows by doubling)
   */
  constructor(id, capacity = 1024) {
    this.family = id.family;
    this.index = id.index;
    this.kind = id.kind ?? "bias";
    this.count = 0;
    this.capacity = capacity;
    for (const f of F64_FIELDS) this[f] = new Float64Array(capacity);
    for (const f of F32_FIELDS) this[f] = new Float32Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  /** Doubles the capacity, preserving contents. */
  grow() {
    const cap = this.capacity * 2;
    for (const f of [...F64_FIELDS, ...F32_FIELDS, "flags"]) {
      const old = this[f];
      const nu = new old.constructor(cap);
      nu.set(old);
      this[f] = nu;
    }
    this.capacity = cap;
  }

  /**
   * Appends a sample. Missing numeric fields default to NaN (flags to 0); `arc` is computed
   * automatically from the previous base point.
   * @param {Object} s  fields as documented above (p: [x,y,z], t: [..], n: [..] accepted as arrays)
   */
  push(s) {
    if (this.count === this.capacity) this.grow();
    const i = this.count;
    this.x[i] = s.p[0];
    this.y[i] = s.p[1];
    this.z[i] = s.p[2];
    this.zp[i] = s.zp;
    this.th[i] = s.th;
    this.time[i] = s.time;
    this.tx[i] = s.t[0];
    this.ty[i] = s.t[1];
    this.tz[i] = s.t[2];
    this.nx[i] = s.n[0];
    this.ny[i] = s.n[1];
    this.nz[i] = s.n[2];
    this.alpha[i] = s.alpha ?? NaN;
    this.kn[i] = s.kn ?? NaN;
    this.kg[i] = s.kg ?? NaN;
    this.slip[i] = s.slip ?? NaN;
    this.free[i] = s.free ?? NaN;
    this.flags[i] = s.flags ?? 0;
    this.arc[i] = i === 0 ? 0 : this.arc[i - 1] +
      Math.hypot(s.p[0] - this.x[i - 1], s.p[1] - this.y[i - 1], s.p[2] - this.z[i - 1]);
    this.count++;
  }

  /** Copies sample i into a plain object (convenient for tests / UI read-outs). */
  get(i) {
    const o = { i };
    for (const f of [...F64_FIELDS, ...F32_FIELDS, "flags"]) o[f] = this[f][i];
    return o;
  }

  /** Base point of sample i as [x, y, z]. */
  point(i) {
    return [this.x[i], this.y[i], this.z[i]];
  }

  /** The most recent sample index, or −1 if empty. */
  get last() {
    return this.count - 1;
  }
}
