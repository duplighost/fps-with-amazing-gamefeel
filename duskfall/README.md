# DUSKFALL

A browser-based horde-survival FPS set in one golden-hour meadow. Run the field,
chain kills, and hold back wave after wave of the advancing horde. Built around a
single goal: **stylish, atmospheric 3D that plays like the smoothest shooter you've
ever touched.** No engine, no build step — just Three.js and vanilla JavaScript
modules. Open it and play.

![menu](docs/menu.png)

## Play

It needs to be served over HTTP (ES modules don't load from `file://`):

```bash
# from this folder:
python3 -m http.server 8080
# …or any static server
```

Then open **http://localhost:8080** and click **CLICK TO PLAY** (this grabs your
mouse).

> Three.js and its post-processing addons are vendored in `vendor/` so the game
> runs **fully offline** — no CDN, no network.

![gameplay](docs/gameplay.png)

## Controls

| | |
|---|---|
| **WASD** | move |
| **Mouse** | look · **Left click** fire |
| **Space** | jump (coyote-time + jump-buffer + variable height) |
| **Shift** | sprint |
| **Ctrl / C** | crouch · **sprint + crouch** = slide |
| **R** | reload |
| **1 / 2 / wheel** | switch weapons (carbine · shotgun) |
| **Esc** | pause |

**On mobile** it auto-switches to touch controls: a floating left-stick to move,
drag the right side to look, and on-screen **FIRE / JUMP / RLD / pause** buttons.

Survive escalating waves. Score points, chain your combo, don't die. Your best run
is saved locally and shown on the menu.

## The look

DUSKFALL goes for *stylish realism* — a warm, cinematic late-afternoon rather than
a photo. The whole scene is generated at load, then run through a filmic camera:

- **Atmospheric-scattering sky** (Preetham model) with the sun sitting low and
  golden, driving a matching warm directional key light, a cool sky-fill
  hemisphere, and a soft bounce.
- **Procedural terrain** — rolling noise-based hills you can actually walk, ringed
  by a forest that hems in the arena. Grass, dirt and rock are blended by slope and
  height, with alpha-tested grass tufts and a subtle detail texture.
- **Instanced foliage** — hundreds of low-poly trees, rocks and bushes scattered
  with a density that thins toward the middle and thickens into a treeline, drawn
  in a handful of instanced draw calls.
- **A filmic pipeline** — everything renders into an HDR multisampled buffer, gets
  a restrained bloom on genuinely bright highlights (the sun, tracers), then ACES
  tone-mapping and sRGB output. Hazy fog, drifting dust motes, and long shadows sell
  the golden hour.
- **The viewmodel** is drawn in a separate depth-cleared overlay pass so the gun
  never clips into the world — a hallmark of a polished FPS.

## The feel

Game feel is the sum of a hundred small responses. The big ones here:

- **Movement** — Quake/Source-style explicit ground/air acceleration with friction
  and stop-speed for crisp starts and stops, air-strafe acceleration, coyote time,
  jump buffering, a floaty variable-height jump, and a momentum-preserving
  crouch-slide — all following the rolling heightfield with snap-to-ground.
- **Gunplay** — hitscan with spread "bloom" that grows while you fire and move and
  recovers when you settle. Every shot drives recoil, an FOV punch, trauma-based
  screen shake, a muzzle flash + light, a tracer, spark burst and a spinning brass
  casing. Headshots hit harder. Two weapons: an automatic **carbine** and a
  hard-hitting **shotgun**.
- **Impact** — enemies flash on hit, snap back with knockback, spray a blood burst,
  and crumple through a scripted death instead of just vanishing. Meaty hits trigger
  a micro hit-stop; wiping out a threat dips the world into a brief kill slow-mo.
- **Arcade scoring** — a combo multiplier climbs as you chain kills without missing,
  headshots pay a bonus, and clearing a wave pays out. Floating score pops and a
  live combo meter keep the reward loop tight.

## The horde

Waves drip-spawn from the treeline and close on you from all sides. Five wildly
distinct creatures — each its own silhouette, size, signature colour, glowing
emissive accents (so you read them at a glance and they pop against the dusk),
signature-coloured blood, and its own gait and behaviour:

- **Husk** — ashen foot-soldier with amber eyes. The steady marcher; the backbone
  of every wave.
- **Stalker** — small, fast, hunched raptor-thing lit toxic green. Weaves as it
  runs and lunges the last few metres.
- **Juggernaut** — a towering charcoal tank with a molten-red core and cracks.
  Slow and relentless; the ground shakes when it walks and shrugs off knockback.
- **Wisp** — a legless hovering specter glowing cyan. Bobs and drifts over the
  terrain, unravelling into light when killed.
- **Bloater** — a bulbous pustular sack glowing orange. Waddles in and **ruptures**
  on death in a second, larger burst.

The roster unlocks and its mix ramps as the waves climb. Each wave is bigger than
the last — clear it for a bonus, brace for the next.

## Structure

```
index.html          importmap + canvas + boot
styles.css          HUD / menu styling
src/
  main.js           game loop, wiring, arcade scoring
  engine/           input, audio, math, FX (particles/shake/hitstop/slow-mo)
  gfx/post.js       HDR + bloom + tone-map composer
  world/            terrain, instanced foliage, sky + lighting + motes
  player/           terrain-following controller + camera rig
  weapons/          weapons + procedural viewmodels
  enemies/          procedural humanoid horde + wave manager
  ui/hud.js         HUD, menus, score pops, wave banners
vendor/             Three.js + addons (vendored for offline play)
```

No dependencies to install, no bundler, no framework. Just open it and hold the
field.
