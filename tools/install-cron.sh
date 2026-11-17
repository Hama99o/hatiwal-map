#!/usr/bin/env bash
# Install (or re-install) the monthly OSM refresh in kamal's crontab ON THE VPS.
#
#   ssh kamal@<vps> 'cd ~/hatiwal-map && ./tools/install-cron.sh'
#
# Idempotent: any previous update-tiles.sh line is replaced, every other cron
# line (backups, disk alert, ...) is kept as it is. The box runs in UTC, so
# "0 2 1 * *" is 02:00 UTC on the 1st of each month.
#
# Safety comes from update-tiles.sh itself: it swaps only after every gate
# passes, keeps the previous file as tiles/afghanistan.prev.pmtiles and rolls
# back on a failed public check. flock -n stops a second run starting while one
# is still going.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
mkdir -p "$ROOT/logs"
LINE="0 2 1 * * cd $ROOT && flock -n /tmp/hatiwal-tiles.lock ./tools/update-tiles.sh >> logs/update-tiles.log 2>&1"

[ "$(date +%Z)" = UTC ] || echo "WARNING: this box is not on UTC ($(date +%Z)); 02:00 is local time" >&2

{ crontab -l 2>/dev/null | grep -v 'tools/update-tiles.sh' || true; echo "$LINE"; } | crontab -
echo "installed:"
crontab -l | grep 'tools/update-tiles.sh'
