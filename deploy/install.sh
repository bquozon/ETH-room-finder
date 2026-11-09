#!/usr/bin/env bash
# Install or update PolyUni Room Finder on a Debian/Ubuntu VPS. Same layout as Poly+Uni Agenda.
#
#   git clone https://github.com/bquozon/ETH-room-finder.git /opt/eth-room-finder
#   sudo bash /opt/eth-room-finder/deploy/install.sh rooms.example.ch    # first time: the site's address
#   /opt/eth-room-finder/scripts/update.sh                               # later: git pull + re-run this
#
# The site and its stats API are Docker containers (deploy/docker-web/) behind the Caddy container that already
# holds ports 80/443 on this machine (solidtime's): this adds one site block to that Caddy's Caddyfile.
# The data jobs run as systemd timers under the 'roomfinder' user.
#
# Safe to re-run: it keeps the data, the stats password and the address from the first run.
set -euo pipefail

APP=/opt/eth-room-finder
SVC_USER=roomfinder
ENV_FILE=/etc/eth-room-finder.env
POLYUNI_ENV=/etc/zh-student-events.env   # reuse Poly+Uni Agenda's ntfy topic if it's on this machine
DIR="$APP/deploy/docker-web"

[[ $EUID -eq 0 ]] || { echo "Please run with sudo."; exit 1; }
[[ "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" == "$APP" ]] \
  || { echo "Clone the repo to $APP first:  git clone https://github.com/bquozon/ETH-room-finder.git $APP"; exit 1; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

say "System packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 curl >/dev/null

say "Service user '$SVC_USER'"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$SVC_USER"
STATS_DIR=/var/lib/eth-room-finder-stats
mkdir -p "$APP/site/data" "$STATS_DIR"
chown -R "$SVC_USER:$SVC_USER" "$APP/site/data" "$STATS_DIR"   # the only folders it may write
chmod 755 "$APP" "$APP/site" "$APP/site/data"
chmod +x "$APP"/scripts/*.sh

say "Settings file $ENV_FILE"
touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
get() { grep -oP "^$1=\K.*" "$ENV_FILE" || true; }
set_var() { sed -i "/^$1=/d" "$ENV_FILE"; echo "$1=$2" >> "$ENV_FILE"; }
DOMAIN="${1:-$(get DOMAIN)}"
[[ -n "$DOMAIN" ]] && set_var DOMAIN "$DOMAIN"
if ! grep -q '^NTFY_TOPIC=' "$ENV_FILE"; then
  topic=$(grep -oP '^NTFY_TOPIC=\K.*' "$POLYUNI_ENV" 2>/dev/null || true)
  printf '%s\n' "# Phone notification when a job fails (ntfy app). Copied from Poly+Uni Agenda if set there." "NTFY_TOPIC=$topic" >> "$ENV_FILE"
fi
[[ -n "$(get STATS_PASSWORD)" ]] || set_var STATS_PASSWORD "$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"

say "Quick checks"
python3 -I -m py_compile "$APP/scripts/scrape_rooms.py"
python3 -I "$APP/scripts/test_stats.py" >/dev/null
if command -v node >/dev/null; then node "$APP/scripts/test_logic.mjs" >/dev/null; fi

say "Scheduled jobs"
if crontab -u "${SUDO_USER:-root}" -l 2>/dev/null | grep -q 'eth-room-finder/scripts'; then
  echo "  Note: ${SUDO_USER:-root}'s crontab still runs eth-room-finder scripts. Remove those lines (crontab -e); the timers replace them."
fi
# left over from the GoAccess version: its timer, report and access log (the log held full IPs)
systemctl disable --now eth-room-finder-stats.timer >/dev/null 2>&1 || true
rm -rf /etc/systemd/system/eth-room-finder-stats.* /var/log/eth-room-finder "$STATS_DIR/index.html"
cp "$APP"/deploy/systemd/eth-room-finder-* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now eth-room-finder-live.timer eth-room-finder-rooms.timer >/dev/null

# ------------------------------------------------------------------ web server
compose() {  # docker compose v2, or the old docker-compose v1
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
}

setup_docker() {
  say "Site and stats containers for $DOMAIN, behind the Docker reverse proxy"
  local proxy net img cf mnt inside hash
  proxy="${PROXY_CONTAINER:-}"
  [[ -n "$proxy" ]] || proxy=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/:(80|443)->/ {print $1; exit}' || true)
  if [[ -z "$proxy" ]]; then
    echo "  Could not identify the proxy container. Re-run with PROXY_CONTAINER=<name> in front of the command."
    return 0
  fi
  net=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$proxy" | awk '{print $1}')

  # stats login: bcrypt hash of the password in $ENV_FILE (delete the file to apply a changed password)
  if [[ ! -s "$DIR/stats-users.caddy" ]]; then
    hash=$(printf '%s\n' "$(get STATS_PASSWORD)" | docker run --rm -i caddy:2-alpine caddy hash-password 2>/dev/null | tail -1)
    [[ "$hash" == \$2* ]] || { echo "  Could not hash the stats password (got: $hash)."; exit 1; }
    echo "admin $hash" > "$DIR/stats-users.caddy"
    chmod 600 "$DIR/stats-users.caddy"
  fi

  cat > "$DIR/.env" <<EOF
DOMAIN=$DOMAIN
PROXY_NETWORK=$net
SITE_DIR=$APP/site
APP_DIR=$APP
RF_UID=$(id -u "$SVC_USER")
RF_GID=$(id -g "$SVC_USER")
EOF
  # rebuild the stats API image, then recreate both containers so they see the new files.
  # A failed build stops here and leaves the running containers as they were.
  (cd "$DIR" && compose build && compose up -d --force-recreate --remove-orphans)
  echo "  Containers eth-room-finder-web and eth-room-finder-api are running on network '$net' (proxy: $proxy)."

  img=$(docker inspect -f '{{.Config.Image}}' "$proxy")
  case "$img" in
    *caddy*)
      # find the Caddyfile the proxy actually runs with (path in its command, else the usual place)
      inside=$(docker inspect -f '{{json .Config.Cmd}}' "$proxy" | grep -oP '"--config","\K[^"]+' || true)
      [[ -n "$inside" ]] || inside=/etc/caddy/Caddyfile
      cf=$(docker inspect -f '{{range .Mounts}}{{.Destination}}|{{.Source}}{{"\n"}}{{end}}' "$proxy" \
           | awk -F'|' -v f="$inside" '$1==f {print $2; exit}' || true)
      if [[ -z "$cf" ]]; then   # parent folder mounted instead of the single file
        mnt=$(docker inspect -f '{{range .Mounts}}{{.Destination}}|{{.Source}}{{"\n"}}{{end}}' "$proxy" \
              | awk -F'|' -v d="$(dirname "$inside")" '$1==d {print $2; exit}' || true)
        [[ -n "$mnt" && -f "$mnt/$(basename "$inside")" ]] && cf="$mnt/$(basename "$inside")"
      fi
      local reload=(docker exec "$proxy" caddy reload --config "$inside" --adapter caddyfile)
      if [[ -n "$cf" && -f "$cf" ]]; then
        cp "$cf" "$cf.bak-eth-room-finder"
        # one block for $DOMAIN, replaced in place on re-runs. Written in place (same file), so the
        # proxy's single-file mount keeps seeing it.
        python3 - "$cf" "$DOMAIN" <<'PY'
import re, sys
path, host = sys.argv[1], sys.argv[2]
text = open(path).read()
block = f"{host} {{\n\tencode zstd gzip\n\treverse_proxy eth-room-finder-web:80\n}}\n"
pat = re.compile(rf"^{re.escape(host)} \{{\n.*?^\}}\n?", re.M | re.S)
text = pat.sub(lambda _: block, text, count=1) if pat.search(text) else text.rstrip("\n") + "\n\n" + block
open(path, "w").write(text)
PY
        if cmp -s "$cf" "$cf.bak-eth-room-finder"; then
          echo "  $cf already has the block for $DOMAIN."
        elif docker exec "$proxy" caddy validate --config "$inside" --adapter caddyfile >/dev/null 2>&1 \
           && "${reload[@]}" >/dev/null 2>&1; then
          echo "  Added the site block for $DOMAIN to $cf and reloaded Caddy (backup: $cf.bak-eth-room-finder)."
        else
          cat "$cf.bak-eth-room-finder" > "$cf"
          "${reload[@]}" >/dev/null 2>&1 || true
          echo "  Caddy rejected the change; the original Caddyfile is restored. Add this block by hand:"
          echo "    $DOMAIN { reverse_proxy eth-room-finder-web:80 }"
        fi
      else
        echo "  Could not find the Caddyfile of '$proxy' on disk. Add this block to it, then reload Caddy:"
        echo "    $DOMAIN { reverse_proxy eth-room-finder-web:80 }"
      fi ;;
    *)
      echo "  '$proxy' ($img) is not a plain Caddy container: point $DOMAIN at eth-room-finder-web:80 in its config yourself." ;;
  esac
}

if [[ -z "$DOMAIN" ]]; then
  echo "  No address given: skipping the web server. Run again with the address, e.g.  sudo bash $0 rooms.example.ch"
elif ! command -v docker >/dev/null; then
  echo "  Docker is not installed: skipping the web server."
else
  setup_docker
fi

say "First data"
systemctl start eth-room-finder-live.service || echo "  Live fetch failed: journalctl -u eth-room-finder-live -n 20"
[[ -f "$APP/site/data/rooms.json" ]] || { systemctl start --no-block eth-room-finder-rooms.service; echo "  Room bookings are being scraped in the background (~2 min)."; }

say "Done"
[[ -n "$DOMAIN" ]] && echo "  Website:      https://$DOMAIN  (HTTPS certificate is fetched on first visit)"
[[ -n "$DOMAIN" ]] && echo "  Stats:        https://$DOMAIN/stats  user admin, password: sudo grep STATS_PASSWORD $ENV_FILE"
[[ -n "$DOMAIN" ]] && echo "                open https://$DOMAIN/?notrack=1 once on each of your own devices to leave them out"
echo "  Jobs:         systemctl list-timers 'eth-room-finder-*'"
echo "  Logs:         journalctl -u eth-room-finder-rooms -u eth-room-finder-live -n 50"
if [[ -z "$(get NTFY_TOPIC)" ]]; then echo "  Alerts:       off. Set NTFY_TOPIC in $ENV_FILE to get a phone notification when a job fails."; fi
echo "  Update:       $APP/scripts/update.sh"
