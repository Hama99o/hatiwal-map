#!/usr/bin/env bash
# Monthly OSM refresh of tiles/afghanistan.pmtiles — runs ON THE VPS, never on
# the owner's PC (he is often on a phone hotspot).
#
#   cron (kamal):  0 2 1 * *  cd /home/kamal/hatiwal-map && flock -n /tmp/hatiwal-tiles.lock ./tools/update-tiles.sh >> logs/update-tiles.log 2>&1
#   by hand:       cd ~/hatiwal-map && ./tools/update-tiles.sh
#   dry run:       SKIP_SWAP=1 ./tools/update-tiles.sh   (build + gates, no swap)
#
# Same build as the 2026-09-13 AF+PK+IR tileset (RUNBOOK §3 / tmp/data/pk1/build.sh):
# Geofabrik afghanistan + pakistan + iran → osmium merge → planetiler with
# --languages=ps,fa,en,ur --bounds=44.0,23.6,77.9,39.8 --download.
#
# THIS BOX ALSO RUNS POSTGRES AND THE API. Everything heavy runs at nice 19 /
# ionice idle inside a container with a hard memory cap, and planetiler uses
# mmap storage (disk-backed, not heap). Local reference: 19m24s, heap peak 1.9 GB
# at 6 threads. Here: 2 threads, -Xmx2g, container capped at 3 GB.
#
# NOTHING is swapped unless every gate passes. The live file is kept as
# afghanistan.prev.pmtiles; rollback = mv it back + restart both containers.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
WORK="$ROOT/build/osm"
TILES="$ROOT/tiles"
LIVE="$TILES/afghanistan.pmtiles"
INCOMING="$TILES/.incoming.pmtiles"
THREADS="${THREADS:-2}"
MEM="${MEM:-3g}"
XMX="${XMX:-2g}"
LOW="nice -n 19 ionice -c3"
PM="docker run --rm -v $TILES:/t:ro ghcr.io/protomaps/go-pmtiles:latest"
mkdir -p "$WORK" "$ROOT/logs"
log() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { log "ABORT: $*"; exit 1; }
T0=$(date +%s)

# Peak-RAM sampler: every 15s, record the build containers' memory. The max is
# reported at the end so the first real run tells us the true cost on this box.
MEMLOG="$WORK/mem.log"; : > "$MEMLOG"
( while sleep 15; do docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | grep -E 'hatiwal_osm_' >> "$MEMLOG" || true; done ) &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

log "disk before: $(df -h "$ROOT" | awk 'NR==2{print $4" free"}')   ram: $(free -m | awk '/Mem:/{print $7" MB available"}')"
[ "$(df --output=avail -k "$ROOT" | tail -1)" -gt $((8*1024*1024)) ] || fail "less than 8 GB free disk"

log "1/5 download Geofabrik extracts"
for c in afghanistan pakistan iran; do
  $LOW curl -sfL --retry 3 -o "$WORK/$c.osm.pbf.part" "https://download.geofabrik.de/asia/$c-latest.osm.pbf" \
    || fail "download $c"
  mv "$WORK/$c.osm.pbf.part" "$WORK/$c.osm.pbf"
  log "    $c $(du -h "$WORK/$c.osm.pbf" | cut -f1)"
done

log "2/5 osmium merge (dedupes border objects — a cat of PBFs is NOT valid)"
rm -f "$WORK/hatiwal3.osm.pbf"
$LOW docker run --rm --name hatiwal_osm_merge --memory="$MEM" -v "$WORK:/w" debian:bookworm-slim sh -c \
  "apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null && \
   osmium merge /w/afghanistan.osm.pbf /w/pakistan.osm.pbf /w/iran.osm.pbf -o /w/hatiwal3.osm.pbf" \
  || fail "osmium merge"
log "    merged $(du -h "$WORK/hatiwal3.osm.pbf" | cut -f1)"

log "3/5 planetiler (threads=$THREADS, -Xmx$XMX, container cap $MEM, mmap storage)"
rm -f "$WORK/hatiwal3.pmtiles"
$LOW docker run --rm --name hatiwal_osm_planetiler --memory="$MEM" --cpus="$THREADS" \
  -e JAVA_TOOL_OPTIONS="-Xmx$XMX" -v "$WORK:/data" ghcr.io/onthegomap/planetiler:latest \
  --osm_path=/data/hatiwal3.osm.pbf --output=/data/hatiwal3.pmtiles \
  --languages=ps,fa,en,ur --bounds=44.0,23.6,77.9,39.8 \
  --threads="$THREADS" --storage=mmap --force --download \
  || fail "planetiler"
mv -f "$WORK/hatiwal3.pmtiles" "$INCOMING"

log "4/5 sanity gates"
size=$(stat -c %s "$INCOMING")
[ "$size" -ge 500000000 ] || fail "incoming is $size bytes (< 500 MB)"
log "    size $((size/1048576)) MB ok"
bounds=$($PM show /t/.incoming.pmtiles | awk -F'[:,() ]+' '/^bounds/{print $3,$5,$7,$9}')
read -r w s e n <<<"$bounds"
awk -v w="$w" -v s="$s" -v e="$e" -v n="$n" 'BEGIN{exit !(w<=44.01 && s<=23.61 && e>=77.89 && n>=39.79)}' \
  || fail "bounds $bounds do not cover AF+PK+IR (44.0,23.6 – 77.9,39.8)"
log "    bounds $bounds ok"
# Kabul, Herat, Islamabad, Karachi, Tehran × z10/12/14. Each must exist in the
# new file, and must not have shrunk to under half its live size (a truncated
# or wrong-area build fails here even if it is big enough overall).
tile_xy() { node -e "const [lon,lat,z]=process.argv.slice(1).map(Number),n=2**z,r=lat*Math.PI/180;console.log(z,Math.floor((lon+180)/360*n),Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n))" "$@" 2>/dev/null \
  || python3 -c "import math,sys;lon,lat,z=map(float,sys.argv[1:]);z=int(z);n=2**z;r=math.radians(lat);print(z,int((lon+180)/360*n),int((1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n))" "$@"; }
# `pmtiles tile` prints "Tile not found in archive." to STDOUT and exits 0 for
# a missing tile, so a byte count alone would score a missing tile as 27 bytes
# and pass it. Measured against the old AF-only file, 2026-10-02.
tsize() {
  local f; f=$(mktemp)
  $PM tile "$@" >"$f" 2>/dev/null || true
  if head -c 14 "$f" | grep -q '^Tile not found'; then echo 0; else stat -c %s "$f"; fi
  rm -f "$f"
}
for city in "Kabul 69.17 34.53" "Herat 62.20 34.35" "Islamabad 73.05 33.70" "Karachi 67.03 24.86" "Tehran 51.39 35.69"; do
  read -r name lon lat <<<"$city"
  for z in 10 12 14; do
    read -r tz tx ty <<<"$(tile_xy "$lon" "$lat" "$z")"
    new=$(tsize /t/.incoming.pmtiles "$tz" "$tx" "$ty")
    old=$(tsize /t/afghanistan.pmtiles "$tz" "$tx" "$ty")
    [ "$new" -gt 100 ] || fail "$name $tz/$tx/$ty missing in new file"
    [ "$old" -eq 0 ] || [ "$new" -ge $((old/2)) ] || fail "$name $tz/$tx/$ty shrank $old → $new bytes"
    log "    $name $tz/$tx/$ty  live ${old}B  new ${new}B"
  done
done

if [ "${SKIP_SWAP:-0}" = 1 ]; then log "SKIP_SWAP=1 — gates passed, leaving $INCOMING in place"; exit 0; fi

log "5/5 swap + restart"
cp -f "$LIVE" "$TILES/afghanistan.prev.pmtiles"
mv -f "$INCOMING" "$LIVE"
# BOTH containers: go-pmtiles reopens the file, and nginx caches the tile
# container's IP — restarting only the tile server gives a 502 (RUNBOOK §4).
docker restart hatiwal_map_tiles >/dev/null && sleep 3 && docker restart hatiwal_map_web >/dev/null
sleep 5
read -r tz tx ty <<<"$(tile_xy 73.05 33.70 12)"
code=$(curl -s -o /dev/null -w '%{http_code}' --compressed "https://map.hatiwal.com/afghanistan/$tz/$tx/$ty.mvt")
if [ "$code" != 200 ]; then
  log "PUBLIC CHECK FAILED (Islamabad $tz/$tx/$ty → $code) — rolling back"
  mv -f "$TILES/afghanistan.prev.pmtiles" "$LIVE"
  docker restart hatiwal_map_tiles >/dev/null && sleep 3 && docker restart hatiwal_map_web >/dev/null
  fail "rolled back to the previous tileset"
fi
rm -f "$WORK"/*.osm.pbf
peak=$(awk '{print $2}' "$MEMLOG" | sort -h | tail -1)
log "DONE in $(( ($(date +%s)-T0)/60 )) min — peak container RAM ${peak:-n/a} — $(du -h "$LIVE" | cut -f1) live, previous kept as afghanistan.prev.pmtiles"
