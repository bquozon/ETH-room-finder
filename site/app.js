import { BUILDINGS, campusOf, distance, formatDistance, roomStatus, dayTimeline, occupancyLevel, hhmm, openingStatus, walkMinutes, shortStay } from "./logic.js";

const ETH = "https://ethz.ch";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---- anonymous visit statistics, the same as Poly+Uni Agenda (no cookies, see api/stats.py).
// Open the site once with ?notrack=1 to leave a device out (?notrack=0 to count it again).
const STATS = (() => {
  let off = location.protocol === "file:" || navigator.webdriver || navigator.doNotTrack === "1";
  const first = new URLSearchParams(location.search);
  const campaign = first.get("ref") || first.get("utm_source") || "";
  try {
    if (first.get("notrack") === "1") localStorage.setItem("rf.notrack", "1");
    if (first.get("notrack") === "0") localStorage.removeItem("rf.notrack");
    if (localStorage.getItem("rf.notrack") === "1") off = true;
  } catch {}
  const send = (d) => {
    if (off) return;
    try {
      const body = JSON.stringify(d);
      if (!(navigator.sendBeacon && navigator.sendBeacon("api/hit", new Blob([body], { type: "text/plain" }))))
        fetch("api/hit", { method: "POST", body, keepalive: true }).catch(() => {});
    } catch {}
  };
  let lastQ = "", qTimer;
  return {
    view() {
      const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : "";
      // new or returning: only the date of the last visit is kept, on this device; just the bucket is sent
      let ret = "new";
      try {
        const last = localStorage.getItem("rf.last"), today = new Date().toISOString().slice(0, 10);
        if (last) ret = (new Date(today) - new Date(last)) / 864e5 <= 7 ? "week" : "older";
        localStorage.setItem("rf.last", today);
      } catch { ret = ""; }
      send({ t: "view", ref, lang: navigator.language || "", utm: campaign, ret });
    },
    search(q) {
      clearTimeout(qTimer); q = q.trim().toLowerCase();
      if (q.length >= 2) qTimer = setTimeout(() => { if (q !== lastQ) { lastQ = q; send({ t: "search", q }); } }, 1800);
    },
    filter(name) { send({ t: "filter", on: [name] }); },
    click(how, title, building) { send({ t: "click", how, title, building }); },
    act(kind) { send({ t: kind }); },
  };
})();

const FILTERS = {
  spaces: [
    ["zentrum", "Zentrum", (s) => s.campus === "Zentrum"],
    ["hongg", "Hönggerberg", (s) => s.campus === "Hönggerberg"],
    ["open", "Open now", (s) => s.open.open === true],
    ["live", "Live data", (s) => s.pct != null],
    ["calm", "Not noisy", (s) => !s.keys.has("um.laut")],
    ["sockets", "Many sockets", (s) => s.keys.has("aus.stromviel")],
    ["food", "Food nearby", (s) => s.keys.has("food.mensa") || s.keys.has("food.cafeteria")],
  ],
  rooms: [
    ["zentrum", "Zentrum", (r) => r.campus === "Zentrum"],
    ["hongg", "Hönggerberg", (r) => r.campus === "Hönggerberg"],
    ["free", "Unbooked now", (r) => r.status.free],
    ["big", "50+ seats", (r) => r.seats >= 50],
  ],
};

const state = {
  tab: store.get("tab", "spaces"),
  on: store.get("filters", { spaces: [], rooms: ["free"] }),
  q: "",
  pos: null,       // [lat, lon] once located
  watch: null,
  day: 0,          // free rooms: days from today (0-6)
  time: "now",     // free rooms: "now" or "HH:MM"
  spaces: [], rooms: [], updated: null, roomsAt: null,
};

// The moment the free-rooms tab looks at.
function when() {
  const d = new Date();
  if (state.day === 0 && state.time === "now") return d;
  d.setDate(d.getDate() + state.day);
  const [h, m] = (state.time === "now" ? "08:00" : state.time).split(":");
  d.setHours(+h, +m, 0, 0);
  return d;
}
const isNow = () => state.day === 0 && state.time === "now";
function whenLabel() {
  if (isNow()) return "now";
  const day = state.day === 0 ? "today" : state.day === 1 ? "tomorrow" : when().toLocaleDateString("en-GB", { weekday: "short" });
  return `${day} ${hhmm(when())}`;
}

// "17:29", or "Fri 17:29" when it isn't from today, so stale data doesn't pass for fresh.
const stamp = (d) => d.toDateString() === new Date().toDateString() ? hhmm(d) : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(d)}`;

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// Spaces and rooms share one shape: title, building, campus, coord, seats, link (floor plan).
async function loadSpaces() {
  const [spaces, avail] = await Promise.all([getJSON("data/spaces.json"), getJSON("data/availability.json")]);
  const live = new Map(avail.data.map((a) => [a.id, a.attributes]));
  state.spaces = spaces.data.map(({ attributes: a }) => {
    const l = live.get(a.roomGlobalIdentifier) || {};
    const ok = l.status && l.status !== "unknown" && l.occupancyPercentage != null;
    const features = a.features || [];
    return {
      title: a.title, description: a.description, building: a.building,
      campus: campusOf(a.building), coord: BUILDINGS[a.building], seats: a.seats,
      link: a.locationPageUrl && ETH + a.locationPageUrl, img: a.image && ETH + a.image,
      has24h: !!a.has24HourAccess, hours: a.hours || [],
      features, keys: new Set(features.map((f) => f.key)),
      pct: ok ? l.occupancyPercentage : null, occupancy: l.occupancy, max: l.maxPeople, trend: ok ? l.trend : null,
      updated: ok && l.timestamp ? new Date(l.timestamp) : null,
    };
  });
  const times = state.spaces.map((s) => s.updated).filter(Boolean);
  state.updated = times.length ? new Date(Math.max(...times)) : null;
}

async function loadRooms() {
  const data = await getJSON("data/rooms.json");
  state.roomsAt = data.generated ? new Date(data.generated) : null;
  state.rooms = data.rooms.map((r) => ({
    ...r, title: `${r.building} ${r.floor} ${r.room}`, campus: campusOf(r.building), coord: BUILDINGS[r.building],
    seats: Number(r.seats) || 0,
    link: `${ETH}/en/utils/location.html?${new URLSearchParams({ building: r.building, floor: r.floor, room: r.room })}`,
  }));
}

// Spaces/rooms with distance attached, filtered and sorted for display.
function visible() {
  const now = new Date(), at = when();
  const list = state.tab === "spaces"
    ? state.spaces.map((s) => ({ ...s, open: openingStatus(s.hours, s.has24h, now) }))
    : state.rooms.map((r) => ({ ...r, status: roomStatus(r.busy, at) }));
  const active = FILTERS[state.tab].filter(([k]) => state.on[state.tab].includes(k));
  // Campus chips are alternatives (OR); the rest narrow down (AND).
  const campus = active.filter(([k]) => k === "zentrum" || k === "hongg");
  const rest = active.filter((f) => !campus.includes(f));
  const q = state.q.trim().toLowerCase();
  const items = list
    .filter((x) => !campus.length || campus.some(([, , f]) => f(x)))
    .filter((x) => rest.every(([, , f]) => f(x)))
    .filter((x) => !q || [x.title, x.description, x.building].some((s) => s && s.toLowerCase().includes(q)))
    .map((x) => ({ ...x, dist: state.pos && x.coord ? distance(state.pos, x.coord) : null }));

  const byDist = (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9);
  if (state.tab === "spaces") {
    // Near me: closest first, but nudge nearly-full places down so a 5-min-further empty one wins.
    const score = (s) => state.pos
      ? (s.dist ?? 1e9) + (s.pct >= 90 ? 600 : s.pct >= 75 ? 250 : 0) + (s.open.open === false ? 1e6 : 0)
      : (s.pct ?? 101) + (s.open.open === false ? 1000 : 0);
    items.sort((a, b) => score(a) - score(b));
  } else {
    const freeMins = (r) => (r.status.free ? (r.status.until - at) / 6e4 : -1);
    items.sort((a, b) => (b.status.free - a.status.free) || (state.pos ? byDist(a, b) : freeMins(b) - freeMins(a)));
  }
  return items;
}

// Distance, then floor plan and walking directions (data-how: counted by the stats).
function linksRow(x) {
  const link = (how, href, text) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener" data-how="${how}" data-title="${esc(x.title)}" data-building="${esc(x.building)}">${text}</a>`;
  const links = [
    x.link && link("floorplan", x.link, "Floor plan"),
    x.coord && link("directions", `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${x.coord}`, "Directions"),
  ].filter(Boolean);
  return `<div class="row"><span class="dist">${formatDistance(x.dist)}</span><span>${links.join(" · ")}</span></div>`;
}

function hoursLine(s) {
  const o = s.open;
  const badge = o.mealNow ? `<b class="medium">Mensa until ${o.mealText.split("–")[1]}</b>`
    : o.open === true ? `<b class="low">Open now</b>` : o.open === false ? `<b class="high">Closed now</b>` : "";
  const main = s.has24h ? "24/7 with ETH card" : o.today ? `today ${o.today}` : esc(s.hours[0] || "");
  const withoutCard = s.has24h && o.today && (o.today === "Closed" ? "card access only today" : `without card today ${o.today}`);
  const mensa = o.mealText && !o.mealNow && `mensa ${o.mealText}`;
  return [badge, main, withoutCard, mensa].filter(Boolean).join(" · ");
}

function spaceCard(s) {
  const lvl = occupancyLevel(s.pct);
  const trend = s.trend?.startsWith("incr") ? " ↑" : s.trend?.startsWith("decr") ? " ↓" : "";
  const feats = s.features.filter((f) => ["aus.stromviel", "um.ruhig", "um.laut", "food.mensa", "food.cafeteria", "work.gruppe", "aus.fenster"].includes(f.key));
  return `<article class="card ${s.img ? "has-img" : ""}">
    ${s.img ? `<img class="thumb" src="${esc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
    <div>
      <h2 class="title">${esc(s.title)}</h2>
      <p class="sub">${esc(s.description)}${s.description ? " · " : ""}${esc(s.campus)}${s.seats ? ` · ${s.seats} seats` : ""}</p>
      <p class="sub hours">${hoursLine(s)}</p>
    </div>
    <div class="side ${lvl}">
      ${s.pct == null
        ? `<div class="big unknown">—<small>no live data</small></div>`
        : `<div class="big">${s.pct}%${trend}<small>${s.occupancy ?? "?"} / ${s.max ?? "?"} people</small>${s.updated ? `<small>counted ${stamp(s.updated)}</small>` : ""}</div>`}
    </div>
    <div class="meter ${lvl}" role="img" aria-label="${s.pct == null ? "Occupancy unknown" : `${s.pct}% full`}"><i style="width:${s.pct ?? 0}%"></i></div>
    ${feats.length ? `<div class="feats">${feats.map((f) => `<span class="feat">${esc(f.label.replace(" | ", ": "))}</span>`).join("")}</div>` : ""}
    ${linksRow(s)}
  </article>`;
}

function roomCard(r) {
  const at = when();
  const st = r.status;
  // "Unbooked" on purpose: no booking says nothing about how many people are in the room.
  const [label, sub, lvl] = st.closed ? ["Closed", "outside 07–21", "unknown"]
    : st.free ? (st.next ? [hhmm(st.next), "unbooked · next booking", "unbooked"] : ["rest of day", "unbooked", "unbooked"])
    : st.nextFree ? [hhmm(st.nextFree), "booked until", "high"]
    : ["rest of day", "booked", "high"];
  // Nearest-first can put a room on top that gets booked minutes after you walk in: say so before you leave.
  const walk = isNow() && r.dist != null ? walkMinutes(r.dist) : 0;
  const left = shortStay(st, at, walk);
  const until = st.next ? `Booked at ${hhmm(st.next)}` : "Closes at 21:00";
  const warn = left == null ? ""
    : `<p class="sub warn">⚠ ${until}, ${left <= 0 ? "before you get there" : walk ? `${left} min after you arrive` : `only ${left} min unbooked`}</p>`;
  const nowFrac = (at.getHours() + at.getMinutes() / 60 - 7) / 14;
  return `<article class="card">
    <div>
      <h2 class="title">${esc(r.title)}</h2>
      <p class="sub">${esc(r.campus)}${r.seats ? ` · ${r.seats} seats` : ""}</p>
      ${warn}
    </div>
    <div class="side ${lvl}"><div class="big"><small>${sub}</small>${label}</div></div>
    <div class="timeline" role="img" aria-label="Bookings that day, 07:00 to 21:00">
      ${dayTimeline(r.busy, at).map(([a, b]) => `<i style="left:${a * 100}%;width:${(b - a) * 100}%"></i>`).join("")}
      ${nowFrac > 0 && nowFrac < 1 ? `<b style="left:${nowFrac * 100}%"></b>` : ""}
    </div>
    <div class="ticks"><span>07</span><span>10</span><span>13</span><span>16</span><span>19</span><span>21</span></div>
    ${linksRow(r)}
  </article>`;
}

function render() {
  for (const b of document.querySelectorAll("[role=tab]")) b.setAttribute("aria-selected", b.dataset.tab === state.tab);
  $("#list").setAttribute("aria-labelledby", `tab-${state.tab}`);
  $("#chips").innerHTML = FILTERS[state.tab].map(([k, label]) =>
    `<button class="chip" type="button" data-k="${k}" aria-pressed="${state.on[state.tab].includes(k)}">${k === "free" ? `Unbooked ${isNow() ? "now" : "then"}` : label}</button>`).join("");
  $("#when").hidden = state.tab !== "rooms";
  $("#maplink").href = `map.html#${state.tab}`; // the map opens on the same tab
  const items = visible();
  $("#list").innerHTML = items.length
    ? items.map(state.tab === "spaces" ? spaceCard : roomCard).join("")
    : `<p class="empty">${state.tab === "rooms" && state.on.rooms.includes("free")
      ? `No teaching room is unbooked ${whenLabel()}. They're closed on weekends and evenings.<br>Pick another day or time, or turn off “Unbooked”.`
      : "Nothing matches. Try removing a filter."}</p>`;
  $("#list").setAttribute("aria-busy", "false");
  $("#updated").textContent = state.tab === "spaces"
    ? (state.updated ? `Live occupancy · updated ${hhmm(state.updated)}` : "Live occupancy")
    : `Bookings, not headcounts${state.roomsAt ? ` · checked ${stamp(state.roomsAt)}` : ""} · ${state.rooms.filter((r) => roomStatus(r.busy, when()).free).length} unbooked ${whenLabel()}`;
}

function locate(on) {
  const btn = $("#locate"), msg = $("#locmsg");
  if (!on) {
    if (state.watch != null) navigator.geolocation.clearWatch(state.watch);
    Object.assign(state, { watch: null, pos: null });
    btn.setAttribute("aria-pressed", "false"); msg.hidden = true; store.set("locate", false); render();
    return;
  }
  if (!navigator.geolocation) { msg.textContent = "Your browser can't share location."; msg.hidden = false; return; }
  btn.dataset.busy = "";
  state.watch = navigator.geolocation.watchPosition(
    (p) => {
      delete btn.dataset.busy;
      state.pos = [p.coords.latitude, p.coords.longitude];
      if (btn.getAttribute("aria-pressed") !== "true") STATS.act("locate"); // once per switch-on, not per GPS update
      btn.setAttribute("aria-pressed", "true"); store.set("locate", true);
      msg.hidden = true; render();
    },
    (e) => {
      delete btn.dataset.busy;
      locate(false);
      STATS.act("locate_no");
      msg.textContent = e.code === 1 ? "Location blocked. Allow it in your browser settings to sort by distance." : "Couldn't get your location. Try again.";
      msg.hidden = false;
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
  );
}

function bind() {
  $(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    if (state.tab !== t.dataset.tab) STATS.act(`tab_${t.dataset.tab}`);
    state.tab = t.dataset.tab; store.set("tab", state.tab); render();
  });
  $("#chips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-k]"); if (!c) return;
    const on = state.on[state.tab], k = c.dataset.k;
    if (!on.includes(k)) STATS.filter(`${state.tab === "spaces" ? "Study spaces" : "Free rooms"}: ${c.textContent}`);
    state.on[state.tab] = on.includes(k) ? on.filter((x) => x !== k) : [...on, k];
    store.set("filters", state.on); render();
  });
  const day = $("#day"), time = $("#time");
  day.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    const name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "long" });
    return `<option value="${i}">${name}, ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</option>`;
  }).join("");
  const slots = Array.from({ length: 28 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  const fillTimes = () => {
    if (state.day !== 0 && state.time === "now") state.time = "08:00";
    time.innerHTML = (state.day === 0 ? [["now", "Now"]] : []).concat(slots.map((t) => [t, t]))
      .map(([v, l]) => `<option value="${v}"${v === state.time ? " selected" : ""}>${l}</option>`).join("");
  };
  fillTimes();
  day.addEventListener("change", () => { state.day = +day.value; fillTimes(); render(); STATS.act("day"); });
  time.addEventListener("change", () => { state.time = time.value; render(); STATS.act("time"); });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; render(); STATS.search(state.q); });
  $("#list").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-how]");
    if (a) STATS.click(a.dataset.how, a.dataset.title, a.dataset.building);
  });
  $("#locate").addEventListener("click", () => locate(state.watch == null));
}

// "Add to home screen", as on Poly+Uni Agenda: phones only, from the first visit, until closed.
// Android: the browser's own install dialog; iPhone: how to do it (Safari has no button for it).
function setupInstall() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return STATS.act("home_open");
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua);
  if (!/Android|iPhone|iPad|iPod/.test(ua) || /Instagram|FBAN|FBAV|Line\//.test(ua)) return; // in-app browsers can't add
  if (store.get("a2hs", "") === "no") return;
  const bar = $("#a2hs"), never = () => store.set("a2hs", "no");
  const show = () => setTimeout(() => { bar.hidden = false; }, 8000);
  $("#a2hsX").addEventListener("click", () => { bar.hidden = true; never(); STATS.act("a2hs_no"); });
  window.addEventListener("appinstalled", () => { bar.hidden = true; never(); STATS.act("installed"); });
  if (ios) {
    $("#a2hsText").innerHTML = 'Add Room Finder to your home screen: tap Share <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M8.5 6.5 12 3l3.5 3.5M8 10H6v10h12V10h-2"/></svg>, then “Add to Home Screen”.';
    return show();
  }
  window.addEventListener("beforeinstallprompt", (ev) => { // Chrome/Edge/Samsung on Android: one-tap install
    ev.preventDefault();
    $("#a2hsText").textContent = "Add Room Finder to your home screen: one tap to find a free spot.";
    $("#a2hsAdd").hidden = false;
    $("#a2hsAdd").onclick = () => { bar.hidden = true; ev.prompt(); };
    show();
  });
}

async function main() {
  setupInstall(); // first: Android fires its event early
  bind();
  STATS.view();
  try {
    await Promise.all([loadSpaces(), loadRooms()]);
  } catch (e) {
    $("#list").innerHTML = `<p class="empty">Couldn't load data. Please reload.</p>`;
    console.error(e);
    return;
  }
  render();
  // Resume "near me" without a prompt if the user already granted it.
  if (store.get("locate", false)) {
    const p = await navigator.permissions?.query({ name: "geolocation" }).catch(() => null);
    if (p?.state === "granted") locate(true);
  }
  setInterval(async () => { try { await loadSpaces(); render(); } catch {} }, 60000);
}

main();
