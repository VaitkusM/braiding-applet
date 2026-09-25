"""
Independent reference solution for the fell-point model on a CURVED, centred mandrel.

For a centred (on-axis) mandrel the Kessels & Akkerman fell-point model reduces to a scalar ODE
for the axial fell-point position z_F(t) of "+" yarn 0 (derivation in docs/THEORY.md):

    d  = z_G − z_F,                 z_G(t) = d0 + v t    (ring plane position on the mandrel axis)
    cos ψ = (r + r' d) / R_g,       θ_F = φ_G − ψ,       φ_G = ω t
    A  = r d / (R_g sin ψ)
    ż_F = A (ω + r' v / (R_g sin ψ)) / (1 − r r'' d² / (R_g² sin² ψ))

Before wrapping starts, the yarn is tied at (z_tie, θ = 0) and stays there until the free yarn
becomes tangent, i.e. until cos(ω t) = (r + r' d)/R_g at z_F = z_tie.

This script integrates that ODE with SciPy (rtol 1e-12) for the "taper" preset and writes
tests/fixtures/taper_scalar_ode.json, which tests/deposition.test.js compares against the general
3D solver in src/core/deposition.js. Re-run with:  python3 tests/fixtures/generate_fixtures.py
"""

import json
import math
import os

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq

# Must match TAPER_CASE in tests/deposition.test.js
CASE = dict(
    r0=0.03, r1=0.05, zStart=0.10, zEnd=0.35, length=0.6,
    ringRadius=0.12, omega=1.5, takeUp=0.03, tieZ=0.02, initialConvergence=0.05,
)


def smootherstep(x):
    if x <= 0:
        return 0.0, 0.0, 0.0
    if x >= 1:
        return 1.0, 0.0, 0.0
    return (x**3 * (10 - 15 * x + 6 * x * x),
            30 * x * x * (1 - x) ** 2,
            60 * x * (1 - x) * (1 - 2 * x))


def profile(z):
    c = CASE
    w = c["zEnd"] - c["zStart"]
    s, ds, d2s = smootherstep((z - c["zStart"]) / w)
    dr = c["r1"] - c["r0"]
    return c["r0"] + dr * s, dr * ds / w, dr * d2s / (w * w)


def main():
    c = CASE
    R, w, v = c["ringRadius"], c["omega"], c["takeUp"]
    d0 = c["tieZ"] + c["initialConvergence"]

    def zG(t):
        return d0 + v * t

    # Wrap start: first t > 0 with cos(ω t) = (r + r' d)/R at the tie point.
    def tangency(t):
        r, rp, _ = profile(c["tieZ"])
        return math.cos(w * t) - (r + rp * (zG(t) - c["tieZ"])) / R

    t_wrap = brentq(tangency, 1e-9, (math.pi / 2) / w)

    def psi_of(t, z):
        r, rp, _ = profile(z)
        return math.acos((r + rp * (zG(t) - z)) / R)

    def rhs(t, y):
        z = y[0]
        r, rp, rpp = profile(z)
        d = zG(t) - z
        psi = psi_of(t, z)
        sp = math.sin(psi)
        A = r * d / (R * sp)
        return [A * (w + rp * v / (R * sp)) / (1 - r * rpp * d * d / (R * R * sp * sp))]

    t_end = t_wrap + 14.0
    times = np.linspace(t_wrap + 0.5, t_end, 28)
    sol = solve_ivp(rhs, (t_wrap, t_end), [c["tieZ"]], method="DOP853",
                    rtol=1e-12, atol=1e-14, t_eval=times)
    assert sol.success, sol.message
    z = sol.y[0]
    theta = [w * t - psi_of(t, zz) for t, zz in zip(times, z)]
    out = dict(case=CASE, tWrap=t_wrap, t=times.tolist(), z=z.tolist(), theta=theta)
    path = os.path.join(os.path.dirname(__file__), "taper_scalar_ode.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path}: t_wrap = {t_wrap:.6f} s, z(t_end) = {z[-1]:.6f} m")


if __name__ == "__main__":
    main()
