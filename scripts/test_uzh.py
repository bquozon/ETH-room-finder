# python3 scripts/test_uzh.py: the two UZH parsers, on strings copied from the real pages.
from fetch_uzh_live import parse
from scrape_rooms import uzh_room

assert parse("text: { value: 'ca. 50% frei von 120', className") == (50, 120, False)
assert parse("value: '&gt; 95% frei von 40'") == (5, 40, False)
assert parse("value: 'geschlossen'") == (None, None, True)
assert parse("<html>changed</html>") == (None, None, False)

assert uzh_room("KOL-F-101 (209 Plätze) **") == ("KOL", "F", "101", 209)
assert uzh_room("BIN-1-D.25 (24 Plätze)") == ("BIN", "1", "D.25", 24)
assert uzh_room("Y10-G-03/04 EV (50 Plätze)") == ("Y10", "G", "03/04", 50)
assert uzh_room("RAI-F-041 Apérofläche (78 Plätze)") is None
assert uzh_room("Y14-F-41 Labor-Praktikumsraum (92 Plätze)") is None
assert uzh_room("Lichthof Nord (450 Personen)") is None
assert uzh_room("Y-Lichthof (800 Personen)") is None
assert uzh_room("Y22-F-62/68/70 (120 Plätze)", {("Y22", "F", "62")}) is None  # merged booking of single rooms
print("uzh ok")
