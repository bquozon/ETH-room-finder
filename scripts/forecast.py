"""Record study-space occupancy and build the forecast (site/data/forecast.json). Run by fetch_live.sh every 10 minutes.

record: one line per run in site/data/.history/YYYY-MM-DD.jsonl, {"t": "HH:MM", "p": {id: pct}}, from the files
        fetch_live.sh just wrote (no extra request to ETH/UZH). The leading dot keeps it off the website (Caddyfile).
build:  for every space, weekday and half hour, a weighted average of past days, newest counting most:
        - once a space has MIN_SAME_WEEKDAY past Mondays, a Monday is predicted from Mondays only;
        - before that, from all past weekdays (or weekend days, for Sat/Sun);
        - each day weighs 0.5 ** (age in days / HALF_LIFE), so last week counts double the week before;
        - days in special_days.txt (holidays, breaks) are left out.
Writes {"generated", "slot": 30, "spaces": {id: {"days": [Mon..Sun: [48 pct|null]], "basis": [Mon..Sun: "weekday"|"days"|null],
"n": [Mon..Sun: past days used]}}}. Ids: ETH roomGlobalIdentifier, "uzh:" + title for UZH.
"""
import datetime as dt
import json
import sys
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

ZH = ZoneInfo("Europe/Zurich")
DATA = Path(__file__).resolve().parent.parent / "site" / "data"
SPECIAL = Path(__file__).resolve().parent / "special_days.txt"
SLOT = 30  # minutes
WEEKS = 8  # older days weigh < 0.5 ** 8 anyway
HALF_LIFE = 7  # days
MIN_SAME_WEEKDAY = 3
STALE = dt.timedelta(minutes=15)


def special_days(text):
    """Dates from lines "2026-12-24 2027-01-03 Christmas" (a range) or "2027-05-06 Ascension"; # starts a comment."""
    out = set()
    for line in text.splitlines():
        parts = line.split("#")[0].split()
        if not parts:
            continue
        a = dt.date.fromisoformat(parts[0])
        try:
            b = dt.date.fromisoformat(parts[1])
        except (IndexError, ValueError):
            b = a
        out |= {a + dt.timedelta(d) for d in range((b - a).days + 1)}
    return out


def sample(now):
    """{id: pct} of the spaces with a fresh count."""
    p = {}
    try:
        for a in json.loads((DATA / "availability.json").read_text())["data"]:
            a = a["attributes"]
            ts = a.get("timestamp")
            if a.get("status") not in (None, "unknown") and a.get("occupancyPercentage") is not None and ts \
                    and now - dt.datetime.fromisoformat(ts) < STALE:
                p[a["roomGlobalIdentifier"]] = a["occupancyPercentage"]
    except (OSError, ValueError, KeyError) as e:
        print(f"ETH occupancy unreadable: {e}", file=sys.stderr)
    try:
        uzh = json.loads((DATA / "uzh_spaces.json").read_text())
        if now - dt.datetime.fromisoformat(uzh["generated"]) < STALE:
            p.update({"uzh:" + s["title"]: s["pct"] for s in uzh["spaces"] if s["pct"] is not None})
    except (OSError, ValueError, KeyError) as e:
        print(f"UZH occupancy unreadable: {e}", file=sys.stderr)
    return p


def record(now, history):
    p = sample(now)
    if p:
        history.mkdir(exist_ok=True)
        with (history / f"{now:%Y-%m-%d}.jsonl").open("a") as f:
            f.write(json.dumps({"t": f"{now:%H:%M}", "p": p}) + "\n")


def load(history, today, skip):
    """{(id, date): {slot: mean pct}} for the last WEEKS weeks, special days left out."""
    sums = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for i in range(WEEKS * 7 + 1):
        day = today - dt.timedelta(i)
        f = history / f"{day}.jsonl"
        if day in skip or not f.exists():
            continue
        for line in f.read_text().splitlines():
            try:
                r = json.loads(line)
                h, m = map(int, r["t"].split(":"))
            except ValueError:
                continue  # a line cut off by a crash
            for k, v in r["p"].items():
                s = sums[(k, day)][(h * 60 + m) // SLOT]
                s[0] += v
                s[1] += 1
    return {key: {slot: t / n for slot, (t, n) in slots.items()} for key, slots in sums.items()}


def build(days, today):
    """days: {(id, date): {slot: pct}} → the "spaces" part of forecast.json."""
    by_space = defaultdict(dict)
    for (k, day), slots in days.items():
        by_space[k][day] = slots
    out = {}
    for k, past in by_space.items():
        res = {"days": [], "basis": [], "n": []}
        for wd in range(7):
            same = [d for d in past if d.weekday() == wd]
            if len(same) >= MIN_SAME_WEEKDAY:
                use, basis = same, "weekday"
            else:  # not enough Mondays yet: all recent weekdays (or weekend days)
                use, basis = [d for d in past if (d.weekday() >= 5) == (wd >= 5)], "days"
            vals = []
            for slot in range(24 * 60 // SLOT):
                pts = [(past[d][slot], 0.5 ** ((today - d).days / HALF_LIFE)) for d in use if slot in past[d]]
                vals.append(round(sum(v * w for v, w in pts) / sum(w for _, w in pts)) if pts else None)
            res["days"].append(vals)
            res["basis"].append(basis if use else None)
            res["n"].append(len(use))
        out[k] = res
    return out


def main():
    now = dt.datetime.now(ZH)
    history = DATA / ".history"
    record(now, history)
    skip = special_days(SPECIAL.read_text()) if SPECIAL.exists() else set()
    spaces = build(load(history, now.date(), skip), now.date())
    tmp = DATA / "forecast.json.tmp"
    tmp.write_text(json.dumps({"generated": now.isoformat(), "slot": SLOT, "spaces": spaces}, separators=(",", ":")))
    tmp.replace(DATA / "forecast.json")


if __name__ == "__main__":
    main()
