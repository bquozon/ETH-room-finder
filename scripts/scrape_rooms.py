"""Scrape bookings of ETH's centrally administered teaching rooms for the next 7 days.

Port of the scraper in roominfo_checker by Oliver Saravanja (github.com/ollie-sara/roominfo_checker),
MIT licensed, see licenses/roominfo_checker-MIT.txt. Writes site/data/rooms.json:
{"generated": iso, "rooms": [{"building", "floor", "room", "seats", "busy": [[from, to], ...]}]}
Stdlib only, so it runs on the server without a virtualenv.
"""
import datetime as dt
import json
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
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps({"generated": dt.datetime.now().astimezone().isoformat(), "rooms": out}, ensure_ascii=False))
    tmp.replace(OUT)  # atomic: the site never sees a half-written file
    print(f"wrote {len(out)} rooms to {OUT}")


if __name__ == "__main__":
    main()
