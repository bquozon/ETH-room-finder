# ETH Room Finder

Unofficial ETH Zurich room finder. It shows how full the student study spaces are right now, which lecture and seminar rooms are free (today or any day this week), and sorts everything by walking distance from you.

- **Study spaces**: live occupancy, opening hours (including 24/7 access with an ETH card), sockets, noise level, food nearby.
- **Free rooms**: "free until 14:15" or "busy, free from 13:00", with a bar of the day's bookings (tap a room for the full schedule) and a warning when a room gets booked soon after you'd arrive. Pick any day and time in the next week. Free means unbooked, not necessarily empty.
- **Map** (`map.html`): a 3D map of the campus with a pin per building (live occupancy or free rooms), ETH buildings in ETH blue, light/dark following the system, and trees that follow the seasons (`?season=winter|spring|summer|autumn` to preview). Map data © OpenStreetMap contributors, tiles from [OpenFreeMap](https://openfreemap.org).
- **Near me**: uses your browser's location. Distances are computed on your device, and your location never reaches the server.

## How it works

There's no backend. The site is plain static files, and two systemd timers on the server keep `site/data/` up to date:

| Data | Source | Refreshed |
|---|---|---|
| Study-space list and live occupancy | `ethz.ch/bin/ethz/studyspaces.json`, `.../availability.json` | every minute |
| Room bookings for the next 7 days | `ethz.ch/bin/ethz/roominfo` (centrally administered teaching rooms, plus `scripts/extra_rooms.txt`) | twice a day |
| UZH library occupancy | the UB's live widgets (`hbzwwws04.ub.uzh.ch/occusense/...`, as on ub.uzh.ch's Belegungsanzeigen), plus the Zentralbibliothek without live data | every 5 minutes |
| UZH room bookings for the next 7 days | UZH's public booking calendar (`uzh.book.3vrooms.app`, anonymous), teaching rooms only | twice a day |

Visitors only ever load these copies, so ETH sees the same handful of requests whether 10 or 10,000 people use the site.

```
site/                 index.html, app.js (UI), logic.js (pure helpers + building coordinates), style.css
                      map.html, map.js (map page), map-style.js (our map look, seasons, trees)
site/vendor/          MapLibre GL JS 4.7.1, CSP build (BSD-3-Clause, licenses/)
site/data/            generated JSON (git-ignored)
api/                  visit statistics: stats.py (counting), server.py (/api/hit, /api/stats), Dockerfile
scripts/              fetch_live.sh, fetch_uzh_live.py, scrape_rooms.py, extra_rooms.txt, update.sh, test_logic.mjs, test_stats.py, test_uzh.py
deploy/install.sh     installs or updates everything on the VPS (safe to re-run)
deploy/systemd/       timers: live data, room bookings; failure alert
deploy/docker-web/    compose.yml and Caddyfile for the site and stats containers
```

## Run locally

Needs Python 3, curl and (for the tests) Node.

```bash
./scripts/fetch_live.sh && python3 scripts/scrape_rooms.py
python3 -m http.server 8765 -d site      # open http://localhost:8765
npm test                                 # site logic (Node)
python3 scripts/test_stats.py            # visit counting
python3 scripts/test_uzh.py              # UZH parsers
```

## Deploy

Same layout as Poly+Uni Agenda on the same VPS:

- The site is its own small Caddy container, `eth-room-finder-web`, on the network of the Caddy container that owns ports 80/443 (solidtime's). That front Caddy forwards the subdomain to it.
- The data jobs are systemd timers that run as a `roomfinder` system user, which can only write `site/data/`.
- If a job fails, you get a phone notification through ntfy. The installer reuses Poly+Uni Agenda's topic.

### First time

1. **DNS:** add an A record for the subdomain (e.g. `rooms`) pointing to the VPS.
2. **Clone and install:**
   ```bash
   sudo mkdir -p /opt/eth-room-finder && sudo chown "$USER": /opt/eth-room-finder
   git clone https://github.com/bquozon/ETH-room-finder.git /opt/eth-room-finder
   sudo bash /opt/eth-room-finder/deploy/install.sh rooms.example.ch
   ```

The installer:
- installs `python3 curl jq goaccess`
- creates the `roomfinder` user
- writes `/etc/eth-room-finder.env` with the address, a generated stats password and the ntfy topic
- enables the timers
- starts the site container
- adds a `rooms.example.ch { reverse_proxy eth-room-finder-web:80 }` block to the front Caddy's Caddyfile. It writes the file in place, validates it, and restores the backup if Caddy rejects it.
- fetches the first data

If it can't tell which container is the proxy, run it again with `PROXY_CONTAINER=solidtime-caddy-1` before `sudo`.

### Updating

Push to `main`, then on the VPS (as your normal user, not with `sudo`):

```bash
/opt/eth-room-finder/scripts/update.sh
```

It runs `git pull --ff-only` and then re-runs the installer, which keeps the data, the password and the address.

### Rolling back

```bash
cd /opt/eth-room-finder && git checkout <commit> && sudo bash deploy/install.sh
```

To remove the site entirely:

```bash
sudo systemctl disable --now eth-room-finder-live.timer eth-room-finder-rooms.timer
cd /opt/eth-room-finder/deploy/docker-web && docker compose down
```

Then delete the site's block from the front Caddyfile (with `nano`, not `sed -i`, which breaks its single-file mount) and reload that Caddy.

### Troubleshooting

- Jobs and their next runs: `systemctl list-timers 'eth-room-finder-*'`
- Job logs: `journalctl -u eth-room-finder-live -u eth-room-finder-rooms -n 50`
- Site doesn't load: `docker logs eth-room-finder-web`
- HTTPS or 502 errors: `docker logs solidtime-caddy-1 --tail 50`
- Stats password: `sudo grep STATS_PASSWORD /etc/eth-room-finder.env`. To change it, edit it there, delete `deploy/docker-web/stats-users.caddy` and re-run the installer.

## Stats

The same anonymous statistics as Poly+Uni Agenda (`api/stats.py` is ported from it). Open `https://<subdomain>/stats` and log in as `admin`.

- **What it shows:** visitors and page views per day, where visitors come from, searches, filters, most opened places and buildings, Near me use, devices, time of day, language, and new vs returning visitors.
- **How it counts:** the page sends small "hits" to `/api/hit`. Bots don't run the page's JavaScript, so they're never counted.
- **What it stores:** only daily totals in `/var/lib/eth-room-finder-stats/stats.json`. No cookies and no IP addresses. A visitor is recognised for one day through a hash with a salt that is thrown away at midnight.
- **Leaving out your own devices:** open `https://<subdomain>/?notrack=1` once on each device, and `?notrack=0` to count it again.

## Maintaining the data

- **A room is missing** (e.g. a department room like `CAB H 56`): add it to `scripts/extra_rooms.txt` as `BUILDING FLOOR ROOM`.
- **A building has no distance:** add its coordinates to `BUILDINGS` in `site/logic.js`. Take them from the Google Maps link on `https://ethz.ch/en/utils/location.html?building=XYZ&floor=..&room=..`.
- **Opening hours look wrong:** they're parsed from ETH's text (`openingStatus` in `site/logic.js`), because ETH's own `isOpen` flag is unreliable. Add a case to `scripts/test_logic.mjs` when you fix one.

## Credits

The free-rooms feature builds on **[roominfo_checker](https://github.com/ollie-sara/roominfo_checker)** by Oliver Saravanja ([@ollie-sara](https://github.com/ollie-sara)), which powers [Sick Room Finder](https://rooms.saravanja.ch). The idea and the way of reading ETH's room-booking API come from that project. `scripts/scrape_rooms.py` is a port of its scraper, used under the MIT license ([licenses/roominfo_checker-MIT.txt](licenses/roominfo_checker-MIT.txt)).

Study-space occupancy, room bookings and building locations come from ETH Zurich's public website. This project is not affiliated with ETH Zurich.
