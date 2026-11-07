// Pure helpers, no DOM. Tested by scripts/test_logic.mjs.

// Building centroids, taken from the Google Maps links on ethz.ch/en/utils/location.html.
export const BUILDINGS = {
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

export const campusOf = (building) => {
  const c = BUILDINGS[building];
  return c && c[0] > 47.4 ? "Hönggerberg" : "Zentrum";
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

// busy: [[isoFrom, isoTo], ...] in local time. Returns {free, until: Date|null, nextFree: Date|null}.
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
  const next = iv.find(([a]) => a > now);
  return { free: true, until: next && next[0] < dayEnd ? next[0] : dayEnd, nextFree: null };
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

// ETH's own `isOpen` flag is unreliable, so read the published hours instead.
// Lines look like "Mon - Fri: 06.00 - 22.00", "Sat: Closed", "Meal time: Mon - Fri: 11.00 - 14.00".
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS_RE = /^(Meal time:\s*)?([A-Z][a-z]{2})(?:\s*-\s*([A-Z][a-z]{2}))?:\s*(?:Closed|(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2}))$/;
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Returns {open: true|false|null (unknown), today: "08:00–17:00"|"Closed"|null, meal: [from,to] mins|null, mealNow}.
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
    open, mealNow, meal,
    today: Array.isArray(today) ? `${fmtMin(today[0])}–${fmtMin(today[1])}` : today === "closed" ? "Closed" : null,
    mealText: meal && `${fmtMin(meal[0])}–${fmtMin(meal[1])}`,
  };
}

export const occupancyLevel = (pct) =>
  pct == null ? "unknown" : pct < 50 ? "low" : pct < 80 ? "medium" : "high";

export const hhmm = (d) => d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
