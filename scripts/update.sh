#!/bin/sh
# Deploy the latest version on the VPS. Run as your normal user (not with sudo):
#   /opt/eth-room-finder/scripts/update.sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
# re-run the installer in a new process, so it runs the freshly pulled version of itself
sudo bash deploy/install.sh
echo "deployed $(git log -1 --format='%h %s')"
