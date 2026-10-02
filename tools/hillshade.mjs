#!/usr/bin/env node
/**
 * hillshade.mjs — pre-render hillshade tiles from a Terrarium DEM pyramid.
 *
 * WHY. A live `hillshade` layer makes every phone download the raw DEM:
 * measured on a 390×844 phone viewport, 1,277 KB at country zoom against 95 KB
 * for the whole vector map (docs/design/MAP_V2.md §4). Shading once on the
 * server and shipping small transparent WebP tiles costs the user a fraction of
 * that, and spares a low-end phone the per-frame GPU work.
 *
 * WHAT. For each output tile it reads the DEM tile at the same z/x/y plus the
 * 8 neighbours' edge pixels (so there are no seams), computes Horn's slope and
 * aspect, lights it from the north-west, and writes RGBA WebP:
 *   darker than flat  → near-black, alpha = shadow strength
 *   brighter than flat → white,      alpha = highlight strength
 *   flat ground        → fully transparent (compresses to almost nothing)
 * The style draws it as a `raster` layer, so the theme tints it via opacity
 * and brightness — one tileset serves light AND dark.
 *
 *   node tools/hillshade.mjs --src 'http://127.0.0.1:8081/terrain/{z}/{x}/{y}.webp' \
 *     --out out/hillshade --bbox 44.0,23.6,77.9,39.8 --minzoom 0 --maxzoom 9
 *
 * Needs only `sharp`. No GDAL, no reprojection: input and output share the
 * Web-Mercator tile grid.
 *
 * --mbtiles out.mbtiles writes an MBTiles file instead of a directory (needs
 * Node >= 22.5 for node:sqlite). Convert it with `pmtiles convert` and drop it
 * beside afghanistan.pmtiles: go-pmtiles then serves it at
 * /hillshade/{z}/{x}/{y}.webp with no nginx change, because the file name IS
 * the URL path.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SRC = arg("src");
const OUT = arg("out", "out/hillshade");
const BBOX = arg("bbox", "44.0,23.6,77.9,39.8").split(",").map(Number);
const MINZ = Number(arg("minzoom", 0));
const MAXZ = Number(arg("maxzoom", 9));
const QUALITY = Number(arg("quality", 60));
const SIZE = Number(arg("tilesize", 512));        // Mapterhorn DEM tiles are 512px
const CONC = Number(arg("concurrency", 6));
const OUTSIZE = Number(arg("outsize", 256));   // downsampled output: 1/4 the pixels of the DEM tile
const CACHE = arg("cache");
// "both" = shadows + highlights; "shadow" = one constant colour, alpha only —
// far cheaper to encode, since the colour channels become a flat fill.
const MODE = arg("mode", "both");                       // optional on-disk DEM cache dir
const MBTILES = arg("mbtiles");
const SKIP_EXISTING = process.argv.includes("--resume");
if (!SRC) { console.error("--src <url template with {z}/{x}/{y}> is required"); process.exit(2); }

// Light: NW (315°), 45° altitude — the same direction as the v2 style's
// building shadows and fill-extrusion light, so every depth cue agrees.
// Compass 315° expressed in the math convention GDAL uses: 360 - 315 + 90 = 135°.
const AZM = (135 * Math.PI) / 180, ALT = (45 * Math.PI) / 180;
const FLAT = Math.sin(ALT);
// Vertical exaggeration per zoom: low zooms flatten relief (pixels are km
// wide), so they need more lift to read at all.
const exag = (z) => (z <= 5 ? 3.0 : z <= 7 ? 2.2 : z <= 9 ? 1.6 : 1.3);

const tileRange = (z) => {
  const n = 2 ** z;
  const lon2x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  return { x0: lon2x(BBOX[0]), x1: lon2x(BBOX[2]), y0: lat2y(BBOX[3]), y1: lat2y(BBOX[1]) };
};

// ── DEM fetch with a small cache (each tile is a neighbour of 8 others) ──
const cache = new Map();
async function dem(z, x, y) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  x = ((x % n) + n) % n;
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const cpath = CACHE && `${CACHE}/${key}.webp`;
        let raw;
        if (cpath && existsSync(cpath)) raw = readFileSync(cpath);
        else {
          const r = await fetch(SRC.replace("{z}", z).replace("{x}", x).replace("{y}", y));
          if (r.status === 404 || r.status === 204) return null;
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          raw = Buffer.from(await r.arrayBuffer());
          if (cpath) { mkdirSync(dirname(cpath), { recursive: true }); writeFileSync(cpath, raw); }
        }
        const { data, info } = await sharp(raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const e = new Float32Array(info.width * info.height);
        for (let i = 0; i < e.length; i++) e[i] = data[i * 3] * 256 + data[i * 3 + 1] + data[i * 3 + 2] / 256 - 32768;
        return e;
      } catch (err) {
        if (attempt === 3) throw new Error(`${key}: ${err.message}`);
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      }
    }
  })();
  cache.set(key, p);
  if (cache.size > 600) cache.delete(cache.keys().next().value);
  return p;
}

async function shade(z, x, y) {
  const S = SIZE;
  const c = await dem(z, x, y);
  if (!c) return null;
  // Padded (S+2)² grid: centre tile plus one pixel from each neighbour.
  const P = S + 2, g = new Float32Array(P * P);
  const nb = {};
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) nb[`${dx},${dy}`] = (dx || dy) ? await dem(z, x + dx, y + dy) : c;
  for (let py = 0; py < P; py++) for (let px = 0; px < P; px++) {
    let sx = px - 1, sy = py - 1, dx = 0, dy = 0;
    if (sx < 0) { dx = -1; sx = S - 1; } else if (sx >= S) { dx = 1; sx = 0; }
    if (sy < 0) { dy = -1; sy = S - 1; } else if (sy >= S) { dy = 1; sy = 0; }
    const t = nb[`${dx},${dy}`];
    // Missing neighbour (edge of the world / of the extract): clamp to the centre.
    g[py * P + px] = t ? t[sy * S + sx] : c[Math.min(S - 1, Math.max(0, px - 1)) + Math.min(S - 1, Math.max(0, py - 1)) * S];
  }
  // Ground size of one pixel at this tile's centre latitude.
  const n = 2 ** z;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  const cell = (40075016.686 * Math.cos(lat)) / (n * S);
  const k = exag(z) / (8 * cell);
  const out = Buffer.alloc(S * S * 4);
  let any = false;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = (py + 1) * P + (px + 1);
    const a = g[i - P - 1], b = g[i - P], cc = g[i - P + 1], d = g[i - 1], f = g[i + 1], gg = g[i + P - 1], h = g[i + P], ii = g[i + P + 1];
    const dzdx = ((cc + 2 * f + ii) - (a + 2 * d + gg)) * k;
    const dzdy = ((gg + 2 * h + ii) - (a + 2 * b + cc)) * k;
    const slope = Math.atan(Math.hypot(dzdx, dzdy));
    const aspect = Math.atan2(dzdy, -dzdx);
    const lum = Math.sin(ALT) * Math.cos(slope) + Math.cos(ALT) * Math.sin(slope) * Math.cos(AZM - aspect);
    const delta = lum - FLAT;
    const o = (py * S + px) * 4;
    // Colour is a SMOOTH ramp (dark slate in shadow → white in light) rather
    // than a hard dark/white switch: a step edge at every ridge costs the
    // encoder far more bits than the shading itself. Alpha carries strength;
    // shadows get more range than highlights because they carry the form.
    if (MODE === "shadow") {
      out[o] = 4; out[o + 1] = 7; out[o + 2] = 16;   // near-black navy: must still read on the dark theme's #0F1B38 ground
      out[o + 3] = delta < 0 ? Math.round(Math.min(1, -delta * 1.6) * 255) : 0;
    } else {
      const v = Math.max(0, Math.min(1, 0.5 + delta * 1.4));
      out[o] = 20 + v * 235; out[o + 1] = 24 + v * 231; out[o + 2] = 36 + v * 219;
      out[o + 3] = Math.round(Math.min(1, delta < 0 ? -delta * 1.6 : delta * 1.2) * 255);
    }
    if (out[o + 3] > 3) any = true;
  }
  if (!any) return Buffer.alloc(0);   // flat tile: write nothing
  let img = sharp(out, { raw: { width: S, height: S, channels: 4 } });
  if (OUTSIZE !== S) img = sharp(await img.resize(OUTSIZE, OUTSIZE, { kernel: "lanczos3" }).raw().toBuffer(), { raw: { width: OUTSIZE, height: OUTSIZE, channels: 4 } });
  return img.webp({ quality: QUALITY, alphaQuality: QUALITY, effort: 5, smartSubsample: true }).toBuffer();
}

let db = null, put = null;
if (MBTILES) {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(MBTILES);
  db.exec(`CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
             PRIMARY KEY (zoom_level, tile_column, tile_row));`);
  const meta = db.prepare("INSERT OR REPLACE INTO metadata VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    name: "hatiwal-hillshade", format: "webp", type: "overlay", minzoom: String(MINZ), maxzoom: String(MAXZ),
    bounds: BBOX.join(","), attribution: "Terrain © Mapterhorn",
    description: "Pre-rendered shadows-only hillshade (tools/hillshade.mjs). 256px images, drawn at tileSize 512.",
  })) meta.run(k, v);
  put = db.prepare("INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)");
}

const stats = {};
for (let z = MINZ; z <= MAXZ; z++) {
  const r = tileRange(z), jobs = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push([x, y]);
  const s = (stats[z] = { tiles: 0, bytes: 0, empty: 0, t0: Date.now() });
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++];
      const path = `${OUT}/${z}/${x}/${y}.webp`;
      if (SKIP_EXISTING && !put && existsSync(path)) continue;
      const buf = await shade(z, x, y);
      if (buf === null || buf.length === 0) { s.empty++; continue; }
      if (put) put.run(z, x, 2 ** z - 1 - y, buf);   // MBTiles rows are TMS (y flipped)
      else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); }
      s.tiles++; s.bytes += buf.length;
    }
  }));
  console.log(`z${String(z).padStart(2)}  ${String(s.tiles).padStart(6)} tiles  ${(s.bytes / 1e6).toFixed(1).padStart(7)} MB  avg ${s.tiles ? (s.bytes / s.tiles / 1024).toFixed(1) : 0} KB  empty ${s.empty}  ${((Date.now() - s.t0) / 1000).toFixed(0)}s`);
}
if (db) db.close();
