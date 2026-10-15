// Dig Straight Through: maps, search, facts about the exit, Daily Dig and sharing.
(() => {
  const $ = id => document.getElementById(id);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const R = 6371;

  let land, borders, countries = [], seas = [], cities = [];
  let origin = null, exit = null, fromLabel = "", toLabel = "", exitIsLand = false;
  let pickId = 0, mode = "explore", exploreSaved = null;

  // ---------- helpers ----------
  const antipode = ([lon, lat]) => [lon > 0 ? lon - 180 : lon + 180, -lat];
  const fmt = ([lon, lat]) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
  const km = rad => Math.round(rad * R);
  const n0 = x => Math.round(x).toLocaleString("en");
  const dotlessI = String.fromCharCode(305);
  const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(dotlessI).join("i");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const trim = (s, n = 30) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  const ll = p => L.latLng(p[1], p[0]);
  // "the Pacific Ocean", "the Tasman Sea" in sentences; land names stay as they are.
  const inSentence = s => (!exitIsLand && !/^the\s/i.test(s) && /\b(Ocean|Sea|Gulf|Bay|Strait|Channel|Sound|Bight|Passage)\b/.test(s)) ? "the " + s : s;
  function say(text) { const m = $("msg"); m.textContent = text; m.hidden = !text; }
  // Anonymous action counts in GoatCounter (only a fixed name, never a place). Does nothing if the counter isn't loaded.
  function track(name, title) {
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title, event: true }); } catch { /* counting must never break the app */ }
  }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function linkOut(label, href) { const a = el("a", null, label); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

  function nearestCity(p) {
    let best = null, bd = Infinity;
    for (const c of cities) { const d = d3.geoDistance(p, [c[3], c[2]]); if (d < bd) { bd = d; best = c; } }
    return { city: best, km: km(bd) };
  }
  function whereIs(p) {
    const country = countries.find(f => d3.geoContains(f, p));
    if (country) return { land: true, name: country.properties.name };
    const hits = seas.filter(f => d3.geoContains(f, p));
    if (hits.length) { hits.sort((a, b) => a.area - b.area); return { land: false, name: hits[0].properties.n }; }
    return { land: false, name: "the open ocean" };
  }
  function describeLocal(p) {
    const w = whereIs(p), n = nearestCity(p);
    if (w.land && n.km <= 25) return { land: true, title: `Near ${n.city[0]}`, sub: w.name };
    if (w.land) return { land: true, title: w.name, sub: `Nearest town: ${n.city[0]}, ${n0(n.km)} km away` };
    return { land: false, title: w.name, sub: `Water. Nearest town: ${n.city[0]}, ${n.city[1]}, ${n0(n.km)} km away` };
  }

  // ---------- address lookup (Esri geocoding via ArcGIS Location Platform, key in js/config.js) ----------
  // Free each month: 20,000 lookups; typing suggestions are not charged. With no key, or once the free amount
  // is used up, every call fails quietly and the app keeps its own town and country names.
  const ESRI_KEY = (window.DIG_CONFIG || {}).ESRI_API_KEY || "";
  const HAS_ESRI = ESRI_KEY.length > 20 && !/PASTE/.test(ESRI_KEY);
  const GEO = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  function esri(path, params) {
    if (!HAS_ESRI) return Promise.reject(new Error("no key"));
    const u = new URLSearchParams({ f: "json", langCode: "en", token: ESRI_KEY, ...params });
    return fetch(`${GEO}/${path}?${u}`).then(r => r.json()).then(j => { if (j.error) throw new Error(j.error.message); return j; });
  }
  const reverse = p => esri("reverseGeocode", { location: `${p[0]},${p[1]}` });
  const suggest = s => esri("suggest", { text: s, maxSuggestions: 5 }).then(j => j.suggestions || []);
  const findPlace = (s, magicKey, n) => esri("findAddressCandidates", { SingleLine: s, maxLocations: n, outFields: "PlaceName,City,Region,CntryName", ...(magicKey ? { magicKey } : {}) }).then(j => j.candidates || []);
  function addrLabel(j) {
    const a = j && j.address;
    if (!a) return null;
    // House numbers are left out on purpose, so a shared result never shows someone's exact home address.
    const street = (a.AddNum ? (a.Address || "").replace(a.AddNum, "") : (a.Address || "")).replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
    const place = a.Addr_type === "POI" && a.PlaceName ? a.PlaceName : street;
    const uniq = arr => arr.filter((v, i) => v && arr.indexOf(v) === i);
    const title = uniq([place, a.Neighborhood || a.District]).slice(0, 2);
    const sub = uniq([a.City, a.Region, a.CntryName]).filter(v => !title.includes(v));
    if (!title.length) return a.CntryName ? { title: a.City || a.CntryName, sub: sub.filter(v => v !== a.City).join(", ") } : null;
    return { title: title.join(", "), sub: sub.join(", ") };
  }

  // ---------- the sun right now (standard low-precision formula, accurate to about a degree) ----------
  function subsolar(date = new Date()) {
    const rad = Math.PI / 180, n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const Lm = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
    const lam = (Lm + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, eps = (23.439 - 0.0000004 * n) * rad;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / rad;
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    return [((ra - gmst * 15) % 360 + 540) % 360 - 180, dec / rad];
  }
  function sunState(p) {
    const alt = 90 - d3.geoDistance(p, subsolar()) * 180 / Math.PI;
    return alt > 0 ? ["day", "Daylight, the sun is up", "daylight"] : alt > -6 ? ["dusk", "Twilight", "twilight"] : ["night", "Night, the sun is down", "night"];
  }
  function sunTime(lon) {
    const now = new Date();
    const h = ((now.getUTCHours() + now.getUTCMinutes() / 60 + lon / 15) % 24 + 24) % 24;
    return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  }
  function updateNow() {
    if (!origin) return;
    $("nowFrom").textContent = sunTime(origin[0]); $("nowFromState").textContent = sunState(origin)[1];
    $("nowTo").textContent = sunTime(exit[0]); $("nowToState").textContent = sunState(exit)[1];
  }
  setInterval(updateNow, 30000);

  // ---------- Wikipedia: facts about the exit ----------
  const WAPI = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query";
  const WPROPS = "&prop=extracts|pageimages|coordinates|info&exintro=1&explaintext=1&exsentences=3&exlimit=max&piprop=thumbnail&pithumbsize=480&inprop=url";
  // Wikipedia asks apps to identify themselves with a contact address.
  const WIKI_AGENT = `DigStraightThrough/1.0 (${(window.DIG_CONFIG || {}).CONTACT_EMAIL || "no contact set"})`;
  const getJSON = url => fetch(url, { headers: { "Api-User-Agent": WIKI_AGENT } }).then(r => { if (!r.ok) throw new Error("request failed"); return r.json(); });
  const pageKm = (p, pg) => pg.coordinates ? km(d3.geoDistance(p, [pg.coordinates[0].lon, pg.coordinates[0].lat])) : Infinity;
  const wikiNearby = p => getJSON(`${WAPI}${WPROPS}&generator=geosearch&ggscoord=${p[1]}|${p[0]}&ggsradius=10000&ggslimit=10`).then(j => j.query?.pages || []);
  async function wikiTown(c) {
    // Search by name, then keep only an article whose coordinates are within 30 km of the town, so we never show the wrong place.
    const j = await getJSON(`${WAPI}${WPROPS}&generator=search&gsrlimit=6&gsrsearch=${encodeURIComponent(c[0] + " " + c[1])}`);
    const pages = (j.query?.pages || []).sort((a, b) => a.index - b.index);
    return pages.find(pg => pageKm([c[3], c[2]], pg) < 30 && pg.extract) || null;
  }
  async function wikiTitle(title) {
    const j = await getJSON(`${WAPI}${WPROPS}&redirects=1&titles=${encodeURIComponent(title)}`);
    const pg = j.query?.pages?.[0];
    return pg && !pg.missing && pg.extract && !/may refer to/.test(pg.extract) ? pg : null;
  }
  function shorten(s, n) {
    if (!s || s.length <= n) return s || "";
    const cut = s.slice(0, n), end = cut.lastIndexOf(". ");
    return end > n * .5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
  }
  function wikiBlock(box, pg, fallback) {
    box.innerHTML = "";
    if (!pg) return box.append(el("p", "meta", fallback));
    if (pg.thumbnail) { const img = new Image(); img.src = pg.thumbnail.source; img.alt = pg.title; img.loading = "lazy"; box.append(img); }
    box.append(el("p", "wt", pg.title), el("p", null, shorten(pg.extract, 360)), linkOut("Read more on Wikipedia", pg.fullurl));
  }
  const loading = box => { box.innerHTML = ""; box.append(el("p", "meta", "Looking it up on Wikipedia…")); };
  function bearing(a, b) {
    const r = Math.PI / 180, dl = (b[0] - a[0]) * r;
    const y = Math.sin(dl) * Math.cos(b[1] * r), x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos(dl);
    const deg = (Math.atan2(y, x) / r + 360) % 360;
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];
  }

  // ---------- fun facts ----------
  // Coastline points from the country outlines, used to find the nearest land to a point at sea.
  let coast = null;
  function buildCoast() {
    const lon = [], lat = [], who = [], names = countries.map(f => f.properties.name);
    countries.forEach((f, i) => {
      const g = f.geometry; if (!g) return;
      for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates)
        for (const ring of poly) for (let j = 0; j < ring.length; j += 2) { lon.push(ring[j][0]); lat.push(ring[j][1]); who.push(i); }
    });
    coast = { lon: Float32Array.from(lon), lat: Float32Array.from(lat), who, names };
  }
  function nearestLand(p) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < coast.lon.length; i++) { const d = d3.geoDistance(p, [coast.lon[i], coast.lat[i]]); if (d < best) { best = d; bi = i; } }
    return { km: km(best), name: coast.names[coast.who[bi]] };
  }
  function funFacts() {
    const ul = $("funFacts"); ul.innerHTML = "";
    const add = (head, text, hi) => { const li = el("li", hi ? "hi" : null); li.append(el("strong", null, head), el("span", null, text)); ul.append(li); };
    // Shares below come from our own count over Natural Earth land data (evenly spread sample points):
    // land ≈ 29% of the surface; ≈ 13% of land has land opposite (≈ 4% of the surface); ≈ 35% of ocean has land opposite.
    // One fact only, always about the exit.
    if (exitIsLand) {
      const fromLand = whereIs(origin).land || nearestCity(origin).km <= 10, country = whereIs(exit).name;
      add(`You surface on land, in ${country}`, fromLand
        ? "That makes yours a rare land-to-land tunnel. Only about 13% of the world's land has land directly on its other side."
        : "That's unusual. Only about 35% of the ocean has land on its other side.", true);
    } else if (coast) {
      const nl = nearestLand(exit);
      add(`The nearest land is about ${n0(nl.km)} km away`,
        `It's part of ${nl.name}.` + (nl.km >= 300 ? " For comparison, Point Nemo, the most remote spot in any ocean, is about 2,688 km from land." : " You'd come up close to the coast."), nl.km >= 1500);
    }
  }

  // ---------- ships near the exit (links out to public ship-tracking sites, centred on the exit) ----------
  const shipSites = p => [
    { name: "MarineTraffic", url: `https://www.marinetraffic.com/en/ais/home/centerx:${p[0].toFixed(2)}/centery:${p[1].toFixed(2)}/zoom:5` },
    { name: "VesselFinder", url: `https://www.vesselfinder.com/?lat=${p[1].toFixed(2)}&lon=${p[0].toFixed(2)}&zoom=5` }
  ];
  // VesselFinder's live map, embedded with their permission. This builds the same frame as their official
  // embed code (vesselfinder.com/embed, aismap.js), with the same settings; their script can only run while
  // the page first loads, but this card appears later, after the dig.
  function vesselFinderFrame(p) {
    const q = [
      "zoom=5", `lat=${p[1].toFixed(4)}`, `lon=${p[0].toFixed(4)}`, "width=100%25", "height=400", "names=false",
      "track=false", "fleet=false", "fleet_name=false", "fleet_hide_old_positions=false",
      "clicktoact=true", "store_pos=true", `ra=${encodeURIComponent(location.href)}`
    ].join("&");
    const f = document.createElement("iframe");
    f.name = "vesselfinder"; f.title = "Live ship map around your exit, by VesselFinder"; f.loading = "lazy";
    f.src = `https://www.vesselfinder.com/aismap?${q}`;
    return f;
  }
  let shipMapFor = "";
  function updateShips() {
    $("shipsCard").hidden = exitIsLand;
    const box = $("shipLinks"); box.innerHTML = "";
    if (exitIsLand) { $("shipMap").innerHTML = ""; shipMapFor = ""; return; }
    shipSites(exit).forEach(s => box.append(linkOut(`Open ${s.name}`, s.url)));
    // Only rebuild the live map when the exit actually changes.
    const key = exit.map(v => v.toFixed(4)).join(",");
    if (key !== shipMapFor) { shipMapFor = key; $("shipMap").replaceChildren(vesselFinderFrame(exit)); }
  }
  const openShips = () => window.open(shipSites(exit)[0].url, "_blank", "noopener");

  let townMark = null;
  function updateThere(id) {
    updateNow();
    funFacts();
    updateShips();
    if (townMark) { townMark.remove(); townMark = null; }
    const w = whereIs(exit), n = nearestCity(exit), c = n.city, cp = [c[3], c[2]];

    $("townName").textContent = `${c[0]}, ${c[1]}`;
    $("townMeta").textContent = (n.km < 1 ? "Right at the exit point" : `${n0(n.km)} km ${bearing(exit, cp)} of the exit`) + (c[4] > 0 ? ` · population about ${n0(c[4])}` : "");
    const links = $("townLinks"); links.innerHTML = "";
    const show = el("button", null, "Show on map"); show.type = "button";
    show.onclick = () => {
      if (townMark) townMark.remove();
      townMark = L.circleMarker(ll(cp), { radius: 8, color: "#ffb347", weight: 3, fillOpacity: .6 }).addTo(mapB).bindTooltip(c[0], { permanent: true, direction: "top" });
      mapB.fitBounds(L.latLngBounds([ll(exit), ll(cp)]).pad(.3));
      $("mapB").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    };
    const wikiLink = linkOut("Wikipedia", `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(c[0] + " " + c[1])}`);
    links.append(show, wikiLink, linkOut("OpenStreetMap", `https://www.openstreetmap.org/?mlat=${c[2]}&mlon=${c[3]}#map=12/${c[2]}/${c[3]}`));
    loading($("townWiki"));
    wikiTown(c).then(pg => { if (id !== pickId) return; wikiBlock($("townWiki"), pg, "Wikipedia has no article that matches this town."); if (pg) wikiLink.href = pg.fullurl; })
      .catch(() => { if (id === pickId) wikiBlock($("townWiki"), null, "Wikipedia isn't responding right now. Try again in a moment."); });

    const areaTitle = w.name === "the open ocean" ? null : w.name;
    $("areaTag").textContent = w.land ? "The country you come out in" : "The water you come out in";
    loading($("areaWiki"));
    (areaTitle ? wikiTitle(areaTitle) : Promise.resolve(null))
      .then(pg => { if (id === pickId) wikiBlock($("areaWiki"), pg, areaTitle ? `No Wikipedia summary found for ${areaTitle}.` : "Open ocean, away from any named sea."); })
      .catch(() => { if (id === pickId) wikiBlock($("areaWiki"), null, "Wikipedia isn't responding right now. Try again in a moment."); });

    const ul = $("nearby"); ul.innerHTML = ""; ul.append(el("li", "empty", "Searching Wikipedia for places near the exit…"));
    wikiNearby(exit).then(pages => {
      if (id !== pickId) return;
      ul.innerHTML = "";
      if (!pages.length) {
        return ul.append(el("li", "empty", w.land
          ? "Wikipedia has no articles about places within 10 km of the exit. A quiet spot."
          : `No Wikipedia places within 10 km, just water. The nearest town, ${c[0]}, is ${n0(n.km)} km away.`));
      }
      pages.map(pg => (pg._d = pageKm(exit, pg), pg)).sort((a, b) => a._d - b._d).slice(0, 6).forEach(pg => {
        const li = el("li");
        if (pg.thumbnail) { const img = new Image(); img.src = pg.thumbnail.source; img.alt = pg.title; img.loading = "lazy"; li.append(img); }
        const nb = el("div", "nb");
        nb.append(linkOut(pg.title, pg.fullurl), el("small", null, pg._d < 1 ? "Less than 1 km from the exit" : `${pg._d} km from the exit`), el("span", null, shorten(pg.extract, 200)));
        li.append(nb); ul.append(li);
      });
    }).catch(() => { if (id === pickId) { ul.innerHTML = ""; ul.append(el("li", "empty", "Wikipedia isn't responding right now. Try again in a moment.")); } });
  }

  // ---------- maps ----------
  const osm = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  const sat = () => L.tileLayer(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_KEY)}`, {
    maxZoom: 19,
    attribution: 'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> | Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community'
  });
  function makeMap(id) {
    const m = L.map(id, { worldCopyJump: true, minZoom: 1 }).setView([41, 29], 4);
    const a = osm();
    a.addTo(m);
    // The satellite option only appears when an Esri key is set in js/config.js.
    if (HAS_ESRI) L.control.layers({ "Map": a, "Satellite": sat() }, null, { position: "topright" }).addTo(m);
    return m;
  }
  const mapA = makeMap("mapA"), mapB = makeMap("mapB");
  const pin = cls => L.divIcon({ className: `pin ${cls}`, iconSize: [18, 18] });
  const markA = L.marker([41, 29], { icon: pin("pin-start"), keyboard: false }).addTo(mapA);
  const markB = L.marker([-41, -151], { icon: pin("pin-exit"), keyboard: false }).addTo(mapB);
  mapA.on("click", e => { if (mode !== "explore") return; const w = e.latlng.wrap(); say(""); setOrigin([w.lng, w.lat]); });
  const isRevealed = () => document.body.dataset.revealed === "yes";
  mapA.on("zoomend", () => { if (mode === "explore" && exit && isRevealed()) mapB.setView(ll(exit), mapA.getZoom(), { animate: false }); });
  mapB.on("click", e => { if (mode === "daily" && !daily.result) placeGuess(e.latlng.wrap()); });

  // ---------- choose a point ----------
  // The exit is worked out straight away (the film needs its name), but kept hidden until the tunnel is dug.
  let exitSub = "", revealedKey = "";
  const keyOf = p => p[0].toFixed(5) + "," + p[1].toFixed(5);
  function setOrigin(p, label, zoomTo) {
    const id = ++pickId;
    origin = p; exit = antipode(p);
    markA.setLatLng(ll(p)); markB.setLatLng(ll(exit));
    if (zoomTo) mapA.setView(ll(p), zoomTo);
    const from = describeLocal(p);
    fromLabel = label || from.title;
    $("fromName").textContent = fromLabel; $("fromSub").textContent = from.sub;
    $("fromCoord").textContent = fmt(p);
    $("season").textContent = Math.abs(p[1]) < 5 ? "near equator" : "opposite";
    $("cutFrom").textContent = trim(fromLabel);
    reverse(p).then(j => {
      const a = addrLabel(j); if (!a || id !== pickId) return;
      if (!label) { fromLabel = a.title; $("fromName").textContent = a.title; $("cutFrom").textContent = trim(a.title); }
      $("fromSub").textContent = a.sub;
    }).catch(() => {});
    prepareExit(id);
    // In Explore, a spot you have already dug from stays revealed (for example after visiting the Daily Dig).
    if (mode === "explore" && revealedKey === keyOf(p)) { mapB.setView(ll(exit), mapA.getZoom(), { animate: false }); revealExit(id); }
    else hideExit(mode === "daily" ? "That's for you to guess." : "Dig the tunnel to find out.");
  }
  function prepareExit(id) {
    const to = describeLocal(exit);
    exitIsLand = to.land; toLabel = to.title; exitSub = to.sub;
    if (to.land) reverse(exit).then(j => {
      const a = addrLabel(j); if (!a || id !== pickId) return;
      toLabel = a.title; exitSub = a.sub || to.sub;
      if (isRevealed()) showExitText();
    }).catch(() => {});
  }
  function hideExit(msg) {
    markB.remove();
    document.body.dataset.revealed = "no";
    if (mode === "explore") mapB.setView([15, 0], 1, { animate: false });
    $("toName").textContent = "?"; $("toSub").textContent = msg; $("toCoord").textContent = " ";
    $("cutTo").textContent = "?";
  }
  function showExitText() {
    $("toName").textContent = toLabel; $("toSub").textContent = exitSub;
    $("toCoord").textContent = fmt(exit); $("cutTo").textContent = trim(toLabel);
  }
  function revealExit(id) {
    document.body.dataset.revealed = "yes";
    if (mode === "explore") revealedKey = keyOf(origin);
    markB.addTo(mapB);
    showExitText();
    updateThere(id);
  }

  // ---------- search ----------
  const q = $("q"), sugg = $("sugg");
  let items = [], active = -1;
  function renderSugg() {
    sugg.innerHTML = "";
    items.forEach((it, i) => {
      const li = el("li", it.kind === "addr" ? "addr" : null);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === active);
      li.append(el("span", null, it.main), el("small", null, it.side || ""));
      li.addEventListener("pointerdown", e => { e.preventDefault(); pick(it); });
      sugg.appendChild(li);
    });
    sugg.hidden = !items.length;
  }
  function closeSugg() { items = []; active = -1; renderSugg(); }
  // Street and place picks pass no label on purpose: the name then comes from the street lookup,
  // which drops house numbers, so a shared result never shows an exact home address.
  function pick(it) {
    if (it.kind === "addr") return runAddressSearch(it.query);
    q.value = it.main + (it.side ? ", " + it.side : "");
    closeSugg(); q.blur(); say("");
    if (it.kind === "esri") {
      say("Finding that place…");
      return findPlace(it.text, it.magicKey, 1)
        .then(c => { if (!c.length) return say("Couldn't find that place. Try another spelling, or click the map."); say(""); setOrigin([c[0].location.x, c[0].location.y], null, 17); })
        .catch(() => say("The address search isn't available right now. Search for a city instead, or click the map."));
    }
    setOrigin(it.p, it.kind === "city" ? it.label : null, it.zoom);
  }
  async function runAddressSearch(s) {
    if (!HAS_ESRI) return say("Street search isn't set up. Search for a city instead, or click the map.");
    say("Searching streets and addresses…");
    try {
      const res = await findPlace(s, null, 5);
      if (!res.length) { closeSugg(); return say(`Nothing found for "${s}". Try adding the city name.`); }
      say("");
      items = res.map(c => {
        const parts = c.address.split(", ");
        return { kind: "place", main: parts.slice(0, 2).join(", "), side: c.attributes.CntryName || parts.slice(-1)[0], p: [c.location.x, c.location.y], zoom: 17 };
      });
      active = 0; renderSugg(); q.focus();
    } catch { say("The address search isn't available right now. Search for a city instead, or click the map."); }
  }
  let sugTimer = null;
  q.addEventListener("input", () => {
    const raw = q.value.trim(), s = fold(raw);
    active = -1;
    clearTimeout(sugTimer);
    if (s.length < 2) return closeSugg();
    const starts = [], has = [];
    for (const c of cities) {
      if (c._f.startsWith(s)) starts.push(c); else if (c._f.includes(s)) has.push(c);
      if (starts.length >= 4) break;
    }
    const local = starts.concat(has).slice(0, 4).map(c => ({ kind: "city", main: c[0], side: c[1], p: [c[3], c[2]], label: c[0], zoom: 12 }));
    const tail = HAS_ESRI && raw.length >= 3 ? [{ kind: "addr", main: `Search streets and addresses for "${raw}"`, query: raw }] : [];
    items = local.concat(tail); renderSugg();
    // Street suggestions while typing (free of charge on Esri), after a short pause.
    if (HAS_ESRI && raw.length >= 3) sugTimer = setTimeout(() => {
      suggest(raw).then(list => {
        if (q.value.trim() !== raw || document.activeElement !== q) return;
        const extra = list.map(sg => { const parts = sg.text.split(", "); return { kind: "esri", main: parts.slice(0, 2).join(", "), side: parts.slice(-2).join(", "), text: sg.text, magicKey: sg.magicKey }; });
        items = local.slice(0, 3).concat(extra, tail); renderSugg();
      }).catch(() => {});
    }, 300);
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter" && !items.length && q.value.trim().length >= 3) { runAddressSearch(q.value.trim()); e.preventDefault(); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { active = (active + 1) % items.length; renderSugg(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; renderSugg(); e.preventDefault(); }
    else if (e.key === "Enter") { pick(items[Math.max(0, active)]); e.preventDefault(); }
    else if (e.key === "Escape") closeSugg();
  });
  q.addEventListener("blur", () => setTimeout(closeSugg, 150));

  $("geo").onclick = () => {
    if (!navigator.geolocation) return say("This browser can't share its location. Search for a place or click the map instead.");
    say("Asking your device for its location…");
    navigator.geolocation.getCurrentPosition(
      pos => { say(""); q.value = ""; setOrigin([pos.coords.longitude, pos.coords.latitude], null, 17); },
      () => say("Location isn't available. Allow location access in your browser, or search for a place instead."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };
  $("rand").onclick = () => {
    const c = cities[Math.floor(Math.random() * 400)];
    q.value = `${c[0]}, ${c[1]}`; say(""); setOrigin([c[3], c[2]], c[0], 11);
  };

  // ---------- the film ----------
  // How far the satellite zoom goes: street level on land or near a town (coastal cities like Istanbul sit right by the water
  // in the rough coastline data), region level in open ocean, where close-up imagery doesn't exist.
  const satZoom = p => (whereIs(p).land || nearestCity(p).km <= 50) ? 16 : 8;
  function playFilm(end) {
    if (!origin || !land) return;
    const st = sunState(exit);
    Film.play({
      origin, exit, fromLabel, toLabel, exitIsLand,
      zOrigin: satZoom(origin), zExit: satZoom(exit),
      sky: st[0], subsolar: subsolar(),
      sunText: `Sun time here: ${sunTime(exit[0])}, ${st[2]}`, coordText: fmt(exit),
      end: end || exploreEnd()
    });
  }
  function exploreEnd() {
    const n = nearestCity(exit);
    return {
      eyebrow: "You came out in", title: toLabel,
      lines: [[fmt(exit), "dim"], [`Nearest town: ${n.city[0]}, ${n.city[1]}, ${n0(n.km)} km away.`], [`Sun time there right now: ${sunTime(exit[0])}.`]],
      actions: [{ label: "Share", primary: true, onClick: () => openShare() }].concat(exitIsLand ? [] : [{ label: "See ships near you", onClick: openShips }])
    };
  }
  Film.onClose = () => {
    // Closing the film (at the end, or by Skip or Close) counts as having dug: reveal the exit.
    if (exit && mode === "explore") {
      if (!isRevealed()) revealExit(pickId);
      mapB.setView(ll(exit), Math.max(mapA.getZoom(), exitIsLand ? 13 : 6));
    }
    $("toName").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  };
  $("dig").onclick = () => { track("dig", "Dug a tunnel"); playFilm(); };

  // =====================================================================
  // ---------- Daily Dig ----------
  // =====================================================================
  const DKEY = "digStraightThrough.daily.v1";
  const daily = { day: 0, city: null, guess: null, guessMark: null, line: null, result: null, timer: null };
  function loadD() { try { return JSON.parse(localStorage.getItem(DKEY)) || { streak: 0, lastDay: 0, results: {} }; } catch { return { streak: 0, lastDay: 0, results: {} }; } }
  function saveD(s) { try { localStorage.setItem(DKEY, JSON.stringify(s)); } catch { /* storage blocked: the game still works for this visit */ } }
  function todayIndex() { const d = new Date(); return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 9, 1)) / 864e5) + 1; }
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function dailyCity(day) { const r = mulberry32(day * 7919 + 104729); r(); r(); const pool = cities.slice(0, 1200); return pool[Math.floor(r() * pool.length)]; }
  const scoreFor = k => k <= 25 ? 5000 : Math.round(5000 * Math.exp(-k / 2000));
  const verdict = k => k < 100 ? "Bullseye!" : k < 500 ? "Superb" : k < 1500 ? "Great guess" : k < 3000 ? "Good guess" : k < 6000 ? "Not bad" : "Way off";
  const blocks = s => Math.max(0, Math.min(5, Math.round(s / 1000)));

  function updateDailyStats() {
    const s = loadD(), res = Object.values(s.results), today = todayIndex();
    const streak = (s.lastDay === today || s.lastDay === today - 1) ? s.streak : 0;
    $("dStreak").textContent = streak;
    $("dPlayed").textContent = res.length;
    $("dBest").textContent = res.length ? n0(Math.max(...res.map(r => r.score))) : "–";
    $("dAvg").textContent = res.length ? n0(res.reduce((a, r) => a + r.score, 0) / res.length) : "–";
    renderHistory(s, today);
  }

  // Personal history: last 14 days from this player's first game, as a bar chart (score out of 5,000) and a list.
  function renderHistory(s, today) {
    const chart = $("histChart"), list = $("histList");
    chart.innerHTML = ""; list.innerHTML = "";
    const played = Object.keys(s.results).map(Number);
    $("histEmpty").hidden = played.length > 0;
    chart.hidden = list.hidden = !played.length;
    if (!played.length) return;
    const first = Math.max(Math.min(...played), today - 13), days = [];
    for (let d = first; d <= today; d++) days.push(d);
    const label = d => { const r = s.results[d], c = dailyCity(d); return r ? `#${d} ${c[0]}: ${n0(r.score)} points, ${n0(r.km)} km off` : d === today ? `#${d} ${c[0]}: not played yet` : `#${d} ${c[0]}: missed`; };

    // Chart: recessive gridlines at 2,500 and 5,000; one bar per day; missed days as a small ring on the baseline.
    const grid = el("div", "hist-grid");
    for (const v of [5000, 2500, 0]) { const g = el("div", "gl"); g.style.bottom = `${v / 50}%`; g.append(el("span", null, n0(v))); grid.append(g); }
    const cols = el("div", "hist-cols"), tip = el("div"); tip.id = "histTip"; tip.hidden = true;
    days.forEach(d => {
      const r = s.results[d], c = el("div", "hc" + (d === today ? " today" : "")), track = el("div", "track");
      if (r) { const b = el("div", "b"); b.style.height = `${Math.max(2, r.score / 50)}%`; track.append(b); }
      else if (d !== today) track.append(el("div", "miss"));
      c.tabIndex = 0; c.setAttribute("aria-label", label(d));
      c.append(track, el("small", null, d === today ? "Today" : `#${d}`));
      const show = () => {
        tip.textContent = label(d); tip.hidden = false;
        const half = tip.offsetWidth / 2, x = c.offsetLeft + c.offsetWidth / 2 + 44;
        tip.style.left = `${Math.max(half, Math.min(chart.clientWidth - half, x))}px`; tip.style.top = `${Math.max(0, (r ? 100 - r.score / 50 : 100) / 100 * (chart.clientHeight - 22))}px`; };
      c.addEventListener("pointerenter", show); c.addEventListener("focus", show);
      c.addEventListener("pointerleave", () => tip.hidden = true); c.addEventListener("blur", () => tip.hidden = true);
      cols.append(c);
    });
    chart.append(grid, cols, tip);
    const scores = days.filter(d => s.results[d]).map(d => s.results[d].score);
    chart.setAttribute("aria-label", `Bar chart of your Daily Dig scores for the last ${days.length} days. Played ${scores.length}, best ${n0(Math.max(...scores))} points.`);

    // List: newest first. This is also the readable table version of the chart.
    for (const d of days.slice().reverse()) {
      const r = s.results[d], c = dailyCity(d);
      if (!r && d === today) continue;
      const li = el("li", r ? null : "missed"), main = el("div", "hl-main"), sc = el("div", "hl-score");
      main.append(el("strong", null, `${c[0]}, ${c[1]}`), el("span", null, r ? `${verdict(r.km)} · ${n0(r.km)} km off` : "Missed"));
      if (r) {
        const bar = el("div", "bar");
        for (let i = 0; i < 5; i++) bar.append(el("i", i < blocks(r.score) ? "on" : null));
        sc.append(el("span", null, `${n0(r.score)} pts`), bar);
      } else sc.append(el("span", null, "–"));
      li.append(el("span", "hl-day", d === today ? "Today" : `#${d}`), main, sc);
      list.append(li);
    }
  }
  function tickCountdown() {
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    let s = Math.max(0, Math.floor((next - now) / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0"), mm = String(Math.floor(s % 3600 / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    $("nextIn").textContent = `Next Daily Dig in ${hh}:${mm}:${ss}`;
    if (daily.day && todayIndex() !== daily.day && mode === "daily") enterDaily();
  }
  function clearGuess() {
    if (daily.guessMark) daily.guessMark.remove();
    if (daily.line) daily.line.remove();
    daily.guessMark = daily.line = null; daily.guess = null;
  }
  function placeGuess(latlng) {
    daily.guess = [latlng.lng, latlng.lat];
    if (!daily.guessMark) daily.guessMark = L.marker(latlng, { icon: pin("pin-guess"), keyboard: false }).addTo(mapB);
    else daily.guessMark.setLatLng(latlng);
    $("guessInfo").textContent = `Your guess: ${fmt(daily.guess)}`;
    $("lockGuess").disabled = false;
  }
  function enterDaily() {
    if (mode === "explore") exploreSaved = { origin, label: fromLabel, zoom: mapA.getZoom() };
    mode = "daily"; document.body.dataset.mode = "daily";
    $("modeDaily").setAttribute("aria-pressed", "true"); $("modeExplore").setAttribute("aria-pressed", "false");
    clearGuess();
    daily.day = todayIndex(); daily.city = dailyCity(daily.day);
    const c = daily.city, res = loadD().results[daily.day];
    daily.result = null;
    $("dailyNo").textContent = `Daily Dig #${daily.day}`;
    $("dailyCity").textContent = `${c[0]}, ${c[1]}`;
    setOrigin([c[3], c[2]], c[0], 5);
    mapB.setView([0, 0], 1);
    $("dailyResult").hidden = true;
    $("lockGuess").disabled = true; $("lockGuess").hidden = false;
    $("guessInfo").textContent = "No guess yet";
    if (res) showDailyResult(res, false);
    updateDailyStats(); tickCountdown();
    clearInterval(daily.timer); daily.timer = setInterval(tickCountdown, 1000);
    setTimeout(() => { mapA.invalidateSize(); mapB.invalidateSize(); }, 50);
  }
  function enterExplore() {
    if (mode === "explore") return;
    mode = "explore"; document.body.dataset.mode = "explore";
    $("modeDaily").setAttribute("aria-pressed", "false"); $("modeExplore").setAttribute("aria-pressed", "true");
    clearGuess(); clearInterval(daily.timer); daily.result = null;
    const s = exploreSaved;
    if (s && s.origin) setOrigin(s.origin, s.label, s.zoom); else document.body.dataset.revealed = "yes";
  }
  $("modeDaily").onclick = enterDaily;
  $("modeExplore").onclick = enterExplore;

  $("lockGuess").onclick = () => {
    if (daily.guess && !daily.result) track("daily-dig", "Played the Daily Dig");
    if (!daily.guess || daily.result) return;
    const off = km(d3.geoDistance(daily.guess, exit)), score = scoreFor(off);
    const s = loadD();
    if (!s.results[daily.day]) {
      s.streak = s.lastDay === daily.day - 1 ? s.streak + 1 : 1;
      s.lastDay = daily.day;
      s.results[daily.day] = { score, km: off, guess: daily.guess };
      saveD(s);
    }
    showDailyResult(s.results[daily.day], true);
  };
  function showDailyResult(res, play) {
    daily.result = res;
    revealExit(pickId);
    clearGuess();
    daily.guess = res.guess;
    daily.guessMark = L.marker(ll(res.guess), { icon: pin("pin-guess"), keyboard: false }).addTo(mapB).bindTooltip("Your guess", { direction: "top" });
    daily.line = L.polyline([ll(res.guess), ll(exit)], { color: "#ffd84d", weight: 2, dashArray: "6 6" }).addTo(mapB);
    mapB.fitBounds(L.latLngBounds([ll(res.guess), ll(exit)]).pad(.35), { maxZoom: 8 });
    $("lockGuess").hidden = true;
    $("guessInfo").textContent = "You've played today's Daily Dig.";
    $("drVerdict").textContent = verdict(res.km);
    $("drLine").textContent = `Your guess was ${n0(res.km)} km from the real exit: ${n0(res.score)} points out of 5,000.`;
    const bar = $("drBar"); bar.innerHTML = "";
    for (let i = 0; i < 5; i++) bar.append(el("i", i < blocks(res.score) ? "on" : null));
    $("dailyResult").hidden = false;
    updateDailyStats();
    if (play) playFilm(dailyEnd());
  }
  function dailyEnd() {
    const r = daily.result;
    return {
      eyebrow: `Daily Dig #${daily.day}`, title: verdict(r.km),
      lines: [[`The tunnel from ${daily.city[0]} comes out in ${inSentence(toLabel)}.`], [`Your guess was ${n0(r.km)} km away: ${n0(r.score)} points.`], [fmt(exit), "dim"]],
      actions: [{ label: "Share my score", primary: true, onClick: () => openShare() }].concat(exitIsLand ? [] : [{ label: "See ships near you", onClick: openShips }])
    };
  }
  $("drShare").onclick = () => openShare();
  $("drReplay").onclick = () => playFilm(dailyEnd());

  // =====================================================================
  // ---------- sharing ----------
  // =====================================================================
  const baseUrl = () => location.origin + location.pathname;
  function shareContent() {
    if (mode === "daily" && daily.result) {
      const r = daily.result, sq = "🟧".repeat(blocks(r.score)) + "⬛".repeat(5 - blocks(r.score));
      return {
        daily: true,
        text: `Daily Dig #${daily.day} ⛏️🌍\nFrom ${daily.city[0]}, my guess was ${n0(r.km)} km off.\n${sq} ${n0(r.score)} points\nStreak: ${loadD().streak}`,
        url: `${baseUrl()}?daily`
      };
    }
    return {
      daily: false,
      text: `If I dug a tunnel straight through the Earth from ${fromLabel}, I'd come out in ${inSentence(toLabel)}. Where does yours come out?`,
      // Rounded to 3 decimals (about 100 m) so a shared link never points to an exact house.
      url: `${baseUrl()}?lat=${origin[1].toFixed(3)}&lon=${origin[0].toFixed(3)}`
    };
  }
  function wrapText(ctx, s, maxW) {
    const words = s.split(" "), lines = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  async function shareImage(sc) {
    await document.fonts.ready;
    const S = 1080, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d");
    x.fillStyle = "#0a0f1c"; x.fillRect(0, 0, S, S);
    x.fillStyle = "rgba(255,255,255,.6)";
    for (let i = 0; i < 160; i++) { x.beginPath(); x.arc((Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * S, (Math.sin(i * 78.233) * 43758.5453 % 1 + 1) % 1 * S, (i % 3) * .6 + .5, 0, 7); x.fill(); }
    const cx = 540, cy = 545, r = 270;
    [[r, "#8a5a3b"], [r * .968, "#b5532a"], [r * .546, "#e8892f"], [r * .192, "#ffd27a"]].forEach(([rr, col]) => { x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fillStyle = col; x.fill(); });
    x.setLineDash([16, 12]); x.strokeStyle = "#e9edf6"; x.lineWidth = 6; x.beginPath(); x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); x.stroke(); x.setLineDash([]);
    [[cy - r, "#7fd6ff"], [cy + r, "#ff7b3a"]].forEach(([y, col]) => { x.beginPath(); x.arc(cx, y, 16, 0, 7); x.fillStyle = col; x.fill(); x.lineWidth = 5; x.strokeStyle = "#0a0f1c"; x.stroke(); });
    x.textAlign = "center";
    x.font = "500 26px 'JetBrains Mono', monospace"; x.fillStyle = "#ff7b3a";
    x.fillText(sc.daily ? `DAILY DIG #${daily.day}` : "DIG STRAIGHT THROUGH", cx, 78);
    const from = sc.daily ? daily.city[0] : fromLabel;
    x.font = "500 24px 'JetBrains Mono', monospace"; x.fillStyle = "#93a0bd"; x.fillText("FROM", cx, 150);
    x.font = "800 54px 'Bricolage Grotesque', sans-serif"; x.fillStyle = "#ffffff"; x.fillText(trim(from, 30), cx, 208);
    x.font = "500 24px 'JetBrains Mono', monospace"; x.fillStyle = "#93a0bd"; x.fillText("STRAIGHT THROUGH TO", cx, 878);
    x.font = "800 54px 'Bricolage Grotesque', sans-serif"; x.fillStyle = "#ff7b3a"; x.fillText(trim(toLabel, 30), cx, 936);
    if (sc.daily) {
      const r2 = daily.result, b = blocks(r2.score);
      for (let i = 0; i < 5; i++) { x.fillStyle = i < b ? "#ff7b3a" : "#24304b"; x.fillRect(cx - 190 + i * 78, 975, 64, 22); }
      x.font = "600 30px 'Instrument Sans', sans-serif"; x.fillStyle = "#e9edf6";
      x.fillText(`${n0(r2.km)} km off · ${n0(r2.score)} points`, cx, 1045);
    } else {
      x.font = "600 30px 'Instrument Sans', sans-serif"; x.fillStyle = "#e9edf6";
      x.fillText("Where does your tunnel come out?", cx, 1010);
      x.font = "500 22px 'JetBrains Mono', monospace"; x.fillStyle = "#93a0bd";
      x.fillText(fmt(exit), cx, 1048);
    }
    return new Promise(res => c.toBlob(b => res(b), "image/png"));
  }
  let shareBlob = null, shareUrl = null;
  async function openShare() {
    track("share", "Opened Share");
    if (!origin) return;
    const sc = shareContent();
    $("sheetTitle").textContent = sc.daily ? "Share your score" : "Share your tunnel";
    $("sheetText").textContent = `${sc.text}\n${sc.url}`;
    $("sheetNote").textContent = "";
    const full = `${sc.text}\n${sc.url}`;
    $("shWa").href = `https://wa.me/?text=${encodeURIComponent(full)}`;
    $("shX").href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(sc.text)}&url=${encodeURIComponent(sc.url)}`;
    $("shNative").hidden = !navigator.share;
    $("sheet").hidden = false;
    $("sheetClose").focus();
    shareBlob = await shareImage(sc);
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(shareBlob);
    $("sheetImg").src = shareUrl; $("shDl").href = shareUrl;
    $("shNative").onclick = async () => {
      const file = new File([shareBlob], "dig-straight-through.png", { type: "image/png" });
      const data = { title: "Dig Straight Through", text: sc.text, url: sc.url };
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ ...data, files: [file] });
        else await navigator.share(data);
      } catch (e) { if (e.name !== "AbortError") $("sheetNote").textContent = "Sharing didn't work here. Use one of the other buttons."; }
    };
    $("shCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(full); $("sheetNote").textContent = "Copied. Paste it anywhere."; }
      catch { $("sheetNote").textContent = "Copy didn't work. Select the text above and copy it by hand."; }
    };
  }
  const closeSheet = () => { $("sheet").hidden = true; };
  $("sheetClose").onclick = closeSheet;
  $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
  $("share").onclick = () => openShare();

  // ---------- load data ----------
  function rewind(f) {
    // Natural Earth rings run counter-clockwise; d3 wants clockwise, so flip any polygon that claims more than half the sphere.
    const fix = poly => d3.geoArea({ type: "Polygon", coordinates: poly }) > 2 * Math.PI ? poly.map(r => r.slice().reverse()) : poly;
    const g = f.geometry;
    if (g.type === "Polygon") g.coordinates = fix(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map(fix);
    f.area = d3.geoArea(f);
    return f;
  }
  Promise.all(["countries.json", "seas.json", "cities.json"].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([world, sea, city]) => {
      countries = topojson.feature(world, world.objects.countries).features;
      land = topojson.feature(world, world.objects.land);
      borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
      Film.setData({ land, borders });
      seas = sea.features.map(rewind);
      cities = city; cities.forEach(c => c._f = fold(c[0]));
      buildCoast();
      // Shared links: ?lat=..&lon=.. opens that exact spot; ?daily opens the Daily Dig.
      const params = new URLSearchParams(location.search);
      const lat = parseFloat(params.get("lat")), lon = parseFloat(params.get("lon"));
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        q.value = ""; setOrigin([lon, lat], null, 15);
      } else {
        const ist = cities.find(c => c[0] === "Istanbul");
        q.value = "Istanbul, Turkey";
        setOrigin([ist[3], ist[2]], "Istanbul", 5);
      }
      if (params.has("daily")) enterDaily();
    })
    .catch(() => { $("fromName").textContent = "The map data didn't load"; say("Open this page with Start Tunnel App.bat, then reload."); });
})();
