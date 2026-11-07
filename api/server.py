"""ETH Room Finder's small API: anonymous visit statistics, the same as Poly+Uni Agenda's.

  POST /api/hit                 a hit from the page (see stats.py). Always 204.
  GET  /api/stats?days=30       the statistics page (password: Caddy's basic_auth, see deploy/docker-web/Caddyfile)
  GET  /api/stats?day=2026-11-07  one past day
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from datetime import date, datetime
from pathlib import Path

from flask import Flask, request
from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup

from .stats import Stats

DIR = Path(os.environ.get("STATS_DIR", "/data"))
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
HITS_PER_IP_PER_HOUR = 600

STATS = Stats(DIR / "stats.json")
app = Flask(__name__)
TEMPLATES = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=True, trim_blocks=True, lstrip_blocks=True
)
TEMPLATES.filters["thousands"] = "{:,}".format
TEMPLATES.globals.update(CSS=(Path(__file__).parent / "admin.css").read_text(), SITE_URL=SITE_URL)

_hits: dict[str, list[float]] = {}  # ip → stats hits in the last hour (memory only)
_hits_lock = threading.Lock()


def _ip() -> str:
    """The visitor's address, as set by our own Caddy from the real connection (never from X-Forwarded-For,
    whose left end the visitor can forge)."""
    return (request.headers.get("X-Real-IP") or request.remote_addr or "").strip()[:64]


@app.post("/api/hit")
def hit():
    """Anonymous statistics from the page. Always answers 204, even when the message is dropped."""
    raw, ip, now = request.get_data(), _ip(), time.time()
    if len(raw) > 2000:
        return "", 204
    with _hits_lock:
        recent = _hits[ip] = [t for t in _hits.get(ip, []) if now - t < 3600]
        if len(recent) >= HITS_PER_IP_PER_HOUR:
            return "", 204
        recent.append(now)
        if len(_hits) > 50_000:  # forget old entries now and then
            for k in [k for k, v in _hits.items() if now - v[-1] > 3600]:
                del _hits[k]
    try:
        d = json.loads(raw)
        if isinstance(d, dict):
            STATS.hit(ip, request.headers.get("User-Agent", ""), d)
    except Exception:
        pass
    return "", 204


@app.get("/api/stats")
def stats():
    try:
        day = date.fromisoformat(request.args["day"]) if request.args.get("day") else None
    except ValueError:
        day = None
    return stats_page(max(1, min(400, request.args.get("days", 30, type=int))), day)


def stats_page(days: int, day: date | None = None) -> str:
    """The last `days` days, or one past day (`day`, from a click on the chart): its whole day vs the day before."""
    STATS.flush()
    s = STATS.summary(1, now=datetime.combine(day, datetime.max.time())) if day else STATS.summary(days)

    def change(now: float, before: float, label: str) -> tuple[int, str] | None:
        return (round(100 * (now - before) / before), label) if before else None

    hours = dict(s["hour"])
    busiest = max([*hours.values(), 1])
    actions = dict(s["action"])
    return TEMPLATES.get_template("stats.html").render(
        title="Stats",
        s=s,
        days=days,
        day=day,
        visitors_change=change(
            s["visitors"],
            s["prev_visitors"],
            "the day before" if day else "yesterday" if days == 1 else f"the previous {days} days",
        ),
        today_change=change(s["today"], s["yesterday_so_far"], "yesterday"),
        near_me=actions.get("Used Near me", 0),
        opened=sum(n for _, n in s["click"]),
        chart=Markup(_daily_svg(s["days"])) if days > 1 and not day else "",
        hours=[
            (f"{h:02d}", hours.get(f"{h:02d}", 0), f"{100 * hours.get(f'{h:02d}', 0) / busiest:.0f}") for h in range(24)
        ],
    )


def _daily_svg(days) -> str:
    """The bar chart of visitors per day as SVG; days = [(date, visitors, views)]. Each column links to its day."""
    n, w, h, pad = len(days), 760, 170, 22
    top = max([v for _, v, _ in days] + [1])
    bw = (w - 30) / n
    bars, labels = [], []
    for i, (d, vis, views) in enumerate(days):
        x, bh = 30 + i * bw, (h - pad - 8) * vis / top
        bars.append(
            f'<a href="stats?day={d}"><rect x="{x}" y="0" width="{bw}" height="{h - pad}" fill="transparent"/>'
            f'<rect x="{x + bw * 0.15:.1f}" y="{h - pad - bh:.1f}" width="{bw * 0.7:.1f}" height="{max(bh, 0.5):.1f}" '
            f'rx="2" fill="var(--accent)"><title>{d}: {vis} visitors, {views} page views (click for that '
            f"day)</title></rect></a>"
        )
        if n <= 14 or i % max(1, n // 8) == 0 or i == n - 1:
            labels.append(
                f'<text class="lbl" x="{x + bw / 2:.1f}" y="{h - 6}" text-anchor="middle">{d[8:10]}.{d[5:7]}</text>'
            )
    grid = []
    for f in (0, 0.5, 1):
        y = h - pad - (h - pad - 8) * f
        grid.append(
            f'<line x1="30" x2="{w}" y1="{y:.1f}" y2="{y:.1f}" stroke="currentColor" stroke-opacity=".12"/>'
            f'<text class="lbl" x="24" y="{y + 3:.1f}" text-anchor="end">{round(top * f)}</text>'
        )
    return f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Visitors per day">{"".join(grid)}{"".join(bars)}{"".join(labels)}</svg>'


if __name__ == "__main__":
    from waitress import serve

    signal.signal(signal.SIGTERM, lambda *_: (STATS.flush(), sys.exit(0)))  # keep the last seconds of stats on restart
    serve(app, host="0.0.0.0", port=8790, threads=4)
