// Bloom cursor interaction.
//
// Reads the cursor, decides how far open each flower should be, and hands that
// to the animation engine (window.Garden, defined in flowers/bouquet.js). The
// engine's springs do the smoothing; this file only decides *targets*.
//
//  - Proximity: every flower measures its own distance to the cursor and blooms
//    gradually between an inner and an outer radius (both scale with the flower).
//  - Hysteresis: a flower that has bloomed stays open briefly after the cursor
//    leaves, then fades slowly, so hovering on a boundary never flutters.
//  - Neighbours: a blooming flower gives nearby flowers a small partial opening
//    and a gentle sway.
//  - Click: bloom a flower fully and hold it open for a while; click it again
//    to close it. A small burst of ASCII sparks answers the click.
//  - Cursor source: the desktop-wide feed from the Electron preload
//    (window.bloomHost, added in Phase 5) when present, otherwise ordinary
//    pointer events inside the window.
(() => {
  'use strict';

  const G = window.Garden;
  if (!G) { console.warn('[bloom] window.Garden not found; cursor interaction disabled'); return; }

  // ---------- configuration (edit live via window.GardenCursor.config) ----------
  const CONFIG = {
    radiusScale: 1,        // multiplies every flower's interaction radius
    inner: 0.75,           // within inner x radius a flower opens fully
    outer: 2.1,            // beyond outer x radius the cursor has no effect
    holdMs: 700,           // stay open this long after the cursor leaves
    decayPerSec: 0.22,     // then close at this rate (1 / decay = seconds to fully close)
    deadband: 0.03,        // ignore target changes smaller than this
    neighbourRange: 200,   // world units: how far a blooming flower is felt
    neighbourStrength: 0.35,// partial opening given to the nearest neighbours (0..1)
    neighbourNudge: 0.35,  // sway kick given to neighbours when a flower wakes
    clickHit: 1.1,         // click area as a multiple of the flower radius
    pinMs: 12000,          // a clicked flower stays open this long
    closeLockMs: 2500,     // a flower closed by click ignores the cursor at least this long,
                           // and stays shut until the cursor has left it
    sparks: true,          // click burst of ASCII sparks
    maxFps: 30,            // update rate while the cursor is active
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  // ---------- per-flower interaction state ----------
  const state = G.flowers.map(() => ({
    held: 0,        // proximity bloom after hold + slow decay (0..1)
    holdUntil: 0,   // ms timestamp: keep `held` until then
    last: 0,        // last target sent to the engine
    pinUntil: 0,    // ms timestamp: clicked open until then
    lockUntil: 0,   // ms timestamp: clicked closed until then
    rearm: false,   // clicked closed: stays shut until the cursor has moved away
    awake: false,   // already woke its neighbours
  }));

  const cursor = { x: 0, y: 0, valid: false };
  let hoverCursor = false;
  let interactive = null;

  // ---------- cursor sources ----------
  // Desktop-wide: the Electron main process polls the system cursor and the
  // preload forwards window-relative CSS-pixel positions through window.bloomHost.
  // Otherwise: normal pointer events, which only work while the cursor is
  // over the window.
  const host = window.bloomHost && typeof window.bloomHost.onCursor === 'function' ? window.bloomHost : null;

  // ---------- click handling ----------
  function pickFlower(wx, wy) {
    let best = null, bestScore = Infinity;
    for (const f of G.flowers) {
      if (!G.isReady(f)) continue;
      const c = G.centerOf(f), R = G.radiusOf(f) * CONFIG.radiusScale * CONFIG.clickHit;
      const d = Math.hypot(wx - c[0], wy - c[1]);
      if (d > R) continue;
      // nearest centre wins; ties go to the flower in front (lower on screen)
      const score = d / R - f.stem[3][1] * 0.0005;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  function nudgeNeighbours(f, amount) {
    const c = G.centerOf(f);
    for (const o of G.flowers) {
      if (o === f) continue;
      const oc = G.centerOf(o);
      const d = Math.hypot(oc[0] - c[0], oc[1] - c[1]);
      if (d < CONFIG.neighbourRange) G.nudge(o, amount * (1 - d / CONFIG.neighbourRange));
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const [wx, wy] = G.cssToWorld(e.clientX, e.clientY);
    const f = pickFlower(wx, wy);
    if (!f) return;
    const s = state[f.id], now = performance.now();
    if (now < s.pinUntil) {
      // clicked again: close it, and let it rest for a moment
      s.pinUntil = 0;
      s.lockUntil = now + CONFIG.closeLockMs;
      s.rearm = true;
      s.held = 0; s.holdUntil = 0;
      burst(f, 0.5);
    } else {
      s.pinUntil = now + CONFIG.pinMs;
      s.lockUntil = 0;
      s.rearm = false;
      G.nudge(f, 0.6);
      nudgeNeighbours(f, CONFIG.neighbourNudge);
      burst(f, 1);
    }
    schedule();
  }

  // ---------- spark layer: a transparent canvas of ASCII glyphs above the garden ----------
  const layer = document.createElement('canvas');
  layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;';
  document.body.appendChild(layer);
  const lctx = layer.getContext('2d');
  let ldpr = 1;
  function sizeLayer() {
    ldpr = Math.min(window.devicePixelRatio || 1, 2);
    layer.width = Math.floor(window.innerWidth * ldpr);
    layer.height = Math.floor(window.innerHeight * ldpr);
  }

  const GLYPHS = ['*', '+', '.', 'o', ':', '*', '+'];
  const sparks = [];
  const lighten = (hex, t) => {
    const n = parseInt(String(hex).slice(1), 16) || 0xffffff;
    const ch = (v) => Math.round(v + (255 - v) * t);
    return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  };

  function burst(f, strength) {
    if (!CONFIG.sparks) return;
    const [cx, cy] = G.worldToCss(...G.centerOf(f));
    const reach = G.cssPerWorld() * G.radiusOf(f);        // flower radius in px
    const n = Math.round(16 * strength);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = reach * (0.9 + Math.random() * 1.1);
      sparks.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed * 0.8 - reach * 0.3,
        age: 0, life: 0.7 + Math.random() * 0.5,
        ch: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        color: lighten(f.col, 0.25 + Math.random() * 0.4),
      });
    }
  }

  // returns true while any spark is alive
  function stepSparks(dt) {
    const w = layer.width, h = layer.height;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, w, h);
    if (!sparks.length) return false;
    lctx.setTransform(ldpr, 0, 0, ldpr, 0, 0);
    lctx.font = 'bold 11px Menlo, Consolas, "DejaVu Sans Mono", monospace';
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.age += dt;
      if (p.age >= p.life) { sparks.splice(i, 1); continue; }
      const drag = Math.exp(-dt * 2.8);
      p.vx *= drag; p.vy = p.vy * drag + 14 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.age / p.life;
      lctx.globalAlpha = 1 - k * k;
      lctx.fillStyle = p.color;
      lctx.fillText(k > 0.65 ? '.' : p.ch, p.x, p.y);
    }
    lctx.globalAlpha = 1;
    return sparks.length > 0;
  }

  // ---------- main update ----------
  function update(now, dt) {
    const flowers = G.flowers;
    const centers = flowers.map((f) => G.centerOf(f));
    const cw = cursor.valid ? G.cssToWorld(cursor.x, cursor.y) : null;
    let working = false, overAny = false;

    // 1) direct proximity, with hold + slow decay
    for (const f of flowers) {
      if (!G.isReady(f)) continue;
      const s = state[f.id];
      const R = G.radiusOf(f) * CONFIG.radiusScale;
      let raw = 0;
      if (cw) {
        const d = Math.hypot(cw[0] - centers[f.id][0], cw[1] - centers[f.id][1]);
        raw = 1 - smoothstep(R * CONFIG.inner, R * CONFIG.outer, d);
        if (d <= R * CONFIG.clickHit) overAny = true;
      }
      if (s.rearm && raw === 0 && now >= s.lockUntil) s.rearm = false;
      if (raw >= s.held) { s.held = raw; s.holdUntil = now + CONFIG.holdMs; }
      else if (now >= s.holdUntil) s.held = Math.max(raw, s.held - CONFIG.decayPerSec * dt);
      if (now < s.lockUntil || s.rearm) { s.held = 0; s.holdUntil = 0; }

      // wake neighbours once per bloom
      if (s.held >= 0.5 && !s.awake) { s.awake = true; nudgeNeighbours(f, CONFIG.neighbourNudge); }
      else if (s.held < 0.15) s.awake = false;
    }

    // 2) neighbour sympathy, final targets, hand-off to the engine
    for (const f of flowers) {
      if (!G.isReady(f)) continue;
      const s = state[f.id];
      let sym = 0;
      for (const o of flowers) {
        if (o === f) continue;
        const so = state[o.id];
        if (so.held < 0.35) continue;
        const d = Math.hypot(centers[o.id][0] - centers[f.id][0], centers[o.id][1] - centers[f.id][1]);
        if (d >= CONFIG.neighbourRange) continue;
        const fall = 1 - d / CONFIG.neighbourRange;
        sym = Math.max(sym, so.held * CONFIG.neighbourStrength * fall);
      }
      let t = Math.max(s.held, sym);
      if (now < s.pinUntil) t = 1;
      if (now < s.lockUntil || s.rearm) t = 0;
      if (t < 0.012) t = 0;
      if (Math.abs(t - s.last) >= CONFIG.deadband || (t === 0 && s.last !== 0) || (t === 1 && s.last !== 1)) {
        G.setTarget(f, t, 0);
        s.last = t;
      }
      if (t > 0 || s.held > 0 || s.rearm || now < s.pinUntil || now < s.lockUntil) working = true;
    }

    // 3) pointer cursor over a flower; click-through hint for the Electron host
    if (!host && overAny !== hoverCursor) {
      hoverCursor = overAny;
      document.documentElement.style.cursor = overAny ? 'pointer' : 'default';
    }
    if (host && typeof host.setInteractive === 'function' && overAny !== interactive) {
      interactive = overAny;
      host.setInteractive(overAny);
    }
    return working || cursor.valid;
  }

  // ---------- loop: runs only while there is something to do ----------
  let rafId = 0, last = 0;
  function schedule() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function tick(now) {
    rafId = 0;
    if (now - last < 1000 / CONFIG.maxFps - 2) { schedule(); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const working = update(now, dt);
    const alive = stepSparks(dt);
    if (working || alive) schedule();
  }

  let unsubscribeHost = null;
  if (host) {
    unsubscribeHost = host.onCursor((p) => {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { cursor.x = p.x; cursor.y = p.y; cursor.valid = true; }
      else cursor.valid = false;
      schedule();
    });
  } else {
    on(window, 'pointermove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; cursor.valid = true; schedule(); }, { passive: true });
    on(document.documentElement, 'mouseleave', () => { cursor.valid = false; schedule(); });
  }
  on(window, 'pointerdown', onPointerDown);
  on(window, 'resize', sizeLayer);
  document.documentElement.style.userSelect = 'none';
  sizeLayer();

  function destroy() {
    cancelAnimationFrame(rafId);
    if (unsubscribeHost) unsubscribeHost();
    for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
    listeners.length = 0;
    layer.remove();
  }
  on(window, 'beforeunload', destroy);

  window.GardenCursor = { config: CONFIG, destroy };
  schedule();
})();