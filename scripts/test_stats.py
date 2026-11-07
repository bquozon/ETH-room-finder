"""python3 scripts/test_stats.py: the visit counting in api/stats.py (no Flask needed)."""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.stats import Stats  # noqa: E402

PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"

with tempfile.TemporaryDirectory() as tmp:
    s = Stats(Path(tmp) / "stats.json")
    s.hit("1.2.3.4", PHONE, {"t": "view", "ref": "https://www.instagram.com/x", "ret": "new", "lang": "de-CH"})
    s.hit("1.2.3.4", PHONE, {"t": "view"})  # same visitor, same day
    s.hit("5.6.7.8", "Mozilla/5.0 (Macintosh)", {"t": "view"})
    s.hit("9.9.9.9", "Googlebot/2.1", {"t": "view"})  # bots are ignored
    s.hit("1.2.3.4", PHONE, {"t": "click", "how": "directions", "title": "HG H 30.1", "building": "HG"})
    s.hit("1.2.3.4", PHONE, {"t": "locate"})
    s.hit("1.2.3.4", PHONE, {"t": "nonsense"})  # unknown kinds are dropped

    t = s.summary(1)
    assert (t["visitors"], t["views"]) == (2, 3), t
    assert dict(t["device"]) == {"Phone": 1, "Computer": 1}
    assert dict(t["ref"])["Instagram"] == 1
    assert dict(t["click"]) == {"HG H 30.1": 1} and dict(t["building"]) == {"HG": 1}
    assert dict(t["action"]) == {"Opened directions": 1, "Used Near me": 1}

    s.flush()
    assert Stats(s.path).summary(1)["visitors"] == 2  # survives a restart
print("stats ok")
