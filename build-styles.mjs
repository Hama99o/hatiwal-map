#!/usr/bin/env node
/**
 * build-styles.mjs — emits all 6 styles from ONE source of truth.
 *
 * WHY THIS EXISTS. The 6 styles were hand-written and structurally identical,
 * differing only in palette (light/dark) and label language (en/ps/fa). That is
 * how a one-line mistake took every one of them down at once: an invalid
 * `text-size` expression blanked all six and the render test went 18/18 → 0/18
 * instantly. Six copies also means an improvement has to be applied six times
 * and stay consistent, which it will not.
 *
 * DESIGN INTENT, inherited and kept (see `metadata['hatiwal:purpose']`): the
 * basemap is DELIBERATELY QUIET, because the listings are the content and this
 * is the backdrop. Brand gold is absent on purpose — it belongs to the price
 * markers drawn on top. So everything added here is legibility, not decoration:
 * road hierarchy is carried by WIDTH more than colour, and POI text only appears
 * at z15+, where the user is inspecting one neighbourhood rather than scanning a
 * city full of markers.
 *
 * THE ONE EXPRESSION RULE: `interpolate` on zoom must be the OUTERMOST
 * expression in a size/width property. Wrapping two interpolates in a `case` is
 * invalid and MapLibre fails it SILENTLY — nothing draws, no error. Branch
 * inside the interpolate, never around it.
 *
 *   node build-styles.mjs && node test/render-test.mjs   # expect 18/18
 */
import { writeFileSync } from "node:fs";

// The path still says "afghanistan" even though the tileset now covers
// Afghanistan, Pakistan and Iran (PK-1). THAT IS DELIBERATE — do not "fix" it.
//
// go-pmtiles derives this path from the deployed FILE NAME, and the mobile app
// that is live in the Play Store hardcodes nothing but the style URL: it reads
// this value out of the style JSON it fetches from the server. Renaming the
// file would therefore 404 every already-installed client into a blank map,
// and mobile is deliberately NOT being redeployed yet. Keeping the path and
// swapping the CONTENT underneath means existing installs silently gain
// Pakistan and Iran with no app update at all.
//
// (Those installs still cannot PAN there — maxBounds lives in app code, not in
// the style — but the tiles they already request now cover three countries.)
const TILES = "https://map.hatiwal.com/afghanistan/{z}/{x}/{y}.mvt";
const GLYPHS = "https://map.hatiwal.com/fonts/{fontstack}/{range}.pbf";
const FONT = ["Noto Sans Regular"];

// Palettes are the APP's own tokens (hatiwal-mobile/src/hooks/useColors.ts), so
// the map is the same light/dark as every other screen rather than an
// approximation of it.
const PALETTES = {
  light: {
    bg: "#FAFAFA",
    water: "#BDD1DB",
    // Park was #BDD1DB — IDENTICAL to water, so every park rendered as a lake.
    // Now a muted green that still reads as "not built on" without shouting.
    park: "#D9E7D6",
    wood: "#CFE0CB",
    grass: "#DEE9D9",
    sand: "#EFE7D4",
    // The GROUND is tinted, not the roads. On a light basemap the roads are
    // white, so they only read as roads if what surrounds them is not also
    // white — the first version left residential land at #F4F5F7 on a #FAFAFA
    // background and the whole city dissolved into a faint web.
    residential: "#ECEFF4",
    commercial: "#F2EDE5",
    industrial: "#E8EBF0",
    building: "#F1F5F9",
    aeroway: "#E8ECF2",
    // Casings carry the hierarchy on a light map — a darker outline is what
    // makes a motorway read as one at a glance.
    casingMajor: "#BFCCDD",
    casingMinor: "#D7DEE9",
    roadMajor: "#FFFFFF",
    roadMinor: "#FFFFFF",
    rail: "#C9D2DF",
    path: "#DCC9A8",
    buildingLine: "#E2E8F0",
    boundary: "#65758B",
    label: "#0F1729",
    labelMuted: "#65758B",
    labelPoi: "#5A6B85",
    halo: "#FAFAFA",
  },
  dark: {
    bg: "#020817",
    water: "#394756",
    park: "#1B3126",
    wood: "#182A20",
    grass: "#1A2C21",
    sand: "#2A2620",
    residential: "#0A1120",
    commercial: "#131A29",
    industrial: "#0F1624",
    building: "#1D283A",
    aeroway: "#223046",
    // On a dark map the CASING is darker than the road: it separates a road from
    // the ground instead of outlining it.
    casingMajor: "#0A1020",
    casingMinor: "#070D1A",
    roadMajor: "#33456A",
    roadMinor: "#1E2A43",
    rail: "#2B3A54",
    path: "#3A3320",
    buildingLine: "#27334A",
    boundary: "#94A3B8",
    label: "#F8FAFC",
    labelMuted: "#94A3B8",
    labelPoi: "#A9B6CA",
    halo: "#020817",
  },
};

// ── v2 "depth" palettes (2026-10-02, owner brief: "more graphic, a little 3D,
// better colour, light AND dark"). Research + rationale: docs/design/MAP_V2.md.
//
// Emitted as hatiwal-v2-*.json BESIDE the v1 files, which stay byte-identical
// until the owner approves the swap. Every v1 key is present (the shared
// layers read them) plus the depth keys only v2 layers use.
//
// Light: warm limestone ground (Kabul/Herat in daylight, not a cold grey web
// map), sage parks, clear blue water. Dark: built on the brand navy #12224F so
// the map IS the app's dark surface, with water darker than land (Apple/Google
// night convention) and a cool moonlit hillshade. Brand gold stays OFF the map
// — motorways are pale apricot in light and dusty slate in dark, neither of
// which can be mistaken for a #E8B23A price marker.
const PALETTES_V2 = {
  light: {
    v2: true,
    bg: "#F4F1EA",
    water: "#A8CDE6",
    waterShore: "#7FAFD3",
    park: "#CFE4C1",
    parkLine: "#B5D3A4",
    wood: "#BFDAAE",
    grass: "#D9E9C9",
    farmland: "#ECEBD5",
    sand: "#F0E2C2",
    rock: "#E6E0D5",
    ice: "#F7FAFC",
    residential: "#ECE7DE",
    commercial: "#F3E6D8",
    industrial: "#E7E4E0",
    building: "#E0D9CD",
    buildingTop: "#EAE4D9",
    buildingSide: "#CFC6B6",
    buildingShadow: "rgba(74, 60, 40, 0.22)",
    aeroway: "#E3E0DA",
    casingMajor: "#E2C690",
    casingMinor: "#D9D1C3",
    roadMajor: "#FBEBC8",
    roadMinor: "#FFFFFF",
    roadShadow: "rgba(74, 60, 40, 0.25)",
    rail: "#BFB7AA",
    path: "#CDB48C",
    buildingLine: "#CBC1B0",
    boundary: "#7A6F8F",
    label: "#1A2236",
    labelMuted: "#5F6B80",
    labelPoi: "#56637A",
    labelWater: "#3E6E96",
    halo: "#F7F5F0",
    shadeShadow: "#77705E",
    shadeHighlight: "#FFFFFF",
    shadeAccent: "#8C7F66",
  },
  dark: {
    v2: true,
    bg: "#0F1B38",
    water: "#0B2F52",
    waterShore: "#2F6496",
    park: "#123229",
    parkLine: "#1C4536",
    wood: "#102B24",
    grass: "#132E26",
    farmland: "#15213A",
    sand: "#231F24",
    rock: "#18223D",
    ice: "#22314F",
    residential: "#14213F",
    commercial: "#1A2443",
    industrial: "#152039",
    building: "#1F2D52",
    buildingTop: "#26365F",
    buildingSide: "#18244A",
    buildingShadow: "rgba(2, 5, 15, 0.55)",
    aeroway: "#22305A",
    casingMajor: "#0A1228",
    casingMinor: "#0B1430",
    roadMajor: "#5C6A8E",
    roadMinor: "#2A3A63",
    roadShadow: "rgba(0, 0, 0, 0.5)",
    rail: "#33446E",
    path: "#4A4231",
    buildingLine: "#2F4170",
    boundary: "#A3AECB",
    label: "#EEF2FA",
    labelMuted: "#97A3C0",
    labelPoi: "#A9B4CE",
    labelWater: "#7FA3D6",
    halo: "#0F1B38",
    shadeShadow: "#03081A",
    shadeHighlight: "#3A4E85",
    shadeAccent: "#0A1230",
  },
};

// Terrain-RGB (Terrarium) source for the v2 hillshade. Mapterhorn publishes it
// as open data (512px WebP, terrarium encoding); the PLAN is to self-host an
// extract as /terrain on map.hatiwal.com (sizes measured in MAP_V2.md), so
// clients never depend on a third party. Until that extract exists the URL is
// overridable, which is how the previews were rendered.
const TERRAIN = process.env.HATIWAL_TERRAIN || "https://map.hatiwal.com/terrain/{z}/{x}/{y}.webp";
const TERRAIN_MAXZOOM = Number(process.env.HATIWAL_TERRAIN_MAXZOOM || 10);

/** Label language chain. `name:ps` EXISTS now — the tiles are built with
 *  `--languages=ps,fa,en,ur`; before that ps fell back to Dari, which is what
 *  the old metadata claimed and is no longer true. `ur` joined that list with
 *  the AF+PK+IR rebuild (PK-1): the previous tileset was built `ps,fa,en`, so
 *  no amount of style work could have produced an Urdu map — the names were
 *  simply not in the data. */
const LANGS = {
  // `name` BEFORE `name:latin`, deliberately.
  //
  // `name:latin` is a machine transliteration and it is frequently garbage:
  // a z16 Kabul render showed two streets as "gwincsjpad byigm" and "wdcjA 1_".
  // A correct local name in its own script beats an unreadable Latin mangling —
  // this app's users are Afghans whose UI language happens to be English, and
  // "دهمزنگ" is recognisable to them where "gwincsjpad byigm" is recognisable to
  // nobody. Places that matter internationally (Kabul, Herat) carry a real
  // `name:en` and are unaffected; `name:latin` stays as a last resort.
  en: ["name:en", "name", "name:latin"],
  ps: ["name:ps", "name:fa", "name:nonlatin", "name", "name:latin"],
  fa: ["name:fa", "name:nonlatin", "name", "name:latin"],
  // Urdu. `name:nonlatin` sits second because Pakistan's OSM coverage carries a
  // lot of Urdu/Arabic-script `name` values that are NOT tagged `name:ur` — that
  // fallback renders them in their own script rather than dropping to a Latin
  // transliteration, which is the same reasoning as the ps chain above. No
  // `name:fa` step: Dari is not a better guess for an Urdu reader than the
  // local name is.
  ur: ["name:ur", "name:nonlatin", "name", "name:latin"],
};

const nameField = (lang) => ["coalesce", ...LANGS[lang].map((k) => ["get", k])];

// Road class groups. `transportation.class` carries these values; grouping them
// is what gives the city a spine — before this every road shared one width and
// one colour, so a motorway looked exactly like an alley.
const MAJOR = ["motorway", "trunk", "primary"];
const SECONDARY = ["secondary", "tertiary"];
const MINOR = ["minor", "service", "track", "unclassified", "residential"];

// POI classes worth showing in Afghanistan, where addresses are informal and
// people navigate by landmark ("near the mosque", "opposite the bazaar").
// Curated deliberately — the full `poi` layer at this density would bury the
// listing markers this basemap exists to support.
// TIER 1 (z15) — the landmarks people actually give directions by.
const POI_LANDMARK = [
  "place_of_worship", "hospital", "pharmacy", "school", "college",
  "police", "fuel", "bank", "post", "bus", "railway", "town_hall",
];
// TIER 2 (z16) — commerce and meeting places. A marketplace's users arrange to
// meet AT these ("in front of the bakery", "at the bazaar"), so they earn their
// ink — but one zoom later than the landmarks, so a neighbourhood view stays
// readable. MapLibre drops colliding labels, so these fill gaps rather than
// pile up.
const POI_COMMERCE = [
  "shop", "food", "lodging", "attraction", "sport", "library", "cafe",
];

const inClass = (values) => ["in", ["get", "class"], ["literal", values]];

function layers(c, lang) {
  const label = nameField(lang);
  // v2 only. Each `...only(v2, …)` splice adds a depth layer; with v2 false it
  // adds nothing, so the v1 output stays byte-identical (checked by md5).
  const v2 = !!c.v2;
  const only = (cond, ...ls) => (cond ? ls : []);
  return [
    { id: "background", type: "background", paint: { "background-color": c.bg } },

    // ── ground cover: subtle, and the reason a city stops looking like a void ──
    {
      id: "landcover", type: "fill", source: "hatiwal", "source-layer": "landcover",
      // v2 adds rock: much of Afghanistan IS bare rock, and leaving it out drew
      // the Hindu Kush as empty background.
      filter: inClass(v2
        ? ["wood", "grass", "farmland", "sand", "ice", "rock", "wetland"]
        : ["wood", "grass", "farmland", "sand", "ice"]),
      paint: {
        "fill-color": v2
          ? ["match", ["get", "class"],
              "wood", c.wood, "grass", c.grass, "wetland", c.grass, "farmland", c.farmland,
              "sand", c.sand, "rock", c.rock, "ice", c.ice, c.grass]
          : ["match", ["get", "class"],
              "wood", c.wood, "grass", c.grass, "farmland", c.grass, "sand", c.sand, c.grass],
        "fill-opacity": v2 ? 0.85 : 0.75,
      },
    },
    {
      id: "landuse", type: "fill", source: "hatiwal", "source-layer": "landuse",
      filter: inClass(["residential", "commercial", "retail", "industrial", "railway"]),
      paint: {
        "fill-color": [
          "match", ["get", "class"],
          "residential", c.residential,
          "commercial", c.commercial, "retail", c.commercial,
          c.industrial,
        ],
        "fill-opacity": 0.95,
      },
    },
    {
      id: "park", type: "fill", source: "hatiwal", "source-layer": "park",
      paint: { "fill-color": c.park, "fill-opacity": 0.85 },
    },
    ...only(v2,
      {
        // A slightly deeper edge so a park reads as a raised green lawn, not a
        // tint. z13+, where parks are big enough to have an edge worth drawing.
        id: "park-outline", type: "line", source: "hatiwal", "source-layer": "park",
        minzoom: 13,
        paint: {
          "line-color": c.parkLine, "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 17, 1.6],
        },
      },
      {
        // MOUNTAIN SHADING. The single biggest "looks 3D at pitch 0" win for a
        // country that is mostly mountains. Light from the north-west (map
        // convention), viewport-anchored so it matches the building shadows.
        // Strong at country/province zoom, fading out by z14 so it never muddies
        // the streets a buyer is reading.
        id: "hillshade", type: "hillshade", source: "terrain",
        maxzoom: 16,
        paint: {
          "hillshade-illumination-anchor": "viewport",
          "hillshade-illumination-direction": 315,
          "hillshade-shadow-color": c.shadeShadow,
          "hillshade-highlight-color": c.shadeHighlight,
          "hillshade-accent-color": c.shadeAccent,
          "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 0.45, 10, 0.35, 12, 0.24, 13, 0.16, 14, 0.07, 15, 0],
        },
      },
    ),
    {
      id: "water", type: "fill", source: "hatiwal", "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": c.water },
    },
    ...only(v2, {
      // A soft, blurred shoreline: a lake reads as a basin with depth instead
      // of a flat cut-out. Blur does the work, so no extra geometry is needed.
      id: "water-shore", type: "line", source: "hatiwal", "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"], minzoom: 8,
      paint: {
        "line-color": c.waterShore, "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 12, 1.6, 16, 3],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 16, 2.5],
      },
    }),
    {
      id: "waterway", type: "line", source: "hatiwal", "source-layer": "waterway",
      paint: {
        "line-color": c.water,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2.2],
      },
    },
    {
      id: "aeroway", type: "line", source: "hatiwal", "source-layer": "aeroway",
      minzoom: 10,
      paint: {
        "line-color": c.aeroway,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 6],
      },
    },
    ...only(v2, {
      // THE PSEUDO-3D TRICK: the same footprints, darker, nudged down-right in
      // SCREEN space (viewport anchor) — a cast shadow from a north-west light.
      // It reads as raised blocks at pitch 0, where most users stay. Offset
      // grows with zoom because a shadow is proportional to how big a block
      // looks.
      id: "building-shadow", type: "fill", source: "hatiwal", "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-color": c.buildingShadow,
        "fill-translate-anchor": "viewport",
        "fill-translate": ["interpolate", ["exponential", 2], ["zoom"], 14, ["literal", [0.6, 0.9]], 16, ["literal", [1.6, 2.4]], 18, ["literal", [4, 6]]],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 15, 1],
      },
    }),
    {
      id: "building", type: "fill", source: "hatiwal", "source-layer": "building",
      minzoom: 14,
      paint: v2
        // Tint deepens with zoom: a faint city texture at z14, solid blocks by z16.
        ? { "fill-color": ["interpolate", ["linear"], ["zoom"], 14, c.building, 16, c.buildingTop],
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 16, 1] }
        : { "fill-color": c.building, "fill-opacity": 0.7 },
    },

    // ── roads, drawn minor → major so the spine sits on top ──
    {
      id: "road-minor-casing", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(MINOR), minzoom: 12,
      paint: {
        "line-color": c.casingMinor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 16, 6],
      },
    },
    {
      id: "road-minor", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(MINOR), minzoom: 12,
      paint: {
        "line-color": c.roadMinor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 3.6],
      },
    },
    {
      // RAIL was invisible: `class: "rail"` is in none of the road groups, so
      // every railway simply did not draw. It is real infrastructure and a
      // landmark in its own right.
      id: "rail", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(["rail", "transit"]), minzoom: 10,
      paint: {
        "line-color": c.rail, "line-dasharray": [3, 2],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 2.2],
      },
    },
    {
      // Footpaths and tracks, z15+. Someone walking the last 200m to a meetup
      // needs the alley that a car map would omit.
      id: "path", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(["path", "footway", "pedestrian", "steps"]), minzoom: 15,
      paint: {
        "line-color": c.path, "line-dasharray": [2, 2], "line-opacity": 0.8,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.6, 18, 2],
      },
    },
    {
      id: "road-secondary-casing", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(SECONDARY),
      paint: {
        "line-color": c.casingMinor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 12, 3.4, 16, 9],
      },
    },
    {
      id: "road-secondary", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(SECONDARY),
      paint: {
        "line-color": c.roadMinor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 2, 16, 6],
      },
    },
    ...only(v2, {
      // Lift: a soft blurred shadow under the main roads, offset like the
      // building shadows, so the spine of the city sits ABOVE the ground.
      id: "road-major-shadow", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(MAJOR), minzoom: 10,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": c.roadShadow,
        "line-translate-anchor": "viewport",
        "line-translate": ["interpolate", ["linear"], ["zoom"], 10, ["literal", [0.5, 0.8]], 16, ["literal", [1.5, 2.5]]],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 4],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 15],
      },
    }),
    {
      id: "road-major-casing", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(MAJOR),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": c.casingMajor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 11, 4.4, 16, 13],
      },
    },
    {
      id: "road-major", type: "line", source: "hatiwal", "source-layer": "transportation",
      filter: inClass(MAJOR),
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": c.roadMajor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 11, 2.6, 16, 9],
      },
    },
    {
      // Outlines at z16+, so blocks read as blocks. The fill alone merged
      // adjacent buildings into one shapeless mass at the zoom where a buyer is
      // working out which building is meant.
      id: "building-outline", type: "line", source: "hatiwal", "source-layer": "building",
      minzoom: 16,
      paint: { "line-color": c.buildingLine, "line-width": 0.6 },
    },
    ...only(v2, {
      // REAL 3D when the user tilts. The tiles carry `render_height` and
      // `render_min_height` (measured: Kabul z14 has real heights, most >10 m;
      // planetiler fills untagged buildings with a default), so no faked
      // height is needed — the coalesce is only a guard. At pitch 0 only the
      // roofs show, sitting on the shadow layer above; tilt and the walls rise.
      // Drawn AFTER the roads so a tilted wall is never painted over by a road.
      id: "building-3d", type: "fill-extrusion", source: "hatiwal", "source-layer": "building",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": c.buildingTop,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-vertical-gradient": true,
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.5, 0.92],
      },
    }),
    {
      id: "boundary", type: "line", source: "hatiwal", "source-layer": "boundary",
      filter: ["<=", ["get", "admin_level"], 4],
      paint: {
        "line-color": c.boundary, "line-opacity": 0.35, "line-dasharray": [3, 2],
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1.6],
      },
    },

    // ── labels ──
    {
      id: "place-label", type: "symbol", source: "hatiwal", "source-layer": "place",
      // ZOOM-GATED BY CLASS. This used to be one flat class list with no zoom
      // condition and no minzoom, so every hamlet, quarter and suburb in the
      // tileset was laid out and collision-tested at EVERY zoom — including z5,
      // where a village label is both illegible and meaningless.
      //
      // The cost is not theoretical and it is not uniform. Measured against the
      // live tiles: one z10 tile over Peshawar carries 308 village features
      // against 64 for the equivalent tile over Kabul. Pakistan is far more
      // densely mapped than Afghanistan, so the renderer was doing ~5x the
      // symbol work there for labels nobody could read — which is the shape of
      // the "map goes blank, but only in Pakistan, and zooming fixes it" report.
      //
      // Thresholds follow the OpenMapTiles convention the tileset is built to:
      // cities and admin areas always; towns from z8; villages from z11;
      // sub-settlement detail from z13. Nothing is removed from the tileset —
      // this is purely when each class is DRAWN, so it ships as a style update
      // (cached 1h) with no rebuild and no app release.
      filter: ["any",
        inClass(["city", "region", "state"]),
        ["all", [">=", ["zoom"], 8],  inClass(["town"])],
        ["all", [">=", ["zoom"], 11], inClass(["village"])],
        ["all", [">=", ["zoom"], 13], inClass(["suburb", "neighbourhood", "quarter", "hamlet"])],
      ],
      layout: {
        "text-field": label, "text-font": FONT,
        // interpolate OUTERMOST; the class check lives INSIDE each stop.
        "text-size": [
          "interpolate", ["linear"], ["zoom"],
          4, ["case", inClass(["city", "region", "state"]), 12, 9],
          10, ["case", inClass(["city", "region", "state"]), 16, 12],
          14, ["case", inClass(["city", "region", "state"]), 20, 14],
        ],
        "text-max-width": 8, "text-padding": 4,
      },
      paint: { "text-color": c.label, "text-halo-color": c.halo, "text-halo-width": 1.4 },
    },
    {
      // NEW. The single biggest orientation win for a meet-in-person marketplace:
      // z15+ only, so it never competes with price markers at scanning zooms.
      id: "poi-label", type: "symbol", source: "hatiwal", "source-layer": "poi",
      minzoom: 15, filter: ["all", inClass(POI_LANDMARK), ["has", "name"]],
      layout: {
        "text-field": label, "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 12.5],
        "text-max-width": 9, "text-padding": 6, "text-optional": true,
        "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": c.labelPoi, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
    {
      // Commerce, one zoom in from the landmarks.
      id: "poi-commerce-label", type: "symbol", source: "hatiwal", "source-layer": "poi",
      minzoom: 16, filter: ["all", inClass(POI_COMMERCE), ["has", "name"]],
      layout: {
        "text-field": label, "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 16, 9.5, 18, 11.5],
        "text-max-width": 9, "text-padding": 6, "text-optional": true,
        "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": c.labelPoi, "text-halo-color": c.halo, "text-halo-width": 1.1 },
    },
    {
      id: "road-label", type: "symbol", source: "hatiwal", "source-layer": "transportation_name",
      minzoom: 12,
      layout: {
        "text-field": label, "text-font": FONT, "symbol-placement": "line",
        "text-size": 11, "text-max-angle": 30, "symbol-spacing": 260, "text-padding": 4,
      },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.4 },
    },
    {
      id: "water-label", type: "symbol", source: "hatiwal", "source-layer": "water_name",
      layout: { "text-field": label, "text-font": FONT, "text-size": 11, "text-max-width": 7 },
      paint: { "text-color": c.labelWater || c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
    {
      // Afghanistan is mountainous and peaks are how people place themselves.
      // z9–14 and muted, so it stays a backdrop.
      id: "peak-label", type: "symbol", source: "hatiwal", "source-layer": "mountain_peak",
      minzoom: 9, filter: ["has", "name"],
      layout: {
        // Name + elevation: "Koh-e Asmai" alone says less than the same name with
        // 2,100 m beside it when you are placing yourself in a valley city.
        "text-field": [
          "case",
          ["has", "ele"], ["concat", label, "\n", ["to-string", ["round", ["get", "ele"]]], " m"],
          label,
        ],
        "text-font": FONT, "text-optional": true,
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9.5, 14, 11.5],
        "text-max-width": 8, "text-padding": 8,
      },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
    {
      id: "aerodrome-label", type: "symbol", source: "hatiwal", "source-layer": "aerodrome_label",
      minzoom: 10, filter: ["has", "name"],
      layout: {
        "text-field": label, "text-font": FONT, "text-size": 11,
        "text-max-width": 8, "text-optional": true,
      },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
  ];
}

const PURPOSE =
  "Search-surface basemap. Deliberately quiet: the LISTINGS are the content and this is the backdrop. Brand gold (#E8B23A) is absent on purpose — it belongs to the price markers drawn on top, and a gold-flecked basemap would make them stop standing out.";

let count = 0;
// v1 = the LIVE files (hatiwal-{theme}-{lang}.json). v2 = the depth redesign,
// emitted beside them as hatiwal-v2-{theme}-{lang}.json until the owner
// approves the swap. The swap is: make v2 the palette set written to the v1
// names — never rename the files, every installed app requests them by name.
for (const variant of ["v1", "v2"]) {
for (const theme of ["light", "dark"]) {
  for (const lang of ["en", "ps", "fa", "ur"]) {
    const v2 = variant === "v2";
    const c = (v2 ? PALETTES_V2 : PALETTES)[theme];
    const style = {
      version: 8,
      name: `Hatiwal ${theme === "light" ? "Light" : "Dark"}${v2 ? " v2" : ""} (${lang})`,
      metadata: {
        "hatiwal:purpose": PURPOSE,
        "hatiwal:labels": `${LANGS[lang][0]} → ${LANGS[lang].slice(1).join(" → ")}. name:ps and name:ur EXIST in these tiles (built with --languages=ps,fa,en,ur); before that ps fell back to Dari script and Urdu was absent entirely.`,
        "hatiwal:palette": v2
          ? "v2 depth palette (docs/design/MAP_V2.md): warm limestone light, brand-navy dark, hillshade + building shadows + extrusion."
          : "The APP's own tokens (hatiwal-mobile/src/hooks/useColors.ts), so the map is the same light/dark as every other screen rather than an approximation of it.",
        "hatiwal:generated": "build-styles.mjs — do NOT hand-edit a style file; edit the generator and re-run it, then `node test/render-test.mjs` (18/18).",
      },
      sources: {
        hatiwal: {
          type: "vector",
          tiles: [TILES],
          minzoom: 0,
          maxzoom: 14,
          // AF + PK + IR, matching --bounds on the planetiler build exactly.
          // This is the SOURCE's declared extent; MapLibre uses it to decide
          // which tiles are worth requesting, so it has to match the data or
          // the client either asks for tiles that do not exist or refuses to
          // ask for ones that do.
          bounds: [44.0, 23.6, 77.9, 39.8],
          attribution: "© OpenMapTiles © OpenStreetMap contributors",
        },
        ...(v2 ? {
          terrain: {
            type: "raster-dem",
            tiles: [TERRAIN],
            encoding: "terrarium",
            tileSize: 512,
            minzoom: 0,
            maxzoom: TERRAIN_MAXZOOM,
            bounds: [44.0, 23.6, 77.9, 39.8],
            attribution: "© Mapterhorn",
          },
        } : {}),
      },
      // v2: one north-west light for the extrusions, viewport-anchored like the
      // hillshade and the shadows, so every depth cue agrees on where the sun is.
      ...(v2 ? { light: { anchor: "viewport", position: [1.2, 315, 35], intensity: theme === "light" ? 0.35 : 0.25, color: "#FFFFFF" } } : {}),
      glyphs: GLYPHS,
      center: [67.69389, 33.937652],
      zoom: 5,
      layers: layers(c, lang),
    };
    writeFileSync(`styles/hatiwal-${v2 ? "v2-" : ""}${theme}-${lang}.json`, JSON.stringify(style, null, 2) + "\n");
    count++;
  }
}
}
console.log(`  wrote ${count} styles: v1 ${layers(PALETTES.light, "en").length} layers, v2 ${layers(PALETTES_V2.light, "en").length} layers`);
