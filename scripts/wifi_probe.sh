#!/bin/bash
# Which room am I in, from the Wi-Fi access point? (test, macOS only; root is needed to read the BSSID)
#   sudo scripts/wifi_probe.sh "HG E 41"   record a sample for that room
#   sudo scripts/wifi_probe.sh             guess the room from the samples recorded so far
set -euo pipefail
FILE="$(dirname "$0")/wifi_samples.tsv"

info=$(wdutil info)
field() { awk -F' : ' -v k="$1" '$1 ~ "^ *"k" *$" {gsub(/^ +| +$/, "", $2); print $2; exit}' <<<"$info"; }
bssid=$(field BSSID); rssi=$(field RSSI); channel=$(field Channel)
ip=$(ipconfig getifaddr en0 || true); gw=$(ipconfig getoption en0 router || true)
pub=$(curl -s -4 --max-time 5 https://api.ipify.org || true)
[[ $bssid =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$ ]] || { echo "No BSSID (got '$bssid'): run with sudo, on Wi-Fi." >&2; exit 1; }
echo "BSSID $bssid  RSSI $rssi  channel $channel  ip $ip  gateway $gw  public $pub"

if [[ $# -gt 0 ]]; then
  [[ -f $FILE ]] || printf 'time\troom\tbssid\trssi\tchannel\tip\tgateway\tpublic\n' >"$FILE"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%FT%T)" "$1" "$bssid" "$rssi" "$channel" "$ip" "$gw" "$pub" >>"$FILE"
  [[ -n ${SUDO_USER:-} ]] && chown "$SUDO_USER" "$FILE"
  echo "Saved for room: $1"
  exit 0
fi

[[ -f $FILE ]] || { echo "No samples yet: record some rooms first." >&2; exit 1; }
# One access point has a radio MAC per band/SSID that differs only in the last digits: the first 5 bytes = the AP.
awk -F'\t' -v b="$bssid" -v gw="$gw" -v pub="$pub" 'NR > 1 {
  if ($3 == b) exact[$2]++
  else if (substr($3, 1, 14) == substr(b, 1, 14)) ap[$2]++
  if ($7 == gw) net[$2]++
  if ($8 == pub) nat[$2]++
}
function show(title, a,   r, s) { s = ""; for (r in a) s = s "  " r " (" a[r] "x)"; print title ":" (s == "" ? "  -" : s) }
END {
  show("Same BSSID      ", exact); show("Same AP         ", ap)
  show("Same gateway    ", net);   show("Same public IP  ", nat)
}' "$FILE"
