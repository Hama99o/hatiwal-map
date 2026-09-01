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
    boundary: "#94A3B8",
    label: "#F8FAFC",
    labelMuted: "#94A3B8",
    labelPoi: "#A9B6CA",
    halo: "#020817",
  },
};

/** Label language chain. `name:ps` EXISTS now — the tiles are built with
 *  `--languages=ps,fa,en`; before that ps fell back to Dari, which is what the
 *  old metadata claimed and is no longer true. */
const LANGS = {
  en: ["name:en", "name:latin", "name"],
  ps: ["name:ps", "name:fa", "name:nonlatin", "name", "name:latin"],
  fa: ["name:fa", "name:nonlatin", "name", "name:latin"],
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
const POI_CLASSES = [
  "place_of_worship", "hospital", "pharmacy", "school", "college",
  "police", "fuel", "bank", "post", "bus", "railway",
];

const inClass = (values) => ["in", ["get", "class"], ["literal", values]];

function layers(c, lang) {
  const label = nameField(lang);
  return [
    { id: "background", type: "background", paint: { "background-color": c.bg } },

    // ── ground cover: subtle, and the reason a city stops looking like a void ──
    {
      id: "landcover", type: "fill", source: "hatiwal", "source-layer": "landcover",
      filter: inClass(["wood", "grass", "farmland", "sand", "ice"]),
      paint: {
        "fill-color": [
          "match", ["get", "class"],
          "wood", c.wood, "grass", c.grass, "farmland", c.grass, "sand", c.sand, c.grass,
        ],
        "fill-opacity": 0.75,
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
    {
      id: "water", type: "fill", source: "hatiwal", "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": c.water },
    },
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
    {
      id: "building", type: "fill", source: "hatiwal", "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": c.building, "fill-opacity": 0.7 },
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
      filter: inClass(["city", "town", "village", "region", "state", "suburb", "neighbourhood", "quarter", "hamlet"]),
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
      minzoom: 15, filter: ["all", inClass(POI_CLASSES), ["has", "name"]],
      layout: {
        "text-field": label, "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 12.5],
        "text-max-width": 9, "text-padding": 6, "text-optional": true,
        "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": c.labelPoi, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
    {
      id: "road-label", type: "symbol", source: "hatiwal", "source-layer": "transportation_name",
      minzoom: 14,
      layout: {
        "text-field": label, "text-font": FONT, "symbol-placement": "line",
        "text-size": 11, "text-max-angle": 30, "symbol-spacing": 260, "text-padding": 4,
      },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.4 },
    },
    {
      id: "water-label", type: "symbol", source: "hatiwal", "source-layer": "water_name",
      layout: { "text-field": label, "text-font": FONT, "text-size": 11, "text-max-width": 7 },
      paint: { "text-color": c.labelMuted, "text-halo-color": c.halo, "text-halo-width": 1.2 },
    },
    {
      // Afghanistan is mountainous and peaks are how people place themselves.
      // z9–14 and muted, so it stays a backdrop.
      id: "peak-label", type: "symbol", source: "hatiwal", "source-layer": "mountain_peak",
      minzoom: 9, filter: ["has", "name"],
      layout: {
        "text-field": label, "text-font": FONT, "text-optional": true,
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
for (const theme of ["light", "dark"]) {
  for (const lang of ["en", "ps", "fa"]) {
    const c = PALETTES[theme];
    const style = {
      version: 8,
      name: `Hatiwal ${theme === "light" ? "Light" : "Dark"} (${lang})`,
      metadata: {
        "hatiwal:purpose": PURPOSE,
        "hatiwal:labels": `${LANGS[lang][0]} → ${LANGS[lang].slice(1).join(" → ")}. name:ps EXISTS in these tiles (built with --languages=ps,fa,en); before that ps fell back to Dari script.`,
        "hatiwal:palette": "The APP's own tokens (hatiwal-mobile/src/hooks/useColors.ts), so the map is the same light/dark as every other screen rather than an approximation of it.",
        "hatiwal:generated": "build-styles.mjs — do NOT hand-edit a style file; edit the generator and re-run it, then `node test/render-test.mjs` (18/18).",
      },
      sources: {
        hatiwal: {
          type: "vector",
          tiles: [TILES],
          minzoom: 0,
          maxzoom: 14,
          bounds: [60.48761, 29.368563, 74.90017, 38.50674],
          attribution: "© OpenMapTiles © OpenStreetMap contributors",
        },
      },
      glyphs: GLYPHS,
      center: [67.69389, 33.937652],
      zoom: 5,
      layers: layers(c, lang),
    };
    writeFileSync(`styles/hatiwal-${theme}-${lang}.json`, JSON.stringify(style, null, 2) + "\n");
    count++;
  }
}
console.log(`  wrote ${count} styles, ${layers(PALETTES.light, "en").length} layers each`);
