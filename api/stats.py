"""Private, cookie-free visitor statistics for PolyUni Room Finder (ported from Poly+Uni Agenda's submit/stats.py).

The page sends small anonymous "hits" (page view, search, filter, click). Only daily totals are kept:
no IP address, no cookie, no cross-day identifier. A visitor is counted once per day through a hash of
(IP, browser, a random salt that is thrown away every day).

Storage: stats.json in STATS_DIR  →  {"days": {"2026-10-09": {"views": 12, "visitors": 7, "ref": {...}, ...}}}
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import secrets
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

KEEP_DAYS = 400
MAX_KEYS = 400  # distinct values kept per list per day (stops anyone from bloating the file)
BOT = re.compile(
    r"bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|telegram|"
    r"discord|slack|curl|wget|python|go-http|java/|monitor|uptime",
    re.I,
)
ACTIONS = {
    "tab_rooms": "Opened Free rooms",
    "tab_spaces": "Opened Study spaces",
    "locate": "Used Near me",
    "locate_no": "Location refused or failed",
    "day": "Picked another day",
    "time": "Picked a time",
    "directions": "Opened directions",
    "floorplan": "Opened a floor plan",
    "info": "Opened a UZH library page",
    "uni_eth": "Switched to ETH",
    "uni_uzh": "Switched to UZH",
    "uni_both": "Switched to ETH + UZH",
    "schedule": "Opened a room's schedule",
    "home_open": "Opened from home screen",
    "a2hs_no": "Closed the home-screen hint",
    "installed": "Added to home screen",
}
# first visit of the day: when this browser was last here (the page keeps only that date, on the phone)
RETURNS = {"new": "First visit ever", "week": "Back within a week", "older": "Back after more than a week"}
COUNTERS = ("ref", "search", "filter", "click", "building", "action", "device", "hour", "campaign", "lang", "return")


class Stats:
    """Visit counters per day, kept in memory and written to stats.json every 20 seconds. Nothing personal is
    stored: a visitor is recognised for one day only, through a hash with a salt that changes at midnight."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self._flush_lock = threading.Lock()  # one file writer at a time (timer, stats page, shutdown)
        self.dirty = False
        try:
            self.data = json.loads(path.read_text()) if path.exists() else {}
        except json.JSONDecodeError:
            self.data = {}
        self.data.setdefault("days", {})
        self._salt_day, self._salt, self._seen = "", "", set()
        threading.Thread(target=self._flusher, daemon=True).start()

    # ------------------------------------------------------------ writing
    def _today(self) -> dict:
        """Today's counters. On a new day: a new salt, yesterday's visitors forgotten, days older than
        KEEP_DAYS dropped."""
        today = date.today().isoformat()
        if self._salt_day != today:  # new day: new salt, forget who was seen
            self._salt_day, self._salt, self._seen = today, secrets.token_hex(16), set()
            cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
            for d in [d for d in self.data["days"] if d < cutoff]:
                del self.data["days"][d]
        return self.data["days"].setdefault(today, {"views": 0, "visitors": 0})

    @staticmethod
    def _bump(day: dict, group: str, key: str, n: int = 1) -> None:
        """Add `n` to counter `key` of a group ("search", "click" …). A group stops taking new keys at MAX_KEYS."""
        key = re.sub(r"\s+", " ", str(key)).strip()[:80]
        if not key:
            return
        g = day.setdefault(group, {})
        if key in g or len(g) < MAX_KEYS:
            g[key] = g.get(key, 0) + n

    def hit(self, ip: str, ua: str, h: dict) -> None:
        """Count one message from the page: a view (and whether it is a new visitor today, from where, on what
        device), a search, a click, a filter or an action. Bots are ignored."""
        if not ua or BOT.search(ua):
            return
        kind = str(h.get("t", ""))[:20]
        with self.lock:
            day = self._today()
            if kind == "view":
                day["views"] += 1
                vid = hashlib.sha256(f"{self._salt}|{ip}|{ua}".encode()).hexdigest()[:16]
                if vid not in self._seen:
                    self._seen.add(vid)
                    day["visitors"] += 1
                    self._bump(day, "device", _device(ua))
                    self._bump(day, "hour", f"{datetime.now().hour:02d}")
                    self._bump(day, "lang", str(h.get("lang", ""))[:2].lower() or "?")
                    self._bump(day, "ref", _ref(h.get("ref", "")))
                    if h.get("ret") in RETURNS:
                        self._bump(day, "return", RETURNS[h["ret"]])
                    if h.get("utm"):
                        self._bump(day, "campaign", str(h["utm"])[:40].lower())
            elif kind == "search":
                self._bump(day, "search", str(h.get("q", "")).lower()[:60])
            elif kind == "filter":
                for f in (h.get("on") or [])[:12]:
                    self._bump(day, "filter", f)
            elif kind == "click":  # directions or floor plan of one place
                self._bump(day, "click", h.get("title", ""))
                self._bump(day, "building", h.get("building", ""))
                if h.get("how") in ("directions", "floorplan", "info"):
                    self._bump(day, "action", ACTIONS[h["how"]])
            elif kind in ACTIONS:
                self._bump(day, "action", ACTIONS[kind])
            else:
                return
            self.dirty = True

    def _flusher(self) -> None:
        """Background thread: write to disk every 20 seconds."""
        while True:
            time.sleep(20)
            self.flush()

    def flush(self) -> None:
        """Write the counters to disk if they changed."""
        with self._flush_lock:
            with self.lock:  # only the snapshot holds up visitors' hits, not the disk write
                if not self.dirty:
                    return
                text = json.dumps(self.data, ensure_ascii=False, separators=(",", ":"))
                self.dirty = False
            try:
                tmp = self.path.with_name(self.path.name + ".tmp")  # temp file + rename: never half a file
                tmp.write_text(text)
                tmp.replace(self.path)
            except OSError:
                self.dirty = True  # try again at the next flush

    # ------------------------------------------------------------ reading
    def summary(self, days: int, now: datetime | None = None) -> dict:
        """Totals for the last `days` days (today included). The trend compares them with the `days` before,
        cut at the same time of day: today isn't over yet, so its counterpart only counts up to this hour."""
        now = now or datetime.now()
        keys = [(now.date() - timedelta(days=i)).isoformat() for i in range(2 * days)]  # newest first
        live = date.today().isoformat()
        with self.lock:  # a snapshot; only today's counters still change, so only today is copied
            snap = [self.data["days"].get(k, {}) for k in keys]
            snap = [copy.deepcopy(d) if k == live else d for k, d in zip(keys, snap)]
        per_day = list(zip(keys[:days], snap[:days]))[::-1]  # oldest first
        prev = snap[days:]  # the `days` before; prev[0] is today's counterpart
        yesterday = snap[1]
        tot = {g: Counter() for g in COUNTERS}
        for _, d in per_day:
            for g in COUNTERS:
                tot[g].update(d.get(g, {}))
        return {
            "days": [(d, x.get("visitors", 0), x.get("views", 0)) for d, x in per_day],
            "visitors": sum(x.get("visitors", 0) for _, x in per_day),
            "views": sum(x.get("views", 0) for _, x in per_day),
            "prev_visitors": _so_far(prev[0], now) + sum(x.get("visitors", 0) for x in prev[1:]),
            "today": per_day[-1][1].get("visitors", 0),
            "yesterday_so_far": _so_far(yesterday, now),
            **{g: tot[g].most_common() for g in COUNTERS},
        }


def _so_far(day: dict, now: datetime) -> float:
    """A past day's visitors up to the time of day `now` shows, from its first-visit counts per hour."""
    hours = day.get("hour") or {}
    minutes = now.hour * 60 + now.minute
    if not sum(hours.values()):  # no hourly detail: assume an even spread over the day
        return day.get("visitors", 0) * minutes / 1440
    return sum(v for h, v in hours.items() if int(h) < now.hour) + hours.get(f"{now.hour:02d}", 0) * now.minute / 60


def _device(ua: str) -> str:
    if re.search(r"Mobi|iPhone|Android", ua):
        return "Phone"
    return "Tablet" if re.search(r"iPad|Tablet", ua) else "Computer"


def _ref(ref: str) -> str:
    """Where the visitor came from, as a readable name."""
    ref = str(ref or "")
    if re.match(r"(android|ios)-app:", ref, re.I):  # opened inside an app, e.g. android-app://com.reddit.frontpage/
        app = ref.split("//", 1)[-1].split("/")[0].lower()
        for pat, name in (
            (r"reddit", "Reddit"),
            (r"instagram", "Instagram"),
            (r"whatsapp", "WhatsApp"),
            (r"facebook|katana", "Facebook"),
            (r"linkedin", "LinkedIn"),
            (r"telegram", "Telegram"),
            (r"discord", "Discord"),
            (r"android\.gm$", "Gmail"),
            (r"google", "Google"),
            (r"twitter", "X / Twitter"),
            (r"slack", "Slack"),
        ):
            if re.search(pat, app):
                return name
        return f"App: {app[:40]}" if app and ":" not in app else "Android/iOS app (unknown)"
    host = re.sub(r"^https?://", "", ref).split("/")[0].lower().removeprefix("www.").removeprefix("m.")
    if not host:
        return "Direct / app"
    for pat, name in (
        (r"google\.", "Google"),
        (r"instagram|^l\.instagram", "Instagram"),
        (r"bing\.", "Bing"),
        (r"duckduckgo", "DuckDuckGo"),
        (r"facebook|fb\.", "Facebook"),
        (r"linkedin|lnkd", "LinkedIn"),
        (r"t\.co$|twitter|x\.com", "X / Twitter"),
        (r"reddit", "Reddit"),
        (r"whatsapp", "WhatsApp"),
        (r"telegram|t\.me", "Telegram"),
        (r"ethz\.ch", "ethz.ch"),
        (r"uzh\.ch", "uzh.ch"),
        (r"chatgpt|openai", "ChatGPT"),
        (r"claude\.ai", "Claude"),
        (r"perplexity", "Perplexity"),
    ):
        if re.search(pat, host):
            return name
    return host[:60]
