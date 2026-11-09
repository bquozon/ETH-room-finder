// Pure helpers, no DOM. Tested by scripts/test_logic.mjs.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const getJSON = (p) => fetch(p, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });

// UZH buildings with rooms or study spaces: UZH's own points (ziplaene-api.uzh.ch/v1/map/buildings); ZB from OSM.
export const UZH_BUILDINGS = {
  AFL: [47.410822, 8.540082], AND: [47.413167, 8.548717], BIM: [47.413811, 8.548754], BIN: [47.414532, 8.549137],
  BOT: [47.358897, 8.560108], C1R: [47.375399, 8.553557], FRE: [47.371025, 8.554153], GLT: [47.374916, 8.553074],
  HAH: [47.376102, 8.554057], KAB: [47.371471, 8.54857], KO2: [47.375194, 8.548007], KOH: [47.374271, 8.548243],
  KOL: [47.374544, 8.548613], KUM: [47.37492, 8.546629], PLD: [47.37322, 8.553648], PLM: [47.374176, 8.552626],
  RAA: [47.372056, 8.550049], RAI: [47.373305, 8.550802], RAK: [47.375321, 8.548866], SOC: [47.373999, 8.549605],
  SOD: [47.373036, 8.549289], SOE: [47.37353, 8.549235], SOF: [47.372851, 8.549755], TFA: [47.400915, 8.55163],
  Y03: [47.397245, 8.548948], Y04: [47.3972, 8.549348], Y10: [47.397854, 8.547568], Y13: [47.3976, 8.549122],
  Y14: [47.397428, 8.549523], Y15: [47.397538, 8.549988], Y16: [47.397368, 8.550265], Y17: [47.397197, 8.550544],
  Y21: [47.397138, 8.548216], Y22: [47.397126, 8.548607], Y23: [47.396749, 8.548742], Y24: [47.396781, 8.549234],
  Y27: [47.396697, 8.550141], Y35: [47.397937, 8.550145], Y44: [47.396168, 8.548743], Y63: [47.3955, 8.549948],
  KAA: [47.371137, 8.548295], KIR: [47.370205, 8.544529], PEA: [47.370801, 8.534326], PET: [47.372749, 8.555471],
  PLF: [47.37427, 8.553428], PLG: [47.37251, 8.554648], PLK: [47.372136, 8.55449], RAE: [47.371655, 8.550801],
  RAF: [47.3716, 8.55121], RAG: [47.371979, 8.551169], TEL: [47.373575, 8.551207], WIH: [47.388239, 8.547085],
  WIL: [47.370101, 8.554034], Y01: [47.397469, 8.548099], Y25: [47.396494, 8.549288], ZOA: [47.357767, 8.559665],
  ZUB: [47.372504, 8.551153],
  ZB: [47.3742527, 8.5453412],
};
export const uniOf = (building) => (building in UZH_BUILDINGS ? "uzh" : "eth");
// "HG E 5" at ETH, "KOL-F-101" at UZH: each the way its own university writes it
export const roomTitle = (r) => [r.building, r.floor, r.room].join(r.uni === "uzh" ? "-" : " ");

// ETH building centroids, taken from the Google Maps links on ethz.ch/en/utils/location.html.
export const BUILDINGS = {
  ...UZH_BUILDINGS,
  CAB: [47.37837, 8.548801], CHN: [47.379377, 8.548462], CLA: [47.377575, 8.546827],
  ETA: [47.377951, 8.553109], ETF: [47.377433, 8.552293], ETZ: [47.377666, 8.552768],
  GLC: [47.3775467, 8.5534081], HCI: [47.407528, 8.507715], HCP: [47.40629, 8.50745],
  HG: [47.37642, 8.547995], HIL: [47.408739, 8.506854], HIT: [47.410381, 8.508163],
  HPH: [47.407615, 8.50919], HPK: [47.409216, 8.510883], HPL: [47.409096, 8.5114],
  HPR: [47.408014, 8.509737], HPT: [47.408777, 8.508579], HPV: [47.407398, 8.510144],
  HWC: [47.40723, 8.505961], IFW: [47.380382, 8.544716], LEE: [47.3782378, 8.5457771],
  LFO: [47.377849, 8.550182], LFV: [47.377732, 8.549823], LFW: [47.377545, 8.549016],
  ML: [47.377945, 8.547755], NO: [47.378439, 8.547159], RZ: [47.380412, 8.545091],
};

// North of the city centre: Hönggerberg (west), Oerlikon, Irchel (incl. the Tierspital).
export const campusOf = (building) => {
  const [lat, lon] = BUILDINGS[building] ?? [0, 0];
  return lat > 47.405 ? (lon < 8.52 ? "Hönggerberg" : "Oerlikon") : lat > 47.39 ? "Irchel" : "Zentrum";
};

// Haversine distance in metres.
export function distance([lat1, lon1], [lat2, lon2]) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Paths are ~1.3x the straight line; walking ~80 m/min.
export const walkMinutes = (m) => Math.max(1, Math.round((m * 1.3) / 80));

export function formatDistance(m) {
  if (m == null) return "";
  const d = m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  return m > 3000 ? d : `${d} · ${walkMinutes(m)} min walk`;
}

const DAY_START = 7, DAY_END = 21; // teaching buildings are realistically usable 07–21

// busy: [[isoFrom, isoTo], ...] in local time. Returns {free, until: Date|null, next: Date|null, nextFree: Date|null}.
// free means no booking, not that nobody is in the room. next: start of the next booking today, if any.
export function roomStatus(busy, now = new Date()) {
  const dayEnd = new Date(now); dayEnd.setHours(DAY_END, 0, 0, 0);
  const h = now.getHours();
  if (h < DAY_START || h >= DAY_END) return { free: false, closed: true, until: null, nextFree: null };
  const iv = busy.map(([a, b]) => [new Date(a), new Date(b)]).sort((x, y) => x[0] - y[0]);
  const current = iv.find(([a, b]) => a <= now && now < b);
  if (current) {
    // Walk forward through back-to-back bookings to find when it really frees up.
    let end = current[1];
    for (const [a, b] of iv) if (a <= end && b > end) end = b;
    return { free: false, until: null, nextFree: end < dayEnd ? end : null };
  }
  const n = iv.find(([a]) => a > now), next = n && n[0] < dayEnd ? n[0] : null;
  return { free: true, until: next ?? dayEnd, next, nextFree: null };
}

// Minutes a free room stays free once you get there, when under SHORT_STAY; otherwise null.
const SHORT_STAY = 30;
export function shortStay(st, at, walk = 0) {
  if (!st.free) return null;
  const left = Math.round((st.until - at) / 6e4) - walk;
  return left < SHORT_STAY ? left : null;
}

// Today's bookings clipped to 07–21, as [startFraction, endFraction] for a timeline bar.
export function dayTimeline(busy, now = new Date()) {
  const s = new Date(now); s.setHours(DAY_START, 0, 0, 0);
  const span = (DAY_END - DAY_START) * 3600e3;
  return busy
    .map(([a, b]) => [(new Date(a) - s) / span, (new Date(b) - s) / span])
    .filter(([a, b]) => b > 0 && a < 1)
    .map(([a, b]) => [Math.max(0, a), Math.min(1, b)]);
}

// One day 07–21 as consecutive blocks [from, to, booked], overlapping bookings merged.
export function daySchedule(busy, day = new Date()) {
  const at = (h) => { const d = new Date(day); d.setHours(h, 0, 0, 0); return d; };
  const start = at(DAY_START), end = at(DAY_END), out = [];
  let t = start;
  for (const [a, b] of busy.map(([a, b]) => [new Date(a), new Date(b)]).sort((x, y) => x[0] - y[0])) {
    if (a >= end) break; // later days
    const from = a < start ? start : a, to = b > end ? end : b;
    if (to <= t) continue;
    if (from > t) out.push([t, from, false]);
    const last = out[out.length - 1];
    if (last?.[2] && from <= last[1]) last[1] = to; else out.push([from > t ? from : t, to, true]);
    t = to;
  }
  if (t < end) out.push([t, end, false]);
  return out;
}

// ETH's own `isOpen` flag is unreliable, so read the published hours instead.
// Lines look like "Mon - Fri: 06.00 - 22.00", "Sat: Closed", "Meal time: Mon - Fri: 11.00 - 14.00".
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS_RE = /^(Meal time:\s*)?([A-Z][a-z]{2})(?:\s*-\s*([A-Z][a-z]{2}))?:\s*(?:Closed|(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2}))$/;
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Returns {open: true|false|null (unknown), today: "08:00–17:00"|"Closed"|null, mealNow, mealText: "11:00–14:00"|null}.
export function openingStatus(hours, has24h, at = new Date()) {
  const day = at.getDay(), now = at.getHours() * 60 + at.getMinutes();
  let today, meal = null;
  for (const line of hours) {
    const x = line.trim().match(HOURS_RE);
    if (!x) continue;
    const a = DAYS.indexOf(x[2]), b = DAYS.indexOf(x[3] || x[2]);
    if (a < 0 || b < 0 || !(a <= b ? day >= a && day <= b : day >= a || day <= b)) continue;
    const span = x[4] ? [x[4] * 60 + +x[5], x[6] * 60 + +x[7]] : null;
    if (x[1]) meal = span; else today = span ?? "closed";
  }
  const within = (s) => Array.isArray(s) && now >= s[0] && now < s[1];
  const mealNow = within(meal); // cafeteria spaces are only for studying outside meal times
  const open = mealNow ? false : has24h ? true : today === undefined ? null : within(today);
  return {
    open, mealNow,
    today: Array.isArray(today) ? `${fmtMin(today[0])}–${fmtMin(today[1])}` : today === "closed" ? "Closed" : null,
    mealText: meal && `${fmtMin(meal[0])}–${fmtMin(meal[1])}`,
  };
}

export const occupancyLevel = (pct) =>
  pct == null ? "unknown" : pct < 50 ? "low" : pct < 80 ? "medium" : "high";

export const hhmm = (d) => d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
