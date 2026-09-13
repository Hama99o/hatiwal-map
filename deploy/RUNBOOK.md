# map.hatiwal.com — operations runbook

The README explains *why* this service exists and how it was designed. This file
is for the moment something is wrong, or you need to change what it serves.

Everything here is safe to run against production. Nothing here needs a rebuild
of the VPS.

---

## 0. Is it up? (start here, always)

```bash
for u in styles/hatiwal-light-en.json styles/hatiwal-dark-ps.json \
         afghanistan/metadata afghanistan/12/2835/1628.mvt; do
  printf '%-42s ' "$u"
  curl -s -o /dev/null --max-time 20 -w 'http=%{http_code} %{size_download}B\n' \
    "https://map.hatiwal.com/$u"
done
```

Healthy looks like: every line `http=200`, the style ~2-6 KB, `metadata` a few
hundred bytes, the `.mvt` tile **tens of KB**.

**A 200 with a tiny body is the failure worth knowing about.** A `0B` or ~`15B`
tile means the archive is being served but has no data at that tile — stale or
half-uploaded file, not a dead service. See §4.

> `curl -I` is NOT a health check here. It never decodes a body, so it reported
> `200` throughout the CORS outage that made every client render a blank map.
> Use the loop above, or the real renderer in §5.

---

## 1. What actually runs

Two containers on the VPS, both `--restart unless-stopped`, both on the `kamal`
docker network so `kamal-proxy` can route to them:

| container | image | role |
|---|---|---|
| `hatiwal_map_tiles` | `ghcr.io/protomaps/go-pmtiles` | serves `/tiles/afghanistan.pmtiles` directly. No database, no tile cache, no state. |
| `hatiwal_map_web` | `nginx:alpine` | front door: static styles + glyph fonts, proxies tile requests. One entry point so CORS and caching behave identically for everything a client fetches. |

On disk, under `/home/kamal/hatiwal-map/`:

```
tiles/afghanistan.pmtiles     the whole dataset — one file
static/styles/*.json          6 styles: hatiwal-{light,dark}-{en,ps,fa}.json
static/fonts/                 glyph PBFs, self-hosted on purpose
nginx.conf                    the front door's config
```

TLS and routing are `kamal-proxy`'s, with a health check on
`/styles/hatiwal-light-en.json`. Routes survive a reboot — the proxy persists
them in a volume.

---

## 2. Redeploy / restore from nothing

`deploy/deploy.sh` is idempotent and recreates the whole service. Run it after a
VPS rebuild, a `docker system prune`, or any time you are unsure what is on the
server:

```bash
HOST=<vps-ip> SSH_USER=kamal SSH_KEY=~/.ssh/id_ed25519 ./deploy/deploy.sh
```

`HOST` comes from `hatiwal-api/.env.production` (`KAMAL_HOST`) — never from a
committed file.

It uploads tiles (only if a local copy exists), styles, fonts and `nginx.conf`,
recreates both containers, re-registers the proxy route, then verifies over
public TLS. Missing local tiles or fonts are left alone rather than blanked, so
running it to fix a style can never wipe the dataset.

**Just need a bounce?** Nothing is being rebuilt, so restart in place:

```bash
ssh kamal@<vps> 'docker restart hatiwal_map_tiles hatiwal_map_web'
```

---

## 3. Changing what it serves

### A style (colour, labels, fonts, zoom behaviour)

**Do NOT hand-edit a style file.** All six are generated:

```bash
node build-styles.mjs        # rewrites all 6 from one source of truth
```

They differ only in palette (light/dark) and label language (en/ps/fa), and six
hand-maintained copies is how one bad expression took every one of them down at
once. Edit the generator, re-run it, then:

```bash
# 1. Validate the styles IN YOUR TREE, before anything is uploaded.
#    The harness defaults to the LIVE host, so without MAP_BASE you score the
#    deployed files and your change is untested — a "before/after" screenshot
#    then shows no difference for the same reason.
python3 - <<'EOF' &   # a CORS-capable static server; plain http.server is not
import functools,http.server,socketserver
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin","*"); super().end_headers()
socketserver.TCPServer.allow_reuse_address=True
socketserver.TCPServer(("127.0.0.1",8099),H).serve_forever()
EOF
MAP_BASE=http://127.0.0.1:8099 node test/render-test.mjs   # MUST be 18/18
MAP_BASE=http://127.0.0.1:8099 node test/screenshot.mjs    # then LOOK at tmp/

# 2. Ship. A style-only change needs no container restart — nginx serves them
#    from a read-only mount — so scp is enough and causes no downtime.
#    Keep a rollback copy first.
ssh $SSH_USER@$KAMAL_HOST 'cd /home/kamal/hatiwal-map/static && rm -rf styles.prev && cp -r styles styles.prev'
scp styles/*.json $SSH_USER@$KAMAL_HOST:/home/kamal/hatiwal-map/static/styles/
node test/render-test.mjs                 # now against LIVE — MUST be 18/18
```

Rollback is `cp -r styles.prev/. styles/` on the server, or re-run the generator
from an earlier commit and scp again.

> MapLibre rejects `line-join` / `line-cap` in `paint` — they are LAYOUT
> properties. It reports this as `unknown property` at load time, which the local
> render catches and a deployed style would only whisper into a user's console.

Clients pick styles up immediately — the URL is unchanged, so there is no cache
to bust. **Always run the render test first**: a style that MapLibre rejects
fails silently, drawing nothing rather than erroring. See §4 for the specific
trap that blanked all six at once.

### The tiles (new OSM data, or a bigger area)

The tileset now covers **Afghanistan + Pakistan + Iran** (862 MB, zoom 0-14,
built 2026-09-13 in 19m27s). Geofabrik has no combined extract, so the three are
merged first:

```bash
cd tmp/data/pk1
for c in afghanistan pakistan iran; do
  curl -sL -C - -o $c.osm.pbf "https://download.geofabrik.de/asia/$c-latest.osm.pbf"
done
# osmium, NOT `cat`: a concatenation of PBFs is not a valid PBF, and objects that
# appear in two extracts along a shared border would be duplicated.
osmium merge afghanistan.osm.pbf pakistan.osm.pbf iran.osm.pbf -o hatiwal3.osm.pbf

docker run --rm -v "$PWD:/data" ghcr.io/onthegomap/planetiler:latest \
  --osm_path=/data/hatiwal3.osm.pbf --output=/data/hatiwal3.pmtiles \
  --languages=ps,fa,en,ur --bounds=44.0,23.6,77.9,39.8 --threads=6 --force --download
```

Four things that each cost time to rediscover:

- **`--download` is required even though `--osm_path` is given.** The
  OpenMapTiles profile also needs lake centerlines, water polygons and Natural
  Earth; without it planetiler dies in 3 seconds on `lake_centerline.shp.zip
  does not exist`.
- **`--osm_path` takes ONE file.** Hence the merge; there is no multi-area flag.
- **Use the Docker image, not `tmp/planetiler.jar`.** The jar needs Java 21 and
  this host has 17 — it fails with `UnsupportedClassVersionError`, class file 65
  vs 61.
- **`--threads` matters if anything else is running.** The default takes every
  core; at 6 the two QA emulators kept working through the whole build.

`--languages` is **not optional**: planetiler's default set excludes `name:ps`,
and without it Pashto users get Latin transliterations (`ql'h mḥmd ḥsn khạn
rkạh`) instead of `قلعه محمد حسن خان رکاه`. `ur` joined the list for the same
reason — before it, `name:ur` was absent from the data and no style file could
have produced an Urdu map.

Then deploy: see **§3a, Replacing the tileset by hand**, below. `deploy.sh` also
works and uploads atomically (`.incoming.pmtiles` then `mv`).

### 3a. Replacing the tileset by hand

```bash
# 1. Upload to a TEMP NAME — go-pmtiles is reading the live file.
rsync -a --partial --inplace -e 'ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes' \
  tmp/data/pk1/hatiwal3.pmtiles kamal@$HOST:/home/kamal/hatiwal-map/tiles/afghanistan.pmtiles.new

# 2. PROVE it arrived intact before touching anything live.
md5sum tmp/data/pk1/hatiwal3.pmtiles
ssh kamal@$HOST 'md5sum /home/kamal/hatiwal-map/tiles/afghanistan.pmtiles.new'

# 3. Rollback copy, then an ATOMIC rename.
ssh kamal@$HOST 'cd /home/kamal/hatiwal-map/tiles \
  && cp -f afghanistan.pmtiles afghanistan-af-only.rollback.pmtiles \
  && mv -f afghanistan.pmtiles.new afghanistan.pmtiles && chmod 644 afghanistan.pmtiles'

# 4. Restart tiles AND THEN nginx. Skipping nginx 502s every tile — see §4.
ssh kamal@$HOST 'docker restart hatiwal_map_tiles && docker restart hatiwal_map_web'

# 5. Verify with REAL TILES in the new area. A style 200 proves nothing about
#    tile data; styles come off a different mount entirely.
```

**Keep the deployed FILE NAME.** go-pmtiles derives the URL path from it, and the
Play Store build reads the tile URL out of the style JSON we serve rather than
compiling it in — renaming `afghanistan.pmtiles` 404s every installed client into
a blank map. The name is a misnomer now; that is by far the cheaper problem.

### Adding another country later

Two changes, **in this order**: rebuild the tileset covering it, deploy that,
and only THEN widen the bounds each client clamps its camera to. Doing it the
other way round lets the camera pan into grey nothing, which is worse than the
honest lock it replaced — that mistake is exactly what the 2026-09-13 Pakistan
report was.

The clamps are `SERVICE_AREA_BOUNDS` in mobile `MapCanvas.tsx` and
`SERVICE_AREA_BOUNDS` / `isInServiceArea` in web `src/lib/geo.ts`. Both must
match the `bounds` in `build-styles.mjs` and the planetiler `--bounds` exactly,
or MapLibre asks for tiles that do not exist, or refuses to ask for ones that
do. Geocoding has its own list: `countrycodes` in mobile
`utils/geocoding.ts` and web `location-search.tsx`.

---

## 4. Troubleshooting — symptom → cause → fix

Every row here has actually happened.

| Symptom | Cause | Fix |
|---|---|---|
| Map area is blank in a browser, console shows a bare `net::ERR_FAILED`, no CORS message | **Duplicate `Access-Control-Allow-Origin`.** `go-pmtiles --cors '*'` sends one and nginx `add_header` sent another; browsers reject two. `curl -I` showed both headers looking fine. | Exactly ONE layer sets CORS. Keep it on the tile server; do not re-add it in `nginx.conf`. |
| All labels vanish from every style at once; tiles still load | **MapLibre requires `interpolate`-on-zoom to be the OUTERMOST expression** in `text-size`. Wrapping two `interpolate`s in a `case` is invalid and fails silently — this took the render test from 18/18 to 0/18 instantly. | Put `interpolate` outermost; branch inside it. Re-run `node test/render-test.mjs`. |
| Pashto labels render as Latin transliteration | Tiles were built without `name:ps` | Regenerate with `--languages=ps,fa,en` (§3) |
| Style URL 404s | Wrong filename. The only six are `hatiwal-{light,dark}-{en,ps,fa}.json` | Check the client's URL builder; on mobile that is `styleUrl()` in `MapCanvas.tsx` |
| Tile 404 but `metadata` returns 200 | The pmtiles file is stale, or the swap in step 2 of `deploy.sh` did not run | `ls -l /home/kamal/hatiwal-map/tiles/` — look for a leftover `.incoming.pmtiles` |
| Map is light while the app is dark | A CLIENT bug, not this service — the client asked for the light style. Both exist and are served. | Mobile: the theme must come from `useColors().isDark`, never a framework colour-scheme hook. Web: read the `.dark` class. |
| Everything 502/503 | Containers are gone or the proxy route was lost | `docker ps \| grep hatiwal_map`; if missing, re-run `deploy.sh` (§2) |
| **Tiles 502 but STYLES 200, right after restarting `hatiwal_map_tiles`** | **nginx cached the tiles container's OLD IP.** `hatiwal_map_web` resolves `hatiwal_map_tiles` once at startup; restarting tiles gives it a new address on the `kamal` network and nginx keeps proxying to the dead one. Styles keep working because nginx serves those from its own read-only mount — that split is the tell. | `docker restart hatiwal_map_web`. Verify with a real tile, not the style: `curl -o /dev/null -w '%{http_code} %{size_download}' https://map.hatiwal.com/afghanistan/12/2835/1628.mvt` |

---

## 5. Verifying for real

`test/render-test.mjs` loads each style in a headless browser and asserts the map
paints — 18 cases (6 styles × 3 checks). It is the only check that catches a
silently-invalid style or a CORS regression, because it renders instead of
inspecting headers.

```bash
node test/render-test.mjs      # expect 18/18
node test/screenshot.mjs       # writes images to look at by eye
```

Mobile has its own end-to-end proof: `hatiwal-mobile/maestro/mapqa/` drives all
four map surfaces across en/ps/fa × light/dark (6 cells), and
`maestro/maps/zoom_controls_not_occluded.yaml` covers the fullscreen controls.

---

## 6. Known gap: nothing watches this

There is **no uptime monitoring**. If `map.hatiwal.com` stops answering, every
map in every client goes blank at once and the first report will come from a
user. Mitigating factors, measured rather than assumed: both containers are
`unless-stopped`, the proxy persists its routes, the service is stateless (one
read-only file), and it needs no database.

The cheap fix when it matters: an external HTTP check on
`https://map.hatiwal.com/styles/hatiwal-light-en.json` every few minutes. That
single URL is also the proxy's own health check, so it fails exactly when routing
or the front door fails.

---

## 7. Rollback

There is no versioned artifact to roll back to — the service is one data file
plus six JSON styles. So:

- **A bad style**: styles live in git. Revert the file and re-run `deploy.sh`.
- **Bad tiles**: keep the previous `.pmtiles` locally before regenerating.
  Re-uploading it is the rollback, and the swap is atomic.
- **A bad container image**: both images are pinned by tag in `deploy.sh`. Pin a
  digest there if a `:latest` ever regresses.

---

## 8. Adding MORE data — measured, and deliberately deferred (2026-09-01)

The owner asked whether a much larger dataset would give more detail in
Jalalabad, Kabul, Herat, Kunar, Laghman, Nuristan and elsewhere. Measured first,
one z14 viewport per place, counting rendered features:

| place | road segments | NAMED roads | buildings |
|---|---|---|---|
| Kabul | 196 | 17 | 33 |
| Herat | 98 | 20 | 3 |
| Jalalabad | 65 | 8 | 2 |
| Bamyan | 62 | 4 | 3 |
| Mehtarlam (Laghman) | 74 | 1 | 1 |
| Asadabad (Kunar) | 12 | 1 | 1 |
| Farah | 98 | 0 | 3 |
| Parun (Nuristan) | 10 | 0 | 1 |

**FILE SIZE IS NOT THE LEVER.** OSM content is. Outside the big cities the roads
exist as geometry with no names and almost no buildings, because nobody has
mapped them. Raising `maxzoom` renders the SAME information more precisely — in
Kabul and Herat that looks sharper; in Nuristan it renders the same 10 roads,
crisper. A ~5 GB tileset (maxzoom ≈ 17) would not add one street name.

What would actually add information, in value order:

1. **maxzoom 14 → 15.** Cheap (~15–30 min on a 16-core box, ~350–450 MB vs
   132 MB), sharpens z15+ geometry where a meetup is pinpointed. No code change:
   the style follows the archive. Nothing below z15 changes.
2. **Terrain — hillshade + contours.** The big one for the eastern mountain
   provinces. Elevation data (Copernicus/SRTM ~30m) exists EVERYWHERE regardless
   of whether anyone mapped the ground, so it fills exactly the provinces OSM
   leaves blank. A separate raster tileset, legitimately GB-scale, and a real
   project rather than a tweak.
3. **Sentinel-2 imagery** (ESA Copernicus, open licence, ~10m, self-hostable).
   Shows villages, fields and riverbeds where nothing is mapped at all. Biggest
   content win for rural Afghanistan; heaviest lift.
4. **OSM contributions.** The ONLY route to street names and buildings, and the
   one where this product has an unfair advantage: its users hold the local
   knowledge, and their edits land in these tiles at the next regeneration.

NOT an option, ever: Google. Self-hosting their tiles is forbidden, it requires
billing, and their terms bar using their data to build a competing map — which is
the dependency this whole service exists to escape.

Status: **deferred by the owner** — "leave it like this, with time we will
decide". The tiles are current (OSM snapshot 2026-08-30) and refreshing them is
§3, a manual step with no automation on the VPS.

