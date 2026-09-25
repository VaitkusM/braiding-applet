/**
 * @file pose.js — placement and motion of the mandrel relative to the braiding machine.
 *
 * Machine frame (fixed): machine axis = z; the guide-ring plane is z = 0; the carriers rotate about
 * +z. The braid is formed DOWNSTREAM of the ring (z < 0, towards the take-up); the bare mandrel
 * arrives from upstream (z > 0).
 *
 * Mandrel frame (moves with the mandrel): axis z_M from the leading end (z_M = 0) to the trailing
 * end (z_M = length). Untilted and centred, the axes of both frames coincide in direction, so the
 * mandrel azimuth θ equals the machine azimuth φ.
 *
 * Pose: x_machine = R · x_M + c(t), where
 *   R = R_x(τ)                         tilt τ about the machine x axis,
 *   a = R · ẑ_M                        mandrel axis direction in the machine frame,
 *   c(t) = e − (d0 + v t) · a           e = (e_x, e_y, 0) the point where the axis pierces the ring
 *                                      plane, v the take-up speed, d0 the initial z_M at the ring.
 * The mandrel moves along its OWN axis (direction −a), so the axis always pierces the ring plane at
 * the same point e, at mandrel coordinate z_M = d0 + v t (see `ringAxisParam`).
 *
 * Note: only points FIXED in the machine (ring, axial-yarn guides) keep constant (x_M, y_M); the
 * rotating guide points move in all three mandrel coordinates.
 */

/** @typedef {import("./vec.js").Vec3} Vec3 */

export class MandrelPose {
  /**
   * @param {{offsetX?:number, offsetY?:number, tilt?:number, d0:number, v:number}} p
   *   offsetX/offsetY [m], tilt [rad], d0 [m] (mandrel z_M at the ring plane at t = 0), v [m/s].
   */
  constructor(p) {
    this.ex = p.offsetX ?? 0;
    this.ey = p.offsetY ?? 0;
    this.tilt = p.tilt ?? 0;
    this.d0 = p.d0;
    this.v = p.v;
    const c = Math.cos(this.tilt), s = Math.sin(this.tilt);
    /** Rotation matrix R (row-major 3×3). */
    this.R = [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
    /** Mandrel axis direction in the machine frame, a = R ẑ. */
    this.axis = [0, -s, c];
  }

  /** True when the mandrel axis coincides with the machine axis (rotational symmetry holds). */
  get isOnAxis() {
    return this.ex === 0 && this.ey === 0 && this.tilt === 0;
  }

  /** Mandrel coordinate z_M at which the axis pierces the ring plane at time t [m]. */
  ringAxisParam(t) {
    return this.d0 + this.v * t;
  }

  /** Machine-frame position of the mandrel-frame origin (leading end on the axis) at time t. */
  origin(t) {
    const d = this.d0 + this.v * t;
    return [this.ex - d * this.axis[0], this.ey - d * this.axis[1], -d * this.axis[2]];
  }

  /** R·u (mandrel → machine, vectors). @param {Vec3} u @returns {Vec3} */
  vectorToMachine(u) {
    const R = this.R;
    return [
      R[0][0] * u[0] + R[0][1] * u[1] + R[0][2] * u[2],
      R[1][0] * u[0] + R[1][1] * u[1] + R[1][2] * u[2],
      R[2][0] * u[0] + R[2][1] * u[1] + R[2][2] * u[2],
    ];
  }

  /** Rᵀ·u (machine → mandrel, vectors). @param {Vec3} u @returns {Vec3} */
  vectorToMandrel(u) {
    const R = this.R;
    return [
      R[0][0] * u[0] + R[1][0] * u[1] + R[2][0] * u[2],
      R[0][1] * u[0] + R[1][1] * u[1] + R[2][1] * u[2],
      R[0][2] * u[0] + R[1][2] * u[1] + R[2][2] * u[2],
    ];
  }

  /** Mandrel-frame point → machine frame at time t. @param {Vec3} xM @param {number} t */
  toMachine(xM, t) {
    const o = this.origin(t), u = this.vectorToMachine(xM);
    return [u[0] + o[0], u[1] + o[1], u[2] + o[2]];
  }

  /** Machine-frame point → mandrel frame at time t. @param {Vec3} x @param {number} t */
  toMandrel(x, t) {
    const o = this.origin(t);
    return this.vectorToMandrel([x[0] - o[0], x[1] - o[1], x[2] - o[2]]);
  }

  /**
   * Velocity of a machine-frame point (with machine-frame velocity u) RELATIVE to the mandrel,
   * expressed in the mandrel frame: ẋ_M = Rᵀ u + v ẑ_M (the machine drifts upstream, towards +z_M,
   * as seen from the mandrel).
   * @param {Vec3} u @returns {Vec3}
   */
  velocityToMandrel(u) {
    const w = this.vectorToMandrel(u);
    return [w[0], w[1], w[2] + this.v];
  }

  /**
   * Smallest guide-ring radius that clears the mandrel's cross-section in the ring plane:
   * the section of a tilted mandrel of radius r is an ellipse with semi-axes r and r / cos τ,
   * centred at the offset e.
   * @param {number} rMax largest mandrel radius [m] @returns {number} [m]
   */
  requiredRingRadius(rMax) {
    return Math.hypot(this.ex, this.ey) + rMax / Math.cos(this.tilt);
  }
}
