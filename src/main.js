// main.js — boot and glue. Everything interesting lives in the modules:
// audio.js (synth engine), world.js (corridor), player.js (movement),
// resonators.js (puzzle), fx.js (post + visual state machine).

import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Resonators } from './resonators.js';
import { FX } from './fx.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  72, window.innerWidth / window.innerHeight, 0.05, 150
);

const world = buildWorld(scene);
const audio = new AudioEngine();
const player = new Player(camera, renderer.domElement, world.bounds);
const resonators = new Resonators(scene, camera, audio, world);
const fx = new FX(renderer, scene, camera, world, audio);

// ---------- UI ----------

const titleScreen = document.getElementById('title-screen');
const hintEl = document.getElementById('hint');
const toastEl = document.getElementById('toast');

let toastTimer = null;
function toast(text, ms = 3200) {
  toastEl.textContent = text;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), ms);
}

let hintOverride = null;
let hintOverrideUntil = 0;
function setHint(text) {
  if (text) {
    if (hintEl.textContent !== text) hintEl.textContent = text;
    hintEl.classList.add('visible');
  } else {
    hintEl.classList.remove('visible');
  }
}

function enterGame() {
  titleScreen.classList.add('hidden');
  document.body.classList.add('playing');
  if (resonators.lockedCount === 0) {
    hintOverride = 'find what hums';
    hintOverrideUntil = performance.now() + 7000;
  }
}

titleScreen.addEventListener('click', () => {
  audio.start();
  player.lock();
});

player.controls.addEventListener('lock', enterGame);

// some environments (embeds, kiosk browsers) deny the Pointer Lock API —
// fall back to drag-to-look instead of trapping the player on the title screen
document.addEventListener('pointerlockerror', () => {
  if (!player.controls.isLocked && !player.fallback) {
    player.fallback = true;
    enterGame();
  }
});

player.controls.addEventListener('unlock', () => {
  titleScreen.classList.remove('hidden');
  document.body.classList.remove('playing');
  titleScreen.querySelector('.enter').textContent = 'CLICK TO RESUME';
});

resonators.onLock = (count) => {
  if (count === 1) toast('ONE OF THREE');
  if (count === 2) toast('TWO OF THREE');
  if (count === 3) toast('. . .', 4200);
};

let dropAnnounced = false;

// ---------- loop ----------

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (player.locked) player.update(dt);

  const bands = audio.getBands();
  fx.update(dt, bands);
  resonators.update(dt, bands, fx.rave);

  if (fx.dropFired && !dropAnnounced) {
    dropAnnounced = true;
    toast('IT REMEMBERS BEING ALIVE', 5200);
  }

  if (hintOverride && performance.now() < hintOverrideUntil && !resonators.hint) {
    setHint(hintOverride);
  } else {
    setHint(resonators.hint);
  }

  fx.render();
}
frame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fx.resize(window.innerWidth, window.innerHeight);
});

// dev/debug hooks
window.__game = {
  audio, player, resonators, fx, camera,
  lockAll: () => resonators.forceLockAll(),
  teleport: (x, z) => camera.position.set(x, 1.62, z),
};
