/**
 * @file machine.js — kinematics of an idealised circular (maypole) braiding machine.
 *
 * Carriers. N carriers, N/2 per family, rotating about the machine axis (+z) at the carrier
 * revolution rate ω [rad/s] (NOT the horn-gear speed):
 *     "+" family:  φ₊ⱼ(t) = jΔ + ωt,           j = 0 … N/2−1
 *     "−" family:  φ₋ᵢ(t) = iΔ + Δ/2 − ωt,     i = 0 … N/2−1,          Δ = 4π/N.
 * Each yarn leaves its carrier and passes through the guide ring (radius R_g, plane z = 0). The
 * deposition model uses the idealised guide point G = R_g (cos φ, sin φ, 0).
 *
 * Passings. Carriers +j and −i have the same azimuth whenever 2ωt = (i−j)Δ + Δ/2 + 2πp, i.e. every
 * π/ω seconds, at the azimuths (2π/N)(k + ½): N fixed passing points on the track.
 *
 * Horn gears and interlacing (pattern m/m: diamond m = 1, regular m = 2, Hercules m = 3). Requires
 * 2m | N. There are N/m gears; gear q spans the azimuth interval [qΔ_g, (q+1)Δ_g) with pitch
 * Δ_g = 2πm/N, centre c_q = Δ_g (q + ½) and side sign σ_q = (−1)^q. Adjacent gears touch at the
 * azimuths qΔ_g = (2π/N)·mq — integer multiples of 2π/N — which never coincide with passing points,
 * so carriers can never collide at a tangency point. A "+" carrier runs on the OUTER arc of gear q
 * when σ_q = +1 (inner arc otherwise); a "−" carrier does the opposite. Hence at every passing the
 * two carriers are on opposite sides; the OUTER carrier's yarn goes OVER. Each gear hosts m
 * passings, so every yarn goes over m, under m: the m/m pattern.
 *
 * Triaxial braids add one stationary axial yarn per horn gear, fed through the gear centre c_q.
 * A bias carrier passes an axial guide on its gear's side, so it lies over the axial yarn iff it is
 * on the outer arc there.
 */

import { wrap2Pi } from "./numeric.js";

/** Braid patterns: m = number of consecutive crossings a yarn goes over (then under). */
export const PATTERNS = Object.freeze({
  diamond: { m: 1, label: "Diamond (1/1)" },
  regular: { m: 2, label: "Regular (2/2)" },
  hercules: { m: 3, label: "Hercules (3/3)" },
});

/**
 * Carrier counts N ∈ [nMin, nMax] compatible with pattern m (2m | N) and N/2 ≥ 2.
 * @param {number} m @param {number} [nMin=8] @param {number} [nMax=144] @returns {number[]}
 */
export function allowedCarrierCounts(m, nMin = 8, nMax = 144) {
  const out = [];
  for (let N = nMin; N <= nMax; N += 2) if (N % (2 * m) === 0 && N >= 4) out.push(N);
  return out;
}

/** @typedef {import("./vec.js").Vec3} Vec3 */
/** Family sign: +1 for the "+" (counter-clockwise, φ increasing) family, −1 for "−". */
/** @typedef {1|-1} Family */

export class CircularBraider {
  /**
   * @param {{carriers:number, omega:number, ringRadius:number, m:number, trackRadius?:number}} p
   *   carriers N (even, 2m | N), omega ω [rad/s] (> 0), ringRadius R_g [m], m pattern,
   *   trackRadius R_t [m] (visual horn-gear circle; defaults to a value that fits the bobbins).
   */
  constructor(p) {
    const { carriers: N, m } = p;
    if (!(N >= 4) || N % (2 * m) !== 0) {
      throw new Error(`machine: ${N} carriers incompatible with pattern ${m}/${m} (need 2m | N)`);
    }
    if (!(p.omega > 0)) throw new Error("machine: omega must be > 0");
    this.N = N;
    this.m = m;
    this.omega = p.omega;
    this.ringRadius = p.ringRadius;
    /** Angular spacing of carriers within one family [rad]. */
    this.delta = (4 * Math.PI) / N;
    /** Horn-gear pitch (azimuth span of one gear) [rad]. */
    this.gearPitch = (2 * Math.PI * m) / N;
    this.gearCount = N / m;
    // Visual track radius: bobbins (≈ 22 mm incl. clearance) must not overlap; at least 1.7 R_g.
    this.trackRadius = p.trackRadius ??
      Math.max(1.7 * p.ringRadius, (N * 0.022) / (2 * Math.PI) * 2);
    /** Horn-gear pitch radius: adjacent gears touch, R_h = R_t sin(Δ_g/2). */
    this.gearRadius = this.trackRadius * Math.sin(this.gearPitch / 2);
  }

  /** Number of carriers per family. */
  get perFamily() {
    return this.N / 2;
  }

  /**
   * Carrier azimuth φ(t) [rad] (unwrapped).
   * @param {Family} family @param {number} j carrier index within the family @param {number} t [s]
   */
  carrierAngle(family, j, t) {
    return family === 1
      ? j * this.delta + this.omega * t
      : j * this.delta + this.delta / 2 - this.omega * t;
  }

  /** Guide point on the ring, machine frame [m]. @param {Family} family @param {number} j @param {number} t */
  guidePoint(family, j, t) {
    const phi = this.carrierAngle(family, j, t);
    return [this.ringRadius * Math.cos(phi), this.ringRadius * Math.sin(phi), 0];
  }

  /** Velocity of the guide point, machine frame [m/s]. */
  guideVelocity(family, j, t) {
    const phi = this.carrierAngle(family, j, t);
    const w = family * this.omega * this.ringRadius;
    return [-w * Math.sin(phi), w * Math.cos(phi), 0];
  }

  /** Index q of the horn gear whose azimuth span contains φ. */
  gearIndex(phi) {
    return Math.floor(wrap2Pi(phi) / this.gearPitch) % this.gearCount;
  }

  /** Centre azimuth c_q of gear q [rad]. */
  gearCenter(q) {
    return this.gearPitch * (q + 0.5);
  }

  /** Side sign σ_q = (−1)^q of gear q. */
  gearSign(q) {
    return q % 2 === 0 ? 1 : -1;
  }

  /**
   * +1 if a carrier of `family` located at azimuth φ runs on the OUTER arc of its gear, else −1.
   * @param {Family} family @param {number} phi
   */
  carrierSide(family, phi) {
    return family * this.gearSign(this.gearIndex(phi));
  }

  /**
   * Latest passing of carriers (+j, −i) at or before time t.
   * @param {number} j @param {number} i @param {number} t
   * @returns {{time:number, azimuth:number}} azimuth wrapped to [0, 2π)
   */
  latestPassing(j, i, t) {
    const base = (i - j) * this.delta + this.delta / 2;
    const p = Math.floor((2 * this.omega * t - base) / (2 * Math.PI));
    const time = (base + 2 * Math.PI * p) / (2 * this.omega);
    return { time, azimuth: wrap2Pi(this.carrierAngle(1, j, time)) };
  }

  /**
   * Over/under of the crossing between yarns (+j, −i) that forms on the mandrel at time tCross:
   * decided at the pair's most recent passing (the lag between passing and crossing is < π/ω
   * because the fell-point lag angle is < 90°). Returns +1 if the "+" yarn is OVER.
   * @param {number} j @param {number} i @param {number} tCross
   */
  crossingPlusOver(j, i, tCross) {
    return this.carrierSide(1, this.latestPassing(j, i, tCross).azimuth);
  }

  /**
   * +1 if a bias yarn of `family` lies OVER the axial yarn of gear q.
   * @param {Family} family @param {number} q
   */
  axialOver(family, q) {
    return family * this.gearSign(q);
  }

  /** Fixed guide point of axial yarn q (on the guide ring, at the gear-centre azimuth) [m]. */
  axialGuidePoint(q) {
    const c = this.gearCenter(q);
    return [this.ringRadius * Math.cos(c), this.ringRadius * Math.sin(c), 0];
  }

  /**
   * Visual position of a carrier on the figure-eight horn-gear track (in the track plane, [m]):
   * the carrier runs on the pitch circle of its current gear, on the outer or inner arc, moving
   * from one tangency point to the next while its mean azimuth advances uniformly.
   * @param {Family} family @param {number} j @param {number} t
   * @returns {[number, number]} (x, y)
   */
  carrierTrackXY(family, j, t) {
    const phi = wrap2Pi(this.carrierAngle(family, j, t));
    const q = this.gearIndex(phi);
    const c = this.gearCenter(q);
    const half = this.gearPitch / 2;
    const u = (phi - c) / half; // −1 … 1 across the gear
    const outer = this.carrierSide(family, phi) === 1;
    // Local angle ψ around the gear centre, measured from the outward radial direction.
    const psi = outer ? u * (Math.PI / 2 + half) : Math.PI - u * (Math.PI / 2 - half);
    const er = [Math.cos(c), Math.sin(c)], et = [-Math.sin(c), Math.cos(c)];
    const R = this.trackRadius, Rh = this.gearRadius;
    return [
      R * er[0] + Rh * (Math.cos(psi) * er[0] + Math.sin(psi) * et[0]),
      R * er[1] + Rh * (Math.cos(psi) * er[1] + Math.sin(psi) * et[1]),
    ];
  }
}
