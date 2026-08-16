// fx.js — post-processing and the visual state machine.
// Three phases, driven by the audio engine's clock:
//   explore  — dead fluorescent white, occasional flickers, dread
//   blackout — the breakdown: lights die while the riser climbs
//   rave     — every light becomes a color instrument driven by the FFT

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradePass = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVig: { value: 0.55 },
    uSat: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVig, uSat;
    varying vec2 vUv;

    float rand(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // film grain
      c.rgb += (rand(vUv * 913.7 + fract(uTime) * 71.3) - 0.5) * uGrain;
      // saturation ride
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      // vignette
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.42, 0.92, d) * uVig;
      gl_FragColor = c;
    }
  `,
};

const BASE_FOV = 72;

export class FX {
  constructor(renderer, scene, camera, world, audio) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.audio = audio;

    this.rave = 0;       // 0 = dead hallway, 1 = full rave
    this.lightScale = 1; // blackout multiplier
    this.punch = 0;      // impact kick at the drop
    this.t = 0;
    this.gridT = 0;
    this.dropFired = false;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.65, 0.85
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradePass);
    this.composer.addPass(this.grade);

    this._fogColor = new THREE.Color(0x070709);
    this._tmpColor = new THREE.Color();
    this._white = new THREE.Color(0xdfe8f0);
    scene.fog = new THREE.FogExp2(0x070709, 0.052);
    renderer.setClearColor(0x070709);
  }

  resize(w, h) {
    this.composer.setSize(w, h);
  }

  update(dt, bands) {
    this.t += dt;
    const audio = this.audio;
    const now = audio.now();

    // ---- phase ----
    let phase = 'explore';
    if (audio.breakdownTime !== null && now >= audio.breakdownTime) phase = 'blackout';
    if (audio.dropTime !== null && now >= audio.dropTime) phase = 'rave';

    if (phase === 'rave' && !this.dropFired) {
      this.dropFired = true;
      this.punch = 1;
    }
    this.punch *= Math.exp(-dt * 2.2);

    const raveTarget = phase === 'rave' ? 1 : 0;
    this.rave += (raveTarget - this.rave) * Math.min(1, dt * (phase === 'rave' ? 3.0 : 0.8));
    const lightTarget = phase === 'blackout' ? 0.03 : 1;
    this.lightScale += (lightTarget - this.lightScale) * Math.min(1, dt * (phase === 'blackout' ? 2.5 : 8));

    const rave = this.rave;
    const bass = bands.bass;

    // ---- fixtures ----
    for (const f of this.world.fixtures) {
      let flicker = 1;
      if (phase === 'explore' && rave < 0.05) {
        f.nextFlicker -= dt;
        if (f.nextFlicker <= 0) {
          f.flickerT = 0.2 + Math.random() * 0.45;
          f.nextFlicker = 5 + Math.random() * 16;
          const dz = Math.abs(this.camera.position.z - f.z);
          if (dz < 10) this.audio.crackle(0.06 * (1 - dz / 10));
        }
        if (f.flickerT > 0) {
          f.flickerT -= dt;
          flicker = Math.random() < 0.55 ? 1 : 0.1;
        }
      }

      // rave color: each fixture cycles hue at its own phase
      const hue = (this.t * 0.11 + f.phase * 0.16) % 1;
      this._tmpColor.setHSL(hue, 0.9, 0.55);
      f.light.color.copy(this._white).lerp(this._tmpColor, rave);
      f.mesh.material.emissive.copy(this._white).lerp(this._tmpColor, rave);

      const raveIntensity = f.baseIntensity * (0.28 + bass * 0.68 + this.punch * 0.5);
      const calmIntensity = f.baseIntensity * flicker;
      f.light.intensity = THREE.MathUtils.lerp(calmIntensity, raveIntensity, rave) * this.lightScale;
      f.mesh.material.emissiveIntensity =
        THREE.MathUtils.lerp(f.baseEmissive * flicker, 0.4 + bass * 1.6, rave) *
        Math.max(this.lightScale, 0.02);
    }

    // ---- ambient + fog ----
    this.world.ambient.intensity =
      THREE.MathUtils.lerp(0.9, 0.25 + bass * 0.35, rave) * Math.max(this.lightScale, 0.07);
    const fogHue = (this.t * 0.05) % 1;
    this._tmpColor.setHSL(fogHue, 0.65, 0.03 + bass * 0.015);
    this._fogColor.set(0x070709).lerp(this._tmpColor, rave);
    this.scene.fog.color.copy(this._fogColor);
    this.renderer.setClearColor(this._fogColor);
    this.scene.fog.density = THREE.MathUtils.lerp(0.052, 0.042, rave);

    // ---- dancefloor grid + particles + sign ----
    this.gridT += dt * (0.5 + bass * 1.6);
    const g = this.world.gridMat.uniforms;
    g.uTime.value = this.gridT;
    g.uOpacity.value = rave * 0.85;
    g.uBass.value = bass;

    const pm = this.world.particles.material;
    pm.opacity = rave * 0.8;
    if (rave > 0.02) {
      const pos = this.world.particles.geometry.attributes.position;
      const vel = this.world.particleVel;
      for (let i = 0; i < vel.length; i++) {
        let y = pos.getY(i) + vel[i] * dt * (0.4 + bass * 1.8);
        if (y > 2.9) y = 0.15;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this._tmpColor.setHSL((this.t * 0.15) % 1, 0.8, 0.7);
      pm.color.copy(this._tmpColor);
    }
    this.world.sign.material.opacity = rave * (0.75 + bands.mid * 0.5);

    // ---- lens ----
    this.bloom.strength = 0.4 + rave * (0.12 + bass * 0.2) + this.punch * 0.6;
    this.bloom.threshold = 0.85 - rave * 0.15;
    this.grade.uniforms.uTime.value = this.t;
    this.grade.uniforms.uSat.value = 1.0 + rave * 0.22;
    this.grade.uniforms.uVig.value = 0.55 - rave * 0.15;
    this.grade.uniforms.uGrain.value = 0.045 + (phase === 'blackout' ? 0.05 : 0);

    const fov = BASE_FOV + rave * bass * 4.5 + this.punch * 5;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    this.composer.render();
  }
}
