// Dig Straight Through: the full-screen journey film.
// Scenes: globe zoom-in -> satellite zoom to the street -> ground breaks -> tunnel through the Earth ->
// rise through the ocean (or break out of the ground) -> arrival -> satellite zoom-out -> globe -> end card (stays until closed).
(() => {
  const film = document.getElementById("film"), fc = document.getElementById("filmCanvas"), fx = fc.getContext("2d");
  const endBox = document.getElementById("filmEnd"), skipBtn = document.getElementById("filmSkip"), closeBtn = document.getElementById("filmClose");
  const R = 6371;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CYAN = "#7fd6ff", MAGMA = "#ff7b3a";
  const mono = "'JetBrains Mono', monospace", body = "'Instrument Sans', sans-serif", display = "'Bricolage Grotesque', sans-serif";

  let W = 0, H = 0, run = null, land = null, borders = null, opts = null;

  // ---------- small helpers ----------
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = d3.easeCubicInOut, easeOut = d3.easeCubicOut, easeIn = d3.easeCubicIn;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c, f = 1) => `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`;
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const trim = (s, n = 34) => s && s.length > n ? s.slice(0, n - 1) + "…" : (s || "");
  const n0 = x => Math.round(x).toLocaleString("en");
  function text(str, x, y, size, color, weight = 800, family = display, align = "center") {
    fx.font = `${weight} ${size}px ${family}`;
    const w = fx.measureText(str).width, room = W - 32;
    if (align === "center" && w > room) { size = Math.max(11, size * room / w); fx.font = `${weight} ${size}px ${family}`; }
    fx.textAlign = align; fx.textBaseline = "alphabetic";
    fx.shadowColor = "rgba(0,0,0,.7)"; fx.shadowBlur = 14;
    fx.fillStyle = color; fx.fillText(str, x, y);
    fx.shadowBlur = 0;
  }
  function stepped(list, x) { // piecewise-linear colour stops: [[x, [r,g,b]], ...]
    if (x <= list[0][0]) return list[0][1];
    for (let i = 1; i < list.length; i++) if (x <= list[i][0]) return mix(list[i - 1][1], list[i][1], (x - list[i - 1][0]) / (list[i][0] - list[i - 1][0]));
    return list[list.length - 1][1];
  }
  const stars = Array.from({ length: 260 }, () => [Math.random(), Math.random(), Math.random() * 1.3 + .2]);

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    fc.width = W * dpr; fc.height = H * dpr;
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- satellite tiles (Esri World Imagery via ArcGIS Location Platform, Web Mercator) ----------
  // Uses the access key from js/config.js. Without a key, or if the photos stop loading (for example when the
  // monthly free amount is used up), the film zooms over the drawn globe instead.
  const KEY = (window.DIG_CONFIG || {}).ESRI_API_KEY || "";
  const HAS_KEY = KEY.length > 20 && !/PASTE/.test(KEY);
  let tileFails = 0;
  const satOK = () => HAS_KEY && tileFails < 8;
  const ESRI_CREDIT = ["Powered by Esri", "Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS,", "USDA, USGS, AeroGRID, IGN, and the GIS User Community"];
  const TILE = 256, LEVELS = [3, 5, 7, 9, 11, 13, 15];
  const cache = new Map();
  function merc(p, z) {
    const n = 2 ** z * TILE, lat = Math.max(-85, Math.min(85, p[1])) * Math.PI / 180;
    return [(p[0] + 180) / 360 * n, (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n];
  }
  function tile(z, x, y) {
    const n = 2 ** z; if (y < 0 || y >= n) return null;
    x = ((x % n) + n) % n;
    const key = `${z}/${x}/${y}`;
    let img = cache.get(key);
    if (!img) {
      img = new Image();
      img.onerror = () => { tileFails++; };
      img.src = `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(KEY)}`;
      cache.set(key, img);
    }
    return img;
  }
  const levelsFor = zMax => LEVELS.filter(l => l < zMax).concat(zMax);
  function preload(p, zMax) {
    if (!satOK()) return;
    for (const L of levelsFor(zMax)) {
      const [px, py] = merc(p, L);
      for (let x = Math.floor((px - W / 2) / TILE); x <= Math.floor((px + W / 2) / TILE); x++)
        for (let y = Math.floor((py - H / 2) / TILE); y <= Math.floor((py + H / 2) / TILE); y++) tile(L, x, y);
    }
  }
  function drawTiles(p, Z, zMax) {
    // Fallback: keep zooming smoothly over the drawn globe.
    if (!satOK()) { drawGlobe([-p[0], -p[1], 0], matchZoom(p) * 2 ** (Z - 4), [], 0); return; }
    const ls = levelsFor(zMax);
    let i = ls.length - 1; while (i > 0 && ls[i] > Z) i--;
    fx.fillStyle = "#0d1a2b"; fx.fillRect(0, 0, W, H);
    for (const L of new Set([ls[Math.max(0, i - 1)], ls[i]])) {
      const s = 2 ** (Z - L), [px, py] = merc(p, L);
      for (let x = Math.floor((px - W / 2 / s) / TILE); x <= Math.floor((px + W / 2 / s) / TILE); x++)
        for (let y = Math.floor((py - H / 2 / s) / TILE); y <= Math.floor((py + H / 2 / s) / TILE); y++) {
          const img = tile(L, x, y);
          if (img && img.complete && img.naturalWidth) fx.drawImage(img, W / 2 + (x * TILE - px) * s, H / 2 + (y * TILE - py) * s, TILE * s + 1, TILE * s + 1);
        }
    }
    // Required Esri credit, bottom-left, on a soft dark band so it stays readable over bright photos.
    fx.font = `500 10px ${body}`; fx.textAlign = "left";
    const lines = W < 640 ? ESRI_CREDIT : [ESRI_CREDIT[0] + " · " + ESRI_CREDIT[1] + " " + ESRI_CREDIT[2]];
    fx.fillStyle = "rgba(0,0,0,.45)"; fx.fillRect(0, H - 10 - lines.length * 13, W, lines.length * 13 + 10);
    fx.fillStyle = "rgba(255,255,255,.85)";
    lines.forEach((t, i) => fx.fillText(t, 10, H - 8 - (lines.length - 1 - i) * 13));
  }
  const zoomName = Z => Z < 6 ? "Country view" : Z < 10 ? "Region view" : Z < 13 ? "City view" : Z < 15 ? "Neighbourhood view" : "Street view";

  // ---------- globe ----------
  const fp = d3.geoOrthographic().clipAngle(90).precision(.6), fpath = d3.geoPath(fp, fx), grat = d3.geoGraticule10();
  const baseScale = () => Math.min(W, H) * .42;
  // Globe zoom that roughly matches satellite zoom level 4 at this latitude, so the hand-over looks continuous.
  const matchZoom = p => Math.max(1.6, Math.min(6, (TILE * 16 / (2 * Math.PI)) / (baseScale() * Math.max(.3, Math.cos(p[1] * Math.PI / 180)))));
  function drawSpace() {
    fx.fillStyle = "#03060d"; fx.fillRect(0, 0, W, H);
    fx.fillStyle = "rgba(255,255,255,.75)";
    for (const [x, y, r] of stars) { fx.beginPath(); fx.arc(x * W, y * H, r, 0, 7); fx.fill(); }
  }
  function marker(x, y, color, label, ms) {
    const pulse = (ms / 1200) % 1;
    fx.beginPath(); fx.arc(x, y, 10 + pulse * 26, 0, 7); fx.strokeStyle = color; fx.globalAlpha = 1 - pulse; fx.lineWidth = 3; fx.stroke(); fx.globalAlpha = 1;
    fx.beginPath(); fx.arc(x, y, 9, 0, 7); fx.fillStyle = color; fx.fill(); fx.lineWidth = 3; fx.strokeStyle = "#0a0f1c"; fx.stroke();
    if (label) text(trim(label), x, y - 34, 18, color, 600, body);
  }
  function drawGlobe(rot, zoom, marks, ms) {
    drawSpace();
    const base = baseScale(), r = base * zoom;
    fp.rotate(rot).translate([W / 2, H / 2]).scale(r);
    const halo = fx.createRadialGradient(W / 2, H / 2, r * .95, W / 2, H / 2, r * 1.12);
    halo.addColorStop(0, "rgba(127,214,255,.35)"); halo.addColorStop(1, "rgba(127,214,255,0)");
    fx.fillStyle = halo; fx.beginPath(); fx.arc(W / 2, H / 2, r * 1.12, 0, 7); fx.fill();
    const g = fx.createRadialGradient(W / 2 - r * .3, H / 2 - r * .3, r * .1, W / 2, H / 2, r);
    g.addColorStop(0, "#2a5c97"); g.addColorStop(1, "#14345e");
    fx.beginPath(); fpath({ type: "Sphere" }); fx.fillStyle = g; fx.fill();
    fx.beginPath(); fpath(grat); fx.strokeStyle = "rgba(255,255,255,.07)"; fx.lineWidth = 1; fx.stroke();
    if (land) {
      fx.beginPath(); fpath(land); fx.fillStyle = "#d2bc8f"; fx.fill();
      fx.beginPath(); fpath(borders); fx.strokeStyle = "rgba(60,40,20,.35)"; fx.lineWidth = .7; fx.stroke();
    }
    // Night side shading from the real sun position.
    if (opts && opts.subsolar) {
      fx.save(); fx.beginPath(); fpath({ type: "Sphere" }); fx.clip();
      fx.beginPath(); fpath(d3.geoCircle().center([opts.subsolar[0] + 180, -opts.subsolar[1]]).radius(90)());
      fx.fillStyle = "rgba(2,6,20,.45)"; fx.fill(); fx.restore();
    }
    for (const m of marks || []) {
      if (d3.geoDistance(m.p, [-rot[0], -rot[1]]) < Math.PI / 2 - .01) { const [x, y] = fp(m.p); marker(x, y, m.color, m.label, ms); }
    }
  }

  // ---------- Earth layers ----------
  const STOPS = [[0, [150, 112, 74]], [35, [92, 60, 40]], [36, [112, 30, 18]], [2890, [214, 84, 30]], [2891, [238, 124, 36]], [5150, [255, 188, 78]], [5151, [255, 226, 152]], [6371, [255, 250, 230]]];
  function colorAt(d) {
    const dd = Math.max(0, Math.min(d, 2 * R - d));
    const c = stepped(STOPS, dd);
    if (dd < 35) { const b = 1 + Math.sin(dd * 1.7) * .12; return [c[0] * b, c[1] * b, c[2] * b]; }
    return c;
  }
  function layerAt(d) {
    if (Math.abs(d - R) < 140) return "centre";
    const dd = Math.min(d, 2 * R - d);
    return dd < 35 ? "crust" : dd < 2890 ? "mantle" : dd < 5150 ? "outer" : "inner";
  }
  const LAYER = {
    crust: ["Crust", "Solid rock. Only 5 to 70 km thick.", "The last few kilometres of rock."],
    mantle: ["Mantle", "Hot rock that flows very, very slowly.", "Climbing back up through the mantle."],
    outer: ["Outer core", "An ocean of liquid iron and nickel.", "Back through the liquid iron."],
    inner: ["Inner core", "A solid iron ball, about 5,200 °C.", "Leaving the inner core."],
    centre: ["Centre of the Earth", "Halfway. Top speed. From here you slow down.", "Halfway. Top speed. From here you slow down."]
  };
  const EMBER = { mantle: [255, 120, 50], outer: [255, 190, 80], inner: [255, 245, 215], centre: [255, 250, 235] };
  // Straight-tunnel physics (uniform-density model): depth = R(1 - cos θ), time = 42 min · θ/π, speed = 7.9 km/s · sin θ.
  function physics(d) {
    const th = Math.acos(Math.max(-1, Math.min(1, 1 - d / R)));
    return { min: 42 * th / Math.PI, speed: 7.9 * Math.sin(th) };
  }
  const T_C1 = 2600, T_DEEP = 9400, T_C2 = 2600, T_DESC = T_C1 + T_DEEP + T_C2;
  function depthAt(ms) {
    if (ms <= 0) return 0;
    if (ms < T_C1) return 35 * ms / T_C1;
    if (ms < T_C1 + T_DEEP) { const x = (ms - T_C1) / T_DEEP; return 35 + (2 * R - 70) * (1 - Math.cos(Math.PI * x)) / 2; }
    return Math.min(2 * R, 2 * R - 35 + 35 * (ms - T_C1 - T_DEEP) / T_C2);
  }

  // ================= SCENES =================
  // 1. Globe: spin to the start and zoom in.
  function sGlobeIn(k, ms) {
    const o = opts.origin, zm = matchZoom(o);
    const rot = d3.interpolate([-o[0] + 70, -o[1] + 18, 0], [-o[0], -o[1], 0])(ease(clamp01(k / .6)));
    drawGlobe(rot, zm ** ease(clamp01((k - .35) / .65)), [{ p: o, color: CYAN }], ms);
    fx.globalAlpha = clamp01(k * 3);
    text("Digging from", W / 2, H * .12, 15, "#93a0bd", 500, mono);
    text(trim(opts.fromLabel, 40), W / 2, H * .12 + 42, Math.min(46, W / 13), "#e9edf6");
    fx.globalAlpha = 1;
  }
  // 2. Satellite: zoom down to the street.
  function sSatIn(k, ms) {
    const o = opts.origin, zMax = opts.zOrigin, Z = 4 + (zMax - 4) * ease(k);
    drawTiles(o, Z, zMax);
    if (k < .2) { fx.globalAlpha = 1 - k / .2; drawGlobe([-o[0], -o[1], 0], matchZoom(o), [], ms); fx.globalAlpha = 1; }
    marker(W / 2, H / 2, CYAN, null, ms);
    text(trim(opts.fromLabel, 40), W / 2, H * .12 + 10, Math.min(40, W / 14), "#ffffff");
    text(zoomName(Z), W / 2, H * .12 + 40, 14, "#e9edf6", 500, mono);
  }
  // 3. The blue dot grows, turns into a hole, and the hole opens up to swallow the screen. Calm: no cracks, no shaking.
  const soil = Array.from({ length: 40 }, () => ({ a: Math.random() * 6.28, v: Math.random() * .5 + .5, r: Math.random() * 2.5 + 1.5, d: Math.random() }));
  function sHole(k, ms) {
    drawTiles(opts.origin, opts.zOrigin, opts.zOrigin);
    const cx = W / 2, cy = H / 2, full = Math.hypot(W, H) / 2 + 20;
    // Phase 1 (k 0 to .4): the dot swells. Phase 2 (.3 to .6): it darkens into a hole. Phase 3 (.55 to 1): the hole opens wide.
    const grow = easeOut(clamp01(k / .4)), dark = clamp01((k - .3) / .3), open = easeIn(clamp01((k - .55) / .45));
    const r = 9 + grow * 46 + open * full;
    // Soft glow around the dot while it grows.
    if (dark < 1) {
      const halo = fx.createRadialGradient(cx, cy, r, cx, cy, r * 2.2);
      halo.addColorStop(0, `rgba(127,214,255,${.45 * (1 - dark)})`); halo.addColorStop(1, "rgba(127,214,255,0)");
      fx.fillStyle = halo; fx.beginPath(); fx.arc(cx, cy, r * 2.2, 0, 7); fx.fill();
    }
    // The dot itself, turning from blue into a deep earth hole.
    const g = fx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgb(mix([127, 214, 255], [0, 0, 0], dark)));
    g.addColorStop(.7, rgb(mix([127, 214, 255], [29, 19, 11], dark)));
    g.addColorStop(1, rgb(mix([127, 214, 255], [92, 61, 36], dark)));
    fx.beginPath(); fx.arc(cx, cy, r, 0, 7); fx.fillStyle = g; fx.fill();
    fx.lineWidth = 4 + 6 * dark; fx.strokeStyle = rgb(mix([10, 15, 28], [122, 82, 51], dark)); fx.stroke();
    // A little soil tossed out of the hole while digging.
    if (dark > 0 && open < .6) {
      fx.fillStyle = `rgba(150,112,74,${.85 * (1 - open / .6)})`;
      for (const s of soil) {
        const t = (dark * 1.6 + s.d) % 1, dist = r + t * 90 * s.v;
        fx.beginPath(); fx.arc(cx + Math.cos(s.a) * dist, cy + Math.sin(s.a) * dist - Math.sin(Math.PI * t) * 30 * s.v, s.r, 0, 7); fx.fill();
      }
    }
    text(dark < .5 ? trim(opts.fromLabel, 40) : "Digging…", W / 2, H * .86, 22, "#ffffff", 600, body);
  }
  // 4. The tunnel.
  const embers = Array.from({ length: 90 }, () => ({ ang: Math.random() * 6.28, a: Math.random(), rr: .55 + Math.random() * .4, s: Math.random() }));
  const flecks = Array.from({ length: 120 }, () => ({ ang: Math.random() * 6.28, a: Math.random() }));
  function sTunnel(k, ms, dt) {
    const d = depthAt(ms), ph = physics(d), sp = ph.speed / 7.9, layer = layerAt(d);
    const maxR = Math.hypot(W, H) / 2 * 1.2, cx = W / 2, cy = H / 2;
    const rad = a => maxR * .05 / (a + .05);
    const N = 46, step = 60, base = Math.floor(ms / step);
    const swirl = ms / 1000 * (layer === "outer" ? .8 : .15);
    fx.fillStyle = "#000"; fx.fillRect(0, 0, W, H);
    for (let j = N; j >= 1; j--) {
      const idx = base + j, tau = idx * step, a = (tau - ms) / (N * step);
      if (a <= 0) continue;
      const col = colorAt(depthAt(Math.min(tau, T_DESC))), r = rad(a);
      const f = (.84 + .3 * hash(idx)) * (.42 + .58 * (1 - a)) * ((idx & 1) ? 1 : .88);
      const p0 = hash(idx * 3) * 6.28 + swirl, amp = .03 + .035 * hash(idx * 7);
      fx.beginPath();
      for (let s = 0; s <= 32; s++) {
        const ang = s / 32 * 6.2832, rr = r * (1 + amp * Math.sin(ang * 3 + p0) + amp * .6 * Math.sin(ang * 7 + p0 * 2));
        s ? fx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr) : fx.moveTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      fx.closePath(); fx.fillStyle = rgb(col, f); fx.fill();
    }
    const far = colorAt(depthAt(Math.min(ms + N * step, T_DESC)));
    const glow = fx.createRadialGradient(cx, cy, 0, cx, cy, maxR * .16);
    glow.addColorStop(0, rgb(far, 1.5)); glow.addColorStop(1, "rgba(0,0,0,0)");
    fx.fillStyle = glow; fx.beginPath(); fx.arc(cx, cy, maxR * .16, 0, 7); fx.fill();

    // Glowing embers in the hot layers.
    const rate = .25 + 1.8 * sp;
    if (layer !== "crust") {
      const ec = EMBER[layer];
      fx.globalCompositeOperation = "lighter";
      for (const e of embers) {
        e.a -= rate * dt / 1000 * (.8 + e.s * .6);
        if (e.a < .01) { e.a = 1; e.ang = Math.random() * 6.28; }
        const r = rad(e.a) * e.rr, x = cx + Math.cos(e.ang + swirl) * r, y = cy + Math.sin(e.ang + swirl) * r, s = 1 + (1 - e.a) * 5;
        const g = fx.createRadialGradient(x, y, 0, x, y, s * 2.5);
        g.addColorStop(0, rgba(ec, .9)); g.addColorStop(1, rgba(ec, 0));
        fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, s * 2.5, 0, 7); fx.fill();
      }
      fx.globalCompositeOperation = "source-over";
    }
    // Rock streaks rushing past.
    fx.strokeStyle = layer === "crust" ? "rgba(235,220,200,.45)" : "rgba(255,235,210,.35)"; fx.lineWidth = 2;
    const count = Math.floor(30 + 90 * sp);
    for (let i = 0; i < count; i++) {
      const f = flecks[i];
      f.a -= rate * dt / 1000;
      if (f.a < .01) { f.a = 1; f.ang = Math.random() * 6.28; }
      const r1 = rad(f.a), r2 = rad(Math.min(1, f.a + .02 * rate));
      fx.beginPath(); fx.moveTo(cx + Math.cos(f.ang) * r1, cy + Math.sin(f.ang) * r1); fx.lineTo(cx + Math.cos(f.ang) * r2, cy + Math.sin(f.ang) * r2); fx.stroke();
    }
    // White-hot glare near the centre of the Earth.
    const heat = clamp01(1 - Math.abs(d - R) / 1500);
    if (heat > 0) { fx.fillStyle = `rgba(255,248,230,${heat * heat * .45})`; fx.fillRect(0, 0, W, H); }
    const vig = fx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, maxR);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.65)");
    fx.fillStyle = vig; fx.fillRect(0, 0, W, H);

    // Layer title.
    if (layer !== run.layer) { run.layer = layer; run.titleT = ms; }
    const age = ms - run.titleT, alpha = clamp01(age / 300) * clamp01(1 - (age - 2000) / 500);
    if (alpha > 0) {
      fx.globalAlpha = alpha;
      const L1 = LAYER[layer], ty = Math.max(H * .2, 120);
      text(L1[0], W / 2, ty, Math.min(64, W / 9), "#ffffff");
      text(d < R ? L1[1] : L1[2], W / 2, ty + 36, Math.min(20, W / 22), "#e9edf6", 500, body);
      fx.globalAlpha = 1;
    }
    // Depth gauge on wide screens.
    if (W >= 760) {
      const gx = 30, gy = H * .2, gh = H * .5;
      const segs = [[0, 35], [35, 2890], [2890, 5150], [5150, 7592], [7592, 9852], [9852, 12707], [12707, 12742]];
      for (const [a, b] of segs) { fx.fillStyle = rgb(colorAt((a + b) / 2)); fx.fillRect(gx, gy + gh * a / (2 * R), 10, Math.max(2, gh * (b - a) / (2 * R))); }
      const my = gy + gh * d / (2 * R);
      fx.fillStyle = "#fff"; fx.beginPath(); fx.moveTo(gx + 14, my); fx.lineTo(gx + 24, my - 6); fx.lineTo(gx + 24, my + 6); fx.fill();
      text(trim(opts.fromLabel, 18), gx, gy - 12, 12, CYAN, 500, mono, "left");
      text(trim(opts.toLabel, 18), gx, gy + gh + 22, 12, MAGMA, 500, mono, "left");
    }
    // Progress bar and live readout.
    const narrow = W < 560, pw = Math.min(560, W - 48), px = (W - pw) / 2, py = H - (narrow ? 140 : 92);
    fx.fillStyle = "rgba(255,255,255,.15)"; fx.fillRect(px, py, pw, 4);
    fx.fillStyle = MAGMA; fx.fillRect(px, py, pw * d / (2 * R), 4);
    if (!(W >= 760)) {
      text(trim(opts.fromLabel, 22), px, py - 10, 13, CYAN, 500, mono, "left");
      text(trim(opts.toLabel, 22), px + pw, py - 10, 13, MAGMA, 500, mono, "right");
    }
    const stats = [["DEPTH", `${n0(Math.min(d, 2 * R - d))} km`], ["TRAVELLED", `${n0(d)} km`], ["SPEED", `${ph.speed.toFixed(1)} km/s`], ["TIME", `${Math.round(ph.min)} min`]];
    const cols = narrow ? 2 : 4, fs = narrow ? 16 : Math.min(22, W / 36);
    stats.forEach(([lab, val], i) => {
      const col = i % cols, row = Math.floor(i / cols), rows = narrow ? 2 : 1;
      const x = px + pw * (col + .5) / cols, y = H - 26 - (rows - 1 - row) * 46;
      text(lab, x, y - 22, 11, "#93a0bd", 500, mono);
      text(val, x, y, fs, "#ffffff", 500, mono);
    });
  }

  // ---------- sea creatures (simple original drawings) ----------
  function fish(x, y, s, dir, col) {
    fx.save(); fx.translate(x, y); fx.scale(dir, 1);
    fx.fillStyle = col;
    fx.beginPath(); fx.ellipse(0, 0, s, s * .42, 0, 0, 7); fx.fill();
    fx.beginPath(); fx.moveTo(-s * .75, 0); fx.lineTo(-s * 1.5, -s * .5); fx.lineTo(-s * 1.35, 0); fx.lineTo(-s * 1.5, s * .5); fx.closePath(); fx.fill();
    fx.fillStyle = "#0a1a2a"; fx.beginPath(); fx.arc(s * .55, -s * .08, Math.max(1, s * .1), 0, 7); fx.fill();
    fx.restore();
  }
  function whale(x, y, s, dir, t) {
    fx.save(); fx.translate(x, y); fx.scale(dir * s / 100, s / 100);
    const g = fx.createLinearGradient(0, -26, 0, 26);
    g.addColorStop(0, "#1d2d42"); g.addColorStop(.6, "#2c4562"); g.addColorStop(1, "#8ea3b5");
    fx.fillStyle = g; fx.beginPath();
    fx.moveTo(100, 0);
    fx.bezierCurveTo(98, -22, 60, -30, 10, -26);
    fx.bezierCurveTo(-40, -22, -75, -10, -92, -3);
    fx.lineTo(-92, 3);
    fx.bezierCurveTo(-70, 10, -30, 24, 20, 24);
    fx.bezierCurveTo(70, 24, 98, 16, 100, 0);
    fx.fill();
    fx.save(); fx.translate(-92, 0); fx.rotate(Math.sin(t / 600) * .35);
    fx.beginPath(); fx.moveTo(0, 0); fx.bezierCurveTo(-10, -6, -26, -24, -36, -22); fx.bezierCurveTo(-28, -10, -22, -2, -16, 0); fx.bezierCurveTo(-22, 2, -28, 10, -36, 22); fx.bezierCurveTo(-26, 24, -10, 6, 0, 0);
    fx.fillStyle = "#1d2d42"; fx.fill(); fx.restore();
    fx.beginPath(); fx.moveTo(35, 14); fx.quadraticCurveTo(20, 40 + Math.sin(t / 700) * 6, 2, 46); fx.quadraticCurveTo(14, 30, 22, 16); fx.fillStyle = "#24384f"; fx.fill();
    fx.strokeStyle = "rgba(255,255,255,.14)"; fx.lineWidth = 1;
    for (let i = 0; i < 5; i++) { fx.beginPath(); fx.moveTo(88 - i * 3, 8 + i * 2.6); fx.quadraticCurveTo(55, 17 + i * 1.8, 22, 19 + i); fx.stroke(); }
    fx.fillStyle = "#0b1422"; fx.beginPath(); fx.arc(62, 3, 2.4, 0, 7); fx.fill();
    fx.restore();
  }
  function dolphin(x, y, s, ang, t) {
    fx.save(); fx.translate(x, y); fx.rotate(ang); fx.scale(s / 100, s / 100);
    const g = fx.createLinearGradient(0, -20, 0, 14);
    g.addColorStop(0, "#4f6c86"); g.addColorStop(.55, "#7d97ad"); g.addColorStop(1, "#d6e0e8");
    fx.fillStyle = g; fx.beginPath();
    fx.moveTo(100, 3);
    fx.bezierCurveTo(92, -2, 80, -7, 66, -10);
    fx.bezierCurveTo(40, -20, -10, -20, -50, -10);
    fx.bezierCurveTo(-70, -5, -85, -2, -92, 0);
    fx.lineTo(-92, 3);
    fx.bezierCurveTo(-70, 7, -30, 14, 10, 14);
    fx.bezierCurveTo(50, 14, 80, 10, 100, 3);
    fx.fill();
    fx.fillStyle = "#4f6c86";
    fx.beginPath(); fx.moveTo(12, -17); fx.quadraticCurveTo(-4, -44, -24, -42); fx.quadraticCurveTo(-12, -30, -14, -16); fx.fill();
    fx.save(); fx.translate(-92, 1.5); fx.rotate(Math.sin(t / 140) * .3);
    fx.beginPath(); fx.moveTo(0, 0); fx.bezierCurveTo(-6, -4, -16, -16, -24, -15); fx.bezierCurveTo(-18, -7, -14, -2, -10, 0); fx.bezierCurveTo(-14, 2, -18, 7, -24, 15); fx.bezierCurveTo(-16, 16, -6, 4, 0, 0); fx.fill(); fx.restore();
    fx.beginPath(); fx.moveTo(42, 9); fx.quadraticCurveTo(30, 26, 16, 28); fx.quadraticCurveTo(26, 18, 30, 11); fx.fill();
    fx.fillStyle = "#0b1422"; fx.beginPath(); fx.arc(70, -3, 2.2, 0, 7); fx.fill();
    fx.restore();
  }
  function jelly(x, y, s, t, hue) {
    const p = 1 + .12 * Math.sin(t / 420 + x);
    fx.globalCompositeOperation = "lighter";
    const g = fx.createRadialGradient(x, y, 0, x, y, s * 1.6);
    g.addColorStop(0, `hsla(${hue},90%,70%,.55)`); g.addColorStop(1, `hsla(${hue},90%,60%,0)`);
    fx.fillStyle = g; fx.beginPath(); fx.arc(x, y, s * 1.6, 0, 7); fx.fill();
    fx.fillStyle = `hsla(${hue},90%,75%,.5)`; fx.beginPath(); fx.ellipse(x, y, s * p, s * .75 / p, 0, Math.PI, 0); fx.closePath(); fx.fill();
    fx.strokeStyle = `hsla(${hue},90%,80%,.35)`; fx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const tx = x + (i - 2.5) * s * .32;
      fx.beginPath(); fx.moveTo(tx, y);
      for (let j = 1; j <= 8; j++) fx.lineTo(tx + Math.sin(t / 300 + j * .8 + i) * s * .12, y + j * s * .3);
      fx.stroke();
    }
    fx.globalCompositeOperation = "source-over";
  }
  function turtle(x, y, s, dir, t) {
    fx.save(); fx.translate(x, y); fx.scale(dir, 1);
    const f = Math.sin(t / 350) * .5;
    fx.fillStyle = "#6b8f4a";
    [[s * .45, -s * .35, -.6 - f], [s * .45, s * .35, .6 + f], [-s * .5, -s * .3, -2.4 + f * .5], [-s * .5, s * .3, 2.4 - f * .5]].forEach(([fxp, fyp, a], i) => {
      fx.save(); fx.translate(fxp, fyp); fx.rotate(a); fx.beginPath(); fx.ellipse(s * .3, 0, s * (i < 2 ? .45 : .25), s * .12, 0, 0, 7); fx.fill(); fx.restore();
    });
    fx.beginPath(); fx.ellipse(s * .82, 0, s * .2, s * .15, 0, 0, 7); fx.fill();
    fx.fillStyle = "#4d6b33"; fx.beginPath(); fx.ellipse(0, 0, s * .7, s * .48, 0, 0, 7); fx.fill();
    fx.strokeStyle = "#8aa865"; fx.lineWidth = 1.5;
    fx.beginPath(); fx.ellipse(0, 0, s * .3, s * .22, 0, 0, 7); fx.stroke();
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; fx.beginPath(); fx.moveTo(Math.cos(a) * s * .3, Math.sin(a) * s * .22); fx.lineTo(Math.cos(a) * s * .62, Math.sin(a) * s * .42); fx.stroke(); }
    fx.restore();
  }
  function bird(x, y, s, t) {
    const fl = Math.sin(t / 130 + x) * .6;
    fx.beginPath(); fx.moveTo(x - s, y - s * fl * .4);
    fx.quadraticCurveTo(x - s * .45, y - s * (.5 + fl * .4), x, y);
    fx.quadraticCurveTo(x + s * .45, y - s * (.5 + fl * .4), x + s, y - s * fl * .4);
    fx.stroke();
  }
  const SKY = {
    day: [[20, 80, 160], [160, 205, 236]], dusk: [[39, 50, 94], [240, 164, 106]], night: [[4, 10, 28], [26, 43, 79]]
  };

  // 5a. Rising through the ocean: midnight zone -> twilight zone -> sunlit zone -> surface.
  const sea = {
    snow: Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random() * 1.3 - .15, r: Math.random() * 1.6 + .4 })),
    school: Array.from({ length: 48 }, () => ({ ox: Math.random() * 2 - 1, oy: Math.random() * 2 - 1, ph: Math.random() * 6.28, s: .7 + Math.random() * .6, gold: Math.random() < .25 })),
    glow: Array.from({ length: 40 }, () => ({ x: Math.random(), y: .7 + Math.random() * .3, ph: Math.random() * 6.28 })),
    trail: []
  };
  const OCEAN = [[-.2, [120, 200, 240]], [0, [70, 165, 222]], [.15, [26, 104, 170]], [.45, [8, 38, 82]], [.75, [3, 10, 26]], [1.2, [2, 6, 16]]];
  function sWater(k, ms, dt) {
    const camY = .97 - 1.02 * ease(k), view = .42;
    const sy = wy => H / 2 + (wy - camY) / view * H;
    const wy0 = camY - view / 2, wy1 = camY + view / 2;
    const bg = fx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, rgb(stepped(OCEAN, wy0))); bg.addColorStop(1, rgb(stepped(OCEAN, wy1)));
    fx.fillStyle = bg; fx.fillRect(0, 0, W, H);
    // Sun rays in the upper water.
    const ray = clamp01((.55 - camY) / .5);
    if (ray > 0) {
      for (let i = 0; i < 8; i++) {
        const x0 = W * (.04 + .13 * i) + Math.sin(ms / 1100 + i) * 30;
        fx.beginPath(); fx.moveTo(x0 - 24, Math.max(0, sy(0))); fx.lineTo(x0 + 24, Math.max(0, sy(0))); fx.lineTo(x0 + 160, H); fx.lineTo(x0 - 40, H); fx.closePath();
        fx.fillStyle = `rgba(210,240,255,${ray * .1})`; fx.fill();
      }
    }
    // Drifting particles ("marine snow").
    fx.fillStyle = "rgba(220,235,255,.45)";
    for (const p of sea.snow) { const y = sy(p.y); if (y > -5 && y < H + 5) { fx.beginPath(); fx.arc(p.x * W + Math.sin(ms / 1500 + p.y * 20) * 6, y, p.r, 0, 7); fx.fill(); } }
    // Bioluminescent sparks in the deep.
    fx.globalCompositeOperation = "lighter";
    for (const g of sea.glow) { const y = sy(g.y), a = .3 + .3 * Math.sin(ms / 400 + g.ph); if (y > -10 && y < H + 10) { fx.fillStyle = `rgba(110,255,230,${a})`; fx.beginPath(); fx.arc(g.x * W, y, 2.2, 0, 7); fx.fill(); } }
    fx.globalCompositeOperation = "source-over";
    // Seabed, with our tunnel glowing in it.
    const bed = sy(1);
    if (bed < H + 60) {
      fx.fillStyle = "#1f1a12"; fx.beginPath(); fx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) fx.lineTo(x, bed + Math.sin(x / 90) * 10 + Math.sin(x / 33) * 4);
      fx.lineTo(W, H); fx.closePath(); fx.fill();
      const hg = fx.createRadialGradient(W / 2, bed + 6, 0, W / 2, bed + 6, 90);
      hg.addColorStop(0, "rgba(255,150,60,.9)"); hg.addColorStop(1, "rgba(255,120,40,0)");
      fx.fillStyle = hg; fx.beginPath(); fx.arc(W / 2, bed + 6, 90, 0, 7); fx.fill();
      fx.fillStyle = "#2a2318";
      for (let i = 0; i < 9; i++) { fx.beginPath(); fx.ellipse(W * hash(i + 3), bed + 8 + hash(i) * 30, 20 + hash(i * 5) * 40, 10 + hash(i * 9) * 14, 0, 0, 7); fx.fill(); }
    }
    const t = ms, S = Math.min(W, H);
    // Jellyfish (midnight zone).
    [[.2, .85, 26, 300], [.74, .79, 20, 190], [.52, .9, 15, 330], [.86, .93, 12, 280]].forEach(([x, wy, s, hue]) => { const y = sy(wy) - Math.sin(t / 700 + x * 9) * 10; if (y > -80 && y < H + 80) jelly(x * W, y, s * S / 500, t, hue); });
    // A whale gliding by (twilight zone).
    { const y = sy(.56); if (y > -S && y < H + S) whale(W * (1.25 - k * 1.5), y + Math.sin(t / 900) * 8, S * .42, -1, t); }
    // A school of fish (sunlit zone).
    { const cxs = W * (.5 + .3 * Math.sin(t / 2200)), cys = sy(.3), dir = Math.cos(t / 2200) >= 0 ? 1 : -1;
      if (cys > -200 && cys < H + 200) for (const f of sea.school) fish(cxs + f.ox * W * .2 + Math.sin(t / 500 + f.ph) * 14, cys + f.oy * S * .1 + Math.cos(t / 650 + f.ph) * 8, 7 * f.s * S / 500, dir, f.gold ? "#ffd65a" : "#cfe3f0"); }
    // A turtle.
    { const y = sy(.19); if (y > -100 && y < H + 100) turtle(W * (-.2 + k * 1.3), y, S * .07, 1, t); }
    // Dolphins near the surface.
    [[.1, 0], [.13, .2], [.075, .38]].forEach(([wy, off]) => { const y = sy(wy) + Math.sin(t / 380 + off * 9) * 12; if (y > -100 && y < H + 100) dolphin(W * (((k * 1.7 + off) % 1.5) - .25), y, S * .13, Math.sin(t / 380 + off * 9) * .15, t); });
    // Our own bubble trail.
    if (Math.random() < .8) sea.trail.push({ x: W / 2 + (Math.random() - .5) * 30, y: H * .62, r: Math.random() * 6 + 2, v: Math.random() * .5 + .6 });
    fx.strokeStyle = "rgba(225,245,255,.75)"; fx.lineWidth = 1.5;
    for (const b of sea.trail) { b.y -= b.v * dt * .5; b.x += Math.sin(b.y / 30) * .6; fx.beginPath(); fx.arc(b.x, b.y, b.r, 0, 7); fx.stroke(); }
    sea.trail = sea.trail.filter(b => b.y > -20).slice(-160);
    // The surface and the sky above it.
    const ys = sy(0);
    if (ys > -40) {
      const sk = SKY[opts.sky] || SKY.day, gy = fx.createLinearGradient(0, ys - H * .5, 0, ys);
      gy.addColorStop(0, rgb(sk[0])); gy.addColorStop(1, rgb(sk[1]));
      fx.beginPath(); fx.moveTo(0, 0); fx.lineTo(W, 0);
      for (let x = W; x >= 0; x -= 12) fx.lineTo(x, ys + Math.sin(x / 45 + t / 220) * 7);
      fx.closePath(); fx.fillStyle = gy; fx.fill();
      fx.strokeStyle = "rgba(255,255,255,.6)"; fx.lineWidth = 2; fx.beginPath();
      for (let x = 0; x <= W; x += 12) x ? fx.lineTo(x, ys + Math.sin(x / 45 + t / 220) * 7) : fx.moveTo(x, ys + Math.sin(t / 220) * 7);
      fx.stroke();
    }
    // Zone label.
    const zone = camY > .66 ? ["Midnight zone", "Below 1,000 m. No sunlight reaches this deep."] : camY > .3 ? ["Twilight zone", "200 to 1,000 m. Only faint blue light."] : ["Sunlit zone", "The top 200 m, where most sea life lives."];
    if (zone[0] !== run.zone) { run.zone = zone[0]; run.zoneT = ms; }
    const za = clamp01((ms - run.zoneT) / 300) * clamp01(1 - (ms - run.zoneT - 2200) / 500);
    if (za > 0 && k < .9) { fx.globalAlpha = za; text(zone[0], W / 2, Math.max(H * .2, 110), Math.min(52, W / 10), "#ffffff"); text(zone[1], W / 2, Math.max(H * .2, 110) + 32, Math.min(19, W / 22), "#e9edf6", 500, body); fx.globalAlpha = 1; }
    text(trim(opts.toLabel, 36), W / 2, H - 30, 15, "#e9edf6", 500, mono);
    if (k > .94) { fx.fillStyle = `rgba(255,255,255,${(k - .94) / .06})`; fx.fillRect(0, 0, W, H); }
  }
  // 5b. Coming up on land: looking up the shaft, a circle of sky opens and grows until you are out. Calm: no cracks, no shaking.
  function sLand(k, ms) {
    const cx = W / 2, cy = H / 2, full = Math.hypot(W, H) / 2 + 20;
    // Soil walls of the shaft, rings rushing past more slowly as you arrive.
    fx.fillStyle = "#1d130b"; fx.fillRect(0, 0, W, H);
    for (let j = 12; j >= 1; j--) {
      const a = ((j - (ms / 140) % 1) / 12), r = full * .06 / (a + .06);
      fx.beginPath(); fx.arc(cx, cy, r, 0, 7);
      fx.fillStyle = rgb([92, 64, 40], (.55 + .45 * (1 - a)) * (j & 1 ? 1 : .88)); fx.fill();
    }
    // The opening: sky colour at the exit right now, growing from a small disc to the whole screen.
    const sk = SKY[opts.sky] || SKY.day, open = easeIn(clamp01(k / .9));
    const r = 14 + open * full;
    const night = opts.sky === "night";
    const g = fx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgb(night ? sk[1] : mix(sk[1], [255, 255, 255], .35))); g.addColorStop(1, rgb(sk[0]));
    fx.beginPath(); fx.arc(cx, cy, r, 0, 7); fx.fillStyle = g; fx.fill();
    if (night) {
      fx.save(); fx.beginPath(); fx.arc(cx, cy, r, 0, 7); fx.clip();
      fx.fillStyle = "rgba(255,255,255,.9)";
      for (const [x, y, s] of stars) { fx.beginPath(); fx.arc(x * W, y * H, s, 0, 7); fx.fill(); }
      fx.restore();
    }
    const halo = fx.createRadialGradient(cx, cy, r, cx, cy, r * 1.6);
    const hc = night ? "160,190,255" : "255,250,230";
    halo.addColorStop(0, `rgba(${hc},${night ? .25 : .45})`); halo.addColorStop(1, `rgba(${hc},0)`);
    fx.fillStyle = halo; fx.beginPath(); fx.arc(cx, cy, r * 1.6, 0, 7); fx.fill();
    text("Almost out…", W / 2, H * .84, Math.min(28, W / 18), "#ffffff", 600, body);
    if (k > .85) { fx.fillStyle = `rgba(255,255,255,${(k - .85) / .15 * .8})`; fx.fillRect(0, 0, W, H); }
  }
  // 6. Arrival: the real sky at the exit right now (day, twilight or night).
  function sArrive(k, ms) {
    const hz = H * .62, night = opts.sky === "night", dusk = opts.sky === "dusk";
    const sk = SKY[opts.sky] || SKY.day, gsky = fx.createLinearGradient(0, 0, 0, hz);
    gsky.addColorStop(0, rgb(sk[0])); gsky.addColorStop(1, rgb(sk[1]));
    fx.fillStyle = gsky; fx.fillRect(0, 0, W, hz);
    if (night) {
      fx.fillStyle = "rgba(255,255,255,.85)";
      for (const [x, y, r] of stars) if (y < .6) { fx.beginPath(); fx.arc(x * W, y * hz, r, 0, 7); fx.fill(); }
      const mg = fx.createRadialGradient(W * .8, H * .18, 0, W * .8, H * .18, 110);
      mg.addColorStop(0, "rgba(245,242,225,1)"); mg.addColorStop(.24, "rgba(245,242,225,1)"); mg.addColorStop(.28, "rgba(245,242,225,.22)"); mg.addColorStop(1, "rgba(245,242,225,0)");
      fx.fillStyle = mg; fx.fillRect(0, 0, W, hz);
    } else {
      const sy0 = H * (dusk ? .52 : .18), sg = fx.createRadialGradient(W * .8, sy0, 0, W * .8, sy0, 140);
      sg.addColorStop(0, "rgba(255,250,220,1)"); sg.addColorStop(.22, "rgba(255,240,190,.95)"); sg.addColorStop(1, "rgba(255,240,190,0)");
      fx.fillStyle = sg; fx.fillRect(0, 0, W, hz);
      fx.strokeStyle = "rgba(30,30,40,.7)"; fx.lineWidth = 2;
      for (let i = 0; i < 4; i++) bird(((ms / 16 + i * 140) % (W + 200)) - 100, H * (.14 + .05 * Math.sin(i * 2)) + Math.sin(ms / 700 + i) * 8, 9 + i * 1.5, ms);
    }
    if (!opts.exitIsLand) {
      const sea2 = fx.createLinearGradient(0, hz, 0, H);
      sea2.addColorStop(0, night ? "#14284a" : "#2f6fa8"); sea2.addColorStop(1, night ? "#020814" : "#0c2c55");
      fx.fillStyle = sea2; fx.fillRect(0, hz, W, H - hz);
      fx.strokeStyle = night ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.25)"; fx.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        const y = hz + Math.pow(i / 16, 1.6) * (H - hz) + 6, off = (ms / 30 + i * 53) % 80;
        fx.beginPath(); for (let x = -80 + off; x < W; x += 80) { fx.moveTo(x, y); fx.lineTo(x + 30 + i * 2, y); } fx.stroke();
      }
      // A dolphin jumps across.
      const u = clamp01((k - .3) / .5);
      if (u > 0 && u < 1) {
        const x = W * (.18 + .5 * u), y = hz + 26 - Math.sin(Math.PI * u) * H * .24;
        const ang = Math.atan2(-Math.cos(Math.PI * u) * Math.PI * H * .24, W * .5);
        dolphin(x, y, Math.min(W, H) * .16, ang, ms);
      }
      for (const [u0, x0] of [[.3, .18], [.8, .68]]) {
        const a = clamp01(1 - Math.abs(k - u0) / .12);
        if (a > 0) { fx.fillStyle = `rgba(255,255,255,${a * .8})`; for (let i = 0; i < 14; i++) { const ang = Math.PI + i / 13 * Math.PI; fx.beginPath(); fx.arc(W * x0 + Math.cos(ang) * 30 * (1.2 - a), hz + 26 + Math.sin(ang) * 40 * (1.2 - a), 3, 0, 7); fx.fill(); } }
      }
    } else {
      fx.fillStyle = night ? "#22321f" : "#6f8f4e"; fx.beginPath(); fx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) fx.lineTo(x, hz - 30 * Math.sin(x / 160) - 18 * Math.sin(x / 57 + 1));
      fx.lineTo(W, H); fx.closePath(); fx.fill();
      fx.fillStyle = night ? "#162214" : "#4d6a35"; fx.fillRect(0, hz + 30, W, H - hz - 30);
      fx.fillStyle = night ? "#0f180d" : "#3b5428";
      for (let i = 0; i < 7; i++) { const x = W * hash(i + 11), y = hz + 10 + hash(i) * 30, s = 18 + hash(i * 3) * 22; fx.beginPath(); fx.moveTo(x, y - s * 2); fx.lineTo(x + s * .6, y); fx.lineTo(x - s * .6, y); fx.fill(); }
    }
    const t = clamp01((k - .12) / .25), big = Math.min(60, W / 11);
    fx.globalAlpha = t;
    text("You came out in", W / 2, H * .26, 16, night || dusk ? "#e9edf6" : "#0a0f1c", 600, mono);
    text(trim(opts.toLabel, 36), W / 2, H * .26 + big, Math.min(64, W / 11), "#ffffff");
    text(opts.coordText, W / 2, H * .26 + big + 34, 15, "#ffffff", 500, mono);
    text(opts.sunText, W / 2, H * .26 + big + 60, 15, "#ffffff", 500, mono);
    fx.globalAlpha = 1;
    if (k < .2) { fx.fillStyle = `rgba(255,255,255,${1 - k / .2})`; fx.fillRect(0, 0, W, H); }
  }
  // 7. Satellite zoom out at the exit.
  function sSatOut(k, ms) {
    const e = opts.exit, zMax = opts.zExit, Z = zMax - (zMax - 4) * ease(k);
    drawTiles(e, Z, zMax);
    marker(W / 2, H / 2, MAGMA, trim(opts.toLabel), ms);
    text(zoomName(Z), W / 2, H * .12 + 40, 14, "#e9edf6", 500, mono);
    if (k > .82) { fx.globalAlpha = (k - .82) / .18; drawGlobe([-e[0], -e[1], 0], matchZoom(e), [], ms); fx.globalAlpha = 1; }
  }
  // 8. Globe pulls back.
  function sGlobeOut(k, ms) {
    const e = opts.exit, zm = matchZoom(e);
    drawGlobe([-e[0], -e[1], 0], zm ** (1 - ease(k)), [{ p: e, color: MAGMA, label: opts.toLabel }], ms);
  }
  // 9. Hold: the globe turns gently until the viewer closes the film.
  function sHold(ms) {
    const e = opts.exit;
    drawGlobe([-e[0] + Math.sin(ms / 5000) * 14, -e[1] + Math.sin(ms / 6500) * 6, 0], 1, [{ p: e, color: MAGMA, label: opts.toLabel }], ms);
  }

  // ================= RUNNER =================
  function buildEnd() {
    const end = opts.end || {};
    document.getElementById("feEyebrow").textContent = end.eyebrow || "";
    document.getElementById("feTitle").textContent = end.title || "";
    const lines = document.getElementById("feLines"); lines.innerHTML = "";
    (end.lines || []).forEach(([t, cls]) => { const p = document.createElement("p"); p.textContent = t; if (cls) p.className = cls; lines.append(p); });
    const acts = document.getElementById("feActions"); acts.innerHTML = "";
    const add = (label, fn, primary) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (primary) b.className = "primary"; b.onclick = fn; acts.append(b); };
    (end.actions || []).forEach(a => add(a.label, a.onClick, a.primary));
    add("Watch again", () => Film.play(opts));
    add("Close", close);
  }
  function enterHold() {
    if (!run) return;
    run.hold = true; run.holdT0 = performance.now();
    skipBtn.hidden = true; endBox.hidden = false; buildEnd();
  }
  function tick(now) {
    if (!run) return;
    const dt = Math.min(50, now - run.last); run.last = now;
    if (run.hold) { sHold(now - run.holdT0); requestAnimationFrame(tick); return; }
    let t = now - run.t0;
    if (t >= run.total) { enterHold(); requestAnimationFrame(tick); return; }
    for (const [dur, fn] of run.scenes) {
      if (t < dur) { fn(t / dur, t, dt); break; }
      t -= dur;
    }
    requestAnimationFrame(tick);
  }
  function close() {
    run = null; film.hidden = true; endBox.hidden = true; document.body.style.overflow = "";
    if (Film.onClose) Film.onClose();
  }

  const Film = {
    onClose: null,
    setData(d) { land = d.land; borders = d.borders; },
    isOpen: () => !!run,
    play(o) {
      opts = o;
      size();
      film.hidden = false; endBox.hidden = true; skipBtn.hidden = false;
      document.body.style.overflow = "hidden";
      preload(o.origin, o.zOrigin);
      setTimeout(() => run && preload(o.exit, o.zExit), 1500);
      flecks.forEach(f => f.a = Math.random()); embers.forEach(e => e.a = Math.random()); sea.trail = [];
      const scenes = [
        [2600, sGlobeIn], [3800, sSatIn], [2000, sHole], [T_DESC, sTunnel],
        o.exitIsLand ? [2400, sLand] : [8500, sWater],
        [3800, sArrive], [3400, sSatOut], [2200, sGlobeOut]
      ];
      run = { scenes, total: scenes.reduce((s, x) => s + x[0], 0), t0: performance.now(), last: performance.now(), layer: null, titleT: -9999, zone: null, zoneT: 0, hold: false };
      if (reduceMotion) enterHold();
      closeBtn.focus();
      requestAnimationFrame(tick);
    },
    close
  };
  skipBtn.onclick = enterHold;
  closeBtn.onclick = close;
  window.addEventListener("keydown", e => { if (run && e.key === "Escape") close(); });
  window.addEventListener("resize", () => { if (run) size(); });
  window.Film = Film;
})();
