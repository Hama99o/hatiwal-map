#!/usr/bin/env bash
# Build tiles/hillshade.pmtiles ON THE VPS. Nothing crosses the owner's link.
#
#   ssh kamal@<vps> 'cd ~/hatiwal-map && ./tools/build-hillshade.sh'
#
# Steps (all at nice 19 / ionice idle so Postgres and the API are never starved):
#   1. pmtiles extract — Mapterhorn DEM for AF+PK+IR, z0-10, ~754 MB (measured
#      with --dry-run 2026-10-02). Reads only the byte ranges it needs.
#   2. serve that DEM on a private docker network (never published).
#   3. tools/hillshade.mjs renders shadows-only WebP into an MBTiles file.
#   4. pmtiles convert → tiles/.hillshade.incoming.pmtiles, sanity-checked,
#      then mv'd to tiles/hillshade.pmtiles (atomic; go-pmtiles picks it up
#      as /hillshade/{z}/{x}/{y}.webp — the file name IS the URL path).
#
# Disk peak ≈ 754 MB DEM + ~150 MB MBTiles + ~150 MB pmtiles. The DEM is deleted
# at the end unless KEEP_DEM=1.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BUILD="$ROOT/build/hillshade"
BBOX="${BBOX:-44.0,23.6,77.9,39.8}"
MAXZOOM="${MAXZOOM:-10}"
QUALITY="${QUALITY:-25}"
NET=hatiwal-hs-build
LOW="nice -n 19 ionice -c3"
mkdir -p "$BUILD" "$ROOT/tiles"
log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "1/4 DEM extract bbox=$BBOX maxzoom=$MAXZOOM"
if [ ! -s "$BUILD/dem.pmtiles" ]; then
  $LOW docker run --rm -v "$BUILD:/d" ghcr.io/protomaps/go-pmtiles:latest \
    extract https://download.mapterhorn.com/planet.pmtiles /d/dem.pmtiles \
    --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=2
fi
ls -l "$BUILD/dem.pmtiles"

log "2/4 serving DEM privately"
docker network create "$NET" >/dev/null 2>&1 || true
docker rm -f hatiwal_hs_dem >/dev/null 2>&1 || true
docker run -d --name hatiwal_hs_dem --network "$NET" -v "$BUILD:/d:ro" \
  ghcr.io/protomaps/go-pmtiles:latest serve /d --port 8080 >/dev/null
trap 'docker rm -f hatiwal_hs_dem >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT

log "3/4 rendering hillshade (node:22 for node:sqlite; sharp installed in a throwaway dir)"
rm -f "$BUILD/hillshade.mbtiles"
docker run --rm --network "$NET" --cpus=1.5 --memory=1500m \
  -v "$ROOT/tools:/tools:ro" -v "$BUILD:/out" node:22-slim sh -c "
    set -e; mkdir -p /app && cd /app && npm init -y >/dev/null && npm i --silent sharp@0.34 >/dev/null
    cp /tools/hillshade.mjs /app/
    nice -n 19 node --no-warnings hillshade.mjs --src 'http://hatiwal_hs_dem:8080/dem/{z}/{x}/{y}.webp' \
      --mbtiles /out/hillshade.mbtiles --bbox $BBOX --minzoom 0 --maxzoom $MAXZOOM \
      --quality $QUALITY --mode shadow --concurrency 3"

log "4/4 convert + sanity gates + atomic swap"
rm -f "$ROOT/tiles/.hillshade.incoming.pmtiles"
$LOW docker run --rm -v "$BUILD:/b" -v "$ROOT/tiles:/t" ghcr.io/protomaps/go-pmtiles:latest \
  convert /b/hillshade.mbtiles /t/.hillshade.incoming.pmtiles
size=$(stat -c %s "$ROOT/tiles/.hillshade.incoming.pmtiles")
[ "$size" -gt 20000000 ] || { log "REFUSING: output only $size bytes"; exit 1; }
for t in "6/44/25" "10/708/404" "10/704/406"; do   # Afghanistan z6, Salang, Bamyan
  docker run --rm -v "$ROOT/tiles:/t:ro" ghcr.io/protomaps/go-pmtiles:latest \
    tile /t/.hillshade.incoming.pmtiles ${t//\// } | head -c 4 | grep -q RIFF \
    || { log "REFUSING: tile $t missing or not WebP"; exit 1; }
done
[ -f "$ROOT/tiles/hillshade.pmtiles" ] && mv -f "$ROOT/tiles/hillshade.pmtiles" "$ROOT/tiles/hillshade.prev.pmtiles"
mv -f "$ROOT/tiles/.hillshade.incoming.pmtiles" "$ROOT/tiles/hillshade.pmtiles"
[ "${KEEP_DEM:-0}" = 1 ] || rm -f "$BUILD/dem.pmtiles"
log "done: tiles/hillshade.pmtiles $(du -h "$ROOT/tiles/hillshade.pmtiles" | cut -f1). go-pmtiles serves it at /hillshade/{z}/{x}/{y}.webp"
log "verify: curl -s -o /dev/null -w '%{http_code} %{size_download}\\n' https://map.hatiwal.com/hillshade/6/44/25.webp"
