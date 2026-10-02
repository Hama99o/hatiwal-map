#!/usr/bin/env bash
# Recreate map.hatiwal.com from nothing.
#
# WHY THIS FILE EXISTS: the first deployment was done by hand over SSH, so the
# only record of it was a chat transcript. A crash would have self-healed
# (both containers are `unless-stopped` and kamal-proxy persists its routes in a
# volume) — but a rebuilt VPS, or a `docker system prune`, would have left
# nothing to run. Un-reproducible infrastructure is the worse failure: it does
# not page anyone, it just cannot be restored.
#
# Idempotent. Safe to re-run.
#
#   HOST=<vps> SSH_USER=kamal SSH_KEY=~/.ssh/id_ed25519 ./deploy/deploy.sh
#
# Host and key come from the environment, never this file — see the workspace
# rule about infrastructure addresses staying in gitignored .env.production.
set -euo pipefail

: "${HOST:?set HOST (see hatiwal-api/.env.production KAMAL_HOST)}"
SSH_USER="${SSH_USER:-kamal}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
DOMAIN="${DOMAIN:-map.hatiwal.com}"
REMOTE="/home/${SSH_USER}/hatiwal-map"
# The live tileset is Afghanistan + Pakistan + Iran (904 MB, built 2026-09-13;
# RUNBOOK section 3). It is uploaded ONLY with UPLOAD_TILES=1: on 2026-10-02 this
# script's old default re-uploaded a stale 138 MB Afghanistan-only file over the
# correct one during the VPS migration, and Pakistan/Iran went blank.
TILES="${TILES:-tmp/data/pk1/hatiwal3.pmtiles}"
UPLOAD_TILES="${UPLOAD_TILES:-0}"
MIN_TILES_BYTES=500000000   # anything smaller is not the 3-country build

ssh_() { ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" "${SSH_USER}@${HOST}" "$@"; }
scp_() { scp -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" "$@"; }

echo "==> 1/6 remote dirs"
ssh_ "mkdir -p ${REMOTE}/tiles ${REMOTE}/static/styles ${REMOTE}/static/fonts"

echo "==> 2/6 tiles"
if [ "$UPLOAD_TILES" != "1" ]; then
  echo "    skipped: leaving the server's tiles as they are (set UPLOAD_TILES=1 to replace them)."
elif [ -f "$TILES" ] && [ "$(stat -c %s "$TILES")" -ge "$MIN_TILES_BYTES" ]; then
  # Upload beside the live file, check it arrived whole, then swap, so no
  # request ever reads a partial one.
  scp_ "$TILES" "${SSH_USER}@${HOST}:${REMOTE}/tiles/.incoming.pmtiles"
  LOCAL_MD5=$(md5sum "$TILES" | cut -d' ' -f1)
  ssh_ "cd ${REMOTE}/tiles && [ \"\$(md5sum .incoming.pmtiles | cut -d' ' -f1)\" = $LOCAL_MD5 ] && mv .incoming.pmtiles afghanistan.pmtiles" \
    || { echo "    upload checksum mismatch: live tiles NOT replaced"; exit 1; }
elif [ -f "$TILES" ]; then
  echo "    REFUSING: $TILES is $(stat -c %s "$TILES") bytes, smaller than the 3-country build. Live tiles NOT replaced."
  exit 1
else
  echo "    no local $TILES — leaving whatever is on the server."
  echo "    regenerate with: docker run --rm -v \"\$PWD/tmp/data:/data\" \\"
  echo "      ghcr.io/onthegomap/planetiler:latest --area=afghanistan \\"
  echo "      --languages=ps,fa,en --output=/data/afghanistan.pmtiles --force --download"
fi

echo "==> 3/6 styles"
scp_ styles/*.json "${SSH_USER}@${HOST}:${REMOTE}/static/styles/"

echo "==> 4/6 fonts (glyph PBFs — self-hosted on purpose: a style pointing at"
echo "    someone else's font server is the dependency CARTO just sprang on us)"
if [ -d tmp/serve/fonts ] && [ -n "$(ls -A tmp/serve/fonts 2>/dev/null)" ]; then
  tar -C tmp/serve/fonts -czf tmp/fonts.tgz .
  scp_ tmp/fonts.tgz "${SSH_USER}@${HOST}:${REMOTE}/fonts.tgz"
  ssh_ "tar -C ${REMOTE}/static/fonts -xzf ${REMOTE}/fonts.tgz && rm ${REMOTE}/fonts.tgz"
else
  echo "    no local glyphs — leaving the server's. Rebuild them with:"
  echo "      curl -sLO https://github.com/openmaptiles/fonts/releases/download/v2.0/v2.0.zip"
fi

echo "==> 5/6 containers"
scp_ deploy/nginx.conf "${SSH_USER}@${HOST}:${REMOTE}/nginx.conf"
ssh_ "
  set -e
  docker rm -f hatiwal_map_tiles hatiwal_map_web >/dev/null 2>&1 || true
  # Tile server: reads the pmtiles file directly, no database, no tile cache.
  docker run -d --name hatiwal_map_tiles --restart unless-stopped --network kamal \
    -v ${REMOTE}/tiles:/tiles:ro \
    ghcr.io/protomaps/go-pmtiles:latest serve /tiles --port 8080 --cors '*'
  # Front door: static styles + glyphs, proxies tiles. One entry point so CORS
  # and caching behave identically for everything a client fetches.
  docker run -d --name hatiwal_map_web --restart unless-stopped --network kamal \
    -v ${REMOTE}/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
    -v ${REMOTE}/static:/srv/static:ro \
    nginx:alpine
"

echo "==> 6/6 proxy route + TLS"
ssh_ "docker exec kamal-proxy kamal-proxy deploy hatiwal_map \
  --target hatiwal_map_web:80 --host ${DOMAIN} --tls \
  --health-check-path /styles/hatiwal-light-en.json"

echo "==> verify (public, over TLS)"
for u in "styles/hatiwal-light-ps.json" "afghanistan/metadata" "afghanistan/12/2835/1628.mvt"; do
  printf "    %-42s " "$u"
  curl -s -o /dev/null --max-time 20 -w "http=%{http_code} %{size_download}B\n" "https://${DOMAIN}/${u}"
done
echo "==> done. If a tile 404s but metadata is 200, the pmtiles file is stale or"
echo "    the swap in step 2 did not run — check ${REMOTE}/tiles."
