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
| **WASD** | move — you're **always running** at full speed |
| **Mouse** | look · **Left click** fire · **Right click** aim (iron sights) |
| **Space** | jump — press again in the air for a **high double jump** |
| **Shift / F / Q / E · Mouse4** | **dash** — a fast i-frame lunge; **dash into enemies to strike** |
| **Ctrl / C** | crouch · **run + crouch** = slide |
| **1 / 2 / wheel** | switch weapons (carbine · shotgun) |
| **Esc** | pause |

**There is no reload.** DOOM-style: your ammo only comes from what enemies drop and
from **dash finishers**, so you have to stay aggressive to stay armed and alive.

**On mobile** it auto-switches to touch controls: a floating left-stick to move,
drag the right side to look, and on-screen **FIRE / JUMP / DASH / AIM / pause** buttons.

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

- **Movement** — Quake/Source-style ground/air acceleration on a rolling heightfield.
  You're **always running** at top speed, with air-strafe acceleration, coyote time,
  jump buffering, a variable-height jump, and a momentum-preserving crouch-slide.
- **Double jump** — tap jump again in the air for a strong second launch (one per
  airtime), with an air-burst ring and whoosh. Reach the high ground, juke the horde.
- **Dash & jump-dash** — a fast, committed lunge in your move direction (ground *or*
  air) with brief **i-frames**, a big FOV punch, camera roll, radial speed-lines, a
  whoosh and a dust kick. Dashing decays into carried momentum, so dash→jump keeps
  your speed. It's a dodge *and* a weapon.
- **Dash strike & finishers** — dashing **through** enemies smashes them: a shockwave
  ring, blood, heavy knockback and a per-body hit-stop, and you can carve through a
  whole crowd in one lunge (i-frames keep you safe). Catch one that's **low on health**
  and it's a **FINISHER** — a gold flash, slow-mo, bonus points, and (crucially) a
  refill of **ammo + health**. Aggression is how you sustain.
- **No reload — feed on the horde** — there's no magazine and only a trickle of passive
  regen. Every weapon draws from one pool that refills from enemy **ammo/health drops**
  (adaptive: more health when you're hurt) and from dash finishers. Glowing pickups
  magnetise into you. Push forward or run dry.
- **Iron sights** — hold right-click to bring the gun up, zoom in, tighten your spread
  and steady your aim (it drops you to a walk and calms the bob). Raising sights breaks
  your run; dashing breaks your sights.
- **Gunplay** — hitscan with spread "bloom" that grows while you fire and move. Every
  shot drives recoil, an FOV punch, screen shake, a muzzle flash + light, a tracer,
  spark burst and a spinning brass casing. Headshots hit harder. Carbine + shotgun.
- **Impact** — enemies flash on hit, snap back, spray signature-coloured blood, and
  crumple through a scripted death. Meaty hits trigger a micro hit-stop; wiping out a
  threat dips the world into a brief kill slow-mo (which the real-time dash cuts right
  through — you glide past frozen enemies).
- **Arcade scoring** — a combo multiplier climbs as you chain kills without missing,
  headshots and finishers pay bonuses, and clearing a wave pays out.

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
