# Theory: circular braiding onto a mandrel

This document derives everything the applet computes. Section numbers are referenced from the code
comments. Symbols: $N$ carriers, $\omega$ carrier revolution rate, $v$ take-up speed, $R_g$
guide-ring radius, $r(z)$ mandrel profile, $h$ convergence length, $\alpha$ braid angle, $w$ yarn
width, $T$ yarn tension, $\mu$ yarn–mandrel friction coefficient.

## 1. Conventions

This block is repeated verbatim in `src/core/surface.js`.

- **Machine frame** (fixed): machine axis $z$, guide-ring plane $z=0$. Carriers revolve about $+z$.
  The braid forms downstream ($z<0$, towards the take-up). $\omega$ is the carriers' revolution rate
  about the machine axis, not the horn-gear speed.
- **Mandrel frame** (moves with the mandrel): axis $z_M$, measured from the leading end (braided
  first). The mandrel is a surface of revolution
  $$S(z,\theta)=(r\cos\theta,\ r\sin\theta,\ z),\qquad S_z=(r'\cos\theta,\ r'\sin\theta,\ 1),\qquad S_\theta=(-r\sin\theta,\ r\cos\theta,\ 0).$$
- **Outward unit normal** $n=\dfrac{S_\theta\times S_z}{|S_\theta\times S_z|}=\dfrac{(\cos\theta,\ \sin\theta,\ -r')}{\sqrt{1+r'^2}}$.
  The chart $(z,\theta)$ is therefore _left-handed_ with respect to $n$.
- **First fundamental form**: $g_{zz}=1+r'^2$, $g_{z\theta}=0$, $g_{\theta\theta}=r^2$.
- **Second fundamental form** with respect to the outward $n$ ($\mathrm{II}_{ij}=S_{ij}\cdot n$):
  $ii_{zz}=r''/\sqrt{1+r'^2}$, $ii_{z\theta}=0$, $ii_{\theta\theta}=-r/\sqrt{1+r'^2}$.
- **Curvatures are convex-positive**: a convex body has positive curvatures.
  $$\kappa_n(t)=-\frac{\mathrm{II}(t,t)}{\mathrm{I}(t,t)},\quad k_m=-\frac{r''}{(1+r'^2)^{3/2}},\quad k_p=\frac{1}{r\sqrt{1+r'^2}},\quad K=k_mk_p=-\frac{r''}{r(1+r'^2)^2},\quad H=\tfrac12(k_m+k_p).$$
- **Braid angle** $\alpha$: signed angle in the tangent plane from the meridian $m=S_z/|S_z|$ towards
  the parallel $e=S_\theta/|S_\theta|$, i.e. $\alpha=\operatorname{atan2}(t\cdot e,\ t\cdot m)$. On a
  cylinder this is the usual angle to the axis. On sloped profiles the angle to the machine axis is
  different: $\cos\alpha_{3D}=\cos\alpha/\sqrt{1+r'^2}$.
- **Darboux frame** of a curve on the surface: $(t,n,b)$ with $b=n\times t$, and
  $t'=\kappa_g\,b-\kappa_n\,n$ (with $\kappa_n$ convex-positive).
- The code writes `g_zz, g_tt, ii_zz, ii_tt` instead of $E,F,G,L,M,N$. Those letters would clash with
  the guide point $G$, the free length $L$ and the carrier count $N$.

## 2. Machine kinematics

Carriers of the two families (half each) move with uniform angular speed:
$$\varphi_{+,j}(t)=j\Delta+\omega t,\qquad \varphi_{-,i}(t)=i\Delta+\tfrac{\Delta}{2}-\omega t,\qquad \Delta=\frac{4\pi}{N}.$$

The deposition model uses the idealised guide point $G=R_g(\cos\varphi,\sin\varphi,0)$ of each
yarn on the guide ring. Carrier $+j$ and carrier $-i$ are at the same azimuth ("pass") when
$2\omega t=(i-j)\Delta+\Delta/2+2\pi p$. This happens every $\pi/\omega$ seconds, at the azimuths
$\frac{2\pi}{N}(k+\frac12)$. These are $N$ fixed passing points.

**Horn gears and interlacing** (pattern $m/m$: diamond $m=1$, regular $m=2$, Hercules $m=3$):

- There are $N/m$ gears. Gear $q$ covers the azimuths $[q\Delta_g,(q+1)\Delta_g)$, where
  $\Delta_g=2\pi m/N$. Its centre is $c_q=\Delta_g(q+\frac12)$ and its side sign is $\sigma_q=(-1)^q$.
- A "+" carrier runs on the outer arc of gear $q$ when $\sigma_q=+1$. A "−" carrier does the
  opposite. The yarn of the outer carrier goes **over**.
- Adjacent gears touch at the azimuths $\frac{2\pi}{N}mq$. These are integer multiples of
  $2\pi/N$, so they never coincide with the passing points (half-integer multiples). Consequences:
  - carriers cannot collide at a tangency point;
  - every passing happens strictly inside one gear, with the two carriers on opposite sides.
- Each gear contains $m$ passing points, so every yarn goes over $m$ and under $m$ crossings.
- The sides alternate around the circle, so the number of gears $N/m$ must be even: $2m\mid N$.
- The visual track uses the pitch circles of radius $R_h=R_t\sin(\pi m/N)$ (adjacent gears touch).
  Carriers follow the outer or inner arc from one tangency point to the next. This gives the
  figure-eight path.
- Triaxial braids feed one stationary axial yarn through each gear centre. A bias carrier passes it
  on its own side of the gear, so it lies over the axial yarn iff it runs on the outer arc there.

## 3. Mandrel pose and relative motion

$$x_{\rm machine}=R\,x_M+c(t),\qquad R=R_x(\tau),\qquad a=R\hat z_M,\qquad c(t)=e-(d_0+vt)\,a,$$

where $\tau$ is the tilt about the machine $x$ axis and $e=(e_x,e_y,0)$ the offset. The mandrel
moves along its own axis. Hence the axis pierces the ring plane always at $e$, at the mandrel
coordinate $z_M=d_0+vt$. A machine point with velocity $u$ moves relative to the mandrel with
$$\dot x_M=R^{\mathsf T}u+v\,\hat z_M.$$

Only points fixed in the machine (the ring, the axial guides) keep constant $x_M,y_M$. Guide-ring
clearance: the ring-plane section of a tilted mandrel is an ellipse with semi-axes $r$ and
$r/\cos\tau$, centred at $e$. This requires $R_g>|e|+r_{\max}/\cos\tau$.

## 4. The fell-point model

This is the model of Kessels & Akkerman (2002), solved with unilateral contact:

- the free yarn is a straight segment from $G$ to the fell point $F$;
- deposited yarn sticks to the mandrel;
- there is no friction before contact.

### 4.1 Unilateral contact

Define the contact function $g=(G-F)\cdot n(F)$.

- If $g>0$, the free yarn leaves the surface outwards and $F$ stays put. This is the tie ring at
  start-up, or a lift-off.
- If $G$ moves so that $g$ would become negative, the straight yarn would cut into the mandrel. The
  yarn wraps instead: $F$ advances along the free-yarn direction $t=(G-F)/L$, $L=|G-F|$, until
  $g=0$ again.

With $g=0$ the free yarn is tangent at $F$: $t$ lies in the tangent plane.

### 4.2 Fell-point speed

Let $F$ move with $\dot F=\lambda t$. Differentiate $g=0$, using $\dot F\cdot n=0$,
$\dot n=dn(\dot F)=\lambda\,dn(t)$ and $t\cdot dn(t)=\kappa_n$ (convex-positive, Section 1;
e.g. $dn(t)=t/\rho$ on a sphere of radius $\rho$):
$$0=\dot G\cdot n+(G-F)\cdot\dot n=\dot G\cdot n+\lambda L\,\kappa_n
\quad\Longrightarrow\quad \lambda=-\frac{\dot G\cdot n}{L\,\kappa_n}.$$

The fell point advances ($\lambda>0$) when the guide point moves "into" the tangent plane
($\dot G\cdot n<0$) and the surface is convex along the yarn ($\kappa_n>0$).

### 4.3 Geometry of the deposited curve (closed forms)

$$\dot t=\frac{\dot G-\dot F}{L}-t\,\frac{\dot L}{L}=\frac{\dot G-t\,(t\cdot\dot G)}{L}
\qquad(\dot F\parallel t\text{ cancels}).$$

Arc length $s$ along the deposited curve satisfies $ds=\lambda\,dt$. Hence $t'=\dot t/\lambda$, and
the Darboux decomposition $t'=\kappa_g b-\kappa_n n$ gives
$$\kappa_g=\frac{\dot G\cdot b}{\lambda L},\qquad \kappa_n=-\frac{\dot G\cdot n}{\lambda L},\qquad
\boxed{\ \frac{\kappa_g}{\kappa_n}=-\frac{\dot G\cdot b}{\dot G\cdot n}\ }.$$

The $\kappa_n$ from the deposited curve equals the surface normal curvature along $t$, consistent
with Section 4.2. The slip tendency of the laid yarn therefore depends only on the **direction** of
the guide point's relative velocity, expressed in the Darboux frame at the fell point. The code
stores these closed forms for every sample. `tests/deposition.test.js` checks them against finite
differences of the deposited polyline.

### 4.4 Numerical scheme

The scheme lives in `src/core/deposition.js`. Per time step, with $G\leftarrow G(t_{n+1})$, it is a
second-order Heun scheme in the chart:

1. **Predictor**: from $F_n$, move along the chart line in direction $d_n=t(F_n,G_n)$ until
   $g(\cdot;G_{n+1})=0$. This gives $F^*$.
2. **Corrector**: from $F_n$, move along $\tfrac12\bigl(d_n+t(F^*,G_{n+1})\bigr)$ until $g=0$.
   This gives $F_{n+1}$.

Each "move until $g=0$" is a bracketed root search followed by Brent's method:

- The search looks for the _first_ sign change of $g$ along the line. On convex parts it starts from
  $1.5\times$ the linear prediction $-g_0/g'(0)$, with $g'(0)=(G-F)\cdot dn/ds$. In the
  non-convex bridging mode it marches in small steps.
- It is position-based, so it never divides by $\kappa_n$.
- Tolerance: $|g|\le10^{-9}$ m.

Step size: $\Delta t=\min\bigl(\Delta\varphi_{\max}/\omega,\ \Delta s_{\max}/\sqrt{\omega^2r_{\max}^2+v^2(1+r'^2_{\max})}\bigr)$,
with defaults 0.5° and 0.5 mm. The step shrinks adaptively when the yarn direction turns more than 1°
per step.

### 4.5 Non-convex regions and obstacles

- **Concave stretch.** If $\kappa_n\le0$ along the yarn (e.g. a waist, $K<0$), a straight tensioned
  yarn cannot follow the surface. The root search then finds the first point ahead where the free
  yarn touches tangentially. The yarn in between is stored as a suspended straight chord, flagged
  BRIDGE.
- **Obstacle interference.** Independently, the whole free yarn is tested for interference with the
  mandrel, e.g. a bulge rising into it. If it cuts the surface, the yarn catches on the obstacle:
  - the fell point jumps to the tangency point near the deepest penetration;
  - the stretch from the old fell point is a straight chord, flagged BRIDGE and CONTACT;
  - this is exactly the old free segment, which is straight.
- **Validity.** The tangential lift-off idealisation is valid where $\kappa_n>0$. The chords are an
  approximation, flagged so that they are never mistaken for surface-following paths.

### 4.6 On-axis reduction (independent reference)

For a centred mandrel, write $d=z_G-z_F$ with $z_G=d_0+vt$ (the ring position on the axis), and let
$\psi=\varphi_G-\theta_F$ be the lag angle. The tangency condition reads
$R_g\cos\psi=r+r'd$. The fell point moves along $G-F$. Projected onto $S_z$ and $S_\theta$, and
using the tangency condition, this gives the chart direction $(\dot z,\dot\theta)\parallel\bigl(d,\ R_g\sin\psi/r\bigr)$.
Differentiating the tangency condition in time then yields the scalar ODE
$$\dot z_F=\frac{A\left(\omega+\dfrac{r'v}{R_g\sin\psi}\right)}{1-\dfrac{r\,r''d^2}{R_g^2\sin^2\psi}},\qquad A=\frac{r\,d}{R_g\sin\psi},\qquad \theta_F=\varphi_G-\psi.$$

The denominator is proportional to $\kappa_n$. `tests/fixtures/generate_fixtures.py` integrates this
ODE with SciPy (DOP853, rtol $10^{-12}$) for a curved taper mandrel. The general 3D solver agrees
with it to $10^{-9}$ m at 0.5 mm steps, with observed order 2.

## 5. Steady state and quasi-static reference

If the fell point were fixed in the machine frame (constant lag $\beta$ and convergence length $h$),
it would move over the mandrel with parallel speed $\omega r$ and meridian speed $v\sqrt{1+r'^2}$:
$$\tan\alpha_{qs}=\frac{\omega r}{v\sqrt{1+r'^2}}.$$

The exact relation on a centred mandrel is
$$\tan\alpha=\frac{r(\omega-\dot\beta)}{(v-\dot h)\sqrt{1+r'^2}}.$$

The quasi-static value is exact only when $\dot\beta=\dot h=0$. This is the classical
$\tan\alpha=\omega r/v$ on a cylinder (Ko 1987).

The quasi-static convergence length is the axial extent of the tangent line that leaves the surface
at angle $\alpha_{qs}$ and reaches the ring radius (a quadratic equation). On a cylinder the
projection of the free yarn onto the ring plane is tangent to the circle. This gives
$\cos\beta=r/R_g$, and
$$\tan\alpha=\frac{\sqrt{R_g^2-r^2}}{h},\qquad h_\infty=\frac{\sqrt{R_g^2-r^2}}{\tan\alpha}=\frac{v\sqrt{R_g^2-r^2}}{\omega r}$$

(van Ravenhorst & Akkerman 2016). The fell point moves axially over the mandrel at
$\omega r\cot\alpha$, so
$$\dot h=v-\frac{\omega r\,h}{\sqrt{R_g^2-r^2}}\quad\Rightarrow\quad h(t)=h_\infty+(h_0-h_\infty)\,e^{-\omega r t/\sqrt{R_g^2-r^2}},$$

which is the transient of Du & Popper (1994). On a changing radius the braid angle lags behind
$\alpha_{qs}$ with this time constant.

## 6. Surface geometry

The formulas are in Section 1. Principal directions are the meridian ($k_m$) and the parallel
($k_p$). Euler's formula gives the normal curvature along a yarn at braid angle $\alpha$:
$$\kappa_n(\alpha)=k_m\cos^2\alpha+k_p\sin^2\alpha.$$

- On a cylinder: $k_m=0$, $k_p=1/r$, $K=0$, so $\kappa_n=\sin^2\alpha/r$.
- On a waist ($r''>0$): $k_m<0$. Here $\kappa_n<0$ for $\tan^2\alpha<-k_m/k_p$, and the yarn
  bridges (Section 4.5).
- The applet colours the mandrel by $K$ or $H$ with a diverging scale centred at 0.

## 7. Geodesics

In the chart $(z,\theta)$, with arc length $s$:
$$z''+\Gamma^z_{zz}z'^2+\Gamma^z_{\theta\theta}\theta'^2=0,\qquad \theta''+2\Gamma^\theta_{z\theta}z'\theta'=0,$$

$$\Gamma^z_{zz}=\frac{r'r''}{1+r'^2},\qquad \Gamma^z_{\theta\theta}=-\frac{r\,r'}{1+r'^2},\qquad \Gamma^\theta_{z\theta}=\frac{r'}{r}.$$

Clairaut's relation $r^2\theta'=r\sin\alpha=c$ is a first integral. Along a geodesic
$\alpha_{geo}(z)=\arcsin(c/r(z))$, until the turning point $r=c$. `src/core/geodesic.js` integrates the ODE with RK4.
The tests check the conservation of $c$ ($10^{-8}$ on analytic profiles, $10^{-6}$ on splines)
and planarity of great circles on a sphere zone. A tensioned yarn on a _frictionless_ mandrel
would follow a geodesic. The applet draws the geodesic leaving the selected fell point in the
yarn's current direction.

## 8. Yarn mechanics

A flexible yarn with tension $T(s)$ is loaded by the surface with a force per unit length
$f=f_n n+f_b b+f_t t$. Equilibrium $\frac{d}{ds}(T\,t)+f=0$ with $t'=\kappa_gb-\kappa_nn$ gives
$$f_n=T\kappa_n,\qquad f_b=-T\kappa_g,\qquad f_t=-T'.$$

The normal line load is $p=T\kappa_n$. It must be positive (compression), which again requires
$\kappa_n>0$. With Coulomb friction and constant tension the yarn does not slip sideways iff
$$|\kappa_g|\le\mu\,\kappa_n$$

(Akkerman & Villa Rodríguez 2007). In filament winding the ratio $\lambda=\kappa_g/\kappa_n$ is
called the slippage coefficient (Wang et al. 2011). Samples violating the criterion are flagged
SLIP; the model does not let them slide.

## 9. Coverage and jamming

With $N/2$ yarns per direction of width $w$, adjacent parallel yarns are $2\pi r/(N/2)$ apart
along a parallel. That is $\frac{4\pi r}{N}\cos\alpha$ perpendicular to the yarns. Therefore:
$$k=\frac{Nw}{4\pi r\cos\alpha},\qquad CF=1-(1-k)^2\ (k\le1),\qquad \alpha_{jam}=\arccos\frac{Nw}{4\pi r}.$$

With $n_a$ axial yarns of width $w_a$: $k_a=n_aw_a/(2\pi r)$ and $CF=1-(1-k)^2(1-k_a)$.

- At $k=1$ the yarns of one family touch, and the braid cannot tighten further: it jams.
- If $Nw/(4\pi r)\ge1$ the braid is jammed at every angle.
- This is the flat-strip ideal. Round yarns jam earlier (max $CF\approx0.82$, Zhang et al. 1997).
- The model flags JAM but does not include yarn–yarn contact.

## 10. Interlacing and undulation

**Detecting crossings.** Crossings are found in the $(z,\theta)$ chart of the mandrel with a
spatial hash (`src/core/crossings.js`). Segment parameters are half-open, so vertex hits count once.

**Over/under.** The pair $(+j,-i)$ crossing at time $t_c$ uses the carrier sides at the pair's most
recent passing:

- the passing times are $t_p=((i-j)\Delta+\Delta/2+2\pi p)/(2\omega)$;
- the lag between passing and crossing is below $\pi/\omega$, because the fell-point lag angle is
  $<90°$;
- so the latest passing is unambiguous. This holds off-axis and in transients.
- On a centred mandrel, crossings occur at the passing azimuths, so the sign equals the
  closed-form rule "gear side at the crossing azimuth". The tests check this for all three patterns.

**Height.** Each yarn stores its crossing events $(s_k,\sigma_k)$. The rendered centre line lies at
height $t_y(c+a\,\tilde\sigma(s))$ above the surface, where:

- $\tilde\sigma=\sigma_k$ exactly at crossings, so the two yarns there always get opposite heights;
- between crossings of different sign, $\tilde\sigma$ follows a half-cosine blend;
- biaxial: $c=1,\ a=\frac12$; triaxial: $c=1.5,\ a=1$ with the axial yarns at $1.5$.

Flat tapes of almost jammed braids may clip slightly near side changes.

## 11. Validation

`deno task test` checks the core against:

| Check                                                                                                    | Result                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Cylinder steady state: $\alpha\to\arctan(\omega r/v)$, $h\to\sqrt{R_g^2-r^2}/\tan\alpha$, $\kappa_g\to0$ | rel. error < $10^{-4}$                   |
| Cylinder transient vs Du & Popper exponential                                                            | max error < $10^{-5}$ m                  |
| Curved taper vs SciPy solution of the on-axis ODE (Section 4.6)                                          | $10^{-9}$ m at 0.5 mm steps; order 2     |
| Closed-form $\kappa_n,\kappa_g$ vs finite differences of the deposited path (cone)                       | 0.2 %                                    |
| General (per-yarn) solver vs symmetric solver; mirror symmetry of the two families                       | < $10^{-8}$ m                            |
| Sphere zone: $\kappa_n=1/\rho$ in every direction, $K=1/\rho^2$                                          | $10^{-12}$                               |
| Clairaut invariant along geodesics                                                                       | $10^{-8}$ (analytic), $10^{-6}$ (spline) |
| Passings on opposite sides, no carrier collisions, $m/m$ blocks along every yarn                         | exact                                    |
| Crossing signs vs the gear-side rule; one yarn on top per crossing                                       | exact                                    |

## 12. Limitations

- **Yarns:** flexible and inextensible, with constant tension and width (no flattening, no bending
  stiffness).
- **Free yarn:** straight from an idealised guide point. There is no friction before contact and no
  yarn–yarn interaction in the convergence zone. Real inter-yarn friction shortens $h$ by about
  25 % for 144 carriers (van Ravenhorst & Akkerman 2016).
- **Contact:**
  - deposited yarn sticks;
  - slip is flagged, not simulated;
  - concave stretches and obstacles are bridged by straight chords.
- **Machine:** uniform carrier rotation; horn-gear speed variations are ignored.
- **Mandrel:** a surface of revolution $r(z)$ (optionally offset or tilted), so domes and poles
  ($r\to0$) are not representable.

## References

- Akkerman R., Villa Rodríguez B.H. (2007). Braiding simulation and slip evaluation for arbitrary
  mandrels. _AIP Conf. Proc._ 907, 1074–1079. doi:10.1063/1.2729657
- do Carmo M.P. (1976). _Differential Geometry of Curves and Surfaces_, §4-4.
- Du G.-W., Popper P. (1994). Analysis of a circular braiding process for complex shapes.
  _J. Textile Institute_ 85(3), 316–337. doi:10.1080/00405009408631277
- Kessels J.F.A., Akkerman R. (2002). Prediction of the yarn trajectories on complex braided
  preforms. _Composites Part A_ 33, 1073–1081. doi:10.1016/S1359-835X(02)00075-1
- Ko F.K. (1987). Braiding. In: _Engineered Materials Handbook_, Vol. 1: Composites. ASM
  International, 519–528.
- van Ravenhorst J.H., Akkerman R. (2014). Circular braiding take-up speed generation using inverse
  kinematics. _Composites Part A_ 64, 147–158. doi:10.1016/j.compositesa.2014.04.020
- van Ravenhorst J.H., Akkerman R. (2016). A yarn interaction model for circular braiding.
  _Composites Part A_ 81, 254–263. doi:10.1016/j.compositesa.2015.11.026
- Wang R., Jiao W., Liu W., Yang F., He X. (2011). Slippage coefficient measurement for
  non-geodesic filament-winding process. _Composites Part A_ 42(3), 303–309.
  doi:10.1016/j.compositesa.2010.12.002
- Zhang Q., Beale D., Adanur S., Broughton R.M., Walker R.P. (1997). Structural analysis of a
  two-dimensional braided fabric. _J. Textile Institute_ 88(1), 41–52.
  doi:10.1080/00405009708658528
