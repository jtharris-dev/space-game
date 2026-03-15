'use strict';
/* ============================================================
   COSMIC FRONTIER — Photorealistic Earth Night Sky
   Canvas 2D renderer: spectral stars, Milky Way, moon, airglow
   ============================================================ */

const Scenes = (() => {

  let canvas, ctx;
  let animFrame = null;
  let t = 0, lastTime = 0;

  const dpr = () => window.devicePixelRatio || 1;
  const W   = () => canvas.width  / dpr();
  const H   = () => canvas.height / dpr();

  // ── Seeded PRNG (Mulberry32) ──────────────────────────────
  function rng32(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Blackbody temperature → sRGB (Tanner Helland algorithm) ──
  function tempToRGB(K) {
    const tmp = Math.max(1000, Math.min(40000, K)) / 100;
    let r, g, b;
    if (tmp <= 66) {
      r = 255;
      g = tmp < 2 ? 0 : Math.max(0, Math.min(255, 99.471 * Math.log(tmp) - 161.120));
      b = tmp >= 66 ? 255 : (tmp <= 19 ? 0 : Math.max(0, Math.min(255, 138.518 * Math.log(tmp - 10) - 305.045)));
    } else {
      r = Math.max(0, Math.min(255, 329.699 * Math.pow(tmp - 60, -0.1332)));
      g = Math.max(0, Math.min(255, 288.122 * Math.pow(tmp - 60, -0.0755)));
      b = 255;
    }
    return [r | 0, g | 0, b | 0];
  }

  // ── Star catalog (fixed sky positions, physical properties) ──
  // Generated once; positions are 0..1 fractions of canvas size.
  const STARS = (() => {
    const rand = rng32(0xC0DA5EED);
    const list = [];
    for (let i = 0; i < 1800; i++) {
      const fx = rand();
      const fy = rand() * 0.83;           // only in sky region

      // Visual magnitude: power distribution — many dim, few bright
      // mag ~6.5 (barely visible) down to ~0.5 (very bright)
      const mag = 6.5 - Math.pow(rand(), 0.38) * 5.8;

      // Spectral type → colour temperature
      // Real distribution is dominated by M/K dwarfs but bright stars
      // skew toward O/B/A, so we weight the visible population:
      const sp = rand();
      let K;
      if      (sp < 0.003) K = 25000 + rand() * 20000;  // O  blue-violet
      else if (sp < 0.022) K = 10000 + rand() * 12000;  // B  blue-white
      else if (sp < 0.065) K =  7500 + rand() *  2500;  // A  white
      else if (sp < 0.165) K =  6000 + rand() *  1500;  // F  yellow-white
      else if (sp < 0.270) K =  5000 + rand() *  1000;  // G  yellow (like Sun)
      else if (sp < 0.445) K =  3700 + rand() *  1300;  // K  orange
      else                 K =  2400 + rand() *  1300;  // M  red-orange

      const [r, g, b] = tempToRGB(K);
      list.push({ fx, fy, mag, r, g, b });
    }
    // Paint faintest first so bright stars composite on top
    return list.sort((a, z) => z.mag - a.mag);
  })();

  // ── Milky Way band star catalog ───────────────────────────
  // Band-relative coords: u in [0,1] along band, v in [-1,1] perpendicular
  const MW_STARS = (() => {
    const rand = rng32(0xBADA55ED);
    const list = [];
    for (let i = 0; i < 6000; i++) {
      const u = rand();
      const v = rand() * 2 - 1;
      // Gaussian falloff from band centerline
      const dv = Math.exp(-v * v * 7.5);
      // Density varies along band; galactic core at u ~0.44 is brightest
      const du = 0.38 + 0.62 * Math.exp(-Math.pow(u - 0.44, 2) * 9.0);
      if (rand() > dv * du * 0.88) continue;

      const size  = 0.15 + rand() * 0.27;
      const alpha = 0.16 + rand() * 0.55;
      const warm  = rand() > 0.52; // warm (yellowish) vs cool (blueish)
      list.push({ u, v, size, alpha, warm });
    }
    return list;
  })();

  // ── Sky gradient ──────────────────────────────────────────
  function drawSky(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, '#00000a'); // zenith: near pure black
    g.addColorStop(0.40, '#00010d');
    g.addColorStop(0.70, '#00020f');
    g.addColorStop(0.82, '#010318'); // atmosphere rises
    g.addColorStop(0.91, '#020520'); // near horizon: deep indigo
    g.addColorStop(1.00, '#030712');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ── Milky Way: diffuse glow + individual stars ────────────
  function drawMilkyWay(w, h) {
    // Band orientation: roughly 28 degree tilt across the sky
    const angle = -0.49; // radians
    const bCx   = w * 0.50;
    const bCy   = h * 0.40;
    const bLen  = Math.sqrt(w * w + h * h) * 1.35;
    const bHW   = h * 0.28; // band half-width

    // Diffuse glow layers (rotated band)
    ctx.save();
    ctx.translate(bCx, bCy);
    ctx.rotate(angle);

    const glowLayers = [
      { hw: bHW * 1.00, a: 0.015, ro: 148, go: 155, bo: 200 },
      { hw: bHW * 0.65, a: 0.024, ro: 158, go: 165, bo: 212 },
      { hw: bHW * 0.40, a: 0.034, ro: 168, go: 176, bo: 224 },
      { hw: bHW * 0.22, a: 0.044, ro: 178, go: 186, bo: 234 },
      { hw: bHW * 0.10, a: 0.055, ro: 192, go: 198, bo: 244 }, // core spine
    ];

    for (const l of glowLayers) {
      const grad = ctx.createLinearGradient(0, -l.hw, 0, l.hw);
      grad.addColorStop(0.00, `rgba(${l.ro},${l.go},${l.bo},0)`);
      grad.addColorStop(0.35, `rgba(${l.ro},${l.go},${l.bo},${l.a})`);
      grad.addColorStop(0.50, `rgba(${l.ro},${l.go},${l.bo},${+(l.a * 1.45).toFixed(4)})`);
      grad.addColorStop(0.65, `rgba(${l.ro},${l.go},${l.bo},${l.a})`);
      grad.addColorStop(1.00, `rgba(${l.ro},${l.go},${l.bo},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(-bLen * 0.5, -l.hw, bLen, l.hw * 2);
    }

    // Galactic core bulge: warmer golden tone, offset toward u=0.44
    const cx0 = -bLen * 0.06, cy0 = 0;
    const cg = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, bHW * 0.75);
    cg.addColorStop(0.00, 'rgba(220, 202, 162, 0.068)');
    cg.addColorStop(0.28, 'rgba(198, 182, 148, 0.044)');
    cg.addColorStop(0.60, 'rgba(165, 152, 125, 0.020)');
    cg.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(cx0, cy0, bHW * 0.75, bHW * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dust lane: thin dark streak through the band centre
    const dust = ctx.createLinearGradient(0, -bHW * 0.07, 0, bHW * 0.07);
    dust.addColorStop(0.0, 'rgba(0,0,3,0)');
    dust.addColorStop(0.5, 'rgba(0,0,3,0.030)');
    dust.addColorStop(1.0, 'rgba(0,0,3,0)');
    ctx.fillStyle = dust;
    ctx.fillRect(-bLen * 0.5, -bHW * 0.07, bLen, bHW * 0.14);

    ctx.restore();

    // Individual MW stars in world space
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    for (const s of MW_STARS) {
      const bx = (s.u - 0.5) * bLen;
      const by = s.v * bHW;
      const wx = bCx + bx * cosA - by * sinA;
      const wy = bCy + bx * sinA + by * cosA;
      if (wx < 0 || wx > w || wy < 0 || wy > h * 0.84) continue;
      const col = s.warm
        ? `rgba(234,224,206,${s.alpha})`
        : `rgba(208,220,245,${s.alpha})`;
      ctx.beginPath();
      ctx.arc(wx, wy, s.size, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
  }

  // ── Emission nebulae (very subtle wisps) ─────────────────
  function drawNebulae(w, h) {
    const patches = [
      // [fx, fy, rx_frac, ry_frac, R, G, B, alpha]
      [0.62, 0.30, 0.065, 0.038, 210,  75, 95, 0.028], // reddish H-II region
      [0.26, 0.20, 0.042, 0.028,  80, 115, 225, 0.022], // blue reflection nebula
      [0.80, 0.44, 0.035, 0.024, 175,  95, 178, 0.020], // violet
    ];
    for (const [fx, fy, rfx, rfy, R, G, B, a] of patches) {
      const px = fx * w, py = fy * h;
      const rx = rfx * w;
      const scaleY = (rfy * h) / rx;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, scaleY);
      const ng = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      ng.addColorStop(0.00, `rgba(${R},${G},${B},${a})`);
      ng.addColorStop(0.45, `rgba(${R},${G},${B},${+(a * 0.40).toFixed(4)})`);
      ng.addColorStop(1.00, `rgba(${R},${G},${B},0)`);
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Star field ────────────────────────────────────────────
  function drawStars(w, h) {
    for (const s of STARS) {
      const x = s.fx * w;
      const y = s.fy * h;

      // Very subtle atmospheric scintillation (twinkle)
      const tw = 0.90 + 0.10 * Math.sin(t * (0.65 + s.fx * 1.28) + s.fy * 13.84);

      // Physical size from magnitude: bright stars appear larger
      const size  = Math.max(0.25, 2.55 - s.mag * 0.34);
      const alpha = Math.max(0.04, 0.96 - s.mag * 0.133) * tw;

      // Glow halo for stars brighter than ~mag 4
      if (size > 1.40) {
        const hR = size * 3.6;
        const hg = ctx.createRadialGradient(x, y, 0, x, y, hR);
        hg.addColorStop(0.00, `rgba(${s.r},${s.g},${s.b},${+(alpha * 0.52).toFixed(4)})`);
        hg.addColorStop(0.30, `rgba(${s.r},${s.g},${s.b},${+(alpha * 0.16).toFixed(4)})`);
        hg.addColorStop(0.70, `rgba(${s.r},${s.g},${s.b},${+(alpha * 0.04).toFixed(4)})`);
        hg.addColorStop(1.00, `rgba(${s.r},${s.g},${s.b},0)`);
        ctx.beginPath();
        ctx.arc(x, y, hR, 0, Math.PI * 2);
        ctx.fillStyle = hg;
        ctx.fill();
      }

      // Diffraction spikes for stars brighter than ~mag 2
      if (size > 2.05) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.26;
        const sLen = size * 10;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const lg = ctx.createLinearGradient(x, y, x + dx * sLen, y + dy * sLen);
          lg.addColorStop(0, `rgba(${s.r},${s.g},${s.b},1)`);
          lg.addColorStop(1, `rgba(${s.r},${s.g},${s.b},0)`);
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + dx * sLen, y + dy * sLen);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Star disc
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${+alpha.toFixed(4)})`;
      ctx.fill();
    }
  }

  // ── Moon (waxing gibbous, ~80% illuminated) ───────────────
  function drawMoon(w, h) {
    const mx = w * 0.74;
    const my = h * 0.155;
    const mr = Math.min(w, h) * 0.054;

    // Outer atmospheric corona
    const halo = ctx.createRadialGradient(mx, my, mr * 0.92, mx, my, mr * 5.8);
    halo.addColorStop(0.00, 'rgba(248,245,228,0.058)');
    halo.addColorStop(0.18, 'rgba(240,238,218,0.026)');
    halo.addColorStop(0.48, 'rgba(228,225,205,0.010)');
    halo.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(mx, my, mr * 5.8, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();

    // Moon disc — clip to circle for all subsequent fills
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.clip();

    // Base tone: off-white with limb darkening
    // Highlight offset toward upper-left (sun direction for gibbous)
    const base = ctx.createRadialGradient(
      mx - mr * 0.20, my - mr * 0.18, 0,
      mx, my, mr
    );
    base.addColorStop(0.00, 'rgba(253, 249, 234, 1.0)');
    base.addColorStop(0.44, 'rgba(240, 236, 220, 1.0)');
    base.addColorStop(0.78, 'rgba(210, 206, 192, 0.97)');
    base.addColorStop(1.00, 'rgba(162, 158, 148, 0.90)');
    ctx.fillStyle = base;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);

    // Mare (lunar basalt plains) — positioned to match real Moon
    // Format: [cx_frac, cy_frac, rx_frac, ry_frac, rotation, opacity]
    const mare = [
      [-0.22, -0.22, 0.37, 0.27, 0.10, 0.27], // Mare Imbrium (large, upper-left)
      [ 0.20, -0.17, 0.25, 0.19, 0.05, 0.24], // Mare Serenitatis
      [ 0.22,  0.10, 0.27, 0.21, 0.08, 0.23], // Mare Tranquillitatis
      [-0.05,  0.30, 0.29, 0.18, 0.05, 0.21], // Mare Nubium
      [ 0.44,  0.08, 0.16, 0.12, 0.00, 0.20], // Mare Crisium (right edge)
      [-0.28,  0.20, 0.18, 0.13, 0.10, 0.18], // Mare Humorum
      [ 0.05, -0.40, 0.18, 0.08, 0.15, 0.16], // Mare Frigoris (top strip)
      [ 0.32, -0.32, 0.14, 0.10, 0.10, 0.16], // Mare Marginis
    ];

    for (const [ox, oy, rx, ry, rot, alpha] of mare) {
      const px = mx + ox * mr, py = my + oy * mr;
      const mg = ctx.createRadialGradient(px, py, 0, px, py, rx * mr);
      mg.addColorStop(0.00, `rgba(112,110,103,${alpha})`);
      mg.addColorStop(0.50, `rgba(132,129,121,${+(alpha * 0.58).toFixed(3)})`);
      mg.addColorStop(1.00, 'rgba(168,164,154,0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.ellipse(px, py, rx * mr, ry * mr, rot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Terminator shadow on right limb (gibbous phase)
    const term = ctx.createRadialGradient(
      mx + mr * 0.88, my, 0,
      mx + mr * 0.88, my, mr * 1.55
    );
    term.addColorStop(0.00, 'rgba(0,0,8,0)');
    term.addColorStop(0.52, 'rgba(0,0,8,0)');
    term.addColorStop(0.76, 'rgba(0,0,8,0.18)');
    term.addColorStop(1.00, 'rgba(0,0,8,0.45)');
    ctx.fillStyle = term;
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);

    ctx.restore(); // end clip

    // Thin bright limb highlight (specular edge)
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,252,240,0.16)';
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }

  // ── Airglow (atmospheric emission at ~100 km altitude) ────
  // Visible in long-exposure dark-site photography as a faint blue-green band.
  function drawAirglow(w, h) {
    const horizY = h * 0.84;
    const ag = ctx.createLinearGradient(0, horizY - h * 0.12, 0, horizY + h * 0.04);
    ag.addColorStop(0.00, 'rgba(0,0,0,0)');
    ag.addColorStop(0.40, 'rgba(28, 62, 36, 0.022)'); // OI green emission
    ag.addColorStop(0.62, 'rgba(24, 52, 78, 0.038)'); // blue-green
    ag.addColorStop(0.82, 'rgba(18, 42, 62, 0.025)');
    ag.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.fillRect(0, horizY - h * 0.12, w, h * 0.16);
  }

  // ── City light pollution on horizon ──────────────────────
  // Drawn before terrain so it glows from behind the hills.
  function drawCityGlow(w, h) {
    const horizY = h * 0.84;
    // [x_frac, radius_frac, intensity, hue_offset]
    const glows = [
      [0.10, 0.18, 0.68, 0],
      [0.46, 0.14, 0.42, 8],
      [0.76, 0.22, 0.85, 0],
      [0.94, 0.10, 0.32, 5],
    ];
    for (const [fx, rf, intensity, hs] of glows) {
      const gx = fx * w;
      const gr = rf * w;
      const gg = ctx.createRadialGradient(gx, horizY, 0, gx, horizY, gr);
      gg.addColorStop(0.00, `rgba(255,${148 + hs},22,${+(0.14 * intensity).toFixed(3)})`);
      gg.addColorStop(0.32, `rgba(255,${120 + hs},12,${+(0.06 * intensity).toFixed(3)})`);
      gg.addColorStop(0.70, `rgba(245,${100 + hs}, 8,${+(0.022 * intensity).toFixed(3)})`);
      gg.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(gx, horizY, gr, gr * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Terrain silhouette ────────────────────────────────────
  function drawTerrain(w, h) {
    const groundY = h * 0.84;

    // 6-octave sum-of-sines
    const pts = new Float32Array(w + 1);
    const SEED = 2.814;
    let amp = 1, freq = 1;
    for (let o = 0; o < 6; o++) {
      for (let x = 0; x <= w; x++) {
        pts[x] +=
          Math.sin((x / w) * Math.PI * 2 * freq + SEED * (o + 1) * 1.31) * amp +
          Math.cos((x / w) * Math.PI * 3.71 * freq + SEED * (o + 2) * 0.73) * amp * 0.44;
      }
      amp *= 0.52; freq *= 2.1;
    }
    for (let x = 0; x <= w; x++) pts[x] *= 36;

    // Terrain body — very dark, nearly black
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, groundY + pts[0]);
    for (let x = 1; x <= w; x++) ctx.lineTo(x, groundY + pts[x]);
    ctx.lineTo(w, h);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, groundY - 20, 0, h);
    tg.addColorStop(0.00, '#060c0b');
    tg.addColorStop(0.14, '#050908');
    tg.addColorStop(0.50, '#030605');
    tg.addColorStop(1.00, '#010403');
    ctx.fillStyle = tg;
    ctx.fill();

    // Ridge rim-light: cool blue-white from moonlight
    ctx.beginPath();
    ctx.moveTo(0, groundY + pts[0]);
    for (let x = 1; x <= w; x++) ctx.lineTo(x, groundY + pts[x]);
    ctx.lineTo(w, groundY + pts[w] + 5);
    ctx.lineTo(0, groundY + pts[0] + 5);
    ctx.closePath();
    const rim = ctx.createLinearGradient(0, groundY - 4, 0, groundY + 8);
    rim.addColorStop(0, 'rgba(200, 212, 235, 0.095)');
    rim.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rim;
    ctx.fill();
  }

  // ── Full frame render ─────────────────────────────────────
  function render(w, h) {
    drawSky(w, h);
    drawMilkyWay(w, h);
    drawNebulae(w, h);
    drawStars(w, h);
    drawMoon(w, h);
    drawAirglow(w, h);
    drawCityGlow(w, h);   // behind terrain
    drawTerrain(w, h);    // covers horizon + below
  }

  // ── Animation loop ────────────────────────────────────────
  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    t += dt;
    render(W(), H());
    animFrame = requestAnimationFrame(frame);
  }

  // ── Setup ─────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('scene-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    lastTime = performance.now();
    animFrame = requestAnimationFrame(frame);
  }

  function resize() {
    if (!canvas) return;
    const pr = dpr();
    canvas.width  = Math.round(window.innerWidth  * pr);
    canvas.height = Math.round(window.innerHeight * pr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pr, pr);
  }

  window.addEventListener('load', init);

  return { init, resize };

})();
