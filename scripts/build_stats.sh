#!/bin/bash
# Turn the site container's access log into the GoAccess report served at /stats/.
# Run every 10 minutes by eth-room-finder-stats.timer (as root: Caddy's log is root-only).
set -euo pipefail
LOGS=/var/log/eth-room-finder
OUT=/var/lib/eth-room-finder-stats
shopt -s nullglob
files=("$LOGS"/access*.log*)
[[ ${#files[@]} -gt 0 ]] || { echo "no access log yet"; exit 0; }
# Caddy's JSON log -> Apache "combined" lines (real visitor IP, /data/ refreshes dropped), so any GoAccess version reads it.
zcat -f "${files[@]}" \
  | jq -r -f "$(dirname "$0")/../deploy/docker-web/caddy2combined.jq" \
  | goaccess - --log-format=COMBINED --anonymize-ip --ignore-crawlers \
      --html-report-title="ETH Room Finder traffic" -o "$OUT/next.html"
mv "$OUT/next.html" "$OUT/index.html"
