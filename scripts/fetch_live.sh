#!/bin/sh
# Copy ETH's study-space data to static files. Run every minute (eth-room-finder-live.timer):
# ETH sees at most 2 requests/minute however many people use the site.
set -eu
DIR="$(dirname "$0")/../site/data"
mkdir -p "$DIR"
fetch() {
  curl -fsS --max-time 20 -A eth-room-finder "https://ethz.ch/bin/ethz/$1" -o "$DIR/$2.tmp" \
    && mv "$DIR/$2.tmp" "$DIR/$2"  # atomic swap; on failure the old file stays
}
fetch studyspaces/availability.json availability.json || echo "availability fetch failed" >&2
# The list of spaces rarely changes; refresh it at most hourly.
if [ ! -f "$DIR/spaces.json" ] || [ -n "$(find "$DIR/spaces.json" -mmin +60)" ]; then
  fetch studyspaces.json spaces.json || echo "spaces fetch failed" >&2
fi
# A one-off ETH hiccup is fine; only fail (and alert) once the live data is 15+ minutes old.
if [ ! -f "$DIR/availability.json" ] || [ -n "$(find "$DIR/availability.json" -mmin +15)" ]; then
  echo "live data is stale" >&2
  exit 1
fi
