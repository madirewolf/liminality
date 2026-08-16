// resonators.js — the puzzle. Each resonator hums at a target pitch; the player
// carries a detuned second tone. Two close frequencies beat against each other
// (a real acoustic wobble), and the puzzle is to tune with Q/E until the wobble
// stops. The visual pulse rate IS the beat frequency, so eyes and ears agree.

import * as THREE from 'three';
import { RESONATOR_FREQS } from './audio.js';

const ENGAGE_DIST = 3.8;
const START_OFFSETS = [27, -31, 19]; // initial detune per resonator, Hz
const LOCK_THRESHOLD = 1.2;          // Hz
const LOCK_HOLD = 0.9;               // seconds inside threshold to lock
const TUNE_RATE = 9;                 // Hz per second on Q/E
const COLORS = [0xff2e88, 0x2ee6ff, 0x9b5cff]; // pink, cyan, violet

export class Resonators {
  constructor(scene, camera, audio, world) {
    this.camera = camera;
    this.audio = audio;
    this.items = [];
    this.lockedCount = 0;
    this.hint = null;
    this.onLock = null; // callback(count)
    this._keys = new Set();

    document.addEventListener('keydown', (e) => this._keys.add(e.code));
    document.addEventListener('keyup', (e) => this._keys.delete(e.code));
    window.addEventListener('wheel', (e) => {
      const it = this.items.find((r) => r.engaged && !r.locked);
      if (it) it.freq += e.deltaY * -0.005;
    });

    world.resonatorSpots.forEach((spot, i) => {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = spot.ry;
      scene.add(group);

      const color = new THREE.Color(COLORS[i]);

      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.36, 0.9, 24),
        new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.5, metalness: 0.4 })
      );
      pedestal.position.y = 0.45;
      group.add(pedestal);

      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        emissive: color.clone(),
        emissiveIntensity: 0.25,
        roughness: 0.3,
        metalness: 0.6,
      });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), coreMat);
      core.position.y = 1.28;
      group.add(core);

      const ringFixedMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.35,
      });
      const ringFixed = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.01, 10, 64), ringFixedMat);
      ringFixed.position.y = 1.28;
      group.add(ringFixed);

      const ringTuneMat = new THREE.MeshBasicMaterial({
        color: 0xff5533, transparent: true, opacity: 0.9,
      });
      const ringTune = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 10, 64), ringTuneMat);
      ringTune.position.y = 1.28;
      group.add(ringTune);

      const light = new THREE.PointLight(COLORS[i], 1.0, 8, 1.8);
      light.position.set(0, 1.5, 0);
      group.add(light);

      this.items.push({
        i, group, core, coreMat, ringTune, ringTuneMat, ringFixed, light,
        color,
        target: RESONATOR_FREQS[i],
        freq: RESONATOR_FREQS[i] + START_OFFSETS[i],
        engaged: false,
        locked: false,
        holdT: 0,
        pulsePhase: 0,
        spin: 0.4,
      });
    });
  }

  forceLockAll() {
    for (const it of this.items) {
      if (!it.locked) {
        it.freq = it.target;
        this._lock(it);
      }
    }
  }

  _lock(it) {
    it.locked = true;
    it.engaged = false;
    it.freq = it.target;
    it.spin = 2.2;
    it.ringTune.scale.setScalar(1);
    it.ringTuneMat.color.set(0xffffff);
    it.coreMat.emissiveIntensity = 2.2;
    it.light.intensity = 5;
    this.audio.lockResonator(it.i, it.target);
    this.lockedCount++;
    if (this.onLock) this.onLock(this.lockedCount);
  }

  update(dt, bands, rave) {
    const camPos = this.camera.position;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.hint = null;

    for (const it of this.items) {
      // idle motion
      it.core.rotation.y += dt * it.spin;
      it.core.rotation.x += dt * it.spin * 0.6;
      it.core.position.y = 1.28 + Math.sin(performance.now() * 0.001 + it.i * 2) * 0.05;

      if (it.locked) {
        // locked resonators dance with the music
        const pump = bands.bass * (0.5 + rave * 1.6);
        it.coreMat.emissiveIntensity = 1.6 + pump * 3.5;
        it.light.intensity = 4 + pump * 14;
        it.ringFixed.rotation.z += dt * (0.5 + rave * 2);
        continue;
      }

      // engagement: near + roughly looking at it
      const toRes = new THREE.Vector3(it.group.position.x, 1.3, it.group.position.z).sub(camPos);
      const dist = toRes.length();
      toRes.normalize();
      const facing = camDir.dot(toRes);
      const engaged = dist < ENGAGE_DIST && facing > 0.45;

      if (engaged && !it.engaged) {
        it.engaged = true;
        this.audio.engageTuner(it.i, it.target, it.freq);
      } else if (!engaged && it.engaged) {
        it.engaged = false;
        it.holdT = 0;
        this.audio.disengageTuner(it.i);
      }

      const detune = it.freq - it.target;
      const closeness = 1 - Math.min(1, Math.abs(detune) / 45);

      if (it.engaged) {
        if (this._keys.has('KeyE')) it.freq += TUNE_RATE * dt;
        if (this._keys.has('KeyQ')) it.freq -= TUNE_RATE * dt;
        it.freq = Math.max(it.target - 45, Math.min(it.target + 45, it.freq));
        this.audio.setTunerFreq(it.i, it.freq);

        this.hint = Math.abs(detune) < 6
          ? 'ALMOST — LET THE WOBBLE DIE'
          : 'HOLD Q / E — TUNE UNTIL THE WOBBLE STOPS';

        if (Math.abs(detune) < LOCK_THRESHOLD) {
          it.holdT += dt;
          if (it.holdT > LOCK_HOLD) this._lock(it);
        } else {
          it.holdT = 0;
        }
      }

      // the pulse rate is the beat frequency between the two tones
      const beatHz = Math.max(Math.abs(detune), 0.4);
      it.pulsePhase += dt * beatHz * Math.PI * 2;
      const pulse = 0.5 + 0.5 * Math.sin(it.pulsePhase);
      const glow = it.engaged ? 0.5 + pulse * 0.9 : 0.25 + pulse * 0.15;
      it.coreMat.emissiveIntensity = glow;
      it.light.intensity = it.engaged ? 1.2 + pulse * 2.2 : 0.9;

      // tuning ring: scale mirrors detune, color runs red -> white as you close in
      it.ringTune.scale.setScalar(1 + (detune / it.target) * 2.6);
      it.ringTuneMat.color.setRGB(1, 0.25 + closeness * 0.75, 0.15 + closeness * 0.85);
      it.ringTuneMat.opacity = it.engaged ? 0.5 + pulse * 0.5 : 0.55;
      it.ringFixed.lookAt(camPos);
      it.ringTune.lookAt(camPos);
    }
  }
}
