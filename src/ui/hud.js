// HUD + menus. All DOM/CSS overlay (crisp text, cheap, no canvas redraw cost).
// Drives the dynamic crosshair (expands with spread, flashes on hits), health /
// ammo / score / wave readouts, the low-health + damage vignette with a
// directional hit indicator, world-anchored floating damage & score popups,
// and the start / pause / game-over screens.

import * as THREE from 'three';
import { clamp, clamp01, lerp } from '../engine/math.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.popups = [];     // floating world-anchored numbers
    this.dmgIndicators = [];
    this._build();
    this.health = 100;
    this.maxHealth = 100;
    this.crossBase = 6;
    this.crossSpread = 0;
    this.hitFlash = 0;
    this.killFlash = 0;
    this.dmgFlash = 0;
    this.hitFlashAmt = 0;
    this.lowHealthPulse = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this._tmp = new THREE.Vector3();
  }

  _build() {
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="timewarp"></div>
      <div id="dmg-vignette"></div>
      <div id="hit-flash"></div>
      <div id="hit-dir-layer"></div>
      <div id="crosshair">
        <div class="ch-dot"></div>
        <div class="ch line top"></div>
        <div class="ch line bottom"></div>
        <div class="ch line left"></div>
        <div class="ch line right"></div>
        <div class="ch-hit"></div>
      </div>
      <div id="popup-layer"></div>

      <div id="hud-bottom-left">
        <div id="health-wrap">
          <div id="health-icon">✛</div>
          <div id="health-bar"><div id="health-fill"></div></div>
          <div id="health-num">100</div>
        </div>
      </div>

      <div id="hud-bottom-right">
        <div id="weapon-name">PULSE RIFLE</div>
        <div id="ammo"><span id="ammo-mag">30</span><span id="ammo-sep">/</span><span id="ammo-reserve">210</span></div>
        <div id="reload-bar"><div id="reload-fill"></div></div>
      </div>

      <div id="hud-top">
        <div class="stat"><div class="stat-label">SCORE</div><div id="score" class="stat-val">0</div></div>
        <div class="stat"><div class="stat-label">WAVE</div><div id="wave" class="stat-val">1</div></div>
        <div class="stat"><div class="stat-label">ENEMIES</div><div id="enemies" class="stat-val">0</div></div>
      </div>

      <div id="combo">x<span id="combo-num">2</span></div>
      <div id="grind-ind">↯ GRIND <b id="grind-spd">0</b></div>
      <div id="banner"><div id="banner-main"></div><div id="banner-sub"></div></div>
      <div id="low-ammo">RELOAD</div>

      <div id="touch-controls">
        <div id="move-stick"><div id="move-knob"></div></div>
        <button id="touch-fire" class="tbtn">FIRE</button>
        <button id="touch-jump" class="tbtn small">JUMP</button>
        <button id="touch-reload" class="tbtn small">RLD</button>
        <button id="touch-pause" class="tbtn pause">❚❚</button>
      </div>

      <div id="overlay" class="show">
        <div id="overlay-card">
          <h1 id="game-title">NEON <span>BREACH</span></h1>
          <p id="game-tag">an FPS about amazing game feel</p>
          <div id="best-line"></div>
          <div id="overlay-body"></div>
          <button id="play-btn">CLICK TO PLAY</button>
          <div id="controls">
            <div><b>WASD</b> move</div><div><b>SPACE</b> jump</div>
            <div><b>SHIFT</b> sprint</div><div><b>CTRL</b> crouch / slide</div>
            <div><b>MOUSE</b> look · <b>L-CLICK</b> fire</div><div><b>R</b> reload</div>
            <div><b>1 2 3 / WHEEL</b> weapons</div><div><b>ESC</b> pause · <b>T</b> slow-mo</div>
          </div>
        </div>
      </div>`;

    this.el = {
      crosshair: q('#crosshair'),
      chHit: q('.ch-hit'),
      lines: { top: q('.ch.top'), bottom: q('.ch.bottom'), left: q('.ch.left'), right: q('.ch.right') },
      healthFill: q('#health-fill'),
      healthNum: q('#health-num'),
      healthWrap: q('#health-wrap'),
      weaponName: q('#weapon-name'),
      ammoMag: q('#ammo-mag'),
      ammoReserve: q('#ammo-reserve'),
      reloadBar: q('#reload-bar'),
      reloadFill: q('#reload-fill'),
      score: q('#score'),
      wave: q('#wave'),
      enemies: q('#enemies'),
      banner: q('#banner'),
      bannerMain: q('#banner-main'),
      bannerSub: q('#banner-sub'),
      lowAmmo: q('#low-ammo'),
      overlay: q('#overlay'),
      overlayBody: q('#overlay-body'),
      overlayCard: q('#overlay-card'),
      playBtn: q('#play-btn'),
      title: q('#game-title'),
      tag: q('#game-tag'),
      controls: q('#controls'),
      vignette: q('#dmg-vignette'),
      timewarp: q('#timewarp'),
      hitFlash: q('#hit-flash'),
      hitDirLayer: q('#hit-dir-layer'),
      popupLayer: q('#popup-layer'),
      combo: q('#combo'),
      comboNum: q('#combo-num'),
      grindInd: q('#grind-ind'),
      grindSpd: q('#grind-spd'),
      bestLine: q('#best-line'),
      touchControls: q('#touch-controls'),
      moveStick: q('#move-stick'),
      moveKnob: q('#move-knob'),
      touchFire: q('#touch-fire'),
      touchJump: q('#touch-jump'),
      touchReload: q('#touch-reload'),
      touchPause: q('#touch-pause'),
    };
  }

  // Reveal the on-screen touch controls (mobile).
  enableTouchUI() { this.root.classList.add('touch-mode'); }

  setBest(best) {
    if (best && best.score > 0) {
      this.el.bestLine.textContent = `BEST  ${best.score.toLocaleString()}  ·  WAVE ${best.wave}`;
      this.el.bestLine.style.display = '';
    } else {
      this.el.bestLine.style.display = 'none';
    }
  }

  // Position the floating move-stick visual from the input's stick state.
  renderTouchStick(stick) {
    if (!stick.active) { this.el.moveStick.style.opacity = '0'; return; }
    const max = 58;
    let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.el.moveStick.style.opacity = '1';
    this.el.moveStick.style.left = stick.ox + 'px';
    this.el.moveStick.style.top = stick.oy + 'px';
    this.el.moveKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // --- readouts ----------------------------------------------------------

  setHealth(hp, max = this.maxHealth) {
    this.maxHealth = max;
    const prev = this.health;
    this.health = hp;
    const r = clamp01(hp / max);
    this.el.healthFill.style.width = (r * 100) + '%';
    this.el.healthFill.style.background = healthColor(r);
    this.el.healthNum.textContent = Math.max(0, Math.ceil(hp));
    if (hp < prev) {
      this.el.healthWrap.classList.remove('pulse');
      void this.el.healthWrap.offsetWidth;
      this.el.healthWrap.classList.add('pulse');
    }
  }

  setAmmo(a) {
    this.el.weaponName.textContent = a.name;
    this.el.ammoMag.textContent = a.mag;
    this.el.ammoReserve.textContent = a.reserve > 900 ? '∞' : a.reserve;
    this.el.ammoMag.classList.toggle('empty', a.mag === 0);
    this.el.lowAmmo.classList.toggle('show', a.mag === 0 && !a.reloading);
    this.reloading = a.reloading;
    this.el.reloadBar.classList.toggle('show', a.reloading);
  }

  setReloadProgress(t) {
    this.el.reloadFill.style.width = (clamp01(t) * 100) + '%';
  }

  setScore(n) { this.el.score.textContent = n.toLocaleString(); }
  setWave(n) { this.el.wave.textContent = n; }
  setEnemies(n) { this.el.enemies.textContent = n; }

  setGrind(active, speed) {
    this.el.grindInd.classList.toggle('show', active);
    if (active) this.el.grindSpd.textContent = Math.round(speed * 3.6); // show as km/h-ish for flavor
  }

  // Visual time-warp cue: a blue edge tint that deepens as time slows (slowmo 1
  // = normal, lower = slower). Makes the kill slow-mo unmistakable.
  setTimewarp(slowmo) {
    const amt = clamp01((1 - slowmo) * 1.5);
    this.el.timewarp.style.opacity = amt.toFixed(3);
  }

  setSpread(spread) {
    // map firing spread (radians) to crosshair gap in px
    this.crossSpread = clamp(spread * 700, 0, 60);
  }

  // --- feedback ----------------------------------------------------------

  hitMarker(isHead, isKill) {
    this.hitFlash = 1;
    if (isKill) this.killFlash = 1;
    this.el.chHit.classList.remove('show', 'head', 'kill');
    void this.el.chHit.offsetWidth;
    this.el.chHit.classList.add('show');
    if (isHead) this.el.chHit.classList.add('head');
    if (isKill) this.el.chHit.classList.add('kill');
  }

  registerKill() {
    this.combo++;
    this.comboTimer = 3;
    if (this.combo >= 2) {
      this.el.comboNum.textContent = this.combo;
      this.el.combo.classList.remove('show');
      void this.el.combo.offsetWidth;
      this.el.combo.classList.add('show');
    }
  }

  damageFlash(intensity, sourcePos, camera) {
    const i = clamp01(intensity);
    this.dmgFlash = Math.max(this.dmgFlash, 0.6 + i * 0.4);   // lingering red vignette
    this.hitFlashAmt = Math.max(this.hitFlashAmt, 0.5 + i * 0.45); // sharp instant punch
    this.el.healthWrap.classList.remove('hit');
    void this.el.healthWrap.offsetWidth;
    this.el.healthWrap.classList.add('hit');
    if (sourcePos && camera) this._spawnDirIndicator(sourcePos, camera);
  }

  _spawnDirIndicator(sourcePos, camera) {
    const el = document.createElement('div');
    el.className = 'hit-dir';
    this.el.hitDirLayer.appendChild(el);
    this.dmgIndicators.push({ el, life: 2.0, max: 2.0, sourcePos: sourcePos.clone() });
  }

  popDamage(worldPos, amount, isHead, camera) {
    const el = document.createElement('div');
    el.className = 'popup dmg' + (isHead ? ' head' : '');
    el.textContent = Math.round(amount);
    this.el.popupLayer.appendChild(el);
    this.popups.push({
      el, life: isHead ? 1.1 : 0.85, maxLife: isHead ? 1.1 : 0.85,
      world: worldPos.clone(), vy: 1.6, drift: (Math.random() - 0.5) * 0.8, camera,
    });
  }

  popScore(worldPos, amount, camera) {
    const el = document.createElement('div');
    el.className = 'popup score';
    el.textContent = '+' + amount;
    this.el.popupLayer.appendChild(el);
    this.popups.push({
      el, life: 1.3, maxLife: 1.3, world: worldPos.clone().add(new THREE.Vector3(0, 1.3, 0)),
      vy: 1.0, drift: 0, camera,
    });
  }

  banner(main, sub = '', color = '#7df9ff') {
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    this.el.bannerMain.style.color = color;
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  // --- overlays ----------------------------------------------------------

  showStart() {
    this.el.title.innerHTML = 'NEON <span>BREACH</span>';
    this.el.tag.textContent = 'an FPS about amazing game feel';
    this.el.overlayBody.innerHTML = '';
    this.el.playBtn.textContent = 'CLICK TO PLAY';
    this.el.controls.style.display = '';
    this.el.overlay.classList.add('show');
    this.el.overlayCard.classList.remove('dead');
  }

  showPause() {
    this.el.title.innerHTML = 'PAUSED';
    this.el.tag.textContent = '';
    this.el.overlayBody.innerHTML = '';
    this.el.playBtn.textContent = 'RESUME';
    this.el.controls.style.display = '';
    this.el.overlay.classList.add('show');
    this.el.overlayCard.classList.remove('dead');
  }

  showGameOver(stats) {
    this.el.title.innerHTML = 'YOU DIED';
    this.el.tag.textContent = '';
    const newBest = stats.newBest
      ? `<div class="newbest">★ NEW BEST ★</div>`
      : (stats.best ? `<div class="prevbest">best ${stats.best.toLocaleString()}</div>` : '');
    this.el.overlayBody.innerHTML = `
      ${newBest}
      <div class="result">
        <div><span>${stats.score.toLocaleString()}</span>SCORE</div>
        <div><span>${stats.wave}</span>WAVES</div>
        <div><span>${stats.kills}</span>KILLS</div>
        <div><span>${stats.time}</span>TIME</div>
      </div>`;
    this.el.playBtn.textContent = 'PLAY AGAIN';
    this.el.controls.style.display = 'none';
    this.el.overlay.classList.add('show');
    this.el.overlayCard.classList.add('dead');
  }

  hideOverlay() { this.el.overlay.classList.remove('show'); }

  // --- per-frame ---------------------------------------------------------

  update(dt, camera) {
    // crosshair gap = base + live weapon spread (already damped by the weapon)
    const gap = this.crossBase + this.crossSpread;
    const L = this.el.lines;
    L.top.style.transform = `translate(-50%, ${-gap - 8}px)`;
    L.bottom.style.transform = `translate(-50%, ${gap}px)`;
    L.left.style.transform = `translate(${-gap - 8}px, -50%)`;
    L.right.style.transform = `translate(${gap}px, -50%)`;

    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.killFlash = Math.max(0, this.killFlash - dt * 3);

    // combined damage + low-health red vignette, all driven from JS
    const lowT = clamp01(1 - this.health / (this.maxHealth * 0.4));
    this.lowHealthPulse += dt * lerp(2, 8, lowT);
    const lowBase = lowT * (0.16 + (Math.sin(this.lowHealthPulse) * 0.5 + 0.5) * 0.22 * lowT);
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.3);
    this.el.vignette.style.opacity = Math.max(this.dmgFlash, lowBase).toFixed(3);
    this.hitFlashAmt = Math.max(0, this.hitFlashAmt - dt * 4.5);
    this.el.hitFlash.style.opacity = this.hitFlashAmt.toFixed(3);

    // combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.el.combo.classList.remove('show'); }
    }

    // floating popups
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.world.y += p.vy * dt;
      p.world.x += p.drift * dt;
      this._tmp.copy(p.world).project(camera);
      const behind = this._tmp.z > 1;
      if (behind) { p.el.style.opacity = '0'; }
      else {
        const x = (this._tmp.x * 0.5 + 0.5) * w;
        const y = (-this._tmp.y * 0.5 + 0.5) * h;
        const t = clamp01(p.life / p.maxLife);
        p.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${lerp(0.7, 1.15, clamp01((p.maxLife - p.life) * 6)) * lerp(0.8, 1, t)})`;
        p.el.style.opacity = String(clamp01(t * 1.6));
      }
      if (p.life <= 0) { p.el.remove(); this.popups.splice(i, 1); }
    }

    // directional damage indicators
    for (let i = this.dmgIndicators.length - 1; i >= 0; i--) {
      const d = this.dmgIndicators[i];
      d.life -= dt;
      // angle from camera forward to source, on the horizontal plane
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      const camYaw = Math.atan2(fwd.x, fwd.z);
      const dx = d.sourcePos.x - camera.position.x;
      const dz = d.sourcePos.z - camera.position.z;
      const srcYaw = Math.atan2(dx, dz);
      let rel = srcYaw - camYaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      d.el.style.transform = `translate(-50%,-50%) rotate(${-rel}rad) translateY(-180px)`;
      d.el.style.opacity = String(clamp01(d.life / (d.max || 2.0)));
      if (d.life <= 0) { d.el.remove(); this.dmgIndicators.splice(i, 1); }
    }
  }
}

function q(sel) { return document.querySelector(sel); }

function healthColor(r) {
  if (r > 0.5) return 'linear-gradient(90deg,#3affc0,#7df9ff)';
  if (r > 0.25) return 'linear-gradient(90deg,#ffd23f,#ff9a3f)';
  return 'linear-gradient(90deg,#ff5a4d,#ff2d6b)';
}
