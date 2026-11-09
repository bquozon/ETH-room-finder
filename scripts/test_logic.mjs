// node scripts/test_logic.mjs
import assert from "node:assert/strict";
import { distance, roomStatus, dayTimeline, occupancyLevel, campusOf, formatDistance, openingStatus, shortStay, daySchedule, uniOf, roomTitle, placeOrder } from "../site/logic.js";

// HG -> CAB is ~220 m
const d = distance([47.37642, 8.547995], [47.37837, 8.548801]);
assert.ok(d > 200 && d < 240, `HG-CAB ${d}`);
assert.equal(campusOf("HG"), "Zentrum");
assert.equal(campusOf("HCI"), "Hönggerberg");
assert.deepEqual(["KOL", "Y15", "TFA", "BIN", "AFL", "ZB", "BOT", "nope"].map(campusOf),
  ["Zentrum", "Irchel", "Irchel", "Oerlikon", "Oerlikon", "Zentrum", "Zentrum", "Zentrum"]);
assert.equal(uniOf("HG"), "eth"); assert.equal(uniOf("KOL"), "uzh");
assert.equal(roomTitle({ building: "HG", floor: "E", room: "5" }), "HG E 5");
assert.equal(roomTitle({ uni: "uzh", building: "KOL", floor: "F", room: "101" }), "KOL-F-101");
assert.equal(formatDistance(220), "220 m · 4 min walk");

const at = (h, m = 0) => new Date(2026, 10, 9, h, m); // Monday
const busy = [
  ["2026-11-09T10:15:00", "2026-11-09T12:00:00"],
  ["2026-11-09T12:00:00", "2026-11-09T13:00:00"], // back-to-back
  ["2026-11-09T15:00:00", "2026-11-09T16:00:00"],
];
let s = roomStatus(busy, at(9));
assert.equal(s.free, true); assert.equal(s.until.getHours(), 10); assert.equal(s.until.getMinutes(), 15);
s = roomStatus(busy, at(11));
assert.equal(s.free, false); assert.equal(s.nextFree.getHours(), 13);
s = roomStatus(busy, at(16, 30));
assert.equal(s.free, true); assert.equal(s.until.getHours(), 21);
assert.equal(s.next, null); // nothing booked before 21:00
assert.equal(roomStatus(busy, at(9)).next.getHours(), 10);
assert.equal(roomStatus(busy, at(22)).closed, true);
// Short stays: 10:15 booking seen at 10:05 is 10 min; with a 4-min walk, 6 min after arrival; at 9:00, fine.
assert.equal(shortStay(roomStatus(busy, at(10, 5)), at(10, 5)), 10);
assert.equal(shortStay(roomStatus(busy, at(10, 5)), at(10, 5), 4), 6);
assert.equal(shortStay(roomStatus(busy, at(10, 5)), at(10, 5), 15), -5);
assert.equal(shortStay(roomStatus(busy, at(9)), at(9)), null);
assert.equal(shortStay(roomStatus(busy, at(11)), at(11)), null); // booked now: nothing to warn about
assert.equal(roomStatus([["2026-11-09T00:00:00", "2026-11-09T23:59:00"]], at(12)).nextFree, null);

// Day schedule: gaps and bookings from 07 to 21, back-to-back bookings merged.
const hm = (d) => d.toTimeString().slice(0, 5);
assert.deepEqual(daySchedule(busy, at(9)).map(([a, b, x]) => `${hm(a)}-${hm(b)}${x ? "B" : ""}`),
  ["07:00-10:15", "10:15-13:00B", "13:00-15:00", "15:00-16:00B", "16:00-21:00"]);
assert.deepEqual(daySchedule([], at(9)).length, 1);
assert.equal(daySchedule([...busy, ["2026-11-10T08:00:00", "2026-11-10T09:00:00"]], at(9)).length, 5); // other days ignored
assert.deepEqual(daySchedule([["2026-11-09T06:00:00", "2026-11-09T08:00:00"], ["2026-11-09T07:30:00", "2026-11-09T09:00:00"]], at(9))
  .map(([a, b, x]) => `${hm(a)}-${hm(b)}${x ? "B" : ""}`), ["07:00-09:00B", "09:00-21:00"]);

const tl = dayTimeline(busy, at(9));
assert.equal(tl.length, 3);
assert.ok(Math.abs(tl[0][0] - 3.25 / 14) < 1e-9);

// Inside one building: tracked, then libraries, then small rooms; bigger first
const inHG = [
  { title: "HG J 60.0039", description: "Korridor HG J Nord", pct: null, seats: 10 },
  { title: "HG H 30.0059", description: "ETH-Bibliothek, Atrium Nord", pct: null, seats: 14 },
  { title: "HG E 20.0029", description: "Risalit HG E Nord", pct: null, seats: 30 },
  { title: "HG H 30.1", description: "ETH-Bibliothek, Lesesaal", pct: 80, seats: 100 },
  { title: "UB Law", description: "UZH library", pct: null, seats: 500 },
];
assert.deepEqual([...inHG].sort(placeOrder).map((s) => s.title), ["HG H 30.1", "UB Law", "HG H 30.0059", "HG E 20.0029", "HG J 60.0039"]);

assert.equal(occupancyLevel(null), "unknown");
assert.equal(occupancyLevel(40), "low");
assert.equal(occupancyLevel(90), "high");
// Opening hours. 2026-11-07 is a Saturday.
const lib = ["Sat - Sun: 08.00 - 17.00", "Mon - Fri: 08.00 - 22.00"];
assert.equal(openingStatus(lib, false, new Date(2026, 10, 7, 17, 21)).open, false); // the reported bug
assert.equal(openingStatus(lib, false, new Date(2026, 10, 7, 10)).open, true);
assert.equal(openingStatus(lib, false, new Date(2026, 10, 7, 10)).today, "08:00–17:00");
assert.equal(openingStatus(lib, false, at(21, 59)).open, true);
const cafe = ["Mon - Fri: 07.00 - 20.30", "Sat - Sun: Closed", "Meal time: Mon - Fri: 11.15 - 13.45", "24-hour access via ETH card"];
assert.equal(openingStatus(cafe, true, at(3)).open, true); // 24h card access
assert.equal(openingStatus(cafe, true, at(12)).open, false); // meal time
assert.equal(openingStatus(cafe, true, at(12)).mealNow, true);
assert.equal(openingStatus(cafe, false, new Date(2026, 10, 8, 12)).today, "Closed");
assert.equal(openingStatus(["Sun: 10.00 - 16.00"], false, at(12)).open, null); // no line for Monday
// Map seasons, from the date
const { season } = await import("../site/map-style.js");
const on = (m, d) => season(new Date(2026, m - 1, d));
assert.deepEqual([on(1, 15), on(2, 28), on(3, 1), on(5, 31), on(6, 1), on(9, 21), on(9, 22), on(11, 30), on(12, 1)],
  ["winter", "winter", "spring", "spring", "summer", "summer", "autumn", "autumn", "winter"]);
console.log("logic ok");
