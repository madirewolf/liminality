# LIMINALITY

*a rave is buried somewhere in these walls*

A first-person liminal-space puzzle game. You wander an empty, humming corridor —
the kind of hallway that shouldn't exist at 3am — and tune the resonators hidden
in its alcoves. Every locked resonator adds a layer to a techno track that builds
behind the walls, until the third one triggers the blackout... and then the drop,
when the dead corridor remembers being alive.

**Vertical slice v0.1** — one corridor, three resonators, one drop.

## Run it

```
npm install
npm run dev
```

Open http://localhost:5173, click, headphones on.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | move |
| Mouse | look (pointer lock; drag-to-look fallback if denied) |
| Q / E (or mouse wheel) | tune the resonator you're facing |
| Esc | release the mouse |

## How the puzzle works

Each resonator hums at a target pitch. When you approach one, your own detuned
tone joins it — two sine waves close in frequency, which physically *beat*
against each other. The wobble you hear is the real acoustic interference
pattern, and its speed is your distance from the correct pitch in hertz. The
glowing ring pulses at exactly that beat frequency, and its size mirrors your
detune. Tune with Q/E until the wobble dies, hold it there, and the resonator
locks — adding its note (a chord tone of A minor) to the buried track.

## Everything is code

There are no assets. Every texture (carpet, wall grime, ceiling tiles, the
accent stripe) is painted onto canvases at boot. Every sound — the fluorescent
hum, the beating drones, the kick, bass, hats, claps, supersaw pads, the riser,
the chime — is synthesized from raw oscillators and noise through the Web Audio
API, sequenced by a lookahead scheduler at 126 BPM. The visuals listen back:
an FFT analyser feeds bass/mid/high bands into the lights, the dancefloor grid
shader, the fog, the bloom, and the camera's field of view.

## Structure

```
src/
  main.js        boot, UI glue, render loop
  audio.js       procedural synth engine + step sequencer + FFT analysis
  world.js       corridor geometry, canvas-painted textures, fixtures, particles
  player.js      pointer-lock first-person controller + collision
  resonators.js  the tuning puzzle (real acoustic beat frequencies)
  fx.js          post-processing + the explore/blackout/rave state machine
```

Built with three.js and Vite. Runs on anything with WebGL.
