"""Copy UZH's study-space occupancy to site/data/uzh_spaces.json. Run by fetch_live.sh every 5 minutes.

The UB (UZH library) shows each location's sensor count as a small widget ("ca. 50% frei von 120") on
ub.uzh.ch/de/ub-besuchen/belegung-alle.html; we read the same widgets. Places without a sensor are listed too,
with pct null (shown as "unknown how busy").
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
# (sensor id, title, building code from ziplaene-api.uzh.ch, page). DLS is in SOC (room SOC-1-105).
SPACES = [
    (10, "UB Business Studies, study room", "PLM", UB + "betriebswirtschaft_lernraum.html"),
    (15, "UB Digital Library Space", "SOC", UB + "digtial-library-space.html"),
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
# Places without a sensor: libraries and study rooms from UZH's floor-plan API (ziplaene-api.uzh.ch, building
# details: "bibliotheken", "arbeitsplaetze" Lernraum/Selbststudium), seats from each UB page, and the ZB.
# shortcut: a fixed list (that API still lists libraries that merged in 2026); re-derive it if UZH moves libraries.
# (title, description, building, seats, link, hours)
UNMEASURED = [
    ("Zentralbibliothek", "Quiet floors P1–P3, collab space P0", "ZB", 600, "https://www.zb.uzh.ch/en/services/lernplatze",
     ["Mon - Fri: 08.00 - 20.00", "Sat - Sun: 09.00 - 17.00"]),
    ("UB Law", "UZH library", "RAI", 500, UB + "recht.html", []),
    ("UB German & Scandinavian Studies", "UZH library", "SOD", 200, UB + "germanistik_skandinavistik.html", []),
    ("UB Business Administration", "UZH library", "PLM", 30, UB + "betriebswirtschaft.html", []),
    ("UB Philosophy", "UZH library", "KOL", 75, UB + "philosophie.html", []),
    ("UB History", "UZH library", "KO2", 60, UB + "geschichte.html", []),
    ("UB Prehistoric Archaeology", "UZH library", "KO2", None, UB + "praehistorische_archaeologie.html", []),
    ("UB Educational Science (FRE)", "UZH library", "FRE", 45, UB + "erziehungswissenschaft_fre.html", []),
    ("UB Educational Science (KAB)", "UZH library", "KAB", 10, UB + "erziehungswissenschaft_kab.html", []),
    ("UB English Studies", "UZH library", "PET", 40, UB + "anglistik.html", []),
    ("UB Greek & Latin Philology", "UZH library", "RAG", 40, UB + "graezistik_latinistik.html", []),
    ("UB Asian & Oriental Studies", "UZH library", "RAA", 35, UB + "asien_orient_raa.html", []),
    ("UB Classical Archaeology", "UZH library", "RAK", 20, UB + "klassische_archaeologie.html", []),
    ("UB Ethnographic Museum", "UZH library", "PEA", 20, UB + "voelkerkundemuseum.html", []),
    ("UB Slavonic Studies & Comparative Literature", "UZH library", "PLG", 17, UB + "slavistik_avl_vergl.html", []),
    ("UB Linguistics", "UZH library", "PLK", None, "", []),
    ("UB Social & Economic History", "UZH library", "RAE", None, "", []),
    ("UB Religious Studies", "UZH library", "KAA", None, "", []),
    ("UB History of Medicine", "UZH library", "WIH", None, "", []),
    ("UB Egyptology", "UZH library", "TEL", None, "", []),
    ("UB Ethics", "UZH library", "ZOA", None, "", []),
    ("Language Center self-study centre", "UZH study room", "RAI", None, "", []),
] + [(room, "UZH study room" + extra, room.split("-")[0], None, "", []) for room, extra in [
    ("KIR-3-303", ""), ("PET--1-3", ""), ("PET--1-4", ""), ("PET--1-4C", ""), ("PET--1-4E", ""), ("PLF-C-105", ""),
    ("PLG-A-001", ""), ("RAA-D-29", ""), ("RAF-1-104", ""), ("RAF-1-105", ""), ("RAI-D-011", ", with computers"),
    ("RAI-J-021", ""), ("WIL-G-205", ""), ("Y01-F-2-49", ", with computers"), ("Y01-F-94", ""), ("Y25-G-10", ""),
    ("Y25-G-80", ""), ("Y25-G-82", ""), ("Y27-H-52", ""), ("Y27-J-11", ""), ("Y27-K-37", ""), ("ZUB-E-7", ""),
]]


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
    out += [{"title": t, "description": d, "building": b, "seats": s, "pct": None, "closed": False, "hours": h, "link": l}
            for t, d, b, s, l, h in UNMEASURED]
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps({"generated": dt.datetime.now().astimezone().isoformat(), "spaces": out}, ensure_ascii=False))
    tmp.replace(OUT)


if __name__ == "__main__":
    main()
