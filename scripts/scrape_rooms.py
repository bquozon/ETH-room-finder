"""Scrape bookings of ETH's and UZH's centrally administered teaching rooms for the next 7 days.

The ETH part is a port of the scraper in roominfo_checker by Oliver Saravanja (github.com/ollie-sara/roominfo_checker),
MIT licensed, see licenses/roominfo_checker-MIT.txt. Writes site/data/rooms.json:
{"generated": iso, "rooms": [{"building", "floor", "room", "seats", "busy": [[from, to], ...], "uni"?: "uzh"}]}
Stdlib only, so it runs on the server without a virtualenv.
"""
import datetime as dt
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://ethz.ch/bin/ethz/roominfo"
HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "site" / "data" / "rooms.json"
EXTRA = HERE / "extra_rooms.txt"  # rooms ETH's /rooms list omits (e.g. department rooms)


def get(path, **params):
    url = API + "?" + urllib.parse.urlencode({"path": path, **params}, safe="/ ")
    req = urllib.request.Request(url.replace(" ", "%20"), headers={"User-Agent": "eth-room-finder"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# UZH: the public booking calendar (3vrooms) behind del.uzh.ch's "Belegungskalender", one view per campus.
UZH = "https://uzh.book.3vrooms.app/default"
UZH_VIEWS = (24885, 22059, 15325)  # Zentrum, Irchel, Oerlikon
# "KOL-F-101 (209 Plätze) **", "Y10-G-03/04 EV (50 Plätze)"; event spaces count "Personen" and don't match
UZH_ROOM = re.compile(r"^([A-Z]+\d*)-([A-Z0-9]+)-(\S+)(?: [^()]*)? \((\d+) Plätze\)")


def uzh_room(title, singles=()):
    """(building, floor, room, seats) for a teaching room title, None for apéro areas, labs and merged rooms."""
    m = UZH_ROOM.match(title)
    if not m or "Apéro" in title or "Labor" in title:
        return None
    b, f, n, seats = m.groups()
    if "/" in n and (b, f, n.split("/")[0]) in singles:  # "Y22-F-62/68/70" is Y22-F-62 + 68 + 70 booked together
        return None
    return b, f, n, int(seats)


def uzh_rooms(start, end):
    # The calendar wants a session: an anonymous OpenID login whose form a browser would auto-submit.
    web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    web.addheaders = [("User-Agent", "eth-room-finder")]
    page = web.open(UZH + "/Anonymous/Calendar/PortalFind", timeout=30).read().decode()
    fields = {n: html.unescape(v) for n, v in re.findall(r'name="([^"]+)" value="([^"]*)"', page)}
    if (action := re.search(r'<form[^>]*action="([^"]+)"', page)) and "code" in fields:
        web.open(html.unescape(action[1]), urllib.parse.urlencode(fields).encode(), timeout=30).read()
    out = []
    for view in UZH_VIEWS:
        time.sleep(1)
        q = urllib.parse.urlencode({"mode": "Week", "from": start, "to": end, "filtersettingId": view, "anlassId": ""})
        req = urllib.request.Request(f"{UZH}/api/v1.0/calendar?{q}", headers={"Accept": "application/json"})
        res = json.load(web.open(req, timeout=120))["RessourceList"]
        singles = {r[:3] for r in map(uzh_room, (x["Title"] for x in res)) if r}
        for x in res:
            if not (r := uzh_room(x["Title"], singles)):
                continue
            # Every block counts as busy: bookings, "not bookable" holds, and the closed hours at night.
            # The times say "Z" but are local (lectures at "10:15:00Z"), so drop it.
            busy = sorted({(b["BeginnEffective"].rstrip("Z"), b["EndeEffective"].rstrip("Z")) for b in x["BlockList"]})
            out.append({"uni": "uzh", "building": r[0], "floor": r[1], "room": r[2], "seats": r[3], "busy": [list(b) for b in busy]})
    if not out:
        raise RuntimeError("no UZH rooms in the calendar")
    return out


def main():
    today = dt.date.today()
    start, end = today.isoformat(), (today + dt.timedelta(days=7)).isoformat()
    rooms = [
        r for r in get("/rooms")
        if r["orgunit"][0]["orgunit"] == "09188"  # "Unterrichtsräume Rektorat"
        and r["typecode"] in ("3430", "3420")  # lecture halls, seminar rooms
    ]
    known = {(r["building"], r["floor"], r["room"]) for r in rooms}
    for line in EXTRA.read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            b, f, n = line.split(None, 2)
            if (b, f, n) not in known:
                rooms.append({"building": b, "floor": f, "room": n, "extra": True})
    out = []
    for r in rooms:
        b, f, n = r["building"], r["floor"], r["room"]
        name = f"{b} {f} {n}"
        try:
            time.sleep(0.2)  # be polite to ETH
            if not r.get("extra") and 114 not in get("/roomgroup", building=b, floor=f, room=n)["roomGroups"]:
                continue
            allocs = get(f"/rooms/{name}/allocations", **{"from": start, "to": end})
            busy = sorted([a["date_from"], a["date_to"]] for a in allocs)
            out.append({"building": b, "floor": f, "room": n, "seats": r.get("seats"), "busy": busy})
        except Exception as e:  # one broken room must not kill the whole run
            print(f"skip {name}: {e}", file=sys.stderr)
    if not out:
        sys.exit("no rooms scraped, keeping previous file")
    try:
        out += uzh_rooms(start, end)
    except Exception as e:  # UZH down: keep its rooms from the last run rather than dropping them
        print(f"UZH skipped: {e}", file=sys.stderr)
        try:
            out += [r for r in json.loads(OUT.read_text())["rooms"] if r.get("uni") == "uzh"]
        except Exception:
            pass
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps({"generated": dt.datetime.now().astimezone().isoformat(), "rooms": out}, ensure_ascii=False))
    tmp.replace(OUT)  # atomic: the site never sees a half-written file
    print(f"wrote {len(out)} rooms to {OUT}")


if __name__ == "__main__":
    main()
