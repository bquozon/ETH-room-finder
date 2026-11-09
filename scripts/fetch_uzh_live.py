"""Copy UZH's study-space occupancy to site/data/uzh_spaces.json. Run by fetch_live.sh every 5 minutes.

The UB (UZH library) shows each location's sensor count as a small widget ("ca. 50% frei von 120") on
ub.uzh.ch/de/ub-besuchen/belegung-alle.html; we read the same widgets. The Zentralbibliothek has no sensor.
Writes {"generated": iso, "spaces": [{title, description, building, seats, pct, closed, hours, link}]}.
"""
import datetime as dt
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "uzh_spaces.json"
WIDGET = "https://hbzwwws04.ub.uzh.ch/occusense/occusense_progressbar_150.php?id={}"
UB = "https://www.ub.uzh.ch/en/ub-besuchen/standorte/"
# (sensor id, title, building code from ziplaene-api.uzh.ch, page). DLS: no building found, so no map pin.
SPACES = [
    (10, "UB Business Studies, study room", "PLM", UB + "betriebswirtschaft_lernraum.html"),
    (15, "UB Digital Library Space", "", UB + "digtial-library-space.html"),
    (19, "UB Social Sciences", "BIM", UB + "sozialwissenschaften.html"),
    (2, "UB Study Center Irchel West", "Y63", UB + "lernzentrum_irchel.html"),
    (23, "UB Study Center Irchel East/South", "Y63", UB + "lernzentrum_irchel.html"),
    (11, "UB Medicine Careum, ground floor", "C1R", UB + "medizin_careum.html"),
    (16, "UB Medicine Careum, study room", "C1R", UB + "medizin_careum_lernraum.html"),
    (12, "UB Sciences", "Y15", UB + "naturwissenschaften.html"),
    (21, "UB Plant Sciences", "BOT", UB + "pflanzenwissenschaften.html"),
    (17, "UB Psychology", "BIN", UB + "psychologie.html"),
    (20, "UB Veterinary Medicine", "TFA", UB + "veterinaermedizin.html"),
    (18, "UB Economics", "KOL", UB + "volkswirtschaft.html"),
]
ZB = {"title": "Zentralbibliothek", "description": "Quiet floors P1–P3, collab space P0", "building": "ZB", "seats": 600,
      "pct": None, "closed": False, "hours": ["Mon - Fri: 08.00 - 20.00", "Sat - Sun: 09.00 - 17.00"],
      "link": "https://www.zb.uzh.ch/en/services/lernplatze"}


def parse(page):
    """(percent full, seats, closed) from a widget; "> 95% frei" counts as 5% full."""
    if "value: 'geschlossen'" in page:
        return None, None, True
    m = re.search(r"value: '(?:ca\. |&gt; )?(\d+)% frei von (\d+)'", page)
    return (100 - int(m[1]), int(m[2]), False) if m else (None, None, False)


def main():
    out, ok = [], 0
    for sid, title, building, link in SPACES:
        try:
            time.sleep(0.2)
            req = urllib.request.Request(WIDGET.format(sid), headers={"User-Agent": "eth-room-finder"})
            pct, seats, closed = parse(urllib.request.urlopen(req, timeout=20).read().decode())
            ok += 1
        except Exception as e:  # one dead sensor must not hide the others
            print(f"skip {title}: {e}", file=sys.stderr)
            pct, seats, closed = None, None, False
        out.append({"title": title, "description": "UZH library", "building": building, "seats": seats,
                    "pct": pct, "closed": closed, "hours": [], "link": link})
    if not ok:
        sys.exit("no UZH sensor answered, keeping previous file")
    out.append(ZB)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps({"generated": dt.datetime.now().astimezone().isoformat(), "spaces": out}, ensure_ascii=False))
    tmp.replace(OUT)


if __name__ == "__main__":
    main()
