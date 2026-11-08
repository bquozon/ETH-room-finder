import { BUILDINGS, campusOf, occupancyLevel, openingStatus, roomStatus, hhmm } from "./logic.js";
import { campusStyle, systemPalette, applyPalette, plantTrees, onTiles } from "./map-style.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const VIEWS = { z: { center: [8.5487, 47.3772], zoom: 16.6 }, h: { center: [8.5085, 47.4085], zoom: 16.4 } };
const STYLES = { "3D": 60, "Flat": 0 }; // name: camera pitch (same map style, so switching is instant)
let current = "3D";

// ---- ETH buildings: the OSM outlines that contain one of our building points, drawn in ETH colour
// as their own layer on top (recolouring the base layer by id glitched). Tiles only load for what is
// on screen, so keep collecting as the user pans.
const PTS = Object.values(BUILDINGS).map(([lat, lon]) => [lon, lat]);
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
const contains = (g, p) => polys(g).some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)));
// A tile feature can bundle many buildings (MultiPolygon). So: take every feature that holds an ETH
// point out of the base layer (by id) and redraw it in our own layer, ETH polygons teal, the rest grey.
// Drawing a copy on top instead made the walls flicker (two identical shapes fighting).
// shortcut: a building cut by a tile edge only gets the half under its point coloured; ship a footprint file if that shows.
// OSM often has a building twice: its outline (hide_3d, not extruded) and its parts (extruded, with
// heights). A polygon is ETH if it holds one of our points, or if it is a part lying inside such an outline.
const ethIds = new Set(), pieces = new Map(), outlines = new Map();
const holdsPoint = (poly) => PTS.some((p) => contains({ type: "Polygon", coordinates: poly }, p));
const middle = ([ring]) => ring.reduce(([x, y], [a, b]) => [x + a / ring.length, y + b / ring.length], [0, 0]);
const isEth = (poly) => holdsPoint(poly) || [...outlines.values()].some((o) => contains({ type: "Polygon", coordinates: o }, middle(poly)));
function collectEth() {
  const fs = map.querySourceFeatures("openmaptiles", { sourceLayer: "building" });
  const ids = ethIds.size, n = pieces.size;
  for (const f of fs) for (const poly of polys(f.geometry)) if (holdsPoint(poly)) outlines.set(JSON.stringify(poly[0][0]), poly);
  for (const f of fs) if (f.id != null && !ethIds.has(f.id) && polys(f.geometry).some(isEth)) ethIds.add(f.id);
  for (const f of fs) if (ethIds.has(f.id)) for (const poly of polys(f.geometry)) {
    const key = f.id + JSON.stringify(poly[0][0]);
    if (!pieces.has(key)) pieces.set(key, { type: "Feature", geometry: { type: "Polygon", coordinates: poly }, properties: { ...f.properties } });
  }
  if (pieces.size !== n) {
    for (const p of pieces.values()) p.properties.eth = isEth(p.geometry.coordinates); // outlines may have arrived after the parts
    map.getSource("eth")?.setData({ type: "FeatureCollection", features: [...pieces.values()] });
  }
  if (ethIds.size !== ids) hideInBase();
}
let baseFilter;
function hideInBase() {
  if (ethIds.size && baseFilter) map.setFilter("building-3d", ["all", baseFilter, ["!", ["in", ["id"], ["literal", [...ethIds]]]]]);
}
function addEthLayers() {
  baseFilter = map.getFilter("building-3d");
  map.addSource("eth", { type: "geojson", data: { type: "FeatureCollection", features: [...pieces.values()] } });
  const solid = ["!", ["has", "hide_3d"]], shape = {
    "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0] };
  // the neighbours that came along in the same tile feature keep the normal cream; ETH ones turn blue
  map.addLayer({ id: "eth-others", type: "fill-extrusion", source: "eth", filter: ["all", solid, ["!", ["get", "eth"]]],
    paint: { "fill-extrusion-color": map.getPaintProperty("building-3d", "fill-extrusion-color"), ...shape } }, "street-name");
  map.addLayer({ id: "eth", type: "fill-extrusion", source: "eth", filter: ["all", solid, ["get", "eth"]],
    paint: { "fill-extrusion-color": systemPalette().eth, ...shape } }, "street-name");
  hideInBase();
}

// ---- live occupancy, one pin per building
const fail = (text) => {
  const e = document.getElementById("maperr");
  e.innerHTML = `${text}<br><a href="./">Back to the list</a>`; e.hidden = false;
};
const getJSON = (p) => fetch(p, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
// shortcut: loaded once, unlike the list (every minute); add a refresh if people keep the map open long
const loading = Promise.all(["data/spaces.json", "data/availability.json", "data/rooms.json"].map(getJSON));

// Most important first: the map starts while the data loads, looking straight down (only the few tiles
// under the campus, the biggest download), then tilts to 3D once those are drawn.
let map;
try {
  maplibregl.setWorkerUrl("vendor/maplibre-gl-csp-worker.js"); // the CSP build loads its worker from a file
  map = new maplibregl.Map({
    container: "map", style: campusStyle(), ...VIEWS.z, maxPitch: 70,
    minZoom: 12, maxBounds: [[8.40, 47.33], [8.65, 47.45]], // stay around Zurich: you can't get lost off the map
    attributionControl: { compact: true },
  });
} catch (e) { fail("Your browser can't show the map (WebGL is off or not supported)."); throw e; }
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));  // compass: tap to face north again
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }));
map.once("load", () => { if (current === "3D" && !map.isMoving()) map.easeTo({ pitch: STYLES["3D"], bearing: -25, duration: 1200 }); });
// before the await below, or the map's first "style.load" could be missed
map.on("style.load", () => { addEthLayers(); plantTrees(map); });
onTiles(map, collectEth);

let spaces, avail, roomData;
try {
  [spaces, avail, roomData] = await loading;
} catch (e) { fail("Couldn't load the data. Please reload."); throw e; }
const live = new Map(avail.data.map((a) => [a.id, a.attributes]));
const byBuilding = new Map();
for (const { attributes: a } of spaces.data) {
  if (!BUILDINGS[a.building]) continue;
  const l = live.get(a.roomGlobalIdentifier) || {};
  const pct = l.status && l.status !== "unknown" ? l.occupancyPercentage ?? null : null;
  const open = openingStatus(a.hours || [], a.has24HourAccess).open;
  (byBuilding.get(a.building) ?? byBuilding.set(a.building, []).get(a.building)).push({ ...a, pct, open });
}


// ---- free rooms, same rules as the list (roomStatus: free until / free from, closed outside 07–21)
const roomsBy = new Map();
for (const r of roomData.rooms) {
  if (!BUILDINGS[r.building]) continue;
  (roomsBy.get(r.building) ?? roomsBy.set(r.building, []).get(r.building)).push({ ...r, status: roomStatus(r.busy) });
}

// One pin per building: [colour level, text after the code, popup rows]
function spacesPin(xs) {
  const known = xs.filter((s) => s.open !== false && s.pct != null).map((s) => s.pct);
  const best = known.length ? Math.min(...known) : null;
  return [occupancyLevel(best), best != null ? ` · ${best}%` : "", best != null ? 100 - best : -1, xs.map((s) => `<li><span>${esc(s.title)}<small>${esc(s.description)}</small></span>
    <b class="${s.open === false ? "high" : occupancyLevel(s.pct)}">${s.open === false ? "Closed" : s.pct == null ? "—" : s.pct + "%"}</b></li>`)];
}
function roomsPin(xs) {
  const free = xs.filter((r) => r.status.free).length, closed = xs.every((r) => r.status.closed);
  const label = (st) => st.closed ? ["Closed", "unknown"] : st.free ? [`free until ${hhmm(st.until)}`, "low"]
    : st.nextFree ? [`free from ${hhmm(st.nextFree)}`, "high"] : ["busy all day", "high"];
  const rows = [...xs].sort((a, b) => b.status.free - a.status.free).map((r) => {
    const [text, lvl] = label(r.status);
    return `<li><span>${esc(`${r.building} ${r.floor} ${r.room}`)}<small>${Number(r.seats) ? `${r.seats} seats` : ""}</small></span><b class="${lvl}">${text}</b></li>`;
  });
  return [closed ? "unknown" : free ? "low" : "high", closed ? "" : ` · ${free} free`, free, rows];
}

// Pins that would overlap on screen: the most useful one keeps its label, the others shrink to a dot.
let queued = false;
function declutter() {
  queued = false;
  const placed = [];
  for (const m of [...markers].sort((a, b) => b.prio - a.prio)) {
    const p = map.project(m.getLngLat()), box = [p.x - m.w / 2 - 4, p.y - 70, p.x + m.w / 2 + 4, p.y - 28];
    const hit = placed.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3]);
    m.getElement().classList.toggle("dot", hit);
    if (!hit) placed.push(box);
  }
}
const queueDeclutter = () => { if (!queued) { queued = true; requestAnimationFrame(declutter); } };

// opens on the list's tab (map.html#rooms), and the list follows a switch made here
let mode = location.hash === "#rooms" ? "rooms" : "spaces", markers = [];
function showPins() {
  for (const m of markers) m.remove();
  markers = [...(mode === "spaces" ? byBuilding : roomsBy)].map(([b, xs]) => {
    const [level, text, prio, rows] = (mode === "spaces" ? spacesPin : roomsPin)(xs);
    const el = document.createElement("div");
    el.className = `pin ${level}`;
    el.innerHTML = `<span>${esc(b)}${text}</span><i></i><em></em>`;
    const [lat, lon] = BUILDINGS[b];
    const popup = new maplibregl.Popup({ offset: 56, maxWidth: "min(320px, 88vw)" }).setHTML(
      `<div class="pop"><h3>${esc(b)} · ${campusOf(b)}</h3><ul>${rows.join("")}</ul>
       <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${lat},${lon}">Directions</a></div>`);
    // tapping a pin also brings the building to the middle, so the popup is never cut off
    el.addEventListener("click", () => map.easeTo({ center: [lon, lat], offset: [0, 120], duration: 500 }));
    const m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lon, lat]).setPopup(popup).addTo(map);
    return Object.assign(m, { prio, w: el.firstChild.offsetWidth });
  });
  declutter();
  for (const c of document.querySelectorAll("[data-mode]")) c.setAttribute("aria-pressed", c.dataset.mode === mode);
}

function setStyle(name) {
  current = name;
  map.easeTo({ pitch: STYLES[name], bearing: STYLES[name] ? -25 : 0 });
  for (const c of document.querySelectorAll("[data-style]")) c.setAttribute("aria-pressed", c.dataset.style === name);
}
// light or dark map, following the phone/computer setting, switched live
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyPalette(map, systemPalette()));
map.on("move", queueDeclutter);

const bar = document.getElementById("styles");
bar.innerHTML = `<a href="./">List</a><button data-mode="spaces">Study spaces</button><button data-mode="rooms">Free rooms</button>` +
  Object.keys(STYLES).map((n) => `<button data-style="${n}" aria-pressed="${n === current}">${n}</button>`).join("");
bar.addEventListener("click", (e) => {
  const c = e.target.closest("[data-style], [data-mode]"); if (!c) return;
  if (c.dataset.style) return setStyle(c.dataset.style);
  mode = c.dataset.mode; showPins();
  history.replaceState(null, "", `#${mode}`);
  try { localStorage.setItem("tab", JSON.stringify(mode)); } catch {}
});
showPins();

document.getElementById("campus").addEventListener("click", (e) => {
  const c = e.target.closest("[data-go]"); if (c) map.flyTo({ ...VIEWS[c.dataset.go], pitch: STYLES[current], bearing: STYLES[current] ? -25 : 0 });
});

