/**
 * @file crossings.js — interlacing: where yarns of the two families cross on the mandrel, which one
 * lies on top, and the resulting undulation (out-of-surface height) along every yarn.
 *
 * Detection. Deposited yarns are polylines in the (z, θ) chart of the mandrel (θ periodic). Every
 * new segment of a bias yarn is tested against the segments of the OPPOSITE family stored in a
 * uniform spatial hash (cells of size cellZ × cellTh, θ wrapped). A crossing is recorded once, when
 * the second of the two segments arrives. Segment parameters are half-open (0, 1] so that a crossing
 * exactly at a shared polyline vertex is counted once.
 *
 * Over/under. For the pair (+j, −i) crossing at time t_c (the later deposition time of the two
 * points), the machine decides: the carrier on the OUTER arc at the pair's most recent passing lays
 * its yarn over (machine.crossingPlusOver). Bias–axial crossings (triaxial braids): the bias
 * carrier's side at the axial yarn's gear decides (machine.axialOver).
 *
 * Undulation. Each yarn stores its crossing events (arc position s_k, sign σ_k = +1 over / −1 under)
 * sorted by s. The smoothed side function σ̃(s) equals σ_k at every crossing (so the two yarns at a
 * crossing always get opposite heights) and blends with a half-cosine between consecutive crossings
 * of different sign. The renderer places the yarn centre-line at height t_y·(c + a·σ̃(s)).
 */

/** @typedef {import("./yarnPath.js").YarnPath} YarnPath */
/** @typedef {import("./machine.js").CircularBraider} CircularBraider */

const TWO_PI = 2 * Math.PI;

/** Per-yarn sorted list of crossing events. */
export class CrossingEvents {
  constructor() {
    /** @type {number[]} arc positions [m] (sorted ascending) */
    this.s = [];
    /** @type {number[]} +1 over / −1 under */
    this.sign = [];
    /** Smallest arc position touched since the last `takeDirty()` (Infinity if none). */
    this.dirtyFrom = Infinity;
  }

  /** Inserts an event keeping the list sorted by s. */
  add(s, sign) {
    let i = this.s.length;
    while (i > 0 && this.s[i - 1] > s) i--;
    this.s.splice(i, 0, s);
    this.sign.splice(i, 0, sign);
    // Heights change from the previous event onwards.
    const from = i > 0 ? this.s[i - 1] : 0;
    if (from < this.dirtyFrom) this.dirtyFrom = from;
  }

  /** Returns and resets the dirty arc position. */
  takeDirty() {
    const d = this.dirtyFrom;
    this.dirtyFrom = Infinity;
    return d;
  }

  /**
   * Smoothed side σ̃(s) ∈ [−1, 1]: exactly σ_k at crossing k, constant before the first and after
   * the last crossing, half-cosine blend between crossings of different sign. 0 if no crossings.
   * @param {number} s arc position [m]
   */
  sideAt(s) {
    const S = this.s, n = S.length;
    if (n === 0) return 0;
    if (s <= S[0]) return this.sign[0];
    if (s >= S[n - 1]) return this.sign[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.sign[lo], b = this.sign[hi];
    if (a === b) return a;
    const u = (s - S[lo]) / (S[hi] - S[lo]);
    return a + (b - a) * 0.5 * (1 - Math.cos(Math.PI * u));
  }
}

export class CrossingTracker {
  /**
   * @param {{machine:CircularBraider, plus:YarnPath[], minus:YarnPath[],
   *          axial?:{q:number, th:number}[], cellZ?:number, cellTh?:number, keepTime?:number}} p
   *   plus/minus: bias yarns of each family (YarnPath.index = carrier index within the family);
   *   axial: axial yarns (gear index q, fixed mandrel azimuth th);
   *   keepTime: segments older than this (sim time) are pruned from the hash [s].
   */
  constructor(p) {
    this.machine = p.machine;
    this.yarns = [...p.plus, ...p.minus];
    this.nPlus = p.plus.length;
    this.axial = (p.axial ?? []).map((a) => ({ q: a.q, th: ((a.th % TWO_PI) + TWO_PI) % TWO_PI }));
    this.cellZ = p.cellZ ?? 2e-3;
    this.nTh = Math.max(16, Math.round(TWO_PI / (p.cellTh ?? TWO_PI / 256)));
    this.cellTh = TWO_PI / this.nTh;
    this.keepTime = p.keepTime ?? TWO_PI / this.machine.omega;
    /** @type {Map<number, object[]>} */
    this.grid = new Map();
    /** Next sample index whose incoming segment has not been processed yet, per yarn. */
    this.cursor = this.yarns.map(() => 1);
    /** Crossing events per yarn (same order as this.yarns). */
    this.events = this.yarns.map(() => new CrossingEvents());
    this.count = 0;
  }

  /** Family of yarn k: +1 or −1. */
  familyOf(k) {
    return k < this.nPlus ? 1 : -1;
  }

  /** Processes all segments appended since the previous call. @param {number} now sim time [s] */
  update(now) {
    for (let k = 0; k < this.yarns.length; k++) {
      const y = this.yarns[k];
      for (let i = this.cursor[k]; i < y.count; i++) this.processSegment(k, i, now);
      this.cursor[k] = Math.max(this.cursor[k], y.count);
    }
    // Cells behind the fell line are never visited again, so lazy pruning alone would keep every
    // segment ever deposited: sweep the whole hash every half keep-time.
    if (now >= (this.nextSweep ?? 0)) {
      this.nextSweep = now + this.keepTime / 2;
      this.prune(now);
    }
  }

  /** Removes segments older than keepTime (and empty cells) from the hash. */
  prune(now) {
    const limit = now - this.keepTime;
    for (const [key, list] of this.grid) {
      let w = 0;
      for (let r = 0; r < list.length; r++) if (list[r].tmax >= limit) list[w++] = list[r];
      list.length = w;
      if (w === 0) this.grid.delete(key);
    }
  }

  /** Number of segments currently stored in the hash (diagnostics / tests). */
  get storedSegments() {
    let n = 0;
    for (const list of this.grid.values()) n += list.length;
    return n;
  }

  /** Segment from sample i−1 to i of yarn k: test against the opposite family, then insert. */
  processSegment(k, i, now) {
    const y = this.yarns[k];
    const z0 = y.zp[i - 1], z1 = y.zp[i];
    const t0raw = y.th[i - 1];
    const th0 = ((t0raw % TWO_PI) + TWO_PI) % TWO_PI;
    const th1 = th0 + (y.th[i] - t0raw);
    const seg = { k, i, z0, th0, z1, th1, tmax: Math.max(y.time[i - 1], y.time[i]) };
    const fam = this.familyOf(k);
    const cells = this.cellsOf(seg);

    const seen = new Set();
    for (const key of cells) {
      const list = this.grid.get(key);
      if (!list) continue;
      for (let n = list.length - 1; n >= 0; n--) {
        const o = list[n];
        if (o.tmax < now - this.keepTime) {
          list.splice(n, 1); // prune old segments lazily
          continue;
        }
        if (this.familyOf(o.k) === fam || seen.has(o)) continue;
        seen.add(o);
        this.testPair(seg, o);
      }
    }
    for (const key of cells) {
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, list = []);
      list.push(seg);
    }
    if (this.axial.length) this.testAxial(seg, fam);
  }

  /** Hash keys of the cells covered by the segment's bounding box (θ wrapped). */
  cellsOf(seg) {
    const keys = [];
    const iz0 = Math.floor(Math.min(seg.z0, seg.z1) / this.cellZ);
    const iz1 = Math.floor(Math.max(seg.z0, seg.z1) / this.cellZ);
    const it0 = Math.floor(Math.min(seg.th0, seg.th1) / this.cellTh);
    const it1 = Math.floor(Math.max(seg.th0, seg.th1) / this.cellTh);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let it = it0; it <= Math.min(it1, it0 + this.nTh - 1); it++) {
        keys.push(iz * this.nTh + (((it % this.nTh) + this.nTh) % this.nTh));
      }
    }
    return keys;
  }

  /** Chart intersection of segments a (new) and b (stored, opposite family). */
  testPair(a, b) {
    // Bring b to the θ branch nearest to a.
    const shift = TWO_PI * Math.round(((a.th0 + a.th1) - (b.th0 + b.th1)) / (2 * TWO_PI));
    const bt0 = b.th0 + shift, bt1 = b.th1 + shift;
    const ax = a.z1 - a.z0, ay = a.th1 - a.th0;
    const bx = b.z1 - b.z0, by = bt1 - bt0;
    const den = ax * by - ay * bx;
    if (den === 0) return;
    const cx = b.z0 - a.z0, cy = bt0 - a.th0;
    const u = (cx * by - cy * bx) / den; // along a
    const w = (cx * ay - cy * ax) / den; // along b
    if (!(u > 0 && u <= 1 && w > 0 && w <= 1)) return;

    const [pk, mk, up, um] = this.familyOf(a.k) === 1 ? [a, b, u, w] : [b, a, w, u];
    const P = this.yarns[pk.k], M = this.yarns[mk.k];
    const sP = P.arc[pk.i - 1] + up * (P.arc[pk.i] - P.arc[pk.i - 1]);
    const sM = M.arc[mk.i - 1] + um * (M.arc[mk.i] - M.arc[mk.i - 1]);
    const tP = P.time[pk.i - 1] + up * (P.time[pk.i] - P.time[pk.i - 1]);
    const tM = M.time[mk.i - 1] + um * (M.time[mk.i] - M.time[mk.i - 1]);
    const plusOver = this.machine.crossingPlusOver(P.index, M.index, Math.max(tP, tM));
    this.events[pk.k].add(sP, plusOver);
    this.events[mk.k].add(sM, -plusOver);
    this.count++;
  }

  /** Crossings of a bias segment with the (meridian) axial yarns θ = θ_a (mod 2π). */
  testAxial(seg, fam) {
    const lo = Math.min(seg.th0, seg.th1), hi = Math.max(seg.th0, seg.th1);
    const dth = seg.th1 - seg.th0;
    if (dth === 0) return;
    const y = this.yarns[seg.k];
    for (const a of this.axial) {
      for (let th = a.th + TWO_PI * Math.ceil((lo - a.th) / TWO_PI); th <= hi; th += TWO_PI) {
        const u = (th - seg.th0) / dth;
        if (!(u > 0 && u <= 1)) continue;
        const s = y.arc[seg.i - 1] + u * (y.arc[seg.i] - y.arc[seg.i - 1]);
        this.events[seg.k].add(s, this.machine.axialOver(fam, a.q));
      }
    }
  }
}
