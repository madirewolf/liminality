// world.js — the corridor. Geometry, procedurally painted textures, fluorescent
// fixtures, the particle field and dancefloor grid that wake up during the rave.
// No downloaded assets: every texture is drawn onto a canvas at boot.

import * as THREE from 'three';

// Playable area, used both to build walls and to clamp the player.
// The alcove rects deliberately overlap the corridor so doorways are passable.
const BOUNDS = [
  { x0: -2, x1: 2, z0: -68, z1: 4 },     // main corridor
  { x0: -5, x1: -1, z0: -20, z1: -16 },  // alcove L1
  { x0: 1, x1: 5, z0: -40, z1: -36 },    // alcove R
  { x0: -5, x1: -1, z0: -60, z1: -56 },  // alcove L2
];

const RESONATOR_SPOTS = [
  { x: -3.6, z: -18, ry: Math.PI / 2 },
  { x: 3.6, z: -38, ry: -Math.PI / 2 },
  { x: -3.6, z: -58, ry: Math.PI / 2 },
];

// ---------- procedural textures ----------

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function speckle(ctx, size, count, alpha) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function toTexture(c, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

function wallCanvas() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#cfc8b8'; // institutional beige
  ctx.fillRect(0, 0, 256, 256);
  // vertical grime smears
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256;
    const grad = ctx.createLinearGradient(0, Math.random() * 100, 0, 256);
    grad.addColorStop(0, 'rgba(60,55,45,0)');
    grad.addColorStop(1, `rgba(60,55,45,${0.03 + Math.random() * 0.07})`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 2 + Math.random() * 8, 256);
  }
  // the accent stripe every dead mall has
  ctx.fillStyle = '#4a5a63';
  ctx.fillRect(0, 150, 256, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 150, 256, 2);
  // skirting
  ctx.fillStyle = '#6d6659';
  ctx.fillRect(0, 240, 256, 16);
  speckle(ctx, 256, 400, 0.05);
  return c;
}

function floorCanvas() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#453e3a'; // tired carpet
  ctx.fillRect(0, 0, 256, 256);
  // diamond weave
  ctx.strokeStyle = 'rgba(90,78,70,0.55)';
  ctx.lineWidth = 3;
  for (let i = -4; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64 - 64, 0);
    ctx.lineTo(i * 64 + 256 - 64, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * 64 + 64, 0);
    ctx.lineTo(i * 64 - 256 + 64, 256);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(30,25,22,0.25)';
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 14, 0, 7);
    ctx.fill();
  }
  speckle(ctx, 256, 900, 0.06);
  return c;
}

function ceilingCanvas() {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = '#d6d3ca'; // drop-ceiling tiles
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#9b968a';
  ctx.lineWidth = 3;
  for (const p of [0, 128, 256]) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
  }
  // water stains
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(150,130,95,${0.04 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 30, 0, 7);
    ctx.fill();
  }
  speckle(ctx, 256, 600, 0.04);
  return c;
}

function dotCanvas() {
  const [c, ctx] = canvas(64);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

function signCanvas() {
  const [c, ctx] = canvas(512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,180,255,0.9)';
  ctx.shadowBlur = 26;
  ctx.font = '200 44px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spaced = (s) => s.split('').join('  ');
  ctx.fillText(spaced('TO BE CONTINUED'), 256, 236);
  ctx.font = '200 20px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(spaced('the walls remember you now'), 256, 296);
  return c;
}

// ---------- shaders ----------

const GRID_SHADER = {
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uBass: { value: 0 },
    uScale: { value: new THREE.Vector2(10.4, 72.4) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uOpacity, uBass;
    uniform vec2 uScale;
    varying vec2 vUv;

    vec3 hue2rgb(float h) {
      vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
      return 1.0 - max(min(min(k, 4.0 - k), vec3(1.0)), vec3(0.0));
    }

    void main() {
      vec2 p = vUv * uScale - vec2(0.0, uTime * 0.9);
      vec2 d = abs(fract(p) - 0.5);
      float line = smoothstep(0.44, 0.5, max(d.x, d.y));
      float hue = fract(uTime * 0.06 + vUv.y * 1.8);
      vec3 col = hue2rgb(hue) * (0.4 + uBass * 1.4);
      gl_FragColor = vec4(col, line * uOpacity);
    }
  `,
};

// ---------- construction ----------

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const wallTexBase = wallCanvas();
  const wallMat = (length) => {
    const mat = new THREE.MeshStandardMaterial({
      map: toTexture(wallTexBase, Math.max(1, Math.round(length / 2.6)), 1),
      roughness: 0.92,
      metalness: 0.0,
    });
    return mat;
  };
  const floorMat = new THREE.MeshStandardMaterial({
    map: toTexture(floorCanvas(), 8, 56),
    roughness: 0.97,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    map: toTexture(ceilingCanvas(), 8, 55),
    roughness: 0.9,
  });

  const box = (mat, cx, cz, sx, sz, sy = 3, cy = 1.5) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    group.add(m);
    return m;
  };

  // main corridor walls, with gaps where the alcoves open
  // left wall (x = -2): openings at z [-20,-16] and [-60,-56]
  box(wallMat(20), -2.1, -6, 0.2, 20);
  box(wallMat(36), -2.1, -38, 0.2, 36);
  box(wallMat(8), -2.1, -64, 0.2, 8);
  // right wall (x = +2): opening at z [-40,-36]
  box(wallMat(40), 2.1, -16, 0.2, 40);
  box(wallMat(28), 2.1, -54, 0.2, 28);
  // end caps
  box(wallMat(4), 0, 4.1, 4.6, 0.2);
  box(wallMat(4), 0, -68.1, 4.6, 0.2);

  // alcoves: back wall + two cheek walls each
  for (const a of [
    { x: -5.1, z: -18, side: -1 },
    { x: 5.1, z: -38, side: 1 },
    { x: -5.1, z: -58, side: -1 },
  ]) {
    box(wallMat(4.4), a.x, a.z, 0.2, 4.4);
    const cx = a.side * 3.5;
    box(wallMat(3.2), cx, a.z + 2, 3.2, 0.2);
    box(wallMat(3.2), cx, a.z - 2, 3.2, 0.2);
  }

  // floor and ceiling span everything
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 72.4), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -32);
  group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 72.4), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 3, -32);
  group.add(ceil);

  // dancefloor grid, invisible until the drop
  const gridMat = new THREE.ShaderMaterial({
    ...GRID_SHADER,
    uniforms: THREE.UniformsUtils.clone(GRID_SHADER.uniforms),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 72.4), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(0, 0.03, -32);
  group.add(grid);

  // fluorescent fixtures down the spine of the corridor
  const fixtures = [];
  const fixtureGeo = new THREE.BoxGeometry(1.9, 0.08, 0.55);
  for (let i = 0; i < 12; i++) {
    const z = -i * 6;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: new THREE.Color(0xdfe8f0),
      emissiveIntensity: 1.5,
    });
    const mesh = new THREE.Mesh(fixtureGeo, mat);
    mesh.position.set(0, 2.95, z);
    group.add(mesh);
    const light = new THREE.PointLight(0xdfe8f0, 16, 14, 1.7);
    light.position.set(0, 2.65, z);
    group.add(light);
    fixtures.push({
      mesh, light, z,
      baseIntensity: 16,
      baseEmissive: 1.5,
      phase: Math.random() * Math.PI * 2,
      flickerT: 0,
      nextFlicker: 4 + Math.random() * 14,
    });
  }

  const ambient = new THREE.AmbientLight(0x2e2e38, 0.9);
  scene.add(ambient);

  // dust that becomes confetti: particle field, invisible until the drop
  const N = 900;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 1] = 0.2 + Math.random() * 2.6;
    pos[i * 3 + 2] = 4 - Math.random() * 72;
    vel[i] = 0.15 + Math.random() * 0.5;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    map: toTexture(dotCanvas()),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(pGeo, pMat);
  group.add(particles);

  // the promise at the end of the hall
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: toTexture(signCanvas()),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  sign.position.set(0, 1.55, -67.9);
  group.add(sign);

  return {
    bounds: BOUNDS,
    resonatorSpots: RESONATOR_SPOTS,
    fixtures,
    ambient,
    gridMat,
    particles,
    particleVel: vel,
    sign,
  };
}
