/**
 * @file machineView.js — the braiding machine in the MACHINE (= world) frame: track plate with
 * horn gears and the two figure-eight carrier paths, bobbin carriers (instanced), the guide ring,
 * axial-yarn guides, and the free yarns (bobbin → guide ring → fell point) drawn as fat lines.
 *
 * Geometry is visual; the physics uses only the idealised guide points on the ring (machine.js).
 */

import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { AXIAL_COLOR, hexToRgb, SERIES, srgbToLinear } from "./colormaps.js";

/** @typedef {import("../core/simulation.js").Simulation} Simulation */

const linear = (hex) => hexToRgb(hex).map(srgbToLinear);

export class MachineView {
  /** @param {Simulation} sim */
  constructor(sim) {
    this.sim = sim;
    const mc = sim.machine;
    this.group = new THREE.Group();
    const Rt = mc.trackRadius, Rh = mc.gearRadius, Rg = mc.ringRadius;
    /** Downstream face of the track plate (carriers stand on it, pointing towards the ring). */
    this.zPlate = 0.45 * Rg + 0.04;
    const zP = this.zPlate;

    // Track plate: a thick annulus behind the carriers.
    const inner = Math.max(Rg * 1.05, Rt - Rh - 0.03), outer = Rt + Rh + 0.035, th = 0.012;
    const plateShape = [
      new THREE.Vector2(inner, 0),
      new THREE.Vector2(outer, 0),
      new THREE.Vector2(outer, th),
      new THREE.Vector2(inner, th),
      new THREE.Vector2(inner, 0),
    ];
    const plateGeo = new THREE.LatheGeometry(plateShape, 160);
    plateGeo.rotateX(Math.PI / 2); // lathe axis y → z
    const plate = new THREE.Mesh(
      plateGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.7, roughness: 0.55 }),
    );
    plate.position.z = zP;
    this.group.add(plate);

    // Horn gears (instanced discs) slightly proud of the plate.
    const gearGeo = new THREE.CylinderGeometry(Rh * 0.96, Rh * 0.96, 0.005, 48);
    gearGeo.rotateX(Math.PI / 2);
    const gears = new THREE.InstancedMesh(
      gearGeo,
      new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.8, roughness: 0.4 }),
      mc.gearCount,
    );
    const m4 = new THREE.Matrix4();
    for (let q = 0; q < mc.gearCount; q++) {
      const c = mc.gearCenter(q);
      m4.makeTranslation(Rt * Math.cos(c), Rt * Math.sin(c), zP - 0.0025);
      gears.setMatrixAt(q, m4);
    }
    this.group.add(gears);

    // The two figure-eight carrier paths (all carriers of a family share one closed path).
    this.pathLines = [1, -1].map((fam) => {
      const pts = [];
      const T = (2 * Math.PI) / mc.omega, n = 1440;
      for (let i = 0; i <= n; i++) {
        const [x, y] = mc.carrierTrackXY(fam, 0, (i / n) * T);
        pts.push(x, y, zP - 0.0055);
      }
      const segs = [];
      for (let i = 0; i < n; i++) segs.push(...pts.slice(3 * i, 3 * i + 6));
      const g = new LineSegmentsGeometry();
      g.setPositions(segs);
      const mat = new LineMaterial({
        color: fam === 1 ? SERIES.plus : SERIES.minus,
        linewidth: 1.2,
        transparent: true,
        opacity: 0.55,
      });
      const line = new LineSegments2(g, mat);
      line.frustumCulled = false;
      this.group.add(line);
      return line;
    });

    // Guide ring.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(Rg, 0.0035, 16, 220),
      new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 }),
    );
    this.group.add(ring);

    // Carriers: base + yarn package (instanced per family).
    const P = mc.perFamily;
    const scale = Math.min(1, (2 * Math.PI * Rt / mc.N) / 0.024);
    this.bobbinLength = 0.045 * scale;
    const baseGeo = new THREE.CylinderGeometry(0.011 * scale, 0.011 * scale, 0.01, 20);
    baseGeo.rotateX(Math.PI / 2);
    const pkgGeo = new THREE.CylinderGeometry(
      0.0085 * scale,
      0.0085 * scale,
      this.bobbinLength,
      20,
    );
    pkgGeo.rotateX(Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x8a9099,
      metalness: 0.85,
      roughness: 0.35,
    });
    this.carriers = [1, -1].map((fam) => {
      const base = new THREE.InstancedMesh(baseGeo, baseMat, P);
      const pkg = new THREE.InstancedMesh(
        pkgGeo,
        new THREE.MeshStandardMaterial({
          color: fam === 1 ? SERIES.plus : SERIES.minus,
          roughness: 0.75,
        }),
        P,
      );
      base.userData.family = pkg.userData.family = fam;
      this.group.add(base, pkg);
      return { base, pkg };
    });

    // Axial-yarn guides (triaxial): short tubes at the gear centres.
    if (sim.axialYarns.length) {
      const tube = new THREE.CylinderGeometry(0.004, 0.004, 0.03, 12);
      tube.rotateX(Math.PI / 2);
      const guides = new THREE.InstancedMesh(tube, baseMat, mc.gearCount);
      for (let q = 0; q < mc.gearCount; q++) {
        const c = mc.gearCenter(q);
        m4.makeTranslation(Rt * Math.cos(c), Rt * Math.sin(c), zP - 0.015);
        guides.setMatrixAt(q, m4);
      }
      this.group.add(guides);
    }

    // Free yarns: 2 segments per yarn (bobbin tip → ring → fell point).
    const nYarns = sim.yarns.length + sim.axialYarns.length;
    this.freePos = new Float32Array(nYarns * 2 * 6);
    const colors = new Float32Array(nYarns * 2 * 6);
    const cPlus = linear(SERIES.plus), cMinus = linear(SERIES.minus), cAx = linear(AXIAL_COLOR);
    for (let k = 0; k < nYarns; k++) {
      const c = k < P ? cPlus : k < 2 * P ? cMinus : cAx;
      for (let v = 0; v < 4; v++) colors.set(c, (4 * k + v) * 3);
    }
    this.freeGeo = new LineSegmentsGeometry();
    this.freeGeo.setPositions(this.freePos);
    this.freeGeo.setColors(colors);
    this.freeMat = new LineMaterial({ vertexColors: true, linewidth: 1.4 });
    this.freeLines = new LineSegments2(this.freeGeo, this.freeMat);
    this.freeLines.frustumCulled = false;
    this.group.add(this.freeLines);
    this.lineMaterials = [this.freeMat, ...this.pathLines.map((l) => l.material)];
  }

  /** Updates carriers and free yarns for the current simulation time. */
  update() {
    const sim = this.sim, mc = sim.machine, t = sim.time, P = mc.perFamily;
    const zP = this.zPlate, m4 = new THREE.Matrix4();
    const zBase = zP - 0.005, zPkg = zP - 0.01 - this.bobbinLength / 2;
    const tipZ = zP - 0.01 - this.bobbinLength;
    let o = 0;
    const put = (a, b) => {
      this.freePos[o++] = a[0];
      this.freePos[o++] = a[1];
      this.freePos[o++] = a[2];
      this.freePos[o++] = b[0];
      this.freePos[o++] = b[1];
      this.freePos[o++] = b[2];
    };
    [1, -1].forEach((fam, fi) => {
      const { base, pkg } = this.carriers[fi];
      for (let j = 0; j < P; j++) {
        const [x, y] = mc.carrierTrackXY(fam, j, t);
        m4.makeTranslation(x, y, zBase);
        base.setMatrixAt(j, m4);
        m4.makeTranslation(x, y, zPkg);
        pkg.setMatrixAt(j, m4);
      }
      base.instanceMatrix.needsUpdate = true;
      pkg.instanceMatrix.needsUpdate = true;
    });
    for (let k = 0; k < sim.yarns.length; k++) {
      const { family, j } = sim.carrierOf(k);
      const [x, y] = mc.carrierTrackXY(family, j, t);
      const G = mc.guidePoint(family, j, t);
      put([x, y, tipZ], G);
      put(G, sim.pose.toMachine(sim.fell[k], t));
    }
    sim.axialYarns.forEach((y, a) => {
      const q = sim.axialInfo[a].q, c = mc.gearCenter(q);
      const G = mc.axialGuidePoint(q);
      put([mc.trackRadius * Math.cos(c), mc.trackRadius * Math.sin(c), zP - 0.03], G);
      put(G, sim.pose.toMachine(y.point(y.last), t));
    });
    const buf = this.freeGeo.attributes.instanceStart.data;
    buf.array.set(this.freePos);
    buf.needsUpdate = true;
  }

  /** Line materials need the viewport size in pixels. */
  setResolution(w, h) {
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  setFreeYarnsVisible(v) {
    this.freeLines.visible = v;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
