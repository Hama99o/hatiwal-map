# hatiwal-map — self-hosted map tiles

`map.hatiwal.com` — the basemap behind every map surface in Hatiwal, served from our own VPS.

**Status:** planned, not yet built. Written 2026-08-31.
**Owner decision:** self-host. No API key, no monthly cap, no provider able to change the terms.

Every number in this document was **measured**, not estimated. Where something is unmeasured it
says so.

---

## 1. Why this exists

### The map is broken in production, on Android, right now

`hatiwal-mobile/src/components/common/map/MapCanvas.android.tsx` ships:

```js
// Free, keyless OSM raster tiles served by CARTO.   <- this comment is now FALSE
light: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
dark:  "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
```

CARTO now **keys** that endpoint. The way it enforces it is why nobody caught this in code:

```
GET https://basemaps.cartocdn.com/rastertiles/voyager/5/20/12.png
-> HTTP 200, 12548 bytes, a valid 256x256 PNG
-> with "API KEY REQUIRED  carto.com/basemaps/apikey" watermarked diagonally across it
```

**HTTP 200.** No error, no log line, nothing to retry. The app cheerfully draws a defaced map.
Verified by fetching a tile and looking at it. All four CARTO styles were probed at multiple
zooms — voyager, dark_all, light_all, rastertiles/dark_all — every one watermarked, so no CARTO
style escapes it. It gets worse over time as cached tiles on users' phones expire.

### The three clients currently disagree, and two of them are wrong

| Client | Engine | Tiles from | State |
|---|---|---|---|
| **Android** | MapLibre | CARTO | **broken** — watermark, live in production |
| **Web** | Leaflet | `tile.openstreetmap.org` | works, but **against OSM's tile policy** — it is a courtesy service that explicitly discourages app traffic, and they block clients that lean on it |
| **iOS** | `react-native-maps` `PROVIDER_DEFAULT` | nobody — **Apple Maps**, built into the phone | fine, needs nothing |

So Android is broken and web is on borrowed time, for two different reasons. iOS has no problem.

### Why not just get a free key

Considered and rejected by the owner: no payment, and no wish to be re-hostaged. A free tier is
free until it is not — which is exactly what CARTO just did. A key shipped in a mobile app is also
extractable from the APK, so it is not a secret; providers manage that with quotas and app
restrictions, not secrecy.

**One thing a key would not fix either:** the planned map-search feature (below) multiplies tile
requests by 10-100x, which is precisely what burns through a free tier.

---

## 2. What we are building

```
                    map.hatiwal.com  (Kamal proxy + Let's Encrypt)
                              |
              +---------------+----------------+
              |                                |
    afghanistan.pmtiles                   style.json
    (the DATA — no design in it)     (the DESIGN — one file, read by all clients)
              |                                |
      +-------+--------+---------------+-------+
      |                |               |
   Android            iOS             Web
   MapLibre         MapLibre      MapLibre GL JS
```

**The data contains no design.** That lives in `style.json` — colours, line widths, fonts, what
appears at which zoom. Because all three clients read *the same* style file, they cannot drift.
That is what makes "all three identical" a guarantee rather than an aspiration.

### Vector, not raster — and why that changed

Raster (finished PNG images) would be a one-line URL change on Android and web, no library swaps.
It was the initial recommendation. It lost once the owner's goal became **all three identical, with
our own design**:

| | Raster | **Vector (chosen)** |
|---|---|---|
| Size | several GB, and **doubles** for a dark set | ~50-200 MB total |
| Design | baked in at generation; can't change without regenerating | one `style.json`, editable |
| Dark mode | a second complete tile set | a style swap |
| Sharpness | blurs between zoom levels | renders on-device, crisp at any zoom |
| Zoom depth | needs tiles at every level you want | stops at z14 and **overzooms** smoothly |
| Labels | baked in Latin script | can use OSM's `name:ps` / `name:fa` |
| Web cost | Leaflet works as-is | Leaflet must become MapLibre GL JS |

The overzoom point is why the file stays small **without** losing zoom: the client keeps scaling
z14 data smoothly past street level. You do not store z18 to reach z18.

### Labels in Pashto and Dari — a real product win

OSM carries multilingual name tags (`name:ps`, `name:fa`). With our own style we can render Kabul's
streets and districts in the app's own language. Today a Pashto user gets a Pashto app wrapped
around a Latin-script map. CARTO cannot do this at all.

**Honest caveat:** coverage of those tags depends on what OSM contributors have added, and it is
uneven in Afghanistan — Kabul far better than rural areas. Where absent, fall back to `name`.

---

## 3. The map is a SEARCH surface, not a navigation map

The owner's framing, and it shapes every decision: *"the goal is it's not a map of the world but of
searching things"*. The intended feature is map-based discovery — search for a car, open a map, see
which cities have one, with prices, zoom in.

Consequences:

- **No world coverage.** Afghanistan only. Neighbours can be added later as separate extracts.
- **No deep zoom needed.** Nobody navigates on it, so the zoom cap can be shallow — smaller again.
- **The basemap must be QUIET.** This is the important design point: the listings are the content,
  the map is a backdrop. Zillow, Airbnb and leboncoin all use muted, desaturated basemaps for
  exactly this reason — a pretty, detailed map **competes with the price bubbles** and makes them
  harder to read. Same rule the design system already applies to listing cards: photo first, price
  prominent, everything else quiet.
- **Lock the map bounds to Afghanistan.** Outside it there are no tiles, and for a local marketplace
  panning to Brazil is not a feature.

### What the search feature actually needs (the tiles are the cheap part)

| Piece | Where it lives | Effort |
|---|---|---|
| Quiet Afghanistan basemap | this repo | small |
| **Listings aggregated by area — counts + price range, bounded to the visible map** | `hatiwal-api` | **this is the real feature** |
| Price bubbles + clustering | MapLibre, client-side | free, built in |
| Directions / routes | **already shipped** | none |

Directions are already handled and should stay that way — `ListingMapSection.tsx:75-82` hands off
to the phone's own maps app (`maps://app?daddr=` on iOS, Google Maps deep link on Android). Routing
is a heavy service (road graphs, turn restrictions, traffic); Google and Apple do it better than we
would, for free.

---

## 4. Measured facts

### The source data

```
https://download.geofabrik.de/asia/afghanistan-latest.osm.pbf
  -> 302 to afghanistan-260830.osm.pbf
  -> Content-Length: 112,335,439  (107 MB)
  -> Last-Modified: Mon, 31 Aug 2026 01:43:45 GMT
```

**107 MB for all of Afghanistan**, and Geofabrik rebuilds daily — that file was hours old when
measured. Free, no account.

**Freshness:** the extract is ~1 day behind live OSM. Generated tiles are frozen until regenerated,
so "latest" means "how often do we re-run this". **Monthly or quarterly is ample** for a
marketplace — Kabul's street layout does not change weekly. Nothing breaks if it is not refreshed;
the map simply reflects an older snapshot.

**Data quality is unchanged by this move.** CARTO renders OSM. OSM's tiles render OSM. Ours will
render OSM. Same source, same detail — only the styling differs.

### The VPS (measured over SSH, read-only)

```
DISK    72G total ·  21G used ·  52G FREE  (29%)
RAM     7.7G total · 3.3G used · 4.4G available
CPU     4 cores · load 0.20 / 0.15 / 0.10   <- essentially idle
DOCKER  17.4G images, 24 images / 34 containers
```

**Space is a non-issue** — ~10x the headroom needed even for the wasteful raster option. The box is
doing almost nothing.

### DNS, already done by the owner

```
map.hatiwal.com  ->  <VPS_IP — see gitignored .env.production>   (same A record as @, api, www)
port 80  OPEN
port 443 OPEN
https://map.hatiwal.com/  ->  TLS handshake fails: no certificate for that hostname yet
```

So DNS is live; what is missing is a cert (Kamal proxy must learn the hostname) and something to
serve.

---

## 5. Plan

Ordered so that each step makes the next one smaller.

### Step 0 — privacy first (`hatiwal-api`, board card 304)

**Do this before the tiles.** Verified live, unauthenticated:

```
curl http://localhost:3007/api/v1/listings/897      (no token)
  location : Kabul, Kabul District, Kabul Province
  latitude : 34.52695    longitude: 69.185058
```

Six decimals is house-level precision, and the listing map draws it as an exact pin
(`radiusKm={0}`). A private seller's listing location is usually their home. leboncoin, Vinted and
Facebook Marketplace all show an approximate area instead — not for cost reasons, for safety.

It also **shrinks this project**: an approximate area needs no street-level zoom, and deep zooms are
most of the tile data. Privacy and cost point the same way. A search map works at city/district
level anyway, so the map feature and the privacy fix want *the same data*.

Fuzzing must be **stable per listing** — a fresh random offset per request lets an attacker average
many samples back to the true point. Distance sorting keeps using the true coordinates server-side;
only what is *sent* is coarsened.

### Step 1 — generate and measure, locally

Generate on the **dev machine** (16 cores), not the VPS. The VPS never does heavy work.
Produces the real numbers: file size, generation time, and a tile to look at.

### Step 2 — the style

Start from a free open quiet style (Protomaps / OpenMapTiles publish light and dark sets), then
brand it: lapis `#12224F`, gold `#E8B23A`. Add `name:ps` / `name:fa` label expressions with a
fallback to `name`.

### Step 3 — serve

Static file serving behind the existing Kamal proxy. **No tile-server process, no database** — a
single `.pmtiles` file read with HTTP range requests. Add `map.hatiwal.com` to the proxy so
Let's Encrypt issues a cert. Long cache headers: tiles are immutable.

**Free speed upgrade worth taking:** Cloudflare's free tier in front of `map.hatiwal.com`. Tiles are
static and immutable, so they cache at edge nodes — which fixes the Kabul-to-Europe latency
(unmeasured: this dev box is ~10ms from the VPS, which says nothing about Kabul) **and** keeps most
requests off the VPS entirely.

### Step 4 — point the clients at it

- **Android** — URL swap. Already MapLibre.
- **Web** — `hatiwal-web/src/components/map/map-impl.tsx`: Leaflet → MapLibre GL JS.
- **iOS** — MapLibre replaces Apple Maps. **Bonus:** `@maplibre/maplibre-react-native` supports both
  platforms, so `MapCanvas.android.tsx` + `MapCanvas.ios.tsx` collapse into **one** `MapCanvas.tsx`.
  Less code, not more — which is the no-duplication rule.

### Step 5 — ship

One **EAS build**. Mobile has no over-the-air updates, so a JS change does not reach installed
phones until a new build ships.

---

## 6. Risks, stated plainly

| Risk | Assessment |
|---|---|
| **iOS loses Apple Maps** | A real cost, not just a change. Apple Maps has better data in many places, native performance, zero infrastructure. Apple does **not** use OSM, so iOS may show **less detail** than today in parts of Afghanistan. **Worth comparing on a device before committing** — two good maps may beat three identical ones. |
| **iOS cannot be tested here** | Needs macOS + Xcode. The iOS half can be written and compiled but must be verified on a real device by the owner. |
| **Tiles share the box with the API** | Mitigated: static files, near-zero CPU, load is 0.20 today, and Cloudflare in front means most requests never arrive. |
| **Staleness** | Tiles are frozen until regenerated. Acceptable at monthly/quarterly; a cron job if wanted. |
| **OSM coverage in rural Afghanistan** | Sparse in places — but identical to what CARTO and OSM tiles already show, since they render the same data. Not a regression. |
| **Interim stopgap** | A QA agent switched Android to `tile.openstreetmap.org` (uncommitted). **Do not ship it** — it trades a cosmetic watermark for a terms violation, in a second client, and if OSM blocks us maps break *entirely*, which is worse than ugly. |

---

## 7. What this replaces

- No CARTO. No API key. No monthly cap. No provider terms to be changed under us.
- One tile source and one style for Android, web and (optionally) iOS.
- A basemap branded to Hatiwal, with labels in the user's own language.
- A foundation the map-search feature can afford, because panning is free.

---

## Operations

**Something wrong, or need to change what it serves? → [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md).**
Health check, redeploy, updating tiles/styles, a symptom→cause→fix table for
every failure that has actually happened here, and the rollback story.

## 8. What is LIVE (2026-08-31)

`https://map.hatiwal.com` is serving. All of this was verified from the public internet, and by
rendering a real map, not by reading headers.

```
tiles      132 MB pmtiles, zoom 0-14, 163,125 tiles, bounds = Afghanistan exactly
           generated in 2 min 57 s from the 108 MB Geofabrik extract
           OSM data date 2026-08-30 20:21 UTC
cert       CN=map.hatiwal.com, Let's Encrypt, valid to 29 Nov 2026
latency    ~100-120 ms per tile from Europe (Kabul UNMEASURED - see §6)
```

### On the VPS

| Container | Role |
|---|---|
| `hatiwal_map_tiles` | `go-pmtiles serve` over the read-only tile file, port 8080, `kamal` network |
| `hatiwal_map_web` | nginx front door: static styles + glyphs, proxies tiles. Registered with `kamal-proxy` for `map.hatiwal.com` |

Both `--restart unless-stopped`. Files live in `/home/kamal/hatiwal-map/{tiles,static,nginx.conf}`.

### URLs

```
/afghanistan/{z}/{x}/{y}.mvt        vector tiles
/afghanistan/metadata               tileset metadata
/styles/hatiwal-{light,dark}-{en,ps,fa}.json
/fonts/{fontstack}/{range}.pbf      Noto Sans Regular + Italic, 256 ranges each
```

### Three bugs found here that `curl` reported as fine

**1. Duplicate `Access-Control-Allow-Origin`.** `pmtiles serve --cors "*"` sets its own, and a
server-level nginx `add_header` added a second. Two ACAO headers is an invalid response and browsers
refuse it with a bare `net::ERR_FAILED`. `curl -I` showed both lines and looked healthy read one at
a time; `curl -o /dev/null` never decodes a body, so it reported 200 throughout. **Only a real
browser render exposed it.** CORS is now set per-location — on the static blocks nginx owns, never on
the proxy.

**2. `name:ps` is NOT in the tiles.** Verified against a live Kabul tile: `name`, `name:latin`,
`name:nonlatin`, `name:fa`, `name:en` and ~70 other languages are present — Pashto is not, because it
is not in planetiler's default language set. A ps-first label chain therefore fell through to
`name:latin` and rendered **transliterations** ("ql'h mḥmd ḥsn khạn rkạh") to a Pashto speaker, which
is worse than useless. The chain now falls to Dari, which shares the Arabic script:
`name:ps -> name:fa -> name:nonlatin -> name -> name:latin`. Rendering confirms real joined script
(`کابل شار`, `ترہ خیل`, `قلعہ محمد حسن خان رکاہ`) with no tofu.
**Open question worth one experiment:** regenerate with `--languages=ps,fa,en` and see whether OSM
actually carries `name:ps` for Afghan places. If it does, that is the proper fix and the Dari
fallback becomes a backstop instead of the answer.

**3. Blank 2nd/3rd renders** were a page-reuse race in the render harness (re-entering `setContent`
against a live MapLibre instance), not a style fault. One fresh page per shot.

### Attribution — required, not optional

These tiles are OpenMapTiles-derived. Every map must visibly credit
**"© OpenMapTiles © OpenStreetMap contributors"**. It is set on the source in every style file so a
client cannot forget it.

### Refreshing the data

```bash
docker run --rm -v "$PWD/tmp/data:/data" ghcr.io/onthegomap/planetiler:latest \
  --area=afghanistan --output=/data/afghanistan.pmtiles --force --download
# then scp to the VPS and restart hatiwal_map_tiles
```
Three minutes. Monthly or quarterly is ample — Kabul's street layout does not change weekly.
