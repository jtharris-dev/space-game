// ============================================================
// COSMIC FRONTIER — Scene Renderer
// Photorealistic planet surfaces + rocket launch + warp travel
// ============================================================

const Scenes = (() => {
  'use strict';

  let canvas, ctx;
  let currentLocation = null;
  let animFrame = null;
  let t = 0, lastAnimTime = 0;

  // Mission animation state
  let missionData   = null;  // current activeMission object
  let missionAnimT0 = 0;     // real-time when mission animation started
  let hasRocket     = false; // whether player has rockets in hangar

  // ── Seeded PRNG (Mulberry32) ─────────────────────────────
  function rng32(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Procedural terrain ───────────────────────────────────
  function genTerrain(w, seed, roughness, oct) {
    const pts = new Float32Array(w + 1);
    for (let x = 0; x <= w; x++) {
      let y = 0, amp = 1, freq = 1;
      for (let o = 0; o < oct; o++) {
        y += Math.sin((x / w) * Math.PI * 2 * freq + seed * (o + 1) * 1.3) * amp;
        y += Math.cos((x / w) * Math.PI * 3.7 * freq + seed * (o + 2) * 0.7) * amp * 0.45;
        amp *= 0.52; freq *= 2.1;
      }
      pts[x] = y * roughness;
    }
    return pts;
  }

  function fillTerrain(pts, baseY, w, h, style) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, baseY + pts[0]);
    for (let x = 1; x <= w; x++) ctx.lineTo(x, baseY + pts[x]);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }

  // ── Stars ─────────────────────────────────────────────────
  function drawStars(density, alpha, seed) {
    const w = canvas.width / dpr(), h = canvas.height / dpr();
    const r = rng32(seed || 42);
    const n = (w * h * density) | 0;
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h * 0.82;
      const radius = 0.25 + r() * 1.3;
      const bright = 0.35 + r() * 0.65;
      const twinkle = 0.7 + 0.3 * Math.sin(t * 1.6 + i * 0.41);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${bright * alpha * twinkle})`;
      ctx.fill();
    }
  }

  // ── Sun/star disc ─────────────────────────────────────────
  function drawSun(cx, cy, rad, R, G, B, corona) {
    const cr = rad * corona;
    const cg = ctx.createRadialGradient(cx, cy, rad * 0.3, cx, cy, cr);
    cg.addColorStop(0,    `rgba(${R},${G},${B},0.70)`);
    cg.addColorStop(0.3,  `rgba(${R},${G},${B},0.30)`);
    cg.addColorStop(0.65, `rgba(${R},${G},${B},0.08)`);
    cg.addColorStop(1,    `rgba(${R},${G},${B},0)`);
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = cg; ctx.fill();

    const dg = ctx.createRadialGradient(cx - rad * 0.2, cy - rad * 0.2, 0, cx, cy, rad);
    dg.addColorStop(0, '#ffffff');
    dg.addColorStop(0.6, `rgb(${R},${G},${B})`);
    dg.addColorStop(1, `rgb(${Math.max(0,R-40)},${Math.max(0,G-40)},${Math.max(0,B-40)})`);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = dg; ctx.fill();
  }

  function dpr() { return window.devicePixelRatio || 1; }
  function W() { return canvas.width / dpr(); }
  function H() { return canvas.height / dpr(); }

  // ── Rocket drawing ─────────────────────────────────────────
  function drawRocket(cx, baseY, scale, phase) {
    // phase 0 = idle on pad, 0-1 = ascending
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(scale, scale);

    const flameIntensity = Math.max(0.2, phase > 0 ? 1.0 : 0.3 + 0.15 * Math.sin(t * 8));
    const flameH = (45 + Math.sin(t * 15) * 12) * flameIntensity;

    // Outer flame
    if (flameIntensity > 0.1) {
      const fg = ctx.createRadialGradient(0, flameH * 0.4, 0, 0, flameH * 0.5, flameH * 0.9);
      fg.addColorStop(0,   `rgba(255,255,180,${flameIntensity * 0.9})`);
      fg.addColorStop(0.25,`rgba(255,140,40,${flameIntensity * 0.7})`);
      fg.addColorStop(0.6, `rgba(255,70,10,${flameIntensity * 0.4})`);
      fg.addColorStop(1,   'rgba(255,30,0,0)');
      ctx.beginPath();
      ctx.ellipse(0, flameH * 0.5, 13 * flameIntensity, flameH * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = fg; ctx.fill();

      // Shock diamonds (mach diamonds in exhaust)
      for (let d = 0; d < 4; d++) {
        const dy = 8 + d * 14;
        const sr = (4 - d) * 4;
        ctx.beginPath();
        ctx.ellipse(0, dy, sr * 0.8, sr * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,220,100,${0.7 - d * 0.15})`;
        ctx.fill();
      }
    }

    // Engine bells (3)
    [-11, 0, 11].forEach(ex => {
      const eg = ctx.createLinearGradient(ex - 6, 0, ex + 6, 0);
      eg.addColorStop(0, '#1a1f28');
      eg.addColorStop(0.5, '#3a4050');
      eg.addColorStop(1, '#1a1f28');
      ctx.beginPath();
      ctx.moveTo(ex - 5, 0); ctx.lineTo(ex - 7, 12); ctx.lineTo(ex + 7, 12); ctx.lineTo(ex + 5, 0);
      ctx.fillStyle = eg; ctx.fill();
    });

    // Fins (4)
    [[-14, -1], [14, 1]].forEach(([fx, side]) => {
      ctx.beginPath();
      ctx.moveTo(side * 12, -15);
      ctx.lineTo(fx, 8);
      ctx.lineTo(side * 12, 5);
      ctx.closePath();
      const finG = ctx.createLinearGradient(0, 0, fx, 0);
      finG.addColorStop(0, '#3a5080');
      finG.addColorStop(1, '#1a2840');
      ctx.fillStyle = finG; ctx.fill();
    });

    // Main body
    const bodyG = ctx.createLinearGradient(-14, 0, 14, 0);
    bodyG.addColorStop(0,   '#1a2540');
    bodyG.addColorStop(0.25,'#2e4470');
    bodyG.addColorStop(0.55,'#4a6898');
    bodyG.addColorStop(0.75,'#3a5480');
    bodyG.addColorStop(1,   '#1a2540');
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-14, -78);
    ctx.lineTo(-10, -90); ctx.lineTo(10, -90);
    ctx.lineTo(14, -78); ctx.lineTo(14, 0);
    ctx.closePath();
    ctx.fillStyle = bodyG; ctx.fill();

    // Body highlight strip (specular)
    ctx.beginPath();
    ctx.moveTo(-5, -5); ctx.lineTo(-5, -82); ctx.lineTo(-2, -88); ctx.lineTo(2, -88); ctx.lineTo(2, -5);
    ctx.fillStyle = 'rgba(200,220,255,0.10)'; ctx.fill();

    // Red accent stripe
    ctx.fillStyle = 'rgba(220,60,60,0.85)';
    ctx.fillRect(-14, -32, 28, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-14, -32, 28, 1.5);

    // Nosecone
    const noseG = ctx.createLinearGradient(-12, -130, 12, -90);
    noseG.addColorStop(0, '#c0ccd8');
    noseG.addColorStop(0.4, '#8898b0');
    noseG.addColorStop(1, '#3a5480');
    ctx.beginPath();
    ctx.moveTo(-10, -90); ctx.quadraticCurveTo(-10,-118,0,-128);
    ctx.quadraticCurveTo(10,-118,10,-90);
    ctx.closePath();
    ctx.fillStyle = noseG; ctx.fill();

    // Porthole windows (2)
    [-52, -70].forEach(wy => {
      const wg = ctx.createRadialGradient(-2, wy - 2, 0, 0, wy, 7);
      wg.addColorStop(0, 'rgba(180,230,255,0.5)');
      wg.addColorStop(0.6, 'rgba(80,160,255,0.3)');
      wg.addColorStop(1, 'rgba(0,80,160,0.6)');
      ctx.beginPath(); ctx.arc(0, wy, 7, 0, Math.PI * 2);
      ctx.fillStyle = wg; ctx.fill();
      ctx.strokeStyle = 'rgba(100,200,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.stroke();
      // window glint
      ctx.beginPath(); ctx.arc(-2, wy - 2, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
    });

    // Nose tip marker
    ctx.beginPath(); ctx.arc(0, -128, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#e04040'; ctx.fill();

    ctx.restore();
  }

  // ── Launch exhaust trail ──────────────────────────────────
  function drawExhaustTrail(cx, rocketY, phase, w, h) {
    const trailLen = Math.min(h, phase * h * 2.5);
    if (trailLen < 5) return;

    const trailGrad = ctx.createLinearGradient(cx, rocketY, cx, rocketY + trailLen);
    trailGrad.addColorStop(0,   'rgba(255,200,80,0.75)');
    trailGrad.addColorStop(0.15,'rgba(255,120,30,0.55)');
    trailGrad.addColorStop(0.4, 'rgba(255,70,10,0.30)');
    trailGrad.addColorStop(0.7, 'rgba(200,40,5,0.12)');
    trailGrad.addColorStop(1,   'rgba(150,20,0,0)');

    const trailW = 16 * Math.max(0.2, 1 - phase * 0.6);
    ctx.beginPath();
    ctx.ellipse(cx, rocketY + trailLen * 0.5, trailW, trailLen * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = trailGrad; ctx.fill();

    // Smoke dissipation puffs
    const r = rng32(Math.floor(t * 3));
    for (let i = 0; i < 8; i++) {
      const py = rocketY + 30 + i * trailLen / 8;
      const px = cx + (r() - 0.5) * 20 * (i / 8);
      const pr = 6 + r() * 12 + i * 4;
      const pa = (0.12 - i * 0.013) * Math.max(0, 1 - phase * 0.8);
      if (pa <= 0) continue;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,160,140,${pa})`;
      ctx.fill();
    }
  }

  // ── Warp / hyperspace travel ──────────────────────────────
  function renderWarp(w, h) {
    // Deep space bg
    ctx.fillStyle = '#000008';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(w * w + h * h) / 2 + 50;
    const r = rng32(123);
    const speed = 0.55;

    ctx.save();
    // Use globalCompositeOperation for additive glow
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 220; i++) {
      const angle = r() * Math.PI * 2;
      const startD = r() * maxDist;
      const phase  = r();
      const d = ((startD + t * speed * maxDist + phase * maxDist) % maxDist);
      const tailLen = d * 0.20 + 8;
      const headD = d, tailD = Math.max(0, d - tailLen);

      const hx = cx + Math.cos(angle) * headD, hy = cy + Math.sin(angle) * headD;
      const tx = cx + Math.cos(angle) * tailD, ty = cy + Math.sin(angle) * tailD;

      const bright = Math.min(1, d / (maxDist * 0.25)) * (0.4 + r() * 0.6);
      const lw = 0.4 + r() * 1.8;
      const hue = r() < 0.15 ? `rgba(180,210,255,` : `rgba(255,255,255,`;

      const lg = ctx.createLinearGradient(tx, ty, hx, hy);
      lg.addColorStop(0, `${hue}0)`);
      lg.addColorStop(1, `${hue}${bright})`);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
      ctx.strokeStyle = lg; ctx.lineWidth = lw; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Central lens flare / warp tunnel mouth
    const tunnelGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.35);
    tunnelGrad.addColorStop(0,    'rgba(60,120,255,0.18)');
    tunnelGrad.addColorStop(0.35, 'rgba(30,70,180,0.10)');
    tunnelGrad.addColorStop(0.7,  'rgba(10,30,100,0.05)');
    tunnelGrad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = tunnelGrad; ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  // ── Launch sequence ───────────────────────────────────────
  function renderLaunch(w, h, elapsed, fromLoc) {
    // elapsed: seconds since launch began
    // Phase 0–3s  : engines ignite on pad
    // Phase 3–9s  : liftoff and ascent
    // Phase 9–16s : upper atmosphere
    // Phase 16s+  : transition to warp

    const p = Math.min(1, elapsed / 16); // overall 0-1

    // Render planet surface beneath (with pan-up effect)
    const panOffset = Math.pow(Math.max(0, p - 0.18), 1.4) * h * 2.2;
    ctx.save();
    ctx.translate(0, panOffset);
    const fn = SCENES[fromLoc] || SCENES.earth;
    fn(w, h);
    ctx.restore();

    // Space overlay — darkens as altitude increases
    const spaceA = Math.pow(Math.max(0, p - 0.22), 1.5);
    const spaceGrad = ctx.createLinearGradient(0, 0, 0, h);
    spaceGrad.addColorStop(0, `rgba(0,0,8,${spaceA * 0.95})`);
    spaceGrad.addColorStop(0.55, `rgba(0,0,15,${spaceA * 0.5})`);
    spaceGrad.addColorStop(1, `rgba(0,2,30,${spaceA * 0.1})`);
    ctx.fillStyle = spaceGrad; ctx.fillRect(0, 0, w, h);

    // Stars fade in
    if (p > 0.35) drawStars(0.00022, (p - 0.35) / 0.65 * 0.9, 42);

    // Rocket position: starts at surface (h*0.62), rises fast then exits top
    const rocketPhase = Math.max(0, elapsed - 2.5) / 13; // 0→1 over 13s
    const rocketBaseY = h * 0.62 - Math.pow(rocketPhase, 1.6) * h * 2.2;
    const rocketScale = Math.max(0.25, 1.0 - rocketPhase * 0.65) * 1.6;

    // Draw exhaust trail
    if (elapsed > 2.5 && rocketBaseY < h + 200) {
      drawExhaustTrail(w * 0.5, rocketBaseY, rocketPhase, w, h);
    }

    // Draw rocket (visible until it exits the top)
    if (rocketBaseY > -160 * rocketScale) {
      drawRocket(w * 0.5, rocketBaseY, rocketScale, rocketPhase);
    }

    // Ground engine glow during ignition (0–3s)
    if (elapsed < 4.5) {
      const glow = Math.sin(Math.min(1, elapsed / 1.5) * Math.PI * 0.5);
      const gg = ctx.createRadialGradient(w*0.5, h*0.65, 0, w*0.5, h*0.65, w * 0.45);
      gg.addColorStop(0, `rgba(255,160,30,${glow * 0.30})`);
      gg.addColorStop(0.5, `rgba(255,80,10,${glow * 0.12})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
    }

    // Transition to warp: streak acceleration at the end
    if (p > 0.85) {
      const warpA = (p - 0.85) / 0.15;
      ctx.globalAlpha = warpA;
      renderWarp(w, h);
      ctx.globalAlpha = 1;
    }
  }

  // ── Arrival sequence ─────────────────────────────────────
  function renderArrival(w, h, arrivalProgress, toLoc) {
    // arrivalProgress 0→1: warp decelerates, planet surface appears

    // Decelerate warp (streaks shorten)
    ctx.save();
    ctx.globalAlpha = 1 - arrivalProgress * 0.9;
    renderWarp(w, h);
    ctx.restore();

    // Planet surface grows in from horizon
    ctx.save();
    const panIn = (1 - arrivalProgress) * h * 2.0;
    ctx.translate(0, panIn);
    ctx.globalAlpha = arrivalProgress;
    const fn = SCENES[toLoc] || SCENES.earth;
    fn(w, h);
    ctx.restore();

    // Flash on arrival
    if (arrivalProgress > 0.88) {
      const flash = Math.pow((arrivalProgress - 0.88) / 0.12, 2) * 0.4;
      ctx.fillStyle = `rgba(200,220,255,${flash})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Ground level (fraction of h) per location — must match SCENES definitions
  const GROUND_FRAC = {
    earth: 0.72, moon: 0.66, mars: 0.63, asteroidBelt: 0.60,
    jupiter: 0.82, europa: 0.67, saturn: 0.65, titan: 0.64,
    uranus: 0.67, neptune: 0.70, kuiperBelt: 0.64, proxima: 0.64,
    proximaB: 0.63, alphaCentauri: 0.67, voidNexus: 0.64,
  };

  // ── Idle rocket on pad (pre-launch) ──────────────────────
  function renderRocketOnPad(w, h, locId) {
    // Render planet surface first (scene handles that in caller)
    // Draw a launch pad platform then rocket on top
    const gf = GROUND_FRAC[locId] || 0.70;
    const padY = h * gf;
    const padW = 60, padH = 8;

    // Pad platform
    const padG = ctx.createLinearGradient(w*0.5 - padW, padY, w*0.5 + padW, padY);
    padG.addColorStop(0, 'rgba(30,40,60,0)');
    padG.addColorStop(0.3, 'rgba(60,80,110,0.8)');
    padG.addColorStop(0.7, 'rgba(60,80,110,0.8)');
    padG.addColorStop(1, 'rgba(30,40,60,0)');
    ctx.fillStyle = padG;
    ctx.fillRect(w*0.5 - padW, padY, padW * 2, padH);

    // Support struts
    [-20, 20].forEach(ox => {
      ctx.fillStyle = 'rgba(50,70,100,0.7)';
      ctx.fillRect(w*0.5 + ox - 3, padY + padH, 6, 18);
    });

    // Engine glow (idle)
    const eGlow = ctx.createRadialGradient(w*0.5, padY + 2, 0, w*0.5, padY + 2, 30);
    eGlow.addColorStop(0, `rgba(255,140,30,${0.15 + 0.08 * Math.sin(t * 4)})`);
    eGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eGlow; ctx.fillRect(0, padY - 20, w, 40);

    drawRocket(w * 0.5, padY, 1.3, 0);
  }

  // ══════════════════════════════════════════════════════════
  // PLANET SURFACE SCENES
  // ══════════════════════════════════════════════════════════

  const SCENES = {

    // ── EARTH ───────────────────────────────────────────────
    earth: (w, h) => {
      // Sky: near-space black at top, deep blue atmosphere lower
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,    '#000008');
      sky.addColorStop(0.10, '#01030d');
      sky.addColorStop(0.28, '#02091e');
      sky.addColorStop(0.48, '#040e35');
      sky.addColorStop(0.62, '#071848');
      sky.addColorStop(0.74, '#0a1c40');
      sky.addColorStop(0.86, '#07101e');
      sky.addColorStop(1,    '#04090e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Stars visible (high altitude nightside)
      drawStars(0.00020, 0.90, 42);

      // Milky Way band (subtle diagonal wash)
      const mw = ctx.createLinearGradient(0, h * 0.05, w, h * 0.45);
      mw.addColorStop(0, 'rgba(120,140,210,0)');
      mw.addColorStop(0.4, 'rgba(150,165,235,0.055)');
      mw.addColorStop(0.6, 'rgba(160,175,245,0.07)');
      mw.addColorStop(1, 'rgba(100,120,190,0)');
      ctx.fillStyle = mw; ctx.fillRect(0, 0, w, h * 0.55);

      // Moon (crescent)
      const moonX = w * 0.18, moonY = h * 0.15, moonR = 14;
      ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      const moonGrad = ctx.createRadialGradient(moonX - 3, moonY - 3, 0, moonX, moonY, moonR);
      moonGrad.addColorStop(0, 'rgba(230,235,245,0.95)');
      moonGrad.addColorStop(0.7, 'rgba(180,190,210,0.80)');
      moonGrad.addColorStop(1, 'rgba(120,130,160,0.40)');
      ctx.fillStyle = moonGrad; ctx.fill();
      // Crescent shadow
      ctx.beginPath(); ctx.arc(moonX + 5, moonY, moonR * 0.88, 0, Math.PI * 2);
      ctx.fillStyle = '#000008'; ctx.fill();

      // Sun near horizon (dawn/dusk)
      drawSun(w * 0.82, h * 0.63, 22, 255, 238, 185, 5.5);

      // Atmospheric limb — thin electric-blue band at horizon
      const horizY = h * 0.70;
      const limb = ctx.createLinearGradient(0, horizY - 45, 0, horizY + 25);
      limb.addColorStop(0, 'rgba(8,55,180,0)');
      limb.addColorStop(0.40, 'rgba(18,90,220,0.28)');
      limb.addColorStop(0.60, 'rgba(38,125,245,0.42)');
      limb.addColorStop(0.80, 'rgba(20,75,185,0.18)');
      limb.addColorStop(1, 'rgba(4,20,85,0.04)');
      ctx.fillStyle = limb; ctx.fillRect(0, horizY - 45, w, 70);

      // Sunrise glow
      const sGlow = ctx.createRadialGradient(w * 0.82, horizY, 0, w * 0.82, horizY, w * 0.65);
      sGlow.addColorStop(0, 'rgba(255,170,45,0.22)');
      sGlow.addColorStop(0.3, 'rgba(220,110,20,0.10)');
      sGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sGlow; ctx.fillRect(0, horizY - 70, w, 140);

      // Ground — rocky dark terrain
      const groundY = h * 0.72;
      const terrain = genTerrain(w, 1.5, 20, 5);
      const gGrad = ctx.createLinearGradient(0, groundY - 24, 0, h);
      gGrad.addColorStop(0,    '#0f2018');
      gGrad.addColorStop(0.12, '#0a1812');
      gGrad.addColorStop(0.5,  '#060d0a');
      gGrad.addColorStop(1,    '#030806');
      fillTerrain(terrain, groundY, w, h, gGrad);

      // Rim-light on ridge from sun
      const rim = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 20);
      rim.addColorStop(0, 'rgba(255,205,85,0.30)');
      rim.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rim; ctx.fillRect(0, groundY - 10, w, 30);

      // City lights (amber clusters)
      const rCity = rng32(13);
      for (let i = 0; i < 32; i++) {
        const lx = rCity() * w, ly = groundY + 18 + rCity() * (h - groundY - 30);
        const lr = 0.8 + rCity() * 1.8;
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr * 7);
        lg.addColorStop(0, `rgba(255,${165 + (rCity() * 75)|0},18,0.72)`);
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(lx, ly, lr * 7, 0, Math.PI * 2); ctx.fill();
      }
    },

    // ── MOON ────────────────────────────────────────────────
    moon: (w, h) => {
      ctx.fillStyle = '#000003'; ctx.fillRect(0, 0, w, h);
      drawStars(0.00045, 1.0, 77);

      // Earth in sky
      const eX = w * 0.22, eY = h * 0.20, eR = Math.min(w, h) * 0.115;
      ctx.save(); ctx.beginPath(); ctx.arc(eX, eY, eR * 2.8, 0, Math.PI * 2);
      const eAtmos = ctx.createRadialGradient(eX, eY, eR, eX, eY, eR * 2.8);
      eAtmos.addColorStop(0, 'rgba(30,100,225,0.20)');
      eAtmos.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eAtmos; ctx.fill(); ctx.restore();

      ctx.save(); ctx.beginPath(); ctx.arc(eX, eY, eR, 0, Math.PI * 2); ctx.clip();
      const eD = ctx.createRadialGradient(eX - eR*0.2, eY - eR*0.2, 0, eX, eY, eR);
      eD.addColorStop(0, '#90c2f2'); eD.addColorStop(0.35, '#1a5cc0');
      eD.addColorStop(0.75, '#1042a2'); eD.addColorStop(1, '#08182a');
      ctx.fillStyle = eD; ctx.fillRect(eX-eR, eY-eR, eR*2, eR*2);
      const re = rng32(500);
      ctx.fillStyle = 'rgba(38,118,52,0.65)';
      for (let i = 0; i < 7; i++) ctx.beginPath(),
        ctx.ellipse(eX+(re()-0.5)*eR*1.5, eY+(re()-0.5)*eR*1.5, eR*(0.2+re()*0.3), eR*(0.15+re()*0.25), re()*Math.PI,0,Math.PI*2), ctx.fill();
      ctx.fillStyle = 'rgba(235,245,255,0.22)';
      for (let i = 0; i < 4; i++) ctx.beginPath(),
        ctx.ellipse(eX+(re()-0.5)*eR*1.6, eY+(re()-0.5)*eR, eR*(0.3+re()*0.4), eR*(0.12+re()*0.18), re()*Math.PI,0,Math.PI*2), ctx.fill();
      ctx.restore();

      drawSun(w * 0.84, h * 0.11, 15, 255, 255, 238, 2.8);

      const groundY = h * 0.66, terrain = genTerrain(w, 3.2, 25, 6);
      const mGrad = ctx.createLinearGradient(0, groundY - 28, 0, h);
      mGrad.addColorStop(0, '#606060'); mGrad.addColorStop(0.08, '#4a4a4a');
      mGrad.addColorStop(0.35, '#323232'); mGrad.addColorStop(0.8, '#1c1c1c');
      mGrad.addColorStop(1, '#0a0a0a');
      fillTerrain(terrain, groundY, w, h, mGrad);

      const ridge = ctx.createLinearGradient(0, groundY - 12, 0, groundY + 20);
      ridge.addColorStop(0, 'rgba(225,225,205,0.68)');
      ridge.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ridge; ctx.fillRect(0, groundY - 12, w, 32);

      const rc = rng32(303);
      for (let i = 0; i < 7; i++) {
        const cx2 = rc() * w, cy2 = groundY + 18 + rc() * (h - groundY - 30);
        const cr = 5 + rc() * 20;
        const cg = ctx.createRadialGradient(cx2 + cr*.3, cy2 - cr*.2, 0, cx2, cy2, cr);
        cg.addColorStop(0, 'rgba(0,0,0,0.65)'); cg.addColorStop(0.7,'rgba(0,0,0,0.22)'); cg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(cx2, cy2, cr, 0, Math.PI*2); ctx.fillStyle = cg; ctx.fill();
      }
    },

    // ── MARS ────────────────────────────────────────────────
    mars: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0d0401'); sky.addColorStop(0.18, '#1d0802');
      sky.addColorStop(0.36, '#3b1203'); sky.addColorStop(0.54, '#7c2d0c');
      sky.addColorStop(0.68, '#c85622'); sky.addColorStop(0.80, '#d87036');
      sky.addColorStop(0.92, '#cc6a28'); sky.addColorStop(1, '#b05820');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Dust haze band
      const dust = ctx.createLinearGradient(0, h * 0.44, 0, h * 0.82);
      dust.addColorStop(0, 'rgba(210,112,42,0)'); dust.addColorStop(0.5,'rgba(200,102,36,0.18)');
      dust.addColorStop(1, 'rgba(178,88,28,0.28)');
      ctx.fillStyle = dust; ctx.fillRect(0, h*0.44, w, h*0.4);

      drawSun(w * 0.70, h * 0.26, 9, 255, 212, 158, 6.5);

      // Dust particles
      const rd = rng32(99);
      for (let i = 0; i < 58; i++) {
        ctx.beginPath(); ctx.arc(rd()*w, h*0.47+rd()*h*0.37, rd()*1.8, 0, Math.PI*2);
        ctx.fillStyle = `rgba(232,148,62,${rd()*0.14})`; ctx.fill();
      }

      const groundY = h * 0.63, terrain = genTerrain(w, 2.1, 27, 5);
      const marsG = ctx.createLinearGradient(0, groundY - 25, 0, h);
      marsG.addColorStop(0, '#943215'); marsG.addColorStop(0.18, '#7a2808');
      marsG.addColorStop(0.5, '#601e05'); marsG.addColorStop(1, '#3c1002');
      fillTerrain(terrain, groundY, w, h, marsG);

      const hl = ctx.createLinearGradient(0, groundY - 12, 0, groundY + 24);
      hl.addColorStop(0, 'rgba(192,92,36,0.55)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hl; ctx.fillRect(0, groundY - 12, w, 36);

      // Boulders
      const rr = rng32(201);
      for (let i = 0; i < 12; i++) {
        const bx = rr()*w, by = groundY + 8 + rr()*(h-groundY-22);
        const bw = 5+rr()*17, bh2 = 3+rr()*9;
        ctx.save(); ctx.translate(bx,by); ctx.rotate(rr()*0.5-0.25);
        ctx.beginPath(); ctx.ellipse(0,0,bw,bh2,0,0,Math.PI*2);
        ctx.fillStyle = `rgba(${100+rr()*52|0},${44+rr()*26|0},${14+rr()*14|0},0.88)`;
        ctx.fill(); ctx.restore();
      }
    },

    // ── ASTEROID BELT ────────────────────────────────────────
    asteroidBelt: (w, h) => {
      ctx.fillStyle = '#000002'; ctx.fillRect(0, 0, w, h);
      drawStars(0.00032, 0.95, 441);
      drawSun(w * 0.14, h * 0.10, 12, 255, 242, 185, 4);

      const groundY = h * 0.60, terrain = genTerrain(w, 4.5, 34, 7);
      const rG = ctx.createLinearGradient(0, groundY - 32, 0, h);
      rG.addColorStop(0, '#504e4a'); rG.addColorStop(0.12, '#3c3a36');
      rG.addColorStop(0.42, '#2a2826'); rG.addColorStop(1, '#0e0c0a');
      fillTerrain(terrain, groundY, w, h, rG);

      // Metallic sheen
      const g2 = ctx.createLinearGradient(0, groundY - 20, 0, groundY + 20);
      g2.addColorStop(0, 'rgba(172,166,145,0.55)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, groundY - 20, w, 40);

      // Floating debris
      const ra = rng32(77);
      for (let i = 0; i < 10; i++) {
        const ax = ra()*w, ay = h*0.10+ra()*h*0.38;
        const arx = 4+ra()*15, ary = arx*(0.4+ra()*0.5);
        ctx.save(); ctx.translate(ax,ay); ctx.rotate(ra()*Math.PI*2);
        ctx.beginPath(); ctx.ellipse(0,0,arx,ary,0,0,Math.PI*2);
        ctx.fillStyle = `rgba(${72+ra()*52|0},${70+ra()*46|0},${60+ra()*36|0},${0.28+ra()*0.34})`;
        ctx.fill(); ctx.restore();
      }
    },

    // ── JUPITER ──────────────────────────────────────────────
    jupiter: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      [0,'#120804'],[0.08,'#ca7a46'],[0.17,'#eaaa62'],[0.25,'#aa6030'],
      [0.33,'#eec272'],[0.41,'#ba7242'],[0.49,'#da9262'],[0.57,'#9c562a'],
      [0.65,'#eaba72'],[0.73,'#ba7a4a'],[0.81,'#ca925c'],[0.9,'#a27248'],[1,'#7c5030']
      ;
      // Build sky gradient programmatically
      const stops = [[0,'#120804'],[0.08,'#ca7a46'],[0.17,'#eaaa62'],[0.25,'#aa6030'],
        [0.33,'#eec272'],[0.41,'#ba7242'],[0.49,'#da9262'],[0.57,'#9c562a'],
        [0.65,'#eaba72'],[0.73,'#ba7a4a'],[0.81,'#ca925c'],[0.9,'#a27248'],[1,'#7c5030']];
      stops.forEach(([pos, col]) => sky.addColorStop(pos, col));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Band edge shading
      [0.08,0.17,0.25,0.33,0.41,0.49,0.57,0.65,0.73,0.81].forEach(b => {
        const bg = ctx.createLinearGradient(0, h*b-5, 0, h*b+5);
        bg.addColorStop(0, 'rgba(60,30,10,0)'); bg.addColorStop(0.5,'rgba(60,30,10,0.28)');
        bg.addColorStop(1, 'rgba(60,30,10,0)');
        ctx.fillStyle = bg; ctx.fillRect(0, h*b-5, w, 10);
      });

      // Great Red Spot
      const gX = w*0.62, gY = h*0.46, gRx = w*0.10, gRy = h*0.055;
      const gG = ctx.createRadialGradient(gX, gY, 0, gX, gY, gRx);
      gG.addColorStop(0,'rgba(172,46,22,0.88)'); gG.addColorStop(0.55,'rgba(192,62,30,0.55)');
      gG.addColorStop(0.85,'rgba(142,52,24,0.25)'); gG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(gX,gY,gRx,gRy,0.08,0,Math.PI*2);
      ctx.fillStyle = gG; ctx.fill();

      // Cloud deck
      const cY = h * 0.82;
      ctx.fillStyle = '#a06030'; ctx.fillRect(0, cY, w, h-cY);
      const cT = genTerrain(w, 7.7, 14, 4);
      const cG = ctx.createLinearGradient(0, cY-18, 0, cY+18);
      cG.addColorStop(0,'rgba(210,148,66,0)'); cG.addColorStop(0.45,'rgba(192,122,56,0.72)');
      cG.addColorStop(1,'rgba(130,76,32,0.92)');
      fillTerrain(cT, cY-8, w, h, cG);
    },

    // ── EUROPA ───────────────────────────────────────────────
    europa: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#000004'); sky.addColorStop(0.28,'#01030e');
      sky.addColorStop(0.58,'#020618'); sky.addColorStop(1,'#010208');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00032, 0.90, 550);

      // Jupiter looming huge
      const jX = w*0.50, jY = -h*0.28, jR = h*0.72;
      const jG = ctx.createRadialGradient(jX-jR*0.12, jY, 0, jX, jY, jR);
      jG.addColorStop(0,'rgba(245,185,106,0.92)'); jG.addColorStop(0.3,'rgba(215,146,72,0.80)');
      jG.addColorStop(0.6,'rgba(175,100,48,0.55)'); jG.addColorStop(0.85,'rgba(140,78,38,0.25)');
      jG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.arc(jX, jY, jR, 0, Math.PI*2); ctx.fillStyle = jG; ctx.fill();
      for (let b = 0; b < 5; b++) {
        const by = jY + jR*(0.12+b*0.13);
        ctx.save(); ctx.beginPath(); ctx.arc(jX,jY,jR,0,Math.PI*2); ctx.clip();
        ctx.strokeStyle = `rgba(110,55,18,${0.22+b*0.04})`; ctx.lineWidth = jR*0.028;
        ctx.beginPath(); ctx.ellipse(jX,by,jR*0.96,jR*0.035,0,0,Math.PI); ctx.stroke(); ctx.restore();
      }

      const groundY = h*0.67, iT = genTerrain(w, 5.5, 14, 5);
      const iG = ctx.createLinearGradient(0, groundY-12, 0, h);
      iG.addColorStop(0,'#cce4f4'); iG.addColorStop(0.06,'#b0cce0');
      iG.addColorStop(0.28,'#86aec8'); iG.addColorStop(0.6,'#5888a8'); iG.addColorStop(1,'#2a4860');
      fillTerrain(iT, groundY, w, h, iG);
      const iHL = ctx.createLinearGradient(0, groundY-6, 0, groundY+20);
      iHL.addColorStop(0,'rgba(200,170,100,0.42)'); iHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = iHL; ctx.fillRect(0, groundY-6, w, 26);

      // Ice cracks
      const rc2 = rng32(55);
      ctx.lineWidth = 2;
      for (let c = 0; c < 7; c++) {
        ctx.strokeStyle = `rgba(${112+rc2()*40|0},${60+rc2()*22|0},${25+rc2()*20|0},${0.45+rc2()*0.32})`;
        ctx.beginPath();
        let cx2 = rc2()*w, cy2 = groundY+8+rc2()*(h-groundY-22);
        ctx.moveTo(cx2, cy2);
        for (let s = 0; s < 5; s++) { cx2 += (rc2()-0.48)*65; cy2 += rc2()*32; ctx.lineTo(cx2, cy2); }
        ctx.stroke();
      }
    },

    // ── SATURN ───────────────────────────────────────────────
    saturn: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#000006'); sky.addColorStop(0.24,'#03060e');
      sky.addColorStop(0.5,'#060c1c'); sky.addColorStop(0.7,'#091220');
      sky.addColorStop(0.88,'#070d18'); sky.addColorStop(1,'#04080e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00026, 0.90, 660);

      // Ring arc
      const rCX = w*0.50, rCY = h*0.38;
      [{rx:w*0.95,ry:22,lw:14,a:0.62},{rx:w*0.78,ry:17,lw:9,a:0.52},{rx:w*0.62,ry:13,lw:5,a:0.38}]
      .forEach(ring => {
        const base = `rgba(192,162,108,`;
        const rg = ctx.createLinearGradient(0, rCY-ring.ry, 0, rCY+ring.ry);
        rg.addColorStop(0, base+'0)'); rg.addColorStop(0.4, base+ring.a+')');
        rg.addColorStop(0.6, base+ring.a+')'); rg.addColorStop(1, base+'0)');
        ctx.strokeStyle = rg; ctx.lineWidth = ring.lw;
        ctx.beginPath(); ctx.ellipse(rCX, rCY, ring.rx, ring.ry, 0, Math.PI, Math.PI*2); ctx.stroke();
      });

      drawSun(w*0.18, h*0.12, 7, 255, 238, 196, 5);

      const groundY = h*0.65, iT = genTerrain(w, 8.1, 18, 5);
      const sG = ctx.createLinearGradient(0, groundY-12, 0, h);
      sG.addColorStop(0,'#e8f0f8'); sG.addColorStop(0.08,'#c4d4e4');
      sG.addColorStop(0.38,'#8096b0'); sG.addColorStop(1,'#1a2430');
      fillTerrain(iT, groundY, w, h, sG);
      const sHL = ctx.createLinearGradient(0, groundY-10, 0, groundY+22);
      sHL.addColorStop(0,'rgba(255,245,220,0.50)'); sHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = sHL; ctx.fillRect(0, groundY-10, w, 32);
    },

    // ── TITAN ────────────────────────────────────────────────
    titan: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#0e0702'); sky.addColorStop(0.15,'#2a1206');
      sky.addColorStop(0.36,'#5e2c0e'); sky.addColorStop(0.56,'#9a4818');
      sky.addColorStop(0.72,'#c26215'); sky.addColorStop(0.84,'#d07218');
      sky.addColorStop(0.93,'#be6610'); sky.addColorStop(1,'#9a5208');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      const haze = ctx.createLinearGradient(0, h*0.24, 0, h*0.62);
      haze.addColorStop(0,'rgba(175,85,15,0)'); haze.addColorStop(0.5,'rgba(160,78,12,0.22)');
      haze.addColorStop(1,'rgba(140,65,10,0)');
      ctx.fillStyle = haze; ctx.fillRect(0, h*0.24, w, h*0.38);

      const sH = ctx.createRadialGradient(w*0.38, h*0.28, 0, w*0.38, h*0.28, w*0.56);
      sH.addColorStop(0,'rgba(255,185,55,0.18)'); sH.addColorStop(0.5,'rgba(210,130,30,0.08)');
      sH.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = sH; ctx.fillRect(0, 0, w, h);

      const groundY = h*0.64, dT = genTerrain(w, 9.9, 20, 4);
      const dG = ctx.createLinearGradient(0, groundY-12, 0, h);
      dG.addColorStop(0,'#3c2010'); dG.addColorStop(0.14,'#2c1808');
      dG.addColorStop(0.5,'#1c1006'); dG.addColorStop(1,'#0e0803');
      fillTerrain(dT, groundY, w, h, dG);
      const dHL = ctx.createLinearGradient(0, groundY-6, 0, groundY+26);
      dHL.addColorStop(0,'rgba(120,65,18,0.62)'); dHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = dHL; ctx.fillRect(0, groundY-6, w, 32);

      // Methane lake
      const rt = rng32(174);
      const lX = rt()*w*0.5+w*0.15, lY = groundY+42+rt()*(h-groundY-62), lW = 62+rt()*82, lH2 = 10+rt()*18;
      const lG = ctx.createRadialGradient(lX,lY,0,lX,lY,lW);
      lG.addColorStop(0,'rgba(20,36,52,0.84)'); lG.addColorStop(0.7,'rgba(15,26,36,0.52)');
      lG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(lX,lY,lW,lH2,0,0,Math.PI*2);
      ctx.fillStyle = lG; ctx.fill();
    },

    // ── URANUS ───────────────────────────────────────────────
    uranus: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#000410'); sky.addColorStop(0.24,'#001520');
      sky.addColorStop(0.5,'#002535'); sky.addColorStop(0.68,'#003240');
      sky.addColorStop(0.82,'#003848'); sky.addColorStop(1,'#002c38');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00024, 0.82, 770);

      ctx.save(); ctx.translate(w*0.5, h*0.28); ctx.rotate(0.28);
      [{rx:76,ry:172,lw:2.5,a:0.38},{rx:92,ry:208,lw:1.5,a:0.25},{rx:56,ry:127,lw:1.5,a:0.20}]
      .forEach(r => {
        ctx.strokeStyle = `rgba(100,196,216,${r.a})`; ctx.lineWidth = r.lw;
        ctx.beginPath(); ctx.ellipse(0,0,r.rx,r.ry,0,0,Math.PI*2); ctx.stroke();
      });
      ctx.restore();

      drawSun(w*0.86, h*0.09, 5, 255, 248, 226, 4);
      const groundY = h*0.67, uT = genTerrain(w, 11.2, 17, 6);
      const uG = ctx.createLinearGradient(0, groundY-12, 0, h);
      uG.addColorStop(0,'#68c0cc'); uG.addColorStop(0.10,'#4898a8');
      uG.addColorStop(0.4,'#207888'); uG.addColorStop(1,'#051820');
      fillTerrain(uT, groundY, w, h, uG);
      const uHL = ctx.createLinearGradient(0, groundY-10, 0, groundY+24);
      uHL.addColorStop(0,'rgba(130,225,240,0.44)'); uHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = uHL; ctx.fillRect(0, groundY-10, w, 34);
    },

    // ── NEPTUNE ──────────────────────────────────────────────
    neptune: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#000006'); sky.addColorStop(0.20,'#00041c');
      sky.addColorStop(0.40,'#000836'); sky.addColorStop(0.56,'#000e52');
      sky.addColorStop(0.72,'#001462'); sky.addColorStop(1,'#000830');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00024, 0.85, 880);

      const gdX = w*0.35, gdY = h*0.30;
      const gdG = ctx.createRadialGradient(gdX,gdY,0,gdX,gdY,w*0.13);
      gdG.addColorStop(0,'rgba(0,0,16,0.74)'); gdG.addColorStop(0.55,'rgba(0,4,26,0.40)');
      gdG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(gdX,gdY,w*0.13,h*0.068,-0.18,0,Math.PI*2);
      ctx.fillStyle = gdG; ctx.fill();

      drawSun(w*0.91, h*0.07, 3, 255, 250, 236, 4.5);
      const groundY = h*0.70, nT = genTerrain(w, 13.3, 15, 5);
      const nG = ctx.createLinearGradient(0, groundY-12, 0, h);
      nG.addColorStop(0,'#4268cc'); nG.addColorStop(0.10,'#2245aa');
      nG.addColorStop(0.42,'#102280'); nG.addColorStop(1,'#030520');
      fillTerrain(nT, groundY, w, h, nG);
      const nHL = ctx.createLinearGradient(0, groundY-8, 0, groundY+22);
      nHL.addColorStop(0,'rgba(80,130,255,0.40)'); nHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = nHL; ctx.fillRect(0, groundY-8, w, 30);
    },

    // ── KUIPER BELT ──────────────────────────────────────────
    kuiperBelt: (w, h) => {
      ctx.fillStyle = '#000001'; ctx.fillRect(0, 0, w, h);
      drawStars(0.00042, 0.96, 991);
      drawSun(w*0.50, h*0.12, 3, 255, 250, 226, 5);
      const groundY = h*0.64, kT = genTerrain(w, 15.5, 30, 7);
      const kG = ctx.createLinearGradient(0, groundY-18, 0, h);
      kG.addColorStop(0,'#b2a898'); kG.addColorStop(0.12,'#907870');
      kG.addColorStop(0.44,'#5c4e40'); kG.addColorStop(1,'#160e08');
      fillTerrain(kT, groundY, w, h, kG);
      const rk = rng32(333);
      for (let i = 0; i < 16; i++) {
        const fx = rk()*w, fy = groundY+6+rk()*(h-groundY-18), fr = 5+rk()*18;
        const fg = ctx.createRadialGradient(fx,fy,0,fx,fy,fr);
        fg.addColorStop(0,`rgba(215,225,236,${0.30+rk()*0.36})`); fg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx,fy,fr,0,Math.PI*2); ctx.fill();
      }
    },

    // ── PROXIMA CENTAURI ─────────────────────────────────────
    proxima: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#040001'); sky.addColorStop(0.22,'#0e0203');
      sky.addColorStop(0.42,'#1e0405'); sky.addColorStop(0.60,'#340606');
      sky.addColorStop(0.74,'#4a0807'); sky.addColorStop(1,'#3c0604');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00015, 0.68, 1102);

      drawSun(w*0.55, h*0.30, 36, 255, 72, 18, 4.2);
      const flare = ctx.createRadialGradient(w*0.55, h*0.30, 32, w*0.55, h*0.30, 115);
      flare.addColorStop(0,'rgba(255,90,15,0.18)'); flare.addColorStop(0.5,'rgba(200,45,8,0.09)');
      flare.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = flare; ctx.fillRect(0, 0, w, h);

      const groundY = h*0.64, pT = genTerrain(w, 17.7, 32, 6);
      const pG = ctx.createLinearGradient(0, groundY-18, 0, h);
      pG.addColorStop(0,'#4e2010'); pG.addColorStop(0.22,'#3c1808');
      pG.addColorStop(0.52,'#280e04'); pG.addColorStop(1,'#110602');
      fillTerrain(pT, groundY, w, h, pG);
      const pHL = ctx.createLinearGradient(0, groundY-10, 0, groundY+22);
      pHL.addColorStop(0,'rgba(200,55,12,0.44)'); pHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = pHL; ctx.fillRect(0, groundY-10, w, 32);
    },

    // ── PROXIMA B ────────────────────────────────────────────
    proximaB: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#060102'); sky.addColorStop(0.28,'#180404');
      sky.addColorStop(0.52,'#300605'); sky.addColorStop(0.70,'#400604');
      sky.addColorStop(0.85,'#3c0503'); sky.addColorStop(1,'#280302');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      const hG = ctx.createRadialGradient(w*0.5, h*0.62, 0, w*0.5, h*0.62, w*0.88);
      hG.addColorStop(0,'rgba(255,95,18,0.40)'); hG.addColorStop(0.3,'rgba(200,55,8,0.20)');
      hG.addColorStop(0.6,'rgba(150,25,4,0.10)'); hG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = hG; ctx.fillRect(0, 0, w, h);

      // Ruin silhouettes
      const rp = rng32(888);
      ctx.fillStyle = 'rgba(14,5,2,0.72)';
      for (let i = 0; i < 5; i++) {
        const rx = rp()*w, ry = h*0.50+rp()*h*0.10, rh2 = 20+rp()*52, rw2 = 8+rp()*25;
        ctx.beginPath(); ctx.moveTo(rx-rw2*0.4,ry); ctx.lineTo(rx,ry-rh2);
        ctx.lineTo(rx+rw2*0.4,ry); ctx.closePath(); ctx.fill();
      }

      const groundY = h*0.63, vT = genTerrain(w, 19.1, 34, 7);
      const vG = ctx.createLinearGradient(0, groundY-22, 0, h);
      vG.addColorStop(0,'#3c1008'); vG.addColorStop(0.15,'#2c0c05');
      vG.addColorStop(0.44,'#1c0803'); vG.addColorStop(1,'#0c0401');
      fillTerrain(vT, groundY, w, h, vG);

      const rl = rng32(888);
      for (let i = 0; i < 5; i++) {
        const lx = rl()*w, ly = groundY+14+rl()*(h-groundY-30);
        const lg2 = ctx.createRadialGradient(lx,ly,0,lx,ly,10+rl()*22);
        lg2.addColorStop(0,'rgba(255,115,0,0.68)'); lg2.addColorStop(0.5,'rgba(200,55,0,0.32)');
        lg2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = lg2; ctx.beginPath(); ctx.arc(lx,ly,32+rl()*22,0,Math.PI*2); ctx.fill();
      }
    },

    // ── ALPHA CENTAURI ───────────────────────────────────────
    alphaCentauri: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,'#010308'); sky.addColorStop(0.24,'#040814');
      sky.addColorStop(0.48,'#080e28'); sky.addColorStop(0.68,'#0a1230');
      sky.addColorStop(0.84,'#080e22'); sky.addColorStop(1,'#04070e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      drawStars(0.00022, 0.80, 1220);

      drawSun(w*0.43, h*0.20, 24, 255, 222, 148, 4.5);
      drawSun(w*0.60, h*0.24, 16, 255, 160, 74, 4.0);

      const bG = ctx.createRadialGradient(w*0.5, h*0.22, 0, w*0.5, h*0.22, w*0.56);
      bG.addColorStop(0,'rgba(255,200,96,0.14)'); bG.addColorStop(0.5,'rgba(200,150,55,0.06)');
      bG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = bG; ctx.fillRect(0, 0, w, h);

      const groundY = h*0.67, aT = genTerrain(w, 21.5, 22, 5);
      const aG = ctx.createLinearGradient(0, groundY-12, 0, h);
      aG.addColorStop(0,'#cca848'); aG.addColorStop(0.14,'#a88838');
      aG.addColorStop(0.44,'#786028'); aG.addColorStop(1,'#201808');
      fillTerrain(aT, groundY, w, h, aG);
      const aHL = ctx.createLinearGradient(0, groundY-8, 0, groundY+24);
      aHL.addColorStop(0,'rgba(255,200,80,0.40)'); aHL.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = aHL; ctx.fillRect(0, groundY-8, w, 32);
    },

    // ── VOID NEXUS ───────────────────────────────────────────
    voidNexus: (w, h) => {
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
      const vG = ctx.createLinearGradient(0, 0, 0, h);
      vG.addColorStop(0,'#000000'); vG.addColorStop(0.38,'#040008');
      vG.addColorStop(0.68,'#080012'); vG.addColorStop(1,'#060008');
      ctx.fillStyle = vG; ctx.fillRect(0, 0, w, h);

      // Nebula wisps
      const rn = rng32(66);
      for (let n = 0; n < 5; n++) {
        const nx = rn()*w, ny = rn()*h*0.65, nr = 65+rn()*115;
        const nG = ctx.createRadialGradient(nx,ny,0,nx,ny,nr);
        nG.addColorStop(0,`rgba(${50+rn()*62|0},0,${90+rn()*100|0},0.18)`);
        nG.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = nG; ctx.beginPath(); ctx.arc(nx,ny,nr,0,Math.PI*2); ctx.fill();
      }

      // Rifts
      const rr2 = rng32(66);
      for (let i = 0; i < 6; i++) {
        const rx = rr2()*w, ry = rr2()*h*0.72, rl = 88+rr2()*165, ang = rr2()*Math.PI;
        const r2 = 60+rr2()*80, b2 = 120+rr2()*100;
        const rfG = ctx.createLinearGradient(rx-Math.cos(ang)*rl,ry-Math.sin(ang)*rl,rx+Math.cos(ang)*rl,ry+Math.sin(ang)*rl);
        rfG.addColorStop(0,'rgba(0,0,0,0)'); rfG.addColorStop(0.5,`rgba(${r2},0,${b2},0.48)`);
        rfG.addColorStop(1,'rgba(0,0,0,0)');
        ctx.strokeStyle = rfG; ctx.lineWidth = 1.2+rr2()*2.0;
        ctx.beginPath(); ctx.moveTo(rx-Math.cos(ang)*rl,ry-Math.sin(ang)*rl);
        ctx.lineTo(rx+Math.cos(ang)*rl,ry+Math.sin(ang)*rl); ctx.stroke();
      }

      const groundY = h*0.64, vT = genTerrain(w, 23.3, 26, 6);
      const vGnd = ctx.createLinearGradient(0, groundY-18, 0, h);
      vGnd.addColorStop(0,'#220034'); vGnd.addColorStop(0.14,'#1a0028');
      vGnd.addColorStop(0.44,'#100018'); vGnd.addColorStop(1,'#060008');
      fillTerrain(vT, groundY, w, h, vGnd);

      // Crystal spires (animated glow)
      const rc2 = rng32(66);
      for (let c = 0; c < 10; c++) {
        const cx2 = rc2()*w, cBase = groundY+4+rc2()*18, cH = 24+rc2()*72, cW = 5+rc2()*13;
        const pulse = 0.6 + 0.4 * Math.sin(t * 1.8 + c * 0.9);
        const cG = ctx.createLinearGradient(cx2, cBase-cH, cx2, cBase);
        cG.addColorStop(0,`rgba(190,0,255,${0.72*pulse})`);
        cG.addColorStop(0.5,`rgba(110,0,190,${0.50*pulse})`);
        cG.addColorStop(1,`rgba(55,0,90,${0.28*pulse})`);
        ctx.beginPath(); ctx.moveTo(cx2-cW*0.5, cBase); ctx.lineTo(cx2, cBase-cH);
        ctx.lineTo(cx2+cW*0.5, cBase); ctx.closePath();
        ctx.fillStyle = cG; ctx.fill();
        const cgG = ctx.createRadialGradient(cx2, cBase-cH*0.5, 0, cx2, cBase-cH*0.5, cW*3);
        cgG.addColorStop(0,`rgba(180,0,255,${0.14*pulse})`); cgG.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = cgG; ctx.beginPath(); ctx.arc(cx2,cBase-cH*0.5,cW*3,0,Math.PI*2); ctx.fill();
      }
    },
  };

  // ══════════════════════════════════════════════════════════
  // ANIMATION LOOP
  // ══════════════════════════════════════════════════════════

  const TWINKLE = new Set(['earth','moon','asteroidBelt','kuiperBelt',
    'proxima','proximaB','alphaCentauri','neptune','uranus','saturn','europa','voidNexus']);

  function frame(now) {
    const dt = (now - lastAnimTime) / 1000;
    lastAnimTime = now;
    t += dt;

    const w = W(), h = H();

    if (missionData) {
      const elapsed = (now - missionAnimT0) / 1000;
      const missionElapsed = (Date.now() - missionData.startTime) / 1000;
      const missionDuration = missionData.duration / 1000;
      const missionProg = Math.min(1, missionElapsed / missionDuration);

      if (elapsed < 16) {
        // Launch sequence
        renderLaunch(w, h, elapsed, missionData.from);
      } else if (missionProg > 0.88) {
        // Arrival
        renderArrival(w, h, (missionProg - 0.88) / 0.12, missionData.to);
      } else {
        // Warp travel
        renderWarp(w, h);
      }
    } else if (currentLocation) {
      const fn = SCENES[currentLocation];
      if (fn) {
        fn(w, h);
        // Draw idle rocket on pad if player has rockets
        if (hasRocket) renderRocketOnPad(w, h, currentLocation);
      }
    }

    animFrame = requestAnimationFrame(frame);
  }

  // ── Public API ────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('scene-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); });
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const pr = dpr();
    const w = parent.clientWidth, h = parent.clientHeight;
    canvas.width  = Math.round(w * pr);
    canvas.height = Math.round(h * pr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pr, pr);
  }

  function render(locId) {
    currentLocation = locId;
    if (!ctx) return;
    const fn = SCENES[locId];
    if (fn) fn(W(), H());
    else { ctx.fillStyle='#000008'; ctx.fillRect(0,0,W(),H()); drawStars(0.00025,0.90,42); }
  }

  function startAnimation(locId) {
    currentLocation = locId;
    missionData = null;
    if (!animFrame) {
      lastAnimTime = performance.now();
      animFrame = requestAnimationFrame(frame);
    }
  }

  function setMission(mission, rocketInHangar) {
    hasRocket = !!rocketInHangar;
    if (!missionData || missionData.startTime !== mission.startTime) {
      missionData = mission;
      missionAnimT0 = performance.now();
    }
    if (!animFrame) {
      lastAnimTime = performance.now();
      animFrame = requestAnimationFrame(frame);
    }
  }

  function clearMission(locId) {
    missionData = null;
    if (locId) currentLocation = locId;
    if (!animFrame) {
      lastAnimTime = performance.now();
      animFrame = requestAnimationFrame(frame);
    }
  }

  function setHasRocket(v) { hasRocket = v; }

  function stopAnimation() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }

  return { init, render, startAnimation, stopAnimation, resize, setMission, clearMission, setHasRocket };

})();
