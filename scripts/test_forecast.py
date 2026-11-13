"""python3 scripts/test_forecast.py: the occupancy forecast in scripts/forecast.py."""

import datetime as dt
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from forecast import build, load, special_days  # noqa: E402

D = dt.date
assert special_days("2026-12-24 2026-12-26 Xmas\n# note\n2027-05-17  Whit Monday\n") == \
    {D(2026, 12, 24), D(2026, 12, 25), D(2026, 12, 26), D(2027, 5, 17)}

today = D(2026, 11, 13)  # a Friday
mon = [D(2026, 11, 9), D(2026, 11, 2), D(2026, 10, 26)]  # last three Mondays
slot = 20  # 10:00

# Too few Mondays: a Monday comes from all recent weekdays, last week weighing double the week before.
days = {("A", mon[0]): {slot: 80}, ("A", D(2026, 11, 3)): {slot: 20}, ("A", D(2026, 11, 7)): {slot: 99}}  # 7th: Sat
f = build(days, today)["A"]
assert f["basis"][0] == "days" and f["n"][0] == 2, f
w1, w2 = 0.5 ** (4 / 7), 0.5 ** (10 / 7)
assert f["days"][0][slot] == round((80 * w1 + 20 * w2) / (w1 + w2)), f["days"][0][slot]
assert f["days"][5][slot] == 99 and f["basis"][5] == "days"  # Saturday from weekend days only
assert f["days"][0][0] is None  # no data at midnight

# Three Mondays: Mondays only, the Tuesday no longer counts for Monday.
days = {**{("A", d): {slot: 50} for d in mon}, ("A", D(2026, 11, 10)): {slot: 0}}
f = build(days, today)["A"]
assert f["basis"][0] == "weekday" and f["days"][0][slot] == 50 and f["n"][0] == 3, f
assert f["basis"][1] == "days" and f["days"][1][slot] < 50  # Tuesday: still the weekday mix

# load: slots are averaged, special days and broken lines skipped.
with tempfile.TemporaryDirectory() as tmp:
    h = Path(tmp)
    (h / "2026-11-09.jsonl").write_text("\n".join(json.dumps(r) for r in [
        {"t": "10:00", "p": {"A": 40}}, {"t": "10:20", "p": {"A": 60, "B": 5}}]) + '\n{"t": "10:4')
    (h / "2026-11-10.jsonl").write_text(json.dumps({"t": "10:00", "p": {"A": 100}}) + "\n")
    got = load(h, today, {D(2026, 11, 10)})
    assert got == {("A", D(2026, 11, 9)): {slot: 50}, ("B", D(2026, 11, 9)): {slot: 5}}, got

print("forecast ok")
