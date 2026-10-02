# Map v2 — "depth" redesign of map.hatiwal.com

**Status (2026-10-02):** owner approved the look ("seems to be good"). Built and verified
locally. **Not deployed:** the server steps (hillshade build, `/v2` staging, monthly tile
update) are scripted but not run yet.
The 8 live styles (`hatiwal-{light,dark}-{en,ps,fa,ur}.json`) are byte-identical to before
(md5-checked after every generator run). The owner reviews the previews before anything ships.

Owner brief (2026-10-02): *"show more graphic… a little bit 3D style, not really 3D but make it
look very 3D, good design, improve the colouring, both dark and light mode."*

---

## 1. Research: what real apps do

Sources: Mobbin (iOS), plus the published Apple Maps, Google Maps, Mapbox Standard and Protomaps
themes.

| Reference | What we took |
|---|---|
| [Tripadvisor map (Mobbin)](https://mobbin.com/screens/19f3c852-67e1-4d0c-8161-312ad653c3b8) | Warm off-white extruded buildings: depth comes from soft side shading, not colour |
| [Fresha on Apple Maps (Mobbin)](https://mobbin.com/screens/7fd4b74d-ab0a-45c3-b90c-438b0778940f) | Warm land, pale-yellow arterials, white minor roads: hierarchy at a glance |
| [Luma map (Mobbin)](https://mobbin.com/screens/fb378b19-93e3-4cac-b862-fd3208c4c59e) | Subtle relief shading under a busy marker layer, and it still stays readable |
| [Oura on Apple Maps dark (Mobbin)](https://mobbin.com/screens/615c3539-2598-4372-b221-5ef1d55a8c74) | Dark is blue-slate, not black, and water is a different hue from land |
| Mapbox Standard | One light source shared by extrusions + shadows; buildings fade in by zoom |
| Google Maps terrain | Hillshade is strong at country zoom and gone by street zoom |

**Direction for Afghanistan.** The country is mostly mountains, and people place themselves by
valleys and peaks, so **hillshade is the biggest single win**. The cities are dense low-rise, so
building **shadows** at pitch 0 do more than tall 3D towers would. Labels in Pashto, Dari and Urdu
need calm ground behind them, so all depth effects stay soft.

## 2. What v2 adds (all of it works at pitch 0)

| Layer | Effect | Zooms |
|---|---|---|
| `hillshade` | Mountain relief: pre-rendered shadow tiles (§4), NW light, opacity fades out by z15 | z0–15 |
| `building-shadow` | Footprint copy, darker, `fill-translate` down-right (viewport). Offset grows with zoom | z14+ |
| `building` | Tint deepens with zoom (faint texture at z14, solid blocks at z16) | z14+ |
| `building-3d` | Real `fill-extrusion` from `render_height`/`render_min_height`. At pitch 0 only roofs show; tilt and walls rise | z15+ |
| `road-major-shadow` | Blurred offset shadow under motorway/trunk/primary, so the city's spine "lifts" | z10+ |
| `water-shore` | Blurred deeper-blue shoreline: lakes read as basins | z8+ |
| `park-outline` | Deeper green edge: parks read as raised lawns | z13+ |
| landcover `rock`, `wetland` | Rock was missing, so the Hindu Kush drew as blank background | all |
| root `light` | One NW light shared by extrusions, shadows and hillshade | — |

**Building heights:** checked in the live tiles, not assumed. `building` carries `render_height`
and `render_min_height`. Sample from a Kabul z14 tile: 18 buildings, 12 of them >10 m. Planetiler
fills untagged buildings with a default, so no zoom-based fallback height is needed. The style
still has `coalesce(render_height, 6)` as a guard.

## 3. Palettes

**Light — "limestone daylight"**: ground `#F4F1EA`, residential `#ECE7DE`, commercial `#F3E6D8`,
park `#CFE4C1`, water `#A8CDE6` (shore `#7FAFD3`), buildings `#E0D9CD`→`#EAE4D9`, motorways pale
apricot `#FBEBC8` / casing `#E2C690`, minor roads white. Labels `#1A2236` on halo `#F7F5F0`.

**Dark — "brand navy night"**: ground `#0F1B38`, in the family of brand navy `#12224F`, so the map
looks like the app's own dark surface. Water `#0B2F52`: a teal-blue, deliberately a different hue
from the land, because the first draft used `#081430` and the Kabul river vanished. Roads slate
`#5C6A8E`, buildings `#1F2D52`→`#26365F`. Labels `#EEF2FA` on navy halo.

**Brand gold `#E8B23A` stays off the basemap** (v1 rule, kept): it belongs to the price markers.
Light motorways are pale apricot and dark motorways are slate, and neither can be mistaken for
gold.

## 4. Mountain shading: pre-rendered, not a live DEM

### 4a. Why not a live DEM (measured 2026-10-02)

The first v2 draft used a `raster-dem` source and a `hillshade` layer. On a phone viewport
(390×844 @2x) the raw DEM tiles cost:

| View | Live DEM | Vector tiles (decompressed) |
|---|---|---|
| Country z6 | 6 tiles, **1,277 KB** | 95 KB |
| Kabul z10 | 6 tiles, **850 KB** | 38 KB |

That is 10–20× the whole vector map, on metered Afghan mobile data. It was rejected and replaced
before anything shipped.

### 4b. What v2 uses: `tools/hillshade.mjs`

The shading is computed **once, on the server**, from the Mapterhorn DEM (open data, Terrarium
512px WebP, <https://mapterhorn.com/data-access/>):

- Horn slope/aspect per pixel. The 8 neighbour tiles' edges are read in, so there are no seams.
- North-west light at 45°, the same direction as the building shadows and extrusion light.
- **Shadows only**: one constant near-black navy colour, with shadow strength in the alpha channel.
  The colour channels become a flat fill and cost almost nothing to encode.
- 256px lossy WebP (quality 25), drawn at `tileSize: 512`. Shading is soft by nature, so the
  upscale is invisible.
- Drawn as a plain `raster` layer: opacity 0.5 in light and 1.0 in dark, fading out by z15.

How the format was found (tile sizes over the Hindu Kush, the densest relief in the service area):

| Variant | KB per tile |
|---|---|
| 512px, shadows + highlights, q60 | 150–178 |
| 256px, smooth colour ramp, q60 | 45–50 |
| 256px, smooth ramp, q40 | 38–43 |
| 256px, shadows only, q50 | 20–24 |
| **256px, shadows only, q25** ← chosen | **13–17** |

**Phone payload, measured with the chosen tiles** (390×844 @2x, v2 light):

| View | Hillshade | Vector on the wire (gzip) | vs live DEM |
|---|---|---|---|
| Country z6 | 6 tiles, **46 KB** | 112 KB | 28× lighter |
| Kabul z10 | 6 tiles, **66 KB** | 93 KB | 13× lighter |
| Kabul z13 | 1 tile, 11 KB | 271 KB | — |
| Kabul z15 | 0 (faded out) | 179 KB | — |

**maxzoom 10** is where the gain stops. A shading-only render at z12 (`tmp/v2/hs-cap-z9-vs-z10.png`)
is visibly sharper with z10 tiles than with z9. Above z12 the layer is fading out anyway (opacity
×0.6 at z12, ×0.2 at z14), so z11 would cost ~4× the tiles for detail nobody sees.

Trade-off: the light is baked in, so it does not rotate with the map. Every pre-rendered basemap
makes this trade. Dark mode loses the highlights the live layer had; shadows alone still read (see
`tmp/v2/dark-kabul-z10-hs25b.png`).

### 4c. Building it on the VPS: `tools/build-hillshade.sh`

The script runs entirely on the server, at nice 19 / ionice idle:
1. `pmtiles extract` of the DEM, AF+PK+IR, z0–10: **754 MB** (exact, from `--dry-run`).
2. Serves the DEM on a private docker network.
3. Renders the hillshade with `tools/hillshade.mjs` in `node:22-slim`, capped at 1.5 CPU and
   1.5 GB.
4. Packs it into MBTiles, then `pmtiles convert` → `tiles/hillshade.pmtiles`.
5. Runs gates (size, 3 sample tiles are WebP), then an atomic `mv`.

go-pmtiles serves it at **`https://map.hatiwal.com/hillshade/{z}/{x}/{y}.webp`**, because the file
name is the URL path. **No nginx change.**

Expected size: ~9,100 tiles × ~13 KB ≈ **120 MB**. Disk peak ≈ 1 GB, and the DEM is deleted at the
end. Expected time: ~30–60 min (local throughput ~0.25 s/tile; not yet measured on the VPS).

## 5. Labels (v2 only)

The tiles carry far more names than v1 drew. v2 shows more of them, sooner, ranked so that the
extra labels only fill gaps:

| Change | v1 | v2 |
|---|---|---|
| Towns / villages / suburbs + neighbourhoods | z8 / z11 / z13 | **z7 / z10 / z12** (hamlets stay z13), with a sort key so the bigger place wins a collision |
| Landmark POIs (mosque, hospital, school, bank, fuel…) | z15 | **z14** |
| Commerce POIs (shop, food, lodging…) | z16 | **z15** |
| Every other named POI | never | **z16**, ranked after landmarks |
| Street names | z12, all one size | z12 (unchanged: v1 already labels from z12), but main roads place **first** and read larger |
| House numbers | never | **z17+**, first label layer, so lowest priority |

**Name fallback**, so no label is blank while any name exists:

| Locale | Chain |
|---|---|
| ps | `name:ps → name:fa → name:nonlatin → name:en → name → name:latin` |
| fa | `name:fa → name:ps → name:nonlatin → name:en → name → name:latin` |
| ur | `name:ur → name:fa → name:nonlatin → name:en → name → name:latin` |
| en | `name:en → name → name:latin` |

**Deviation from the brief, measured.** The brief asked for `… → name:en → name`. With English
ahead of the local name, a Dari reader saw English for **187 Kabul features whose `name` was
already Dari script** (e.g. «سرک سمنت خانه» rendered as "Cement Khaneh Street"), plus 129 in
Herat and 154 in Islamabad. `name:nonlatin` (OpenMapTiles sets it to the local name when that is
already non-Latin) now sits before `name:en`. Re-measured over every named street, POI and place
in z14 views of Kabul (913), Herat (338) and Islamabad (1,492), with the fa chain: **0** Latin
labels where a local-script name exists, and **0** blank labels.

**Glyphs:** every Arabic-script range these labels need is self-hosted and live: 1536-1791,
1792-2047, 2048-2303 and the presentation forms 64256–65279. The local and live 1536-1791.pbf are
identical (96,133 B).

**Placed labels, v1 → v2** (phone 390×844, light, hillshade off; same counts in all 4 locales
within ±2):

| | z13 | z14 | z15 | z16 | z17 |
|---|---|---|---|---|---|
| Kabul (en) | 21 → 20 | 32 → **48** | 23 → 26 | 6 → **13** | 3 → 5 |
| Herat (en) | 18 → 17 | 21 → **30** | 23 → 26 | 13 → 16 | 9 → 10 |
| Islamabad (en) | 33 → 29 | 48 → **62** | 33 → 37 | 17 → 21 | 6 → 8 |

z13 stays flat (no clutter at city-scanning zoom). z14 gains ~50% from the landmarks. z16 roughly
doubles in Kabul. **House numbers are sparse in the data**, not hidden: 154 in the 9 z14 tiles
around central Kabul, 2 around Herat, against 8,443 around Karachi. They will appear as OSM gains
them; see `docs/OSM_NAMES.md` for how to add names and addresses.

House numbers are **filtered to real numbers** (no `+`, at most 8 characters). Measured in z14
views: Kabul keeps 149/154 (dropped: "End of Jada-E Maiwand", "Shop #12, GM Mall Market…"),
Tehran 426/451 (dropped: full Persian street addresses), Karachi 4,166/8,443 (dropped: imported
Plus Codes like `V2G8+FV` and "DHA Phase 2", which carpeted a z17 view before the filter),
Islamabad 46/78. Kept values look like `19`, `32A`, `B-1`, `1A/3`.

## 6. Monthly tile update: `tools/update-tiles.sh`

The script runs on the VPS from cron, at 02:00 UTC on the 1st:

```
0 2 1 * *  cd /home/kamal/hatiwal-map && flock -n /tmp/hatiwal-tiles.lock ./tools/update-tiles.sh >> logs/update-tiles.log 2>&1
```

Same build as 2026-09-13: Geofabrik afghanistan + pakistan + iran → `osmium merge` (in a throwaway
debian container) → planetiler `--languages=ps,fa,en,ur --bounds=44.0,23.6,77.9,39.8 --download`.
Resources: nice 19 / ionice idle, 2 threads, `-Xmx2g`, container memory cap 3 GB, `--storage=mmap`.
The local reference build took 19m24s with a heap peak of 1.9 GB at 6 threads. **The VPS
duration and peak RAM are not measured yet**; the script logs both.

**Gates before any swap:** ≥ 8 GB free disk to start; output ≥ 500 MB; declared bounds cover
44.0,23.6–77.9,39.8; Kabul, Herat, Islamabad, Karachi and Tehran tiles at z10/12/14 present
(> 100 B) and not under half their live size. Then: previous file kept as
`afghanistan.prev.pmtiles`, `mv`, restart **both** containers, and a public HTTPS check of
Islamabad z12. On failure it rolls back automatically.

Tested locally: the bounds gate passes the 3-country file and rejects the old AF-only one
(60.5,29.4–74.9,38.5). The tile gate first had a bug: `pmtiles tile` prints "Tile not found in
archive." to stdout and exits 0, so a missing tile counted as 27 bytes. It now detects that text.

## 7. Proposals for the apps (NOT done — need a release after 1.1.4)

- **3D toggle button** (cube icon) on full-screen maps: animate to `pitch: 55`. Walls rise and the
  same style serves both. No style change needed.
- Optionally open the full-screen map at a gentle `pitch: 30` at z15+ only. Keep listing maps flat,
  because markers are easier to tap top-down.
- Both work today with v2. They only need app code. The style already supports tilt.

## 8. Verification

- Style-spec validator (`@maplibre/maplibre-gl-style-spec` `validateStyleMin`): all 16 files valid.
- `node build-styles.mjs` then md5 of the 8 v1 files: unchanged.
- Render sweep (maplibre-gl 5.24.0, the web app's version, real live tiles), run twice: on the
  first live-DEM draft, and again on the FINAL styles (pre-rendered hillshade, new labels and name
  chains), both **96/96**: 8 v2 styles × Kabul/Herat/Salang × z6/10/13/16 = **96/96 pass**. No map errors, no
  failed requests, and labels drawn everywhere except Salang at z13/16, which is open mountain with
  nothing to label.
- Not yet verified: MapLibre **Native** (the RN app). `raster`, `fill-extrusion` and the root
  `light` are all supported by MapLibre Native 11, but no device render has been done. Do it on
  the QA emulator (point a dev build at the v2 URL) before the swap.
- Side-by-side previews: `MAP_BASE=http://127.0.0.1:8099 CHROME_PATH=/usr/bin/google-chrome node test/preview-v2.mjs`
  → `tmp/v2/{light,dark}-*.png` (9 views each: country z6, Hindu Kush, Bamyan, Kabul z10/z13/z16,
  z16 tilted, Herat z13, Islamabad z13 in Urdu).

## 9. Swapping v2 live (after approval)

1. In `build-styles.mjs`, write the v2 palettes to the **v1 file names**. Never rename the files:
   every installed app requests `hatiwal-{theme}-{lang}.json` by name. Sources, tile URL and glyph
   URL stay identical. v2 only ADDS the `hillshade` raster source.
2. Host `/hillshade` first (§4c). Without it the hillshade layer just draws nothing (tile 404s):
   the map still renders, but the main depth cue is gone.
3. RUNBOOK §3: keep a `styles.prev` rollback copy, scp, then re-run the render test against live.
