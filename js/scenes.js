// ============================================================
// COSMIC FRONTIER - Photorealistic Planet Surface Renderer
// Canvas-based surface views for each location
// ============================================================

const Scenes = (() => {
  'use strict';

  let canvas, ctx;
  let currentLocation = null;
  let animFrame = null;
  let t = 0;
  let lastAnimTime = 0;

  // ---- Seeded PRNG (Mulberry32) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Terrain generator (sum of sines) ----
  function genTerrain(w, seed, roughness, octaves) {
    const pts = new Float32Array(w + 1);
    for (let x = 0; x <= w; x++) {
      let y = 0, amp = 1, freq = 1;
      for (let o = 0; o < octaves; o++) {
        const phase1 = seed * (o + 1) * 1.3;
        const phase2 = seed * (o + 2) * 0.7;
        y += Math.sin((x / w) * Math.PI * 2 * freq + phase1) * amp;
        y += Math.cos((x / w) * Math.PI * 3.7 * freq + phase2) * amp * 0.45;
        amp  *= 0.52;
        freq *= 2.1;
      }
      pts[x] = y * roughness;
    }
    return pts;
  }

  // ---- Draw filled terrain silhouette ----
  function drawTerrain(pts, baseY, w, h, fillStyle) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, baseY + pts[0]);
    for (let x = 1; x <= w; x++) {
      ctx.lineTo(x, baseY + (pts[x] !== undefined ? pts[x] : pts[pts.length - 1]));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  // ---- Draw stars ----
  function drawStars(density, maxOpacity, seed) {
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    const rng = mulberry32(seed || 42);
    const count = Math.floor(w * h * density);
    for (let i = 0; i < count; i++) {
      const x = rng() * w;
      const y = rng() * h * 0.78;
      const r = 0.3 + rng() * 1.4;
      const bright = 0.4 + rng() * 0.6;
      const twinkle = 0.75 + 0.25 * Math.sin(t * 1.8 + i * 0.37);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${bright * maxOpacity * twinkle})`;
      ctx.fill();
    }
  }

  // ---- Draw a sun/star disc with corona ----
  function drawSun(cx, cy, radius, r, g, b, coronaMult) {
    const cR = radius * coronaMult;
    const corona = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, cR);
    corona.addColorStop(0,   `rgba(${r},${g},${b},0.75)`);
    corona.addColorStop(0.25,`rgba(${r},${g},${b},0.35)`);
    corona.addColorStop(0.55,`rgba(${r},${g},${b},0.10)`);
    corona.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(cx, cy, cR, 0, Math.PI * 2);
    ctx.fillStyle = corona;
    ctx.fill();

    const disc = ctx.createRadialGradient(cx - radius * 0.22, cy - radius * 0.22, 0, cx, cy, radius);
    disc.addColorStop(0,   'rgba(255,255,255,1)');
    disc.addColorStop(0.55,`rgba(${r},${g},${b},1)`);
    disc.addColorStop(1,   `rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},1)`);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = disc;
    ctx.fill();
  }

  // ============================================================
  // SCENE DEFINITIONS
  // ============================================================

  const SCENES = {

    // ---- EARTH: High-altitude night view, stars clearly visible ----
    earth: (w, h) => {
      // Sky: near-space at top, deep-blue atmosphere towards ground
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,    '#000008');
      sky.addColorStop(0.12, '#01030f');
      sky.addColorStop(0.30, '#020820');
      sky.addColorStop(0.50, '#040d35');
      sky.addColorStop(0.66, '#071545');
      sky.addColorStop(0.78, '#0a1a3a');
      sky.addColorStop(0.90, '#07101e');
      sky.addColorStop(1,    '#050c12');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Stars bright in upper sky (high altitude / nightside)
      drawStars(0.00018, 0.92, 42);

      // Milky Way band
      const mw = ctx.createLinearGradient(0, 0, w, h * 0.5);
      mw.addColorStop(0, 'rgba(120,140,200,0)');
      mw.addColorStop(0.3, 'rgba(140,160,220,0.04)');
      mw.addColorStop(0.5, 'rgba(160,180,240,0.07)');
      mw.addColorStop(0.7, 'rgba(130,150,210,0.04)');
      mw.addColorStop(1, 'rgba(100,120,180,0)');
      ctx.fillStyle = mw;
      ctx.fillRect(0, 0, w, h * 0.55);

      // Sun near horizon (late twilight / dawn)
      drawSun(w * 0.80, h * 0.62, 20, 255, 235, 180, 5.5);

      // Atmospheric limb: thin blue line at horizon
      const horizY = h * 0.70;
      const atmosLimb = ctx.createLinearGradient(0, horizY - 40, 0, horizY + 20);
      atmosLimb.addColorStop(0, 'rgba(10,60,180,0)');
      atmosLimb.addColorStop(0.45, 'rgba(20,90,220,0.30)');
      atmosLimb.addColorStop(0.62, 'rgba(40,120,240,0.45)');
      atmosLimb.addColorStop(0.80, 'rgba(20,70,180,0.20)');
      atmosLimb.addColorStop(1, 'rgba(5,20,80,0.05)');
      ctx.fillStyle = atmosLimb;
      ctx.fillRect(0, horizY - 40, w, 60);

      // Sunrise/sunset glow on horizon
      const hGlow = ctx.createRadialGradient(w * 0.80, horizY, 0, w * 0.80, horizY, w * 0.6);
      hGlow.addColorStop(0, 'rgba(255,160,40,0.20)');
      hGlow.addColorStop(0.3, 'rgba(220,100,20,0.10)');
      hGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hGlow;
      ctx.fillRect(0, horizY - 60, w, 120);

      // Ground: rocky terrain, dark green-gray
      const groundY = h * 0.72;
      const terrain = genTerrain(w, 1.5, 18, 5);
      const groundGrad = ctx.createLinearGradient(0, groundY - 20, 0, h);
      groundGrad.addColorStop(0,   '#0e2018');
      groundGrad.addColorStop(0.15,'#0a1812');
      groundGrad.addColorStop(0.5, '#060e0a');
      groundGrad.addColorStop(1,   '#030806');
      drawTerrain(terrain, groundY, w, h, groundGrad);

      // Rim-light on ridge from sun
      const rimGrad = ctx.createLinearGradient(0, groundY - 8, 0, groundY + 16);
      rimGrad.addColorStop(0, 'rgba(255,200,80,0.28)');
      rimGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rimGrad;
      ctx.fillRect(0, groundY - 8, w, 24);

      // City lights glow on ground (scattered amber dots)
      const rng = mulberry32(13);
      for (let i = 0; i < 28; i++) {
        const lx = rng() * w;
        const ly = groundY + 20 + rng() * (h - groundY - 30);
        const lr = 0.8 + rng() * 1.6;
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr * 6);
        lg.addColorStop(0, `rgba(255,${160 + rng() * 80|0},20,0.7)`);
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(lx, ly, lr * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    // ---- MOON: Black sky, dense stars, Earth in sky, harsh regolith ----
    moon: (w, h) => {
      ctx.fillStyle = '#000003';
      ctx.fillRect(0, 0, w, h);

      // Crisp dense stars (no atmosphere)
      drawStars(0.00042, 1.0, 77);

      // Earth — large, blue marble
      const eX = w * 0.22, eY = h * 0.20, eR = Math.min(w, h) * 0.11;
      const earthAtmos = ctx.createRadialGradient(eX, eY, eR * 0.9, eX, eY, eR * 2.8);
      earthAtmos.addColorStop(0, 'rgba(40,100,220,0.18)');
      earthAtmos.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = earthAtmos;
      ctx.beginPath(); ctx.arc(eX, eY, eR * 2.8, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.arc(eX, eY, eR, 0, Math.PI * 2); ctx.clip();
      // Ocean base
      const earthDisc = ctx.createRadialGradient(eX - eR*0.2, eY - eR*0.2, 0, eX, eY, eR);
      earthDisc.addColorStop(0,   '#90c0f0');
      earthDisc.addColorStop(0.35,'#1a5ab8');
      earthDisc.addColorStop(0.70,'#1040a0');
      earthDisc.addColorStop(1,   '#081828');
      ctx.fillStyle = earthDisc; ctx.fillRect(eX - eR, eY - eR, eR*2, eR*2);
      // Land masses
      const rngE = mulberry32(500);
      ctx.fillStyle = 'rgba(40,120,50,0.65)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(eX + (rngE()-0.5)*eR*1.4, eY + (rngE()-0.5)*eR*1.4,
                    eR*(0.2+rngE()*0.3), eR*(0.15+rngE()*0.25), rngE()*Math.PI, 0, Math.PI*2);
        ctx.fill();
      }
      // Clouds
      ctx.fillStyle = 'rgba(230,240,255,0.28)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(eX + (rngE()-0.5)*eR*1.6, eY + (rngE()-0.5)*eR*1.0,
                    eR*(0.3+rngE()*0.4), eR*(0.12+rngE()*0.18), rngE()*Math.PI, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();

      // Harsh white Sun
      drawSun(w * 0.82, h * 0.12, 14, 255, 255, 235, 2.8);

      // Regolith surface
      const groundY = h * 0.66;
      const terrain = genTerrain(w, 3.2, 24, 6);
      const moonGrad = ctx.createLinearGradient(0, groundY - 25, 0, h);
      moonGrad.addColorStop(0,   '#606060');
      moonGrad.addColorStop(0.08,'#4a4a4a');
      moonGrad.addColorStop(0.3, '#333333');
      moonGrad.addColorStop(0.7, '#1e1e1e');
      moonGrad.addColorStop(1,   '#0c0c0c');
      drawTerrain(terrain, groundY, w, h, moonGrad);

      // Sun-lit ridge highlight
      const ridgeHL = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 18);
      ridgeHL.addColorStop(0, 'rgba(220,220,200,0.65)');
      ridgeHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ridgeHL; ctx.fillRect(0, groundY - 10, w, 28);

      // Shadow-filled craters (dark circles on lit ground)
      const rngC = mulberry32(303);
      for (let i = 0; i < 6; i++) {
        const cx = rngC() * w;
        const cy = groundY + 15 + rngC() * (h - groundY - 25);
        const cr = 4 + rngC() * 18;
        const cg = ctx.createRadialGradient(cx + cr*0.25, cy - cr*0.15, 0, cx, cy, cr);
        cg.addColorStop(0, 'rgba(0,0,0,0.6)');
        cg.addColorStop(0.7,'rgba(0,0,0,0.25)');
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fillStyle = cg; ctx.fill();
      }
    },

    // ---- MARS: Pink-orange sky, dust haze, rusty terrain ----
    mars: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,    '#0e0401');
      sky.addColorStop(0.18, '#1e0802');
      sky.addColorStop(0.35, '#3c1204');
      sky.addColorStop(0.52, '#7a2c0c');
      sky.addColorStop(0.68, '#c85520');
      sky.addColorStop(0.80, '#d87035');
      sky.addColorStop(0.90, '#cc6828');
      sky.addColorStop(1,    '#b05820');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Dust haze band
      const dust = ctx.createLinearGradient(0, h * 0.45, 0, h * 0.82);
      dust.addColorStop(0, 'rgba(210,110,40,0)');
      dust.addColorStop(0.5,'rgba(200,100,35,0.18)');
      dust.addColorStop(1, 'rgba(180,90,30,0.28)');
      ctx.fillStyle = dust; ctx.fillRect(0, h * 0.45, w, h * 0.4);

      // Small pale Sun
      drawSun(w * 0.68, h * 0.26, 9, 255, 215, 160, 6.5);

      // Dust motes
      const rngD = mulberry32(99);
      for (let i = 0; i < 55; i++) {
        const px = rngD() * w, py = h * 0.48 + rngD() * h * 0.36;
        ctx.beginPath();
        ctx.arc(px, py, rngD() * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(230,145,60,${rngD() * 0.14})`;
        ctx.fill();
      }

      // Rocky terrain
      const groundY = h * 0.63;
      const terrain = genTerrain(w, 2.1, 26, 5);
      const marsGrad = ctx.createLinearGradient(0, groundY - 22, 0, h);
      marsGrad.addColorStop(0,   '#923015');
      marsGrad.addColorStop(0.18,'#7a2808');
      marsGrad.addColorStop(0.5, '#601e05');
      marsGrad.addColorStop(1,   '#3d1002');
      drawTerrain(terrain, groundY, w, h, marsGrad);

      // Rock surface highlight
      const hl = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 22);
      hl.addColorStop(0, 'rgba(190,90,35,0.52)');
      hl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hl; ctx.fillRect(0, groundY - 10, w, 32);

      // Scattered rocks
      const rngR = mulberry32(201);
      for (let i = 0; i < 10; i++) {
        const rx = rngR() * w;
        const ry = groundY + 8 + rngR() * (h - groundY - 20);
        const rw = 5 + rngR() * 16, rh2 = 3 + rngR() * 8;
        ctx.save(); ctx.translate(rx, ry); ctx.rotate(rngR() * 0.5 - 0.25);
        ctx.beginPath(); ctx.ellipse(0, 0, rw, rh2, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${100 + rngR()*50|0},${45 + rngR()*25|0},${15 + rngR()*15|0},0.85)`;
        ctx.fill(); ctx.restore();
      }
    },

    // ---- ASTEROID BELT: Pure space, rocky surface, floating debris ----
    asteroidBelt: (w, h) => {
      ctx.fillStyle = '#000002';
      ctx.fillRect(0, 0, w, h);
      drawStars(0.00030, 0.95, 441);

      // Distant Sun
      drawSun(w * 0.15, h * 0.10, 11, 255, 242, 185, 4);

      // Asteroid surface — rough, gray-brown
      const groundY = h * 0.60;
      const terrain = genTerrain(w, 4.5, 32, 7);
      const rockGrad = ctx.createLinearGradient(0, groundY - 30, 0, h);
      rockGrad.addColorStop(0,   '#4e4c48');
      rockGrad.addColorStop(0.12,'#3c3a36');
      rockGrad.addColorStop(0.40,'#2a2826');
      rockGrad.addColorStop(1,   '#100e0c');
      drawTerrain(terrain, groundY, w, h, rockGrad);

      // Metallic gleam
      const gleam = ctx.createLinearGradient(0, groundY - 18, 0, groundY + 18);
      gleam.addColorStop(0, 'rgba(170,165,145,0.52)');
      gleam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gleam; ctx.fillRect(0, groundY - 18, w, 36);

      // Floating debris in background
      const rngA = mulberry32(77);
      for (let i = 0; i < 8; i++) {
        const ax = rngA() * w, ay = h * 0.10 + rngA() * h * 0.38;
        const arx = 4 + rngA() * 14, ary = (arx * (0.4 + rngA() * 0.5));
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(rngA() * Math.PI * 2);
        ctx.beginPath(); ctx.ellipse(0, 0, arx, ary, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${70+rngA()*50|0},${68+rngA()*45|0},${58+rngA()*35|0},${0.28+rngA()*0.32})`;
        ctx.fill(); ctx.restore();
      }
    },

    // ---- JUPITER: View from cloud-top, banded bands, Great Red Spot ----
    jupiter: (w, h) => {
      // Banded atmosphere
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,    '#120804');
      sky.addColorStop(0.08, '#c87845');
      sky.addColorStop(0.17, '#e8a860');
      sky.addColorStop(0.25, '#a85e2a');
      sky.addColorStop(0.33, '#ecc070');
      sky.addColorStop(0.41, '#b87040');
      sky.addColorStop(0.49, '#d89060');
      sky.addColorStop(0.57, '#9a5528');
      sky.addColorStop(0.65, '#e8b870');
      sky.addColorStop(0.73, '#b87848');
      sky.addColorStop(0.81, '#c8905a');
      sky.addColorStop(0.90, '#a07048');
      sky.addColorStop(1,    '#7a5030');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Dark band edges
      [0.08,0.17,0.25,0.33,0.41,0.49,0.57,0.65,0.73,0.81].forEach(b => {
        const bg = ctx.createLinearGradient(0, h*b-5, 0, h*b+5);
        bg.addColorStop(0, 'rgba(60,30,10,0)');
        bg.addColorStop(0.5,'rgba(60,30,10,0.28)');
        bg.addColorStop(1, 'rgba(60,30,10,0)');
        ctx.fillStyle = bg; ctx.fillRect(0, h*b-5, w, 10);
      });

      // Great Red Spot
      const gX = w * 0.62, gY = h * 0.46;
      const gRx = w * 0.10, gRy = h * 0.055;
      const gGrad = ctx.createRadialGradient(gX, gY, 0, gX, gY, gRx);
      gGrad.addColorStop(0,   'rgba(170,45,20,0.85)');
      gGrad.addColorStop(0.55,'rgba(190,60,28,0.55)');
      gGrad.addColorStop(0.85,'rgba(140,50,22,0.25)');
      gGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(gX, gY, gRx, gRy, 0.08, 0, Math.PI*2);
      ctx.fillStyle = gGrad; ctx.fill();

      // Cloud deck "ground"
      const cloudY = h * 0.82;
      const cloudGrad = ctx.createLinearGradient(0, cloudY - 15, 0, h);
      cloudGrad.addColorStop(0, 'rgba(180,110,50,0)');
      cloudGrad.addColorStop(0.3,'#a06030');
      cloudGrad.addColorStop(1, '#5a3015');
      ctx.fillStyle = cloudGrad; ctx.fillRect(0, cloudY, w, h - cloudY);

      const cTerrain = genTerrain(w, 7.7, 14, 4);
      const cTopGrad = ctx.createLinearGradient(0, cloudY - 18, 0, cloudY + 15);
      cTopGrad.addColorStop(0, 'rgba(210,145,65,0)');
      cTopGrad.addColorStop(0.45,'rgba(190,120,55,0.72)');
      cTopGrad.addColorStop(1, 'rgba(130,75,30,0.9)');
      drawTerrain(cTerrain, cloudY - 8, w, h, cTopGrad);
    },

    // ---- EUROPA: Icy plain, Jupiter huge in sky, brown cracks ----
    europa: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#000004');
      sky.addColorStop(0.25,'#01030e');
      sky.addColorStop(0.55,'#020618');
      sky.addColorStop(0.80,'#010410');
      sky.addColorStop(1,   '#010208');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      drawStars(0.00030, 0.90, 550);

      // Jupiter looming huge overhead
      const jX = w * 0.50, jY = -h * 0.28, jR = h * 0.72;
      const jGrad = ctx.createRadialGradient(jX - jR*0.12, jY, 0, jX, jY, jR);
      jGrad.addColorStop(0,   'rgba(245,185,105,0.92)');
      jGrad.addColorStop(0.30,'rgba(215,145,70,0.80)');
      jGrad.addColorStop(0.60,'rgba(175,100,48,0.55)');
      jGrad.addColorStop(0.85,'rgba(140,78,38,0.25)');
      jGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.arc(jX, jY, jR, 0, Math.PI * 2);
      ctx.fillStyle = jGrad; ctx.fill();

      // Jupiter bands (visible at edge above horizon)
      for (let b = 0; b < 5; b++) {
        const by = jY + jR * (0.12 + b * 0.13);
        ctx.save();
        ctx.beginPath(); ctx.arc(jX, jY, jR, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = `rgba(110,55,18,${0.22 + b*0.04})`;
        ctx.lineWidth = jR * 0.028;
        ctx.beginPath();
        ctx.ellipse(jX, by, jR * 0.96, jR * 0.035, 0, 0, Math.PI);
        ctx.stroke(); ctx.restore();
      }

      // Icy surface
      const groundY = h * 0.67;
      const iceTerrain = genTerrain(w, 5.5, 14, 5);
      const iceGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      iceGrad.addColorStop(0,   '#cce4f4');
      iceGrad.addColorStop(0.06,'#b0cce0');
      iceGrad.addColorStop(0.25,'#86aec8');
      iceGrad.addColorStop(0.55,'#5888a8');
      iceGrad.addColorStop(1,   '#2a4860');
      drawTerrain(iceTerrain, groundY, w, h, iceGrad);

      // Ice surface glow (Jupiter light)
      const iceHL = ctx.createLinearGradient(0, groundY - 6, 0, groundY + 18);
      iceHL.addColorStop(0, 'rgba(200,170,100,0.40)');
      iceHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = iceHL; ctx.fillRect(0, groundY - 6, w, 24);

      // Brown cracks (linea)
      const rngC = mulberry32(55);
      ctx.lineWidth = 2;
      for (let c = 0; c < 6; c++) {
        ctx.strokeStyle = `rgba(${110+rngC()*40|0},${60+rngC()*20|0},${25+rngC()*20|0},${0.45+rngC()*0.30})`;
        ctx.beginPath();
        let cx = rngC() * w, cy = groundY + 8 + rngC() * (h - groundY - 20);
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 5; s++) {
          cx += (rngC() - 0.48) * 65; cy += rngC() * 32;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    },

    // ---- SATURN: Icy surface, rings arc overhead, pale blue sky ----
    saturn: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#000006');
      sky.addColorStop(0.22,'#03060e');
      sky.addColorStop(0.48,'#060c1c');
      sky.addColorStop(0.68,'#091220');
      sky.addColorStop(0.85,'#070d18');
      sky.addColorStop(1,   '#04080e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      drawStars(0.00025, 0.90, 660);

      // Ring arc spanning sky
      const rCX = w * 0.50, rCY = h * 0.38;
      [
        { rx: w * 0.95, ry: 22, lw: 14, col: 'rgba(192,162,108,0.62)' },
        { rx: w * 0.78, ry: 17, lw: 9,  col: 'rgba(178,150,100,0.52)' },
        { rx: w * 0.62, ry: 13, lw: 5,  col: 'rgba(210,180,120,0.38)' },
      ].forEach(ring => {
        const rg = ctx.createLinearGradient(0, rCY - ring.ry, 0, rCY + ring.ry);
        rg.addColorStop(0, ring.col.replace(/[\d.]+\)$/, '0)'));
        rg.addColorStop(0.4, ring.col);
        rg.addColorStop(0.6, ring.col);
        rg.addColorStop(1, ring.col.replace(/[\d.]+\)$/, '0)'));
        ctx.strokeStyle = rg;
        ctx.lineWidth = ring.lw;
        ctx.beginPath();
        ctx.ellipse(rCX, rCY, ring.rx, ring.ry, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
      });

      // Distant Sun
      drawSun(w * 0.18, h * 0.12, 7, 255, 238, 195, 5);

      // Icy ground
      const groundY = h * 0.65;
      const iceTerrain = genTerrain(w, 8.1, 18, 5);
      const iceGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      iceGrad.addColorStop(0,   '#e8f0f8');
      iceGrad.addColorStop(0.08,'#c4d4e4');
      iceGrad.addColorStop(0.35,'#8096b0');
      iceGrad.addColorStop(0.70,'#3a4e64');
      iceGrad.addColorStop(1,   '#1a2430');
      drawTerrain(iceTerrain, groundY, w, h, iceGrad);

      // Ice gleam
      const iceHL = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 20);
      iceHL.addColorStop(0, 'rgba(255,245,220,0.48)');
      iceHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = iceHL; ctx.fillRect(0, groundY - 10, w, 30);
    },

    // ---- TITAN: Thick orange smog, dark dunes, no visible stars ----
    titan: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#0f0702');
      sky.addColorStop(0.15,'#2a1206');
      sky.addColorStop(0.35,'#5e2c0e');
      sky.addColorStop(0.55,'#9a4818');
      sky.addColorStop(0.70,'#c26215');
      sky.addColorStop(0.82,'#d07218');
      sky.addColorStop(0.92,'#be6610');
      sky.addColorStop(1,   '#9a5208');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Haze layers
      const haze = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.60);
      haze.addColorStop(0, 'rgba(175,85,15,0)');
      haze.addColorStop(0.5,'rgba(160,78,12,0.22)');
      haze.addColorStop(1, 'rgba(140,65,10,0)');
      ctx.fillStyle = haze; ctx.fillRect(0, h * 0.25, w, h * 0.35);

      // Diffuse sun halo (not directly visible)
      const sHalo = ctx.createRadialGradient(w*0.38, h*0.28, 0, w*0.38, h*0.28, w*0.55);
      sHalo.addColorStop(0, 'rgba(255,185,55,0.18)');
      sHalo.addColorStop(0.5,'rgba(210,130,30,0.08)');
      sHalo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sHalo; ctx.fillRect(0, 0, w, h);

      // Dark organic sand dunes
      const groundY = h * 0.64;
      const duneTerrain = genTerrain(w, 9.9, 20, 4);
      const duneGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      duneGrad.addColorStop(0,   '#3c2010');
      duneGrad.addColorStop(0.15,'#2c1808');
      duneGrad.addColorStop(0.50,'#1c1006');
      duneGrad.addColorStop(1,   '#0e0803');
      drawTerrain(duneTerrain, groundY, w, h, duneGrad);

      // Dune crest highlight (back-lit orange)
      const duneHL = ctx.createLinearGradient(0, groundY - 6, 0, groundY + 24);
      duneHL.addColorStop(0, 'rgba(120,65,18,0.60)');
      duneHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = duneHL; ctx.fillRect(0, groundY - 6, w, 30);

      // Methane lake (dark reflective patch)
      const rngT = mulberry32(174);
      const lakeX = rngT() * w * 0.5 + w * 0.15;
      const lakeY = groundY + 40 + rngT() * (h - groundY - 60);
      const lakeW = 60 + rngT() * 80, lakeH2 = 10 + rngT() * 18;
      const lakeGrad = ctx.createRadialGradient(lakeX, lakeY, 0, lakeX, lakeY, lakeW);
      lakeGrad.addColorStop(0, 'rgba(20,35,50,0.82)');
      lakeGrad.addColorStop(0.7,'rgba(15,25,35,0.50)');
      lakeGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(lakeX, lakeY, lakeW, lakeH2, 0, 0, Math.PI*2);
      ctx.fillStyle = lakeGrad; ctx.fill();
    },

    // ---- URANUS: Teal-blue methane sky, ice surface, tilted rings ----
    uranus: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#000410');
      sky.addColorStop(0.22,'#001520');
      sky.addColorStop(0.48,'#002535');
      sky.addColorStop(0.65,'#003240');
      sky.addColorStop(0.80,'#003848');
      sky.addColorStop(1,   '#002c38');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      drawStars(0.00022, 0.82, 770);

      // Tilted ring system in sky
      const uRx = w * 0.50, uRy = h * 0.28;
      ctx.save(); ctx.translate(uRx, uRy); ctx.rotate(0.28);
      [
        { rx: 75, ry: 170, lw: 2.5, a: 0.38 },
        { rx: 90, ry: 205, lw: 1.5, a: 0.25 },
        { rx: 55, ry: 125, lw: 1.5, a: 0.20 },
      ].forEach(r => {
        ctx.strokeStyle = `rgba(100,195,215,${r.a})`;
        ctx.lineWidth = r.lw;
        ctx.beginPath(); ctx.ellipse(0, 0, r.rx, r.ry, 0, 0, Math.PI*2); ctx.stroke();
      });
      ctx.restore();

      // Very distant Sun
      drawSun(w * 0.85, h * 0.09, 5, 255, 248, 225, 4);

      // Ice-rock surface
      const groundY = h * 0.67;
      const iceTerrain = genTerrain(w, 11.2, 17, 6);
      const iceGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      iceGrad.addColorStop(0,   '#68c0cc');
      iceGrad.addColorStop(0.10,'#4898a8');
      iceGrad.addColorStop(0.38,'#207888');
      iceGrad.addColorStop(0.70,'#0c3848');
      iceGrad.addColorStop(1,   '#051820');
      drawTerrain(iceTerrain, groundY, w, h, iceGrad);

      // Surface sheen
      const sheen = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 22);
      sheen.addColorStop(0, 'rgba(130,225,240,0.42)');
      sheen.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sheen; ctx.fillRect(0, groundY - 10, w, 32);
    },

    // ---- NEPTUNE: Deep blue, storm system, frozen surface ----
    neptune: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#000006');
      sky.addColorStop(0.18,'#00041c');
      sky.addColorStop(0.38,'#000835');
      sky.addColorStop(0.55,'#000e50');
      sky.addColorStop(0.70,'#001460');
      sky.addColorStop(0.85,'#000e50');
      sky.addColorStop(1,   '#000830');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      drawStars(0.00022, 0.85, 880);

      // Great Dark Spot
      const gdX = w * 0.35, gdY = h * 0.30;
      const gdGrad = ctx.createRadialGradient(gdX, gdY, 0, gdX, gdY, w * 0.12);
      gdGrad.addColorStop(0,   'rgba(0,0,15,0.72)');
      gdGrad.addColorStop(0.55,'rgba(0,4,24,0.40)');
      gdGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.ellipse(gdX, gdY, w*0.12, h*0.065, -0.18, 0, Math.PI*2);
      ctx.fillStyle = gdGrad; ctx.fill();

      // Tiny distant Sun
      drawSun(w * 0.90, h * 0.07, 3, 255, 250, 235, 4.5);

      // Frozen surface
      const groundY = h * 0.70;
      const nepTerrain = genTerrain(w, 13.3, 15, 5);
      const nepGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      nepGrad.addColorStop(0,   '#4268cc');
      nepGrad.addColorStop(0.10,'#2245aa');
      nepGrad.addColorStop(0.40,'#102280');
      nepGrad.addColorStop(0.70,'#070e3a');
      nepGrad.addColorStop(1,   '#030520');
      drawTerrain(nepTerrain, groundY, w, h, nepGrad);

      // Ice surface gleam
      const iceHL = ctx.createLinearGradient(0, groundY - 8, 0, groundY + 20);
      iceHL.addColorStop(0, 'rgba(80,130,255,0.38)');
      iceHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = iceHL; ctx.fillRect(0, groundY - 8, w, 28);
    },

    // ---- KUIPER BELT: Deep space, icy-dirty terrain, frost patches ----
    kuiperBelt: (w, h) => {
      ctx.fillStyle = '#000001';
      ctx.fillRect(0, 0, w, h);
      drawStars(0.00040, 0.96, 991);

      // Minuscule Sun
      drawSun(w * 0.50, h * 0.12, 3, 255, 250, 225, 5);

      // Dirty ice terrain
      const groundY = h * 0.64;
      const kbTerrain = genTerrain(w, 15.5, 30, 7);
      const kbGrad = ctx.createLinearGradient(0, groundY - 18, 0, h);
      kbGrad.addColorStop(0,   '#b2a898');
      kbGrad.addColorStop(0.12,'#908070');
      kbGrad.addColorStop(0.42,'#5c4e40');
      kbGrad.addColorStop(0.75,'#2e2218');
      kbGrad.addColorStop(1,   '#16100a');
      drawTerrain(kbTerrain, groundY, w, h, kbGrad);

      // Frost patches
      const rngK = mulberry32(333);
      for (let i = 0; i < 15; i++) {
        const fx = rngK() * w, fy = groundY + 6 + rngK() * (h - groundY - 18);
        const fr = 5 + rngK() * 18;
        const fGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
        fGrad.addColorStop(0, `rgba(215,225,235,${0.30 + rngK()*0.35})`);
        fGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
      }
    },

    // ---- PROXIMA CENTAURI: Red dwarf, alien rock, red sky ----
    proxima: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#040001');
      sky.addColorStop(0.20,'#0e0203');
      sky.addColorStop(0.40,'#1e0405');
      sky.addColorStop(0.58,'#340606');
      sky.addColorStop(0.72,'#4a0807');
      sky.addColorStop(0.85,'#580906');
      sky.addColorStop(1,   '#3c0604');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Some stars (thin atmosphere)
      drawStars(0.00014, 0.68, 1102);

      // Red dwarf — large, reddish
      drawSun(w * 0.55, h * 0.30, 34, 255, 72, 18, 4.2);

      // Flare corona
      const flare = ctx.createRadialGradient(w*0.55, h*0.30, 32, w*0.55, h*0.30, 110);
      flare.addColorStop(0, 'rgba(255,90,15,0.18)');
      flare.addColorStop(0.5,'rgba(200,45,8,0.09)');
      flare.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = flare; ctx.fillRect(0, 0, w, h);

      // Red rocky alien terrain
      const groundY = h * 0.64;
      const pcTerrain = genTerrain(w, 17.7, 32, 6);
      const pcGrad = ctx.createLinearGradient(0, groundY - 18, 0, h);
      pcGrad.addColorStop(0,   '#4e2010');
      pcGrad.addColorStop(0.20,'#3c1808');
      pcGrad.addColorStop(0.50,'#280e04');
      pcGrad.addColorStop(1,   '#110602');
      drawTerrain(pcTerrain, groundY, w, h, pcGrad);

      // Red-lit rim
      const rimHL = ctx.createLinearGradient(0, groundY - 10, 0, groundY + 20);
      rimHL.addColorStop(0, 'rgba(200,55,12,0.42)');
      rimHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rimHL; ctx.fillRect(0, groundY - 10, w, 30);
    },

    // ---- PROXIMA B: Tidally locked, volcanic, eternal glow ----
    proximaB: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#060102');
      sky.addColorStop(0.25,'#160303');
      sky.addColorStop(0.50,'#280504');
      sky.addColorStop(0.68,'#400604');
      sky.addColorStop(0.82,'#3c0503');
      sky.addColorStop(1,   '#280302');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      // Eternal horizon glow (red dwarf locked at horizon)
      const hGlow = ctx.createRadialGradient(w*0.50, h*0.62, 0, w*0.50, h*0.62, w*0.85);
      hGlow.addColorStop(0, 'rgba(255,95,18,0.38)');
      hGlow.addColorStop(0.30,'rgba(200,55,8,0.20)');
      hGlow.addColorStop(0.60,'rgba(150,25,4,0.10)');
      hGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hGlow; ctx.fillRect(0, 0, w, h);

      // Ancient ruins silhouette (subtle geometric shapes)
      const rngP = mulberry32(888);
      ctx.fillStyle = 'rgba(15,5,2,0.7)';
      for (let i = 0; i < 5; i++) {
        const rx = rngP() * w;
        const ry = h * 0.50 + rngP() * h * 0.10;
        const rh2 = 20 + rngP() * 50, rw2 = 8 + rngP() * 25;
        // Obelisk-like shape
        ctx.beginPath();
        ctx.moveTo(rx - rw2 * 0.4, ry);
        ctx.lineTo(rx, ry - rh2);
        ctx.lineTo(rx + rw2 * 0.4, ry);
        ctx.closePath(); ctx.fill();
      }

      // Volcanic terrain
      const groundY = h * 0.63;
      const volTerrain = genTerrain(w, 19.1, 34, 7);
      const volGrad = ctx.createLinearGradient(0, groundY - 22, 0, h);
      volGrad.addColorStop(0,   '#3c1008');
      volGrad.addColorStop(0.15,'#2c0c05');
      volGrad.addColorStop(0.42,'#1c0803');
      volGrad.addColorStop(1,   '#0c0401');
      drawTerrain(volTerrain, groundY, w, h, volGrad);

      // Lava cracks glow
      const rngL = mulberry32(888);
      for (let i = 0; i < 5; i++) {
        const lx = rngL() * w;
        const ly = groundY + 14 + rngL() * (h - groundY - 28);
        const lg2 = ctx.createRadialGradient(lx, ly, 0, lx, ly, 10 + rngL() * 20);
        lg2.addColorStop(0, 'rgba(255,115,0,0.65)');
        lg2.addColorStop(0.5,'rgba(200,55,0,0.30)');
        lg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lg2;
        ctx.beginPath(); ctx.arc(lx, ly, 30 + rngL() * 20, 0, Math.PI*2); ctx.fill();
      }
    },

    // ---- ALPHA CENTAURI: Binary suns, sandy alien surface ----
    alphaCentauri: (w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0,   '#010308');
      sky.addColorStop(0.22,'#040814');
      sky.addColorStop(0.45,'#080e28');
      sky.addColorStop(0.65,'#0a1230');
      sky.addColorStop(0.82,'#080e22');
      sky.addColorStop(1,   '#04070e');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      drawStars(0.00020, 0.80, 1220);

      // Alpha Centauri A (yellow-white)
      drawSun(w * 0.43, h * 0.20, 22, 255, 222, 145, 4.5);
      // Alpha Centauri B (orange)
      drawSun(w * 0.60, h * 0.24, 15, 255, 158, 72, 4.0);

      // Combined light glow
      const binGlow = ctx.createRadialGradient(w*0.50, h*0.22, 0, w*0.50, h*0.22, w*0.55);
      binGlow.addColorStop(0, 'rgba(255,200,95,0.14)');
      binGlow.addColorStop(0.5,'rgba(200,150,55,0.06)');
      binGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = binGlow; ctx.fillRect(0, 0, w, h);

      // Alien sandy surface
      const groundY = h * 0.67;
      const acTerrain = genTerrain(w, 21.5, 22, 5);
      const acGrad = ctx.createLinearGradient(0, groundY - 12, 0, h);
      acGrad.addColorStop(0,   '#cca848');
      acGrad.addColorStop(0.14,'#a88838');
      acGrad.addColorStop(0.42,'#786028');
      acGrad.addColorStop(0.75,'#3e3012');
      acGrad.addColorStop(1,   '#201808');
      drawTerrain(acTerrain, groundY, w, h, acGrad);

      // Warm sun rim light
      const rimHL = ctx.createLinearGradient(0, groundY - 8, 0, groundY + 22);
      rimHL.addColorStop(0, 'rgba(255,200,80,0.38)');
      rimHL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rimHL; ctx.fillRect(0, groundY - 8, w, 30);
    },

    // ---- VOID NEXUS: Alien void, crystal spires, rifts in spacetime ----
    voidNexus: (w, h) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // Void backdrop
      const voidGrad = ctx.createLinearGradient(0, 0, 0, h);
      voidGrad.addColorStop(0,   '#000000');
      voidGrad.addColorStop(0.35,'#040008');
      voidGrad.addColorStop(0.65,'#080012');
      voidGrad.addColorStop(1,   '#060008');
      ctx.fillStyle = voidGrad; ctx.fillRect(0, 0, w, h);

      // Nebula wisps
      const rngN = mulberry32(66);
      for (let n = 0; n < 4; n++) {
        const nx = rngN() * w, ny = rngN() * h * 0.65;
        const nr = 65 + rngN() * 110;
        const nGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
        nGrad.addColorStop(0, `rgba(${50+rngN()*60|0},0,${90+rngN()*100|0},0.18)`);
        nGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = nGrad; ctx.beginPath(); ctx.arc(nx, ny, nr, 0, Math.PI*2); ctx.fill();
      }

      // Spacetime rifts (glowing cracks)
      const rngR = mulberry32(66);
      for (let i = 0; i < 5; i++) {
        const rx = rngR() * w, ry = rngR() * h * 0.72;
        const rl = 85 + rngR() * 160, ang = rngR() * Math.PI;
        const r2 = 60 + rngR() * 80, g2 = 0, b2 = 120 + rngR() * 100;
        const rfGrad = ctx.createLinearGradient(
          rx - Math.cos(ang)*rl, ry - Math.sin(ang)*rl,
          rx + Math.cos(ang)*rl, ry + Math.sin(ang)*rl
        );
        rfGrad.addColorStop(0, 'rgba(0,0,0,0)');
        rfGrad.addColorStop(0.5,`rgba(${r2},${g2},${b2},0.45)`);
        rfGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = rfGrad; ctx.lineWidth = 1.2 + rngR() * 2.0;
        ctx.beginPath();
        ctx.moveTo(rx - Math.cos(ang)*rl, ry - Math.sin(ang)*rl);
        ctx.lineTo(rx + Math.cos(ang)*rl, ry + Math.sin(ang)*rl);
        ctx.stroke();
      }

      // Crystalline ground
      const groundY = h * 0.64;
      const voidTerrain = genTerrain(w, 23.3, 26, 6);
      const voidGnd = ctx.createLinearGradient(0, groundY - 18, 0, h);
      voidGnd.addColorStop(0,   '#220034');
      voidGnd.addColorStop(0.14,'#1a0028');
      voidGnd.addColorStop(0.42,'#100018');
      voidGnd.addColorStop(1,   '#060008');
      drawTerrain(voidTerrain, groundY, w, h, voidGnd);

      // Crystal spires
      const rngC = mulberry32(66);
      for (let c = 0; c < 9; c++) {
        const cx = rngC() * w;
        const cBase = groundY + 4 + rngC() * 18;
        const cH = 22 + rngC() * 68, cW = 5 + rngC() * 12;
        const cGrad = ctx.createLinearGradient(cx, cBase - cH, cx, cBase);
        cGrad.addColorStop(0, `rgba(190,0,255,0.72)`);
        cGrad.addColorStop(0.5,`rgba(110,0,190,0.50)`);
        cGrad.addColorStop(1, `rgba(55,0,90,0.28)`);
        ctx.beginPath();
        ctx.moveTo(cx - cW * 0.5, cBase);
        ctx.lineTo(cx, cBase - cH);
        ctx.lineTo(cx + cW * 0.5, cBase);
        ctx.closePath();
        ctx.fillStyle = cGrad; ctx.fill();

        // Crystal glow
        const cgGlow = ctx.createRadialGradient(cx, cBase - cH * 0.5, 0, cx, cBase - cH * 0.5, cW * 3);
        cgGlow.addColorStop(0, 'rgba(180,0,255,0.12)');
        cgGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cgGlow;
        ctx.beginPath(); ctx.arc(cx, cBase - cH * 0.5, cW * 3, 0, Math.PI*2); ctx.fill();
      }
    },

  }; // end SCENES

  // ---- Animate twinkling stars for certain scenes ----
  const TWINKLE_SCENES = new Set(['earth', 'moon', 'asteroidBelt', 'kuiperBelt',
                                   'proxima', 'proximaB', 'alphaCentauri', 'neptune',
                                   'uranus', 'saturn', 'europa']);

  function animate(now) {
    if (!currentLocation) return;
    const dt = (now - lastAnimTime) / 1000;
    lastAnimTime = now;
    t += dt;

    // Only re-render at ~20 fps and only for scenes with twinkle
    if (TWINKLE_SCENES.has(currentLocation)) {
      render(currentLocation);
    }
    animFrame = requestAnimationFrame(animate);
  }

  // ---- Public API ----
  function init() {
    canvas = document.getElementById('scene-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const pr = window.devicePixelRatio || 1;
    const w = parent.clientWidth, h = parent.clientHeight;
    canvas.width  = Math.round(w * pr);
    canvas.height = Math.round(h * pr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(pr, pr);
    }
    if (currentLocation) render(currentLocation);
  }

  function render(locId) {
    currentLocation = locId;
    if (!ctx) return;
    const pr = window.devicePixelRatio || 1;
    const w = canvas.width / pr, h = canvas.height / pr;
    ctx.clearRect(0, 0, w, h);
    const fn = SCENES[locId];
    if (fn) {
      fn(w, h);
    } else {
      // Fallback: plain space view
      ctx.fillStyle = '#000008';
      ctx.fillRect(0, 0, w, h);
      drawStars(0.00025, 0.90, 42);
    }
  }

  function startAnimation(locId) {
    stopAnimation();
    currentLocation = locId;
    if (TWINKLE_SCENES.has(locId)) {
      lastAnimTime = performance.now();
      animFrame = requestAnimationFrame(animate);
    } else {
      render(locId);
    }
  }

  function stopAnimation() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }

  return { init, render, startAnimation, stopAnimation, resize };

})();
