// player.js — first-person movement. PointerLockControls handles the look;
// movement and collision are ours (position is clamped to the union of
// walkable rectangles, per-axis, so you slide along walls).

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.62;
const RADIUS = 0.32;
const SPEED = 4.0;

export class Player {
  constructor(camera, domElement, bounds) {
    this.camera = camera;
    this.bounds = bounds;
    this.controls = new PointerLockControls(camera, domElement);
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.bobT = 0;
    this.moving = false;
    // drag-to-look fallback for environments that deny the Pointer Lock API
    this.fallback = false;
    this._dragging = false;

    camera.rotation.order = 'YXZ';
    camera.position.set(0, EYE_HEIGHT, 2.5);
    camera.rotation.set(0, 0, 0); // -Z faces down the corridor

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    domElement.addEventListener('pointerdown', () => { this._dragging = true; });
    window.addEventListener('pointerup', () => { this._dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.fallback || !this._dragging || this.controls.isLocked) return;
      camera.rotation.y -= e.movementX * 0.004;
      camera.rotation.x = THREE.MathUtils.clamp(
        camera.rotation.x - e.movementY * 0.004, -1.45, 1.45
      );
    });
  }

  lock() { this.controls.lock(); }
  get locked() { return this.controls.isLocked || this.fallback; }

  _inBounds(x, z) {
    return this.bounds.some(
      (r) => x > r.x0 + RADIUS && x < r.x1 - RADIUS && z > r.z0 + RADIUS && z < r.z1 - RADIUS
    );
  }

  update(dt) {
    const k = this.keys;
    const input = new THREE.Vector3(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      0,
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0)
    );

    // camera-relative move direction, flattened to the floor plane
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));

    const wish = new THREE.Vector3()
      .addScaledVector(fwd, -input.z)
      .addScaledVector(right, input.x);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(SPEED);

    // smooth accel / decel
    const t = 1 - Math.pow(0.0001, dt);
    this.velocity.lerp(wish, t);
    this.moving = this.velocity.lengthSq() > 0.3;

    const pos = this.camera.position;
    const nx = pos.x + this.velocity.x * dt;
    if (this._inBounds(nx, pos.z)) pos.x = nx;
    const nz = pos.z + this.velocity.z * dt;
    if (this._inBounds(pos.x, nz)) pos.z = nz;

    // head bob, subtle
    if (this.moving) this.bobT += dt * this.velocity.length() * 1.9;
    pos.y = EYE_HEIGHT + Math.sin(this.bobT) * 0.028;
  }
}
