// Bloom: an interactive ASCII wildflower garden growing from the taskbar.
//
// Pipeline (unchanged): the scene is painted with vector shapes onto a tiny
// offscreen canvas (one pixel per character cell), then every lit pixel is
// redrawn as a coloured ASCII glyph whose density follows the pixel's brightness.
// The characters are the only thing that is ever shown.
//
// Structure:
//   - every plant is an independent object: its own root on the ground line,
//     its own stem curve, leaves, optional side branch, flower head, sway
//     parameters and bloom state. Nothing is shared between plants.
//   - the window's bottom edge IS the ground line (it sits exactly on top of
//     the taskbar), and every stem starts just below it, so there is never a gap.
//   - layout is data (PLANTS, below) in relative units and is recomputed
//     whenever the window size changes.
//   - each flower's `open` value (0 = closed bud, 1 = fully bloomed) follows a
//     critically damped spring toward a `target`; window.Garden exposes this
//     to the cursor module.
(() => {
  'use strict';

  // ---------- configuration ----------
  const CONFIG = {
    fps: 30,            // frame rate while something is animating
    idleFps: 15,        // frame rate while only the breeze is moving
    glow: true,         // soft bloom under the glyphs (set false to save CPU)
    shimmer: 0.05,      // fraction of glyphs that jitter one step (0 = off)
    shimmerRate: 3,     // how many times per second the jitter changes
    openSpeed: 1,       // >1 = blooms faster, <1 = slower
    closeRatio: 1.5,    // closing takes this many times longer than opening
    wind: 2,            // breeze strength multiplier
    minFont: 5,
    maxFont: 11,
  };

  const RAMP = ' .:-=+*cxoaX#%&@';
  const ROOT_GLYPH = RAMP.indexOf('X');   // the bottom row of glyphs is at least this dense

  // The garden is always 1000 world units tall; its width follows the window
  // shape (width = 1000 * windowWidth / windowHeight). World y = GROUND is the
  // bottom edge of the window, which sits on the taskbar.
  const WORLD_H = 1000;
  const GROUND = WORLD_H;

  // ---------- flower data (kept separate from the animation logic) ----------
  const TYPES = {
    lily: {
      size: 118, wid: 17, open: [3.0, 4.0],
      colors: ['#f08a2a', '#e9c63c', '#d24aa9', '#ffffff', '#f39ab2'],
      throat: '#e8d070',
      leaf: { n: [3, 5], len: [62, 98], w: [9, 13], spread: [28, 54], pair: false },
    },
    peony: {
      size: 80, layers: 3, petals: 7, notch: 0, open: [3.5, 4.5], sepalKeep: 0,
      colors: ['#e8325a', '#f4a6bd', '#d24a7a', '#f08aa8'],
      throat: '#f2b43a',
      leaf: { n: [4, 6], len: [54, 80], w: [15, 21], spread: [35, 60], pair: true },
    },
    cosmos: {
      size: 64, layers: 1, petals: 5, notch: 0.22, open: [2.2, 3.0], sepalKeep: 0,
      colors: ['#f6efe0', '#cfa6e0', '#e0a8d8', '#fff3e0'],
      throat: '#f08a2a',
      leaf: { n: [3, 5], len: [50, 76], w: [4, 6], spread: [22, 40], pair: false },
    },
    rosebud: {
      size: 46, layers: 2, petals: 5, notch: 0, open: [2.5, 3.5], sepalKeep: 0.55,
      colors: ['#f08aa8', '#ff7a6a', '#f4a6bd', '#e3233a'],
      throat: '#f2c04a',
      leaf: { n: [2, 3], len: [28, 44], w: [6, 8], spread: [30, 50], pair: false },
    },
  };

  // Plant layout, in relative units so it survives any screen size:
  //   ax     where the root sits across the window (0 = left edge, 1 = right edge)
  //   h      height of the stem top as a fraction of the garden height
  //   lean   how far the stem top drifts sideways from its root (world units)
  //   size   flower size multiplier
  //   reach  (optional) cursor interaction radius multiplier, default 1
  //   branch (optional) a side branch carrying a second, smaller flower
  // Roots are irregularly spaced, tall plants hug the right edge and the lower
  // plants sit between them; stems never cross or share a root. Stems near a
  // window edge lean inward automatically so no flower is ever cut off.
  const PLANTS = [
    { type: 'cosmos',  ax: 0.095, h: 0.22, lean: -8,  size: 0.80 },
    { type: 'rosebud', ax: 0.155, h: 0.34, lean: 10,  size: 1.00,
      branch: { t: 0.55, side: -1, dx: 38, dy: 66, type: 'rosebud', size: 0.70 } },
    { type: 'lily',    ax: 0.250, h: 0.47, lean: -12, size: 0.80 },
    { type: 'cosmos',  ax: 0.355, h: 0.30, lean: 8,   size: 0.90 },
    { type: 'peony',   ax: 0.450, h: 0.52, lean: -14, size: 0.85 },
    { type: 'rosebud', ax: 0.545, h: 0.24, lean: 10,  size: 0.95 },
    { type: 'cosmos',  ax: 0.620, h: 0.66, lean: 14,  size: 0.95,
      branch: { t: 0.5, side: 1, dx: 34, dy: 60, type: 'rosebud', size: 0.75 } },
    { type: 'peony',   ax: 0.700, h: 0.40, lean: -10, size: 0.85 },
    { type: 'lily',    ax: 0.785, h: 0.70, lean: -16, size: 0.90 },
    { type: 'rosebud', ax: 0.855, h: 0.46, lean: 6,   size: 1.00,
      branch: { t: 0.5, side: 1, dx: 30, dy: 56, type: 'cosmos', size: 0.60 } },
    { type: 'peony',   ax: 0.915, h: 0.84, lean: -20, size: 0.95 },
  ];

  // Palette 0 gives every flower its own colour from its type's list.
  // Palettes 1 and 2 are the original single-colour lily palettes.
  const PALETTES = [
    { mixed: true, vein: 'rgba(120,20,60,0.40)', anther: '#4a1d10', spots: true },
    {
      petal: '#f39ab2', edge: '#f9c3d2', blush: '#d99aa6', throat: '#c9dc78',
      vein: 'rgba(170,40,80,0.45)', anther: '#4a1d10', spots: true,
    },
    {
      petal: '#f6f2ea', edge: '#ffffff', blush: '#d8dcc0', throat: '#c8d87a',
      vein: 'rgba(120,130,90,0.4)', anther: '#8a3a16', spots: false,
    },
  ];

  // ---------- helpers ----------
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (r, [a, b]) => lerp(a, b, r());
  const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const rad = (d) => (d * Math.PI) / 180;

  function rgbOf(c) {
    if (c[0] === '#') {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c.match(/\d+/g).slice(0, 3).map(Number);
  }
  function mix(a, b, t) {
    const A = rgbOf(a), B = rgbOf(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }

  function bez(p, t) {
    const u = 1 - t;
    return [
      u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
      u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
    ];
  }
  function bezAngle(p, t) {
    const a = bez(p, Math.max(0, t - 0.01)), b = bez(p, Math.min(1, t + 0.01));
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  // ---------- breeze ----------
  // Seconds since the garden (re)started. Every plant sways with its own speed,
  // phase, amplitude and drift direction. The offset grows with height above the
  // ground and is exactly zero at the ground, so roots never leave the taskbar.
  let T = 0;
  function sway(x, y, ref) {
    if (!ref) return [x, y];
    const lift = Math.pow(clamp((ref.ground - y) / ref.span, 0, 1), 1.5);
    if (lift === 0) return [x, y];
    const gust = 1 + 0.5 * Math.max(0, Math.sin(T * 0.17 + ref.phase)) * Math.max(0, Math.sin(T * 0.11 + 1));
    const dx = (Math.sin(T * ref.speed + ref.phase + y * 0.004) + 0.5 * Math.sin(T * ref.speed * 0.47 + ref.phase2))
      * ref.amp * CONFIG.wind * gust
      + ref.bias
      + ref.kick * Math.sin(T * 7 + y * 0.01) * 10;
    return [x + dx * lift, y];
  }

  // ---------- scene ----------
  // Intro timeline (seconds): each stem grows up out of the ground line on its
  // own schedule, leaves unfurl, buds swell and blush. After that every flower
  // waits, closed, until something asks it to bloom.
  const BLUSH_DELAY = 1.4;

  let introEnd = 0;

  const newPts = () => [[0, 0], [0, 0], [0, 0], [0, 0]];
  const setPt = (p, x, y) => { p[0] = x; p[1] = y; };

  function buildScene() {
    const r = rng(11);
    const S = { plants: [], stems: [], leaves: [], flowers: [] };
    const colorCursor = {};

    function addLeaves(st, spec, spc, count) {
      for (let i = 0; i < count; i++) {
        const slot = spc.leaf.pair ? Math.floor(i / 2) : i;
        const slots = spc.leaf.pair ? Math.ceil(count / 2) : count;
        const t = 0.3 + (slot / slots) * 0.5 + r() * 0.04;     // leaves start above the root so stems stay clearly separate
        S.leaves.push({
          st, t, side: i % 2 ? 1 : -1,
          len: range(r, spc.leaf.len) * (0.8 + 0.4 * spec.size),
          w: range(r, spc.leaf.w),
          spread: rad(range(r, spc.leaf.spread)),
          start: st.start + st.dur * t + 0.15 + r() * 0.3,
          tint: r(), ph: r() * Math.PI * 2,
        });
      }
    }

    function addFlower(plant, st, type, size, lean, reach) {
      const spc = TYPES[type];
      const list = spc.colors;
      colorCursor[type] = colorCursor[type] ?? Math.floor(r() * list.length);
      const col = list[colorCursor[type] % list.length];
      colorCursor[type] += 1;

      const dir = rad(-90 + lean * 0.35 + (r() - 0.5) * 10);
      const grow = st.start + st.dur * 0.75 + r() * 0.5;
      const f = {
        id: S.flowers.length, plant, type, size, col, st, stem: st.pts, ref: st.ref, dir, reach,
        len: spc.size * size * (0.92 + r() * 0.16),
        wid: (spc.wid || 0) * size * (0.9 + r() * 0.2),
        squash: 0.6 + r() * 0.25,
        twist: (r() - 0.5) * 0.8,
        droop: rad((dir > rad(-90) ? 1 : -1) * (15 + r() * 20)),
        spin: (r() - 0.5) * 0.5,
        rnd: Array.from({ length: 16 }, r),
        grow,
        readyAt: Math.max(st.start + st.dur, grow + 2.2),
        // animation state
        open: 0, vel: 0, target: 0, cmdTarget: 0, cmdAt: null,
        openDur: range(r, spc.open),      // seconds to bloom
        delay: r() * 0.6,                 // reaction delay for discrete commands
      };
      S.flowers.push(f);
      return f;
    }

    PLANTS.forEach((spec, index) => {
      const spc = TYPES[spec.type];
      // every plant gets its own sway personality
      const ref = {
        ground: GROUND, span: 1,
        phase: r() * Math.PI * 2, phase2: r() * Math.PI * 2,
        speed: 0.7 + r() * 0.5,
        amp: 4 + spec.h * 7 + r() * 2,
        bias: (r() - 0.5) * 8,          // drifts a little to one side
        kick: 0,
      };
      const st = { pts: newPts(), ref, start: r() * 1.4, dur: 1.8 + spec.h * 1.4, width: 7 };
      const plant = { index, spec, ref, st, jx: (r() - 0.5) * 10, bow: (r() - 0.5) * 30, branch: null };
      S.plants.push(plant);
      S.stems.push(st);

      addLeaves(st, spec, spc, Math.max(2, Math.round(range(r, spc.leaf.n) * (0.7 + spec.h * 0.6))));
      plant.flower = addFlower(plant, st, spec.type, spec.size, spec.lean, spec.reach || 1);

      if (spec.branch) {
        const b = spec.branch;
        const bst = { pts: newPts(), ref, start: st.start + st.dur * b.t + 0.2, dur: 1.2, width: 5 };
        plant.branch = { spec: b, st: bst };
        S.stems.push(bst);
        addLeaves(bst, { size: b.size }, TYPES[b.type], 1);
        plant.branch.flower = addFlower(plant, bst, b.type, b.size, b.side * 14, spec.reach || 1);
      }
    });

    introEnd = Math.max(...S.flowers.map((f) => f.readyAt), 0);
    return S;
  }

  // Place every plant for a garden that is `worldW` units wide. Roots sit
  // exactly on the ground line (their curves start slightly below it, so the
  // window edge cuts them off flush with the taskbar). Called again whenever the
  // window size changes; arrays are updated in place so nothing else needs to know.
  function layoutPlants(S, worldW) {
    // half the width of a fully bloomed head (+ a little for sway), used to keep
    // every flower completely inside the window
    const extentOf = (f) => f.len * (f.type === 'lily' ? 1.25 : 1.05) + 6;

    for (const P of S.plants) {
      const { spec, st, ref } = P;
      const bx = clamp(spec.ax * worldW + P.jx, 24, worldW - 24);
      const topY = GROUND - spec.h * WORLD_H;
      // lean the stem inward if its flower would otherwise be cut off by a window edge
      const ext = extentOf(P.flower);
      const lean = clamp(bx + spec.lean, ext, worldW - ext) - bx;
      const p = st.pts;
      setPt(p[0], bx, GROUND + 30);
      setPt(p[1], bx + lean * 0.1 + P.bow * 0.3, lerp(GROUND, topY, 0.35));
      setPt(p[2], bx + lean * 0.75 - P.bow * 0.3, lerp(GROUND, topY, 0.72));
      setPt(p[3], bx + lean, topY);
      ref.span = Math.max(80, GROUND - topY);

      if (P.branch) {
        const b = P.branch.spec, q = P.branch.st.pts;
        const a = bez(p, b.t);
        const bext = extentOf(P.branch.flower);
        const endX = clamp(a[0] + b.side * b.dx, bext, worldW - bext);
        const dx = endX - a[0];
        setPt(q[0], a[0], a[1]);
        setPt(q[1], a[0] + dx * 0.1, a[1] - b.dy * 0.45);
        setPt(q[2], a[0] + dx * 0.7, a[1] - b.dy * 0.8);
        setPt(q[3], endX, a[1] - b.dy);
      }
    }
    // fixed back-to-front order (higher on screen = further back) so overlapping
    // flowers never swap places while they open and close
    S.draw = S.flowers.slice().sort((a, b) => a.stem[3][1] - b.stem[3][1]);
  }

  // ---------- animation engine ----------
  // Ask a flower to move toward `v` (0 closed .. 1 open). With a delay > 0 the
  // command is held back briefly (used for discrete triggers so flowers don't
  // all react in the same frame); pass 0 for continuous input.
  function setTarget(f, v, delay) {
    v = clamp(v, 0, 1);
    if (Math.abs(v - f.cmdTarget) < 0.001) return;
    f.cmdTarget = v;
    const d = delay === undefined ? f.delay : delay;
    if (d > 0) f.cmdAt = T + d; else { f.cmdAt = null; f.target = v; }
  }

  // Advance every flower by dt seconds. Each `open` value is a critically
  // damped spring: it eases in, eases out, never overshoots, and keeps its
  // velocity if the target changes mid-bloom, so reversing is just as smooth.
  // Returns true while anything is still moving (used to pick the frame rate).
  function stepFlowers(S, dt) {
    let busy = T < introEnd;
    for (const f of S.flowers) {
      if (f.cmdAt !== null && T >= f.cmdAt) { f.target = f.cmdTarget; f.cmdAt = null; }
      const tgt = T >= f.readyAt ? f.target : 0;
      const dur = (tgt >= f.open ? f.openDur : f.openDur * CONFIG.closeRatio) / CONFIG.openSpeed;
      const w = 4.6 / dur;
      f.vel += (w * w * (tgt - f.open) - 2 * w * f.vel) * dt;
      f.open += f.vel * dt;
      if (f.open < 0) { f.open = 0; f.vel = 0; } else if (f.open > 1) { f.open = 1; f.vel = 0; }
      f.ref.kick *= Math.exp(-dt * 2.2);
      if (Math.abs(f.vel) > 0.003 || Math.abs(f.open - tgt) > 0.003 || f.cmdAt !== null || f.ref.kick > 0.02) busy = true;
    }
    return busy;
  }

  // ---------- drawing ----------
  function strokeCurve(g, pts, from, upto, width, color, ref) {
    if (upto <= from) return;
    const N = 36;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = bez(pts, lerp(from, upto, i / N));
      const q = sway(p[0], p[1], ref);
      i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
    }
    g.lineWidth = width;
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.stroke();
  }

  function stemProgress(st) {
    return easeInOut(prog(T, st.start, st.dur));
  }

  function leafShape(g, L, W, bend) {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.25, -W, L * 0.7, -W * 0.8 + bend * 0.5, L, bend);
    g.bezierCurveTo(L * 0.7, W * 0.8 + bend * 0.5, L * 0.25, W, 0, 0);
  }

  function drawLeaf(g, lf) {
    const p = easeOut(prog(T, lf.start, 1.4));
    if (!p) return;
    const { pts, ref } = lf.st;
    const a = bez(pts, lf.t);
    const [x, y] = sway(a[0], a[1], ref);
    // leaves flutter a little on their own and lift when the plant is nudged
    const flutter = Math.sin(T * 1.6 + lf.ph) * 0.05 * p + ref.kick * Math.sin(T * 9 + lf.ph) * 0.08;
    const ang = bezAngle(pts, lf.t) + lf.side * lf.spread * (0.4 + 0.6 * p) + flutter;
    const L = lf.len * p, W = lf.w * (0.4 + 0.6 * p);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const bend = lf.side * L * 0.18 + Math.sin(T * 1.3 + lf.ph) * L * 0.03;
    leafShape(g, L, W, bend);
    const grad = g.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, '#2e6e22');
    grad.addColorStop(0.5, lf.tint > 0.5 ? '#4c9a2e' : '#3f8a2a');
    grad.addColorStop(1, '#78bc44');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = 'rgba(20,60,15,0.8)';
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.6, bend * 0.3, L * 0.95, bend * 0.95); g.stroke();
    g.restore();
  }

  // One tepal along +x (lily). Closed, six of these overlap into the club-shaped
  // bud; open, they fan out and their tips curl back.
  function tepal(g, L, W, color, edge, throat, vein, open, curl, spots, rnd) {
    const rc = smooth(0.45, 1, open);
    const tipX = L * (1 - 0.12 * rc), tipY = curl * W * 1.6 * rc;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.3, -W * 0.85, L * 0.72, -W * 1.05 + tipY * 0.3, tipX, tipY);
    g.bezierCurveTo(L * 0.72, W * 1.05 + tipY * 0.3, L * 0.3, W * 0.85, 0, 0);
    const grad = g.createLinearGradient(0, 0, L, 0);
    grad.addColorStop(0, throat);
    grad.addColorStop(lerp(0.45, 0.22, open), color);
    grad.addColorStop(1, edge);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = open > 0.2 ? vein : 'rgba(40,70,20,0.55)';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(L * 0.05, 0); g.quadraticCurveTo(L * 0.6, tipY * 0.2, tipX * 0.94, tipY * 0.9); g.stroke();
    if (spots && open > 0.6) {
      g.fillStyle = `rgba(110,15,40,${(open - 0.6) * 2})`;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(L * (0.18 + rnd[i] * 0.22), (rnd[i + 4] - 0.5) * W * 0.8, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Rounded petal along +x, optionally notched at the tip (cosmos).
  function petalPath(g, L, W, notch) {
    const n = notch * W;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.18, -W, L * 0.82, -W * 1.15, L, -W * 0.28);
    g.quadraticCurveTo(L + W * 0.12 - n * 1.5, 0, L, W * 0.28);
    g.bezierCurveTo(L * 0.82, W * 1.15, L * 0.18, W, 0, 0);
    g.closePath();
  }

  // petal indices, outermost of the fan first, so the middle petals overlap them
  const orderCache = {};
  function petalOrder(n) {
    if (!orderCache[n]) {
      orderCache[n] = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
    }
    return orderCache[n];
  }

  // Colours for one flower at this moment: green bud, blushing into its petal colour.
  function flowerLook(f, pal, blush) {
    const spc = TYPES[f.type];
    let petal, edge, tint, throat;
    if (pal.mixed) {
      petal = f.col;
      edge = mix(petal, '#ffffff', 0.3);
      tint = mix(petal, '#a8c85a', 0.45);
      throat = spc.throat;
    } else {
      petal = pal.petal; edge = pal.edge; tint = pal.blush; throat = pal.throat;
    }
    return {
      petal, edge, throat,
      bud: mix('#9cc63e', tint, blush),
      budEdge: mix('#b4d860', tint, blush),
    };
  }

  function drawLily(g, f, look, st, x, y, pal) {
    const { grow, open } = st;
    const L = f.len * (0.3 + 0.7 * grow) * (1 + 0.3 * open);
    const W = f.wid * (0.6 + 0.4 * grow) * (1 + 1.4 * open);
    const color = mix(look.bud, look.petal, smooth(0.05, 0.45, open));
    const edgeCol = mix(look.budEdge, look.edge, smooth(0.05, 0.45, open));
    const throat = mix('#8fbf3a', look.throat, open);
    const nod = Math.sin(T * 0.8 + f.ref.phase) * 0.04;

    g.save();
    g.translate(x, y);
    g.rotate(f.dir + f.droop * open + nod);
    g.scale(1, lerp(1, f.squash, open));
    g.fillStyle = '#5f9a34';
    g.beginPath(); g.ellipse(0, 0, 7, 5.5, 0, 0, Math.PI * 2); g.fill();
    g.rotate(f.twist * open);
    // back three tepals first, then the front three
    for (const k of [3, 1, -1, 2, -2, 0]) {
      g.save();
      g.rotate(rad(k * 60) * open);
      const wob = 1 + (f.rnd[(k + 3) % 12] - 0.5) * 0.12 * open;
      tepal(g, L * wob, W, color, edgeCol, throat, pal.vein, open, k === 0 ? 0.3 : Math.sign(k) || 1, pal.spots !== false, f.rnd);
      g.restore();
    }
    // stamens and pistil reach out once the tepals have parted
    const s = smooth(0.55, 1, open);
    if (s > 0) {
      for (let i = 0; i < 6; i++) {
        const a = rad(-28 + i * 11);
        const l = L * 0.72 * s * (0.92 + f.rnd[i] * 0.16);
        g.strokeStyle = '#d6dca8';
        g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(l * 0.5, a * l * 0.3, Math.cos(a) * l, Math.sin(a) * l); g.stroke();
        g.fillStyle = pal.anther;
        g.beginPath(); g.ellipse(Math.cos(a) * l, Math.sin(a) * l, 8.5, 3.5, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
      }
      const pl = L * 0.82 * s;
      g.strokeStyle = '#cfe0a0';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(pl, 0); g.stroke();
      g.fillStyle = '#86a83c';
      g.beginPath(); g.arc(pl, 0, 5.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // Peony, cosmos and rosebud: a front-facing rosette. Closed, every petal points
  // up and overlaps into a bud; opening fans the petals around the centre, outer
  // layers first, and the stamens appear last.
  function drawRosette(g, f, look, st, x, y, pal) {
    const spc = TYPES[f.type];
    const e = st.open;
    const R = f.len * (0.4 + 0.6 * st.grow);
    const col = mix(look.bud, look.petal, smooth(0.05, 0.45, e));
    const edge = mix(look.budEdge, look.edge, smooth(0.05, 0.45, e));
    const throat = mix('#8fbf3a', look.throat, e);
    const n = spc.petals;
    const order = petalOrder(n);

    g.save();
    g.translate(x, y);
    g.rotate(Math.sin(T * 0.8 + f.ref.phase) * 0.04);
    g.scale(1, lerp(1, 0.88, e));
    g.fillStyle = '#5f9a34';
    g.beginPath(); g.ellipse(0, 0, R * 0.14, R * 0.1, 0, 0, Math.PI * 2); g.fill();

    for (let layer = 0; layer < spc.layers; layer++) {
      const lf = 1 - layer * (spc.layers > 2 ? 0.3 : 0.28);
      const le = smooth(layer * 0.14, 0.6 + layer * 0.16, e);
      const spread = ((Math.PI * 2) / n) * le;
      const twist = layer * (Math.PI / n) * le + f.spin * le;
      const L = R * lf * lerp(0.82, 1, le);
      const W = R * lf * lerp(0.44, 0.5, le);
      const lcol = mix(col, '#ffffff', layer * 0.1);
      const ledge = mix(edge, '#ffffff', layer * 0.08);
      for (const i of order) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * spread + twist + (f.rnd[(i + layer * 3) % 16] - 0.5) * 0.08 * le;
        g.save();
        g.rotate(a);
        petalPath(g, L * (1 + (f.rnd[(i * 2 + layer) % 16] - 0.5) * 0.08 * le), W, spc.notch * le);
        const grad = g.createLinearGradient(0, 0, L, 0);
        grad.addColorStop(0, throat);
        grad.addColorStop(lerp(0.5, 0.25, le), lcol);
        grad.addColorStop(1, ledge);
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 4;
        g.stroke();
        if (le > 0.2) {
          g.strokeStyle = pal.vein;
          g.lineWidth = 2.5;
          g.beginPath(); g.moveTo(L * 0.12, 0); g.lineTo(L * 0.8, 0); g.stroke();
        }
        g.restore();
      }
    }

    // centre disc and stamens, last to appear
    const s = smooth(0.55, 1, e);
    if (s > 0) {
      g.fillStyle = look.throat;
      g.beginPath(); g.arc(0, 0, R * 0.17 * s, 0, Math.PI * 2); g.fill();
      const cnt = f.type === 'cosmos' ? 10 : 14;
      g.fillStyle = f.type === 'rosebud' ? '#f2c04a' : '#f2a52a';
      for (let i = 0; i < cnt; i++) {
        const ang = (i / cnt) * Math.PI * 2 + f.rnd[i % 16] * 0.4;
        const rr = R * (0.12 + 0.1 * f.rnd[(i + 5) % 16]) * s * 1.6;
        g.beginPath(); g.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, 2.8 * (0.5 + 0.5 * s), 0, Math.PI * 2); g.fill();
      }
    }

    // green sepals hug the bud, then peel back as it opens
    const keep = spc.sepalKeep || 0;
    const sa = lerp(1, keep, smooth(0.15, 0.55, e));
    if (sa > 0.02) {
      g.save();
      g.globalAlpha = sa;
      for (const k of [-2, -1, 0, 1, 2]) {
        g.save();
        g.rotate(-Math.PI / 2 + k * 0.3 + k * 0.55 * e);
        const SL = R * lerp(0.62, 0.5, e), SW = R * 0.13;
        leafShape(g, SL, SW, k * SL * 0.08);
        g.fillStyle = k % 2 ? '#4c9a2e' : '#5aa63a';
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 3.5;
        g.stroke();
        g.restore();
      }
      g.restore();
    }
    g.restore();
  }

  function budState(f) {
    return {
      grow: easeOut(prog(T, f.grow, 2.2)),
      blush: smooth(0, 1, prog(T, f.grow + BLUSH_DELAY, 2.5)) * 0.85,
      open: f.open,
    };
  }

  function drawFlower(g, f, pal) {
    if (stemProgress(f.st) < 0.98) return;
    const st = budState(f);
    if (!st.grow) return;
    const base = f.stem[3];
    const [x, y] = sway(base[0], base[1], f.ref);
    const look = flowerLook(f, pal, st.blush);
    if (f.type === 'lily') drawLily(g, f, look, st, x, y, pal);
    else drawRosette(g, f, look, st, x, y, pal);
  }

  // World-space centre and radius of a flower (used for cursor hit-testing).
  function centerOf(f) {
    const base = f.stem[3];
    const [x, y] = sway(base[0], base[1], f.ref);
    const grow = easeOut(prog(T, f.grow, 2.2));
    if (f.type === 'lily') {
      const L = f.len * (0.3 + 0.7 * grow) * (1 + 0.3 * f.open);
      return [x + Math.cos(f.dir) * L * 0.5, y + Math.sin(f.dir) * L * 0.5];
    }
    return [x, y - f.len * (0.4 + 0.6 * grow) * 0.45];
  }
  const radiusOf = (f) => f.len * (f.type === 'lily' ? 0.7 : 0.85) * f.reach;

  function drawScene(g, S, pal) {
    for (const st of S.stems) strokeCurve(g, st.pts, 0, stemProgress(st), st.width, '#5a9a30', st.ref);
    for (const lf of S.leaves) drawLeaf(g, lf);
    for (const f of S.draw) drawFlower(g, f, pal);
  }

  // ---------- ascii renderer ----------
  const screen = document.getElementById('flowerCanvas');
  const sctx = screen.getContext('2d');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });
  const glow = document.createElement('canvas');
  const gctx = glow.getContext('2d');
  let glowImg = null;

  let cols = 0, rows = 0, cellW = 0, cellH = 0, fontSize = 0, dpr = 1;
  // unit = CSS pixels per world unit; the garden fills the window height exactly.
  // The character grid is aligned to the BOTTOM edge of the window (gridTop <= 0),
  // so the last row of glyphs sits exactly on the ground line / taskbar edge.
  let view = { unit: 1, worldW: WORLD_H };
  let gridTop = 0;
  const styleCache = new Map();
  function style(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let s = styleCache.get(key);
    if (!s) { s = `rgb(${r},${g},${b})`; styleCache.set(key, s); }
    return s;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    fontSize = clamp(Math.floor(h / 120), CONFIG.minFont, CONFIG.maxFont);
    sctx.font = `bold ${fontSize}px Menlo, Consolas, "DejaVu Sans Mono", monospace`;
    cellW = sctx.measureText('M').width || fontSize * 0.6;
    cellH = fontSize;
    screen.width = Math.floor(w * dpr);
    screen.height = Math.floor(h * dpr);
    cols = Math.ceil(w / cellW);
    rows = Math.ceil(h / cellH);
    gridTop = h - rows * cellH;
    off.width = cols;
    off.height = rows;
    glow.width = cols;
    glow.height = rows;
    glowImg = gctx.createImageData(cols, rows);
    // the bottom edge of the window is the ground line, so world height maps
    // exactly onto window height and the width follows the window shape
    const unit = h / WORLD_H;
    view = { unit, worldW: w / unit };
    layoutPlants(S, view.worldW);
  }

  function render(pal) {
    // paint the scene into the low-res buffer, correcting for tall character cells.
    // The buffer is transparent, so only the plants produce glyphs.
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, cols, rows);
    octx.setTransform(view.unit / cellW, 0, 0, view.unit / cellH, 0, -gridTop / cellH);
    drawScene(octx, S, pal);

    const data = octx.getImageData(0, 0, cols, rows).data;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, screen.width, screen.height);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.font = `bold ${fontSize}px Menlo, Consolas, "DejaVu Sans Mono", monospace`;
    sctx.textBaseline = 'alphabetic';   // glyph ink rests on the cell's bottom edge

    const gd = CONFIG.glow ? glowImg.data : null;
    if (gd) gd.fill(0);
    const n = RAMP.length - 1;
    const flick = Math.floor(T * CONFIG.shimmerRate);
    const shim = Math.round(CONFIG.shimmer * 1000);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const a = data[i + 3];
        if (a < 24) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const m = Math.max(r, g, b);
        if (m < 14) continue;
        const v = (m / 255) * (a / 255);
        if (v < 0.05) continue;
        let j = 0;
        if (shim) {
          const h = ((x * 73856093) ^ (y * 19349663) ^ (flick * 83492791)) >>> 0;
          if (h % 1000 < shim) j = h & 8 ? 1 : -1;
        }
        let idx = clamp(Math.round(Math.pow(v, 0.7) * n) + j, 1, n);
        if (y === rows - 1) idx = Math.max(idx, ROOT_GLYPH);   // roots always reach the ground line
        const k = Math.min(1.25, (40 + 215 * v) / m);
        const cr = Math.min(255, (r * k) | 0) & 0xf8;
        const cg = Math.min(255, (g * k) | 0) & 0xf8;
        const cb = Math.min(255, (b * k) | 0) & 0xf8;
        sctx.fillStyle = style(cr, cg, cb);
        sctx.fillText(RAMP[idx], x * cellW, gridTop + (y + 1) * cellH);
        if (gd) { gd[i] = cr; gd[i + 1] = cg; gd[i + 2] = cb; gd[i + 3] = Math.min(255, v * 190); }
      }
    }
    if (gd) {
      // soft bloom drawn *behind* the glyphs, from lit cells only
      gctx.putImageData(glowImg, 0, 0);
      sctx.save();
      sctx.globalCompositeOperation = 'destination-over';
      sctx.globalAlpha = 0.5;
      sctx.filter = `blur(${Math.round(cellH * 0.4)}px)`;
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(glow, 0, gridTop, cols * cellW, rows * cellH);
      sctx.restore();
    }
  }

  // ---------- loop ----------
  const S = buildScene();
  let palette = 0;
  let t0 = performance.now();
  let lastDraw = 0;
  let busy = true;
  let rafId = 0;
  let demo = false;

  // Test driver: a travelling wave of blooms across the garden.
  function runDemo() {
    if (!demo) return;
    const c = T % 16;
    S.draw.forEach((f, i) => setTarget(f, c > 1 + i * 0.45 && c < 8 + i * 0.45 ? 1 : 0));
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (document.hidden) return;
    const interval = 1000 / (busy ? CONFIG.fps : CONFIG.idleFps);
    if (now - lastDraw < interval - 2) return;
    const dt = Math.min(0.1, (now - lastDraw) / 1000);
    lastDraw = now;
    T = (now - t0) / 1000;
    runDemo();
    busy = stepFlowers(S, dt);
    render(PALETTES[palette]);
  }

  function resetFlowers() {
    for (const f of S.flowers) { f.open = 0; f.vel = 0; f.target = 0; f.cmdTarget = 0; f.cmdAt = null; f.ref.kick = 0; }
  }
  const replay = () => { t0 = performance.now(); resetFlowers(); busy = true; };
  const openAll = () => S.flowers.forEach((f) => setTarget(f, 1));
  const closeAll = () => S.flowers.forEach((f) => setTarget(f, 0));

  const listeners = [];
  function on(target, type, fn) { target.addEventListener(type, fn); listeners.push([target, type, fn]); }

  on(window, 'resize', resize);
  on(document, 'visibilitychange', () => { lastDraw = 0; });
  on(window, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'r') replay();
    else if (k === 'p' || k === 'c') palette = (palette + 1) % PALETTES.length;
    else if (k === 'o') { demo = false; openAll(); }
    else if (k === 'k') { demo = false; closeAll(); }
    else if (k === 'd') { demo = !demo; if (!demo) closeAll(); }
  });

  function destroy() {
    cancelAnimationFrame(rafId);
    for (const [t, type, fn] of listeners) t.removeEventListener(type, fn);
    listeners.length = 0;
  }
  on(window, 'beforeunload', destroy);

  // ---------- public API (used by the cursor module) ----------
  window.Garden = {
    config: CONFIG,
    flowers: S.flowers,
    plants: S.plants,
    groundY: GROUND,
    setTarget, openAll, closeAll, replay, destroy,
    toggle: (f, delay) => setTarget(f, f.cmdTarget > 0.5 ? 0 : 1, delay),
    nudge: (f, amount) => { f.ref.kick = Math.min(1.5, f.ref.kick + amount); },
    isReady: (f) => T >= f.readyAt,
    centerOf, radiusOf,
    // a point along a flower's stem (t = 0 root .. 1 flower), swayed like the picture
    stemPoint: (f, t) => { const p = bez(f.stem, t); return sway(p[0], p[1], f.ref); },
    worldToCss: (x, y) => [x * view.unit, y * view.unit],
    cssToWorld: (px, py) => [px / view.unit, py / view.unit],
    cssPerWorld: () => view.unit,
  };

  // ?t=8 starts 8s in, ?p=1 picks a palette, ?demo=1 runs the bloom wave
  const q = new URLSearchParams(location.search);
  if (q.has('p')) palette = clamp(+q.get('p') | 0, 0, PALETTES.length - 1);
  if (q.has('t')) t0 = performance.now() - +q.get('t') * 1000;
  if (q.has('demo')) demo = true;

  resize();
  rafId = requestAnimationFrame(frame);
})();