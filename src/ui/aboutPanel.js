/**
 * @file aboutPanel.js — the "About" tab: what the applet shows, how to use it, suggested
 * experiments, and links. Static content, built with textContent (no HTML injection).
 */

const REPO = "https://github.com/VaitkusM/braiding-applet";

const EXPERIMENTS = [
  [
    "Steady state on a cylinder",
    "Choose the cylinder. In Plots, the convergence length h(t) relaxes to √(R_g² − r²)/tan α exactly as Du & Popper's exponential predicts (dashed). The braid angle settles at tan α = ωr/v, and the yarn is a helix, a geodesic, with κg = 0.",
  ],
  [
    "Lag on a taper",
    "With the default taper the simulated braid angle trails the quasi-static curve through the transition, because the convergence length has to adapt. Colour the yarns by slip ratio: the transition needs |κg/κn| up to about 0.43, more than μ = 0.25 provides. Raise μ above about 0.45 and the slip warnings disappear.",
  ],
  [
    "Negative Gaussian curvature",
    "Choose the hourglass and colour the mandrel by K (blue = saddle-like). At the waist centre κn = k_m cos²α + k_p sin²α is negative along the yarn for braid angles below about 20°. Raise the take-up speed to about 100 mm/s: the yarn approaches the waist at a low braid angle, the free yarn catches on the far side, and the concave middle of the waist is spanned by one straight chord (bridging and contact are flagged).",
  ],
  [
    "Off-axis mandrel",
    "Offset or tilt the mandrel axis. The fell line tilts, and the convergence length and braid angle now vary around the circumference (bands in the plots). Every yarn is solved individually.",
  ],
  [
    "Jamming",
    "Increase the yarn width (e.g. 9 mm) or the number of carriers. Where the braid angle exceeds α_jam (dashed in the angle plot), the per-family coverage k reaches 1: yarns of one family would have to overlap, so a real braid jams there. The kinematic model does not include yarn–yarn contact, so it flags these regions instead of limiting the angle.",
  ],
  [
    "Patterns and triaxial braids",
    "Switch between diamond (1/1), regular (2/2) and Hercules (3/3) and look at the fell zone: each yarn goes over m, under m. Enable axial yarns: they are laid along meridians (geodesics) and trapped between the two bias families.",
  ],
];

export class AboutPanel {
  /** @param {HTMLElement} host */
  constructor(host) {
    const add = (tag, text, cls) => {
      const el = document.createElement(tag);
      if (text) el.textContent = text;
      if (cls) el.className = cls;
      host.appendChild(el);
      return el;
    };
    add("h2", "What you see");
    add(
      "p",
      "An idealised circular (maypole) braiding machine. Carriers on a figure-eight horn-gear track feed yarns through a guide ring onto a mandrel that is pulled through the machine. The yarns are laid by the fell-point model of Kessels & Akkerman: each free yarn is straight and leaves the mandrel tangentially at its fell point. The applet relates the resulting yarn paths to the differential geometry of the mandrel (curvatures, geodesics) and to yarn mechanics (normal pressure, friction, jamming).",
    );
    add("h2", "How to use it");
    const ul = add("ul");
    for (
      const t of [
        "Parameters (top right): the machine, the mandrel shape and placement, and the yarn properties. Changing one restarts the run.",
        "Mouse: drag to orbit, scroll to zoom, right-drag to pan. The camera buttons (top left) jump to preset views.",
        "Click a carrier or a deposited yarn to select it. Plots and live values then refer to that yarn, and its Darboux frame (t, n, b) and geodesic appear at its fell point.",
        "Display (parameter panel): colour yarns by braid angle, slip ratio, curvatures or contact pressure, and the mandrel by Gaussian or mean curvature.",
        "Space plays or pauses, R restarts. “Run to end” computes the rest of the run as fast as possible.",
        "The URL always contains all parameters: copy it to share a set-up.",
      ]
    ) {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }
    add("h2", "Experiments to try");
    for (const [title, text] of EXPERIMENTS) {
      add("h3", title);
      add("p", text);
    }
    add("h2", "Source and documentation");
    const p = add("p");
    const link = (href, text) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = text;
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    };
    p.append(
      link(REPO, "GitHub repository"),
      document.createTextNode(" · "),
      link(`${REPO}/blob/main/docs/THEORY.md`, "Theory & derivations"),
      document.createTextNode(" · "),
      link(`${REPO}/blob/main/docs/ARCHITECTURE.md`, "Code architecture"),
    );
    add(
      "p",
      "Built with three.js, lil-gui and KaTeX. MIT licence. The physics core (src/core) is plain JavaScript with unit tests that check it against analytic solutions and an independent SciPy reference.",
      "note",
    );
  }
}
