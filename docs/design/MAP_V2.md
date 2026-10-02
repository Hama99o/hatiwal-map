# Map v2 — "depth" redesign of map.hatiwal.com

**Status:** v2 styles built and previewed locally, 2026-10-02. **Not deployed, not live.**
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
| `hillshade` | Mountain relief. NW light, viewport-anchored. Exaggeration 0.6 → 0 | z0–15 |
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

## 4. Mountain shading: DEM cost (measured 2026-10-02, nothing downloaded)

Source: **Mapterhorn** (open terrain, Terrarium-encoded 512px WebP, `planet.pmtiles` z0–12,
<https://mapterhorn.com/data-access/>). `pmtiles extract --dry-run` reads only the archive
directories, so these sizes are exact:

| Extract (bbox) | maxzoom | Tiles | Archive size |
|---|---|---|---|
| AF + PK + IR `44.0,23.6,77.9,39.8` | **10** | 6,864 | **754 MB** ← recommended |
| AF + PK + IR | 11 | 26,650 | 2.2 GB |
| AF + PK + IR | 12 | 104,298 | 8.3 GB |
| AF only | 12 | — | 2.6 GB |

512px tiles at z10 have the detail of 256px z11 (~38 m/pixel at 34°N), which is plenty for
hillshade. MapLibre overzooms the DEM above that.

**Build/host plan (needs the owner's OK):** run the extract **on the VPS**, so nothing crosses the
office/hotspot link:

```bash
pmtiles extract https://download.mapterhorn.com/planet.pmtiles \
  /home/kamal/hatiwal-map/tiles/terrain.pmtiles \
  --bbox=44.0,23.6,77.9,39.8 --maxzoom=10
```

go-pmtiles already serves every archive in `tiles/`, so it appears at
`https://map.hatiwal.com/terrain/{z}/{x}/{y}.webp` with no container change. That is the URL the
v2 styles already use. Disk: 754 MB against ~65 GB free.

Add to RUNBOOK if adopted: the extract uses the `pmtiles` CLI (go-pmtiles v1.28.0 release binary).

**Cost to users (measured; this is the real trade-off).** Phone viewport 390×844 @2x, v2 light,
Mapterhorn tiles as-is (512px lossless-ish WebP, ~130–250 KB each):

| View | Terrain | Vector tiles (decompressed) |
|---|---|---|
| Country z6 | 6 tiles, **1,277 KB** | 95 KB |
| Kabul z10 | 6 tiles, **850 KB** | 38 KB |
| Kabul z13 | 1 tile, 132 KB | 175 KB |
| Kabul z15 | 1 tile, 132 KB | 113 KB |

At country/province zoom the hillshade costs **~10–20× the whole vector map**. For Afghan users on
metered mobile data that is not acceptable as-is. Options, cheapest first:

1. **Pre-rendered hillshade raster (recommended).** Run `gdaldem hillshade` once on the extract,
   then publish 256px lossy WebP greyscale tiles (typically 5–20 KB each, unmeasured here) as a
   `raster` source. Draw it with `raster-opacity` in light, and with low opacity plus
   `raster-brightness-max` in dark. That's ~10× less traffic, and phones do less GPU work than
   with live `hillshade`. Cost: a one-off build step (GDAL + `pmtiles convert`). Tilted 3D terrain
   could not reuse it.
2. **Same DEM, lower maxzoom (8).** One-line change (`HATIWAL_TERRAIN_MAXZOOM=8`): a z10 view
   overzooms 1–2 z8 tiles instead of fetching 6. The archive drops to roughly 1/16 of 754 MB. The
   relief gets softer at z10–13. Unmeasured: needs a render before choosing.
3. Ship as-is. Not recommended for this audience.

Until `/terrain` exists, the previews route those requests to `tiles.mapterhorn.com` at the
network layer (`test/preview-v2.mjs`). The style files never carry a third-party URL.

## 5. Proposals for the apps (NOT done — need a release after 1.1.4)

- **3D toggle button** (cube icon) on full-screen maps: animate to `pitch: 55`. Walls rise and the
  same style serves both. No style change needed.
- Optionally open the full-screen map at a gentle `pitch: 30` at z15+ only. Keep listing maps flat,
  because markers are easier to tap top-down.
- Both work today with v2. They only need app code. The style already supports tilt.

## 6. Verification

- Style-spec validator (`@maplibre/maplibre-gl-style-spec` `validateStyleMin`): all 16 files valid.
- `node build-styles.mjs` then md5 of the 8 v1 files: unchanged.
- Render sweep (maplibre-gl 5.24.0, the web app's version, real live tiles, terrain via
  Mapterhorn): 8 v2 styles × Kabul/Herat/Salang × z6/10/13/16 = **96/96 pass**. No map errors, no
  failed requests, and labels drawn everywhere except Salang at z13/16, which is open mountain with
  nothing to label.
- Not yet verified: MapLibre **Native** (the RN app). `hillshade`, `fill-extrusion` and the root
  `light` are all supported by MapLibre Native 11, but no device render has been done. Do it on
  the QA emulator (point a dev build at the v2 URL) before the swap.
- Side-by-side previews: `MAP_BASE=http://127.0.0.1:8099 CHROME_PATH=/usr/bin/google-chrome node test/preview-v2.mjs`
  → `tmp/v2/{light,dark}-*.png` (9 views each: country z6, Hindu Kush, Bamyan, Kabul z10/z13/z16,
  z16 tilted, Herat z13, Islamabad z13 in Urdu).

## 7. Swapping v2 live (after approval)

1. In `build-styles.mjs`, write the v2 palettes to the **v1 file names**. Never rename the files:
   every installed app requests `hatiwal-{theme}-{lang}.json` by name. Sources, tile URL and glyph
   URL stay identical. v2 only ADDS the `terrain` source.
2. Host `/terrain` first (§4). Without it the hillshade layer just draws nothing (tile 404s): the
   map still renders, but the main depth cue is gone.
3. RUNBOOK §3: keep a `styles.prev` rollback copy, scp, then re-run the render test against live.
