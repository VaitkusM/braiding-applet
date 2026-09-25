/**
 * @file scene.js — three.js renderer, camera, controls, lights and environment.
 *
 * World coordinates = MACHINE frame (metres): machine axis along world z (horizontal on screen),
 * y up, guide-ring plane z = 0, braid formed towards −z. Objects that move with the mandrel are
 * children of a group whose matrix is the mandrel pose (see mandrelView.js).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export class SceneView {
  /** @param {HTMLElement} host element that receives the canvas */
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.8;

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.8, 1.6, 1.0);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.6);
    rim.position.set(-1.2, 0.4, -1.5);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xdfe8ff, 0x202020, 0.35));

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.005, 40);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 6;

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }

  /** Matches the drawing buffer to the host size. */
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
  }

  /**
   * Moves the camera to a named view around the fell zone.
   * @param {"overview"|"fell"|"side"|"front"} name
   * @param {{fellZ:number, radius:number, ringRadius:number, trackRadius:number}} b scene scales [m]
   */
  setView(name, b) {
    const target = new THREE.Vector3(0, 0, b.fellZ * 0.6);
    const pos = new THREE.Vector3();
    switch (name) {
      case "fell":
        target.set(0, 0, b.fellZ);
        pos.set(b.radius * 5.5, b.radius * 3.6, b.fellZ - b.radius * 6.5);
        break;
      case "side":
        pos.set(0, b.trackRadius * 0.35, 0).add(
          new THREE.Vector3(b.trackRadius * 3.2, 0, target.z),
        );
        break;
      case "front":
        target.set(0, 0, b.fellZ);
        pos.set(0.001, b.radius * 0.8, b.fellZ - b.trackRadius * 3.2);
        break;
      default: // overview
        pos.set(b.trackRadius * 2.3, b.trackRadius * 1.25, b.fellZ - b.trackRadius * 2.6);
    }
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** Renders one frame. */
  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Renders and returns the canvas as a PNG data URL. */
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  /**
   * Projects a world point to CSS pixels in the host element.
   * @param {THREE.Vector3} v world point
   * @returns {{x:number, y:number, visible:boolean}}
   */
  project(v) {
    const p = v.clone().project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * this.size.w,
      y: (-p.y * 0.5 + 0.5) * this.size.h,
      visible: p.z > -1 && p.z < 1,
    };
  }
}
