// Our own map look: white "snow" city, soft greens, blue water, ETH buildings in the site's own blue, haze
// on the horizon, a light and a dark version. Only the data comes from OpenFreeMap (OpenStreetMap vector
// tiles, OpenMapTiles schema).
// Keys: ground, campus (university land), grass, wood, water, road, roadEdge, rail, building, eth (ETH
// buildings = the site's --accent), label, halo (text outline), transit (stop names), sky, tree, tree2 (round trees), pine (conifers), leaf (spherical broadleaf), trunk,
// yellow/orange/red: autumn leaves, bare: winter branches, pink/rose: spring blossom, each [from, to] (each tree
// gets its own shade in between), kept soft to suit the pale map;
// autumn/winter/spring: keys that replace the normal (summer) ones in that season.
export const PALETTES = {
  // light buildings: a pale tint of the complement of the ETH blue (hue 38° vs 218°), so the blue stands out
  light: { ground: "#f6f7f8", campus: "#e9f2f3", grass: "#cbe6b8", wood: "#b8d9a8", water: "#b3d9f2", road: "#ffffff",
    roadEdge: "#dfe3e8", rail: "#c8cdd4", building: "#faf6ef", eth: "#1f407a", label: "#6b7280", halo: "#ffffff",
    transit: "#1f407a", sky: "#e6eef5", place: "#9aa1ad", tree: "#9fcf8a", tree2: "#86bf73", pine: "#6aa26a", leaf: "#b2d68a", trunk: "#b09579",
    yellow: ["#e8cf7e", "#e6da9c"], orange: ["#e6974f", "#eeae6a"], red: ["#cf6d58", "#dc846c"],
    bare: ["#b9a998", "#cbbfb2"], pink: ["#f4bccb", "#f8cdd8"], rose: ["#e79ab3", "#eeaac0"],
    autumn: { grass: "#e9e5b6", wood: "#d6d197" },
    // winter: frosty, faded grass; conifers a duller green
    winter: { grass: "#e4e9e1", wood: "#d2dccf", pine: "#7f9f84" },
    // spring: fresh, bright young green
    spring: { grass: "#d4edbd", wood: "#bfe0a8", tree: "#b4dc8c", tree2: "#a2d27c", leaf: "#c6e39a" } },
  dark: { ground: "#14171d", campus: "#18212a", grass: "#1c3322", wood: "#22362a", water: "#1b3149", road: "#2a2f3a",
    roadEdge: "#1f232c", rail: "#3a4150", building: "#2c313c", eth: "#7ea3e6", label: "#9aa1ad", halo: "#14171d",
    transit: "#7ea3e6", sky: "#0c0e13", place: "#646b78", tree: "#2f5039", tree2: "#284632", pine: "#223b2b", leaf: "#36583b", trunk: "#3a3129",
    yellow: ["#5f5532", "#5a5639"], orange: ["#6a4729", "#735131"], red: ["#5d2f28", "#673830"],
    bare: ["#3a352f", "#433d37"], pink: ["#6a4450", "#724c58"], rose: ["#5e3646", "#663d4d"],
    autumn: { grass: "#2b2b1d", wood: "#323322" },
    winter: { grass: "#20262a", wood: "#252d2e", pine: "#233a2d" },
    spring: { grass: "#1f3a22", wood: "#26402a", tree: "#3a603c", tree2: "#325634", leaf: "#436a45" } },
};
export const systemPalette = () => {
  const P = PALETTES[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"];
  return { ...P, ...P[season()] }; // summer has no overrides
};
const FONT = ["Noto Sans Regular"], BOLD = ["Noto Sans Bold"];
const geom = (t) => ["==", ["geometry-type"], t];
const cls = (...c) => ["match", ["get", "class"], c, true, false];
const zw = (pairs) => ["interpolate", ["exponential", 1.6], ["zoom"], ...pairs.flat()]; // width by zoom
// street width by zoom, small streets narrower: [zoom, small, big] (zoom must be the outer expression)
const streets = (stops) => zw(stops.map(([z, small, big]) => [z, ["match", ["get", "class"], ["minor", "service"], small, big]]));

export const campusStyle = (C = systemPalette()) => ({
  version: 8,
  sources: {
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    trees: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  light: { anchor: "viewport", position: [1.4, 200, 35], color: "#fffaf0", intensity: 0.35 }, // soft afternoon sun
  sky: sky(C), // the haze far away, as in a tilted diorama photo

  layers: [
    { id: "ground", type: "background", paint: { "background-color": C.ground } },
    { id: "campus", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: cls("university", "college", "school"),
      paint: { "fill-color": C.campus } },
    { id: "grass", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: cls("grass", "farmland", "wetland"),
      paint: { "fill-color": C.grass } },
    { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", filter: ["any", geom("Polygon"), geom("MultiPolygon")],
      paint: { "fill-color": C.grass } },
    { id: "wood-ground", type: "fill", source: "openmaptiles", "source-layer": "landcover", filter: cls("wood"),
      paint: { "fill-color": C.wood } },
    { id: "pitch", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: cls("pitch", "stadium", "playground"),
      paint: { "fill-color": C.grass } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": C.water } },
    { id: "river", type: "line", source: "openmaptiles", "source-layer": "waterway",
      paint: { "line-color": C.water, "line-width": zw([[12, 1], [18, 6]]) } },

    // streets: white with a soft edge, like the reference renders
    { id: "road-edge", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["all", geom("LineString"), cls("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service")],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C.roadEdge, "line-width": streets([[12, 0.5, 2], [14, 2, 4], [19, 16, 28]]) } },
    { id: "path", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: cls("path", "track"), minzoom: 15,
      paint: { "line-color": C.road, "line-width": zw([[15, 1], [19, 4]]), "line-dasharray": [2, 1] } },
    { id: "road", type: "line", source: "openmaptiles", "source-layer": "transportation",
      filter: ["all", geom("LineString"), cls("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service")],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C.road, "line-width": streets([[12, 0.3, 1], [14, 1.5, 3], [19, 13, 24]]) } },
    { id: "rail", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: cls("rail", "transit"),
      paint: { "line-color": C.rail, "line-width": zw([[13, 1], [19, 3]]) } },

    { id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
      filter: ["!", ["has", "hide_3d"]],
      paint: { "fill-extrusion-color": C.building, "fill-extrusion-height": ["get", "render_height"],
        "fill-extrusion-base": ["get", "render_min_height"], "fill-extrusion-vertical-gradient": true } },
    // a few trees in parks and woods, filled in by plantTrees(); a small add-on
    { id: "trees", type: "fill-extrusion", source: "trees", minzoom: 14.5,
      paint: { "fill-extrusion-color": treeColour(C), "fill-extrusion-base": ["get", "b"], "fill-extrusion-height": ["get", "h"] } },

    // labels: only what helps finding the way (streets, tram/train stops, districts); no shops
    { id: "street-name", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", minzoom: 15,
      filter: cls("primary", "secondary", "tertiary", "minor"),
      layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": FONT, "text-size": 12 },
      paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 } },
    { id: "stops", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 15, filter: cls("railway", "bus"),
      // a stop has one point per platform/direction: the big padding lets only one of them show
      layout: { "text-field": ["concat", "● ", ["get", "name"]], "text-font": BOLD, "text-size": 11, "text-padding": 40 },
      paint: { "text-color": C.transit, "text-halo-color": C.halo, "text-halo-width": 1.5 } },
    { id: "place", type: "symbol", source: "openmaptiles", "source-layer": "place", filter: cls("suburb", "quarter", "neighbourhood"), maxzoom: 16,
      layout: { "text-field": ["get", "name"], "text-font": BOLD, "text-size": 13, "text-transform": "uppercase", "text-letter-spacing": 0.1 },
      paint: { "text-color": C.place, "text-halo-color": C.ground, "text-halo-width": 1.5 } },
  ],
});

const sky = (C) => ({ "sky-color": C.sky, "horizon-color": C.ground, "fog-color": C.ground,
  "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4, "atmosphere-blend": 0 });

// Recolour a loaded map in place (no reload): [layer, paint property, palette key]
const PAINT = [
  ["ground", "background-color", "ground"], ["campus", "fill-color", "campus"], ["grass", "fill-color", "grass"],
  ["park", "fill-color", "grass"], ["pitch", "fill-color", "grass"], ["wood-ground", "fill-color", "wood"],
  ["water", "fill-color", "water"], ["river", "line-color", "water"], ["road-edge", "line-color", "roadEdge"],
  ["road", "line-color", "road"], ["path", "line-color", "road"], ["rail", "line-color", "rail"],
  ["building-3d", "fill-extrusion-color", "building"], ["eth-others", "fill-extrusion-color", "building"], ["eth", "fill-extrusion-color", "eth"],
  ["street-name", "text-color", "label"], ["street-name", "text-halo-color", "halo"],
  ["stops", "text-color", "transit"], ["stops", "text-halo-color", "halo"], ["place", "text-halo-color", "ground"], ["place", "text-color", "place"],
];
export function applyPalette(map, C) {
  for (const [id, prop, key] of PAINT) if (map.getLayer(id)) map.setPaintProperty(id, prop, C[key]);
  if (map.getLayer("trees")) map.setPaintProperty("trees", "fill-extrusion-color", treeColour(C));
  map.setSky(sky(C));
}
// Seasonal crowns carry g (colour group) and v (shade within it); everything else is coloured by kind (t).
// g: 0 yellow, 1 orange, 2 red (autumn), 3 bare (winter), 4 pink, 5 rose (spring blossom)
const shade = ([a, b]) => ["interpolate", ["linear"], ["get", "v"], 0, a, 1, b];
const treeColour = (C) => ["case", ["has", "g"], ["match", ["get", "g"], 0, shade(C.yellow), 1, shade(C.orange), 2, shade(C.red),
    3, shade(C.bare), 4, shade(C.pink), shade(C.rose)],
  ["match", ["get", "t"], 0, C.tree, 1, C.tree2, 3, C.pine, 4, C.leaf, C.trunk]];

// ---- seasons, from today's date (?season=winter|spring|summer|autumn in the URL to preview one)
// spring 1 Mar - 31 May, summer 1 Jun - 21 Sep, autumn 22 Sep - 30 Nov, winter 1 Dec - end of Feb
export function season(d = new Date()) {
  const forced = new URLSearchParams(globalThis.location?.search).get("season");
  if (["winter", "spring", "summer", "autumn"].includes(forced)) return forced;
  const md = (d.getMonth() + 1) * 100 + d.getDate(); // e.g. 1108 = 8 November
  return md < 301 || md > 1130 ? "winter" : md < 601 ? "spring" : md < 922 ? "summer" : "autumn";
}

// ---- trees. OSM tiles have no single trees, so we plant a few: a fixed world grid, kept only where it falls
// in a park or wood and passes a sparse random draw (hash of the cell, so the same trees come back after a pan).
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = ([outer, ...holes], p) => inRing(p, outer) && !holes.some((h) => inRing(p, h));
// The random seed changes every week (weeks start on Monday; 1 Jan 1970 was a Thursday, hence + 3), so the trees
// rearrange once a week but stay put all week long, on every visit and every device.
const WEEK = Math.floor((Date.now() / 864e5 + 3) / 7);
const hash = (i, j) => { const x = Math.sin(i * 12.9898 + j * 78.233 + WEEK * 7.31) * 43758.5453; return x - Math.floor(x); };
const M = 111320; // metres per degree of latitude
// Fixed, not taken from the view: a grid that depends on the map centre moves on every pan and the trees jump.
// shortcut: right for Zurich (the map is locked there); elsewhere the spacing would drift a bit.
const K = Math.cos((47.38 * Math.PI) / 180);
const circle = ([lon, lat], r, k, rot = 0) => [Array.from({ length: 13 }, (_, a) => // 12 sides: reads as round
  [lon + (r * Math.cos(rot + (a * Math.PI) / 6)) / (M * k), lat + (r * Math.sin(rot + (a * Math.PI) / 6)) / M])];

// Two kinds of tree, each a thin trunk plus stacked tiers:
// round (broadleaf): a crown that widens then closes, so it reads round from any angle;
// conifer: taller, narrowing in steps to a point, in a deeper green;
// sphere (feuillu): a ball of leaves, sliced so each slice's width follows a sphere, plus a smaller ball beside it.
function ball(at, R, z0, t, k, slices, rot, leaves) {
  return Array.from({ length: slices }, (_, n) => {
    const a = -1 + (2 * n) / slices, b = -1 + (2 * (n + 1)) / slices, mid = (a + b) / 2;
    return { type: "Feature", properties: { t, b: z0 + R * (1 + a), h: z0 + R * (1 + b), ...leaves },
      geometry: { type: "Polygon", coordinates: circle(at, R * Math.sqrt(1 - mid * mid), k, rot) } };
  });
}
// rot: the tree's own random turn (radians), so no two trees face the same way.
// leaves: extra properties for the crown only ({g, v} in autumn), never for the trunk.
function tree(p, s, kind, k, rot, leaves) {
  const part = (r, b, h, t, extra) => ({ type: "Feature", properties: { t, b, h, ...extra }, geometry: { type: "Polygon", coordinates: circle(p, r, k, rot) } });
  if (kind === "sphere") {
    const side = [p[0] + (1.8 * s * Math.cos(rot)) / (M * k), p[1] + (1.8 * s * Math.sin(rot)) / M]; // the second ball, on a random side
    return [part(0.35, 0, 3.5 * s, 2), ...ball(p, 2.8 * s, 2.6 * s, 4, k, 6, rot, leaves), ...ball(side, 1.7 * s, 2.4 * s, 4, k, 4, rot, leaves)];
  }
  if (kind === "pine") return [part(0.3, 0, 2 * s, 2), part(2.2 * s, 1.8 * s, 4.6 * s, 3), part(1.6 * s, 4.6 * s, 7 * s, 3),
    part(1 * s, 7 * s, 9.2 * s, 3), part(0.45 * s, 9.2 * s, 11 * s, 3)];
  const shade = kind === "round" ? 0 : 1;
  return [part(0.35, 0, 3 * s, 2), part(2.6 * s, 2.4 * s, 5.2 * s, shade, leaves), part(2.1 * s, 5.2 * s, 7 * s, shade, leaves),
    part(1.2 * s, 7 * s, 8.2 * s, shade, leaves)];
}

// Autumn colour of a broadleaf at p: big patches of one colour (smooth noise over ~70 m), each tree its own
// shade, and about 1 tree in 7 breaking from its patch, as in a real park.
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
  const a = hash(i, j + 1000), b = hash(i + 1, j + 1000), c = hash(i, j + 1001), d = hash(i + 1, j + 1001);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function autumnLeaves(p, i, j) {
  const n = noise((p[0] * M * K) / 70, (p[1] * M) / 70);
  // 0 yellow, 1 orange, 2 red. Orange takes the wide middle of the noise (most common), yellow the low end,
  // red only the high tail (rarest), so red stays a few small patches.
  let g = n < 0.4 ? 0 : n < 0.76 ? 1 : 2;
  if (hash(i - 13, j + 29) < 0.15) { const r = hash(i + 31, j - 17); g = r < 0.5 ? 1 : r < 0.85 ? 0 : 2; } // the odd one out
  return { g, v: hash(i + 3, j + 41) };
}
// Spring: most broadleaves in fresh green, with blossoming trees in small groups (~50 m patches) and the odd
// lone one; pink and rose mixed within a group.
function springLeaves(p, i, j) {
  const n = noise((p[0] * M * K) / 50 + 300, (p[1] * M) / 50 + 300);
  if (n < 0.68 && hash(i - 13, j + 29) > 0.06) return undefined;
  return { g: hash(i + 31, j - 17) < 0.6 ? 4 : 5, v: hash(i + 3, j + 41) };
}
const LEAVES = { autumn: autumnLeaves, spring: springLeaves, winter: (p, i, j) => ({ g: 3, v: hash(i + 3, j + 41) }) };

export function plantTrees(map) {
  const leavesOf = LEAVES[season()]; // undefined in summer: all green
  const plant = () => {
    if (map.getZoom() < 14.5) return;
    // far out: only half the trees, always the same half, so zooming in only adds trees, never moves them
    const thin = map.getZoom() < 15.5 ? 0.5 : 1;
    const v = map.getBounds(), k = K;
    const seen = new Set(), out = [];
    for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "landcover" })) {
      const wood = f.properties.class === "wood";
      if (!wood && !["park", "garden", "village_green"].includes(f.properties.subclass)) continue;
      // step: metres between candidate spots; keep: share of them that get a tree where the clump pattern is densest
      const step = wood ? 12 : 14, keep = wood ? 0.65 : 0.5;
      const sLat = step / M, sLon = step / (M * k);
      const ps = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
      for (const poly of ps) {
        const xs = poly[0].map((q) => q[0]), ys = poly[0].map((q) => q[1]);
        const x0 = Math.max(Math.min(...xs), v.getWest()), x1 = Math.min(Math.max(...xs), v.getEast());
        const y0 = Math.max(Math.min(...ys), v.getSouth()), y1 = Math.min(Math.max(...ys), v.getNorth());
        for (let i = Math.floor(x0 / sLon); i * sLon <= x1 && seen.size < 4000; i++) // shortcut: at most 4000 trees in view
          for (let j = Math.floor(y0 / sLat); j * sLat <= y1; j++) {
            const key = `${step}:${i}:${j}`, r1 = hash(i, j), r2 = hash(j, i);
            // clumps: a smooth pattern (~30 m, small enough that even a small park gets both dense and open spots)
            // sets the density; open spots keep a floor (parks a quarter, woods a third) so no area goes bare
            const c = Math.min(1, Math.max(0, (noise(((i + 0.5) * step) / 30 + 500, ((j + 0.5) * step) / 30 + 500) - 0.3) / 0.4)) ** 1.5;
            const chance = keep * (wood ? 0.35 + 0.65 * c : 0.25 + 0.75 * c);
            if (seen.has(key) || r1 > chance * thin) continue;
            const p = [(i + 0.2 + 0.6 * r2) * sLon, (j + 0.2 + 0.6 * (r1 / chance)) * sLat];
            if (!inPoly(poly, p)) continue;
            seen.add(key);
            // the mix: woods half conifers, a third feuillus; parks a quarter conifers, 40 % feuillus
            const r3 = hash(i + 7, j - 3), [pine, sphere] = wood ? [0.5, 0.8] : [0.25, 0.65];
            const kind = r3 < pine ? "pine" : r3 < sphere ? "sphere" : r2 < 0.5 ? "round" : "round2";
            const leaves = leavesOf && kind !== "pine" ? leavesOf(p, i, j) : undefined; // conifers stay green
            // size: its own random draw, 0.6x to 1.7x, mostly small and medium with the odd big one
            const size = 0.6 + 1.1 * hash(i + 19, j + 23) ** 1.6;
            out.push(...tree(p, size, kind, k, 2 * Math.PI * hash(j + 11, i + 5), leaves));
          }
      }
    }
    const sig = [...seen].join();
    if (sig !== last) { last = sig; map.getSource("trees")?.setData({ type: "FeatureCollection", features: out }); }
  };
  let last = "";
  // The signature check stops setData -> render -> idle from looping.
  onTiles(map, plant);
}

// Runs fn as tiles arrive (batched, so the centre shows before the horizon has loaded) and once all is
// loaded ("idle", which also covers zooming in past the tiles' last level, when no new tile comes).
// ("moveend" comes too early: it left areas bare.)
export function onTiles(map, fn) {
  let t;
  map.on("sourcedata", (e) => { if (e.sourceId === "openmaptiles" && e.tile) { clearTimeout(t); t = setTimeout(fn, 200); } });
  map.on("idle", fn);
}
