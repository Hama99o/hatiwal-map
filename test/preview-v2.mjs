// Side-by-side previews: the LIVE style (left) vs the v2 depth style (right),
// rendered by the same maplibre-gl major the web app ships (5.x), on real tiles.
//
//   MAP_BASE=http://127.0.0.1:8099 node test/preview-v2.mjs     # → tmp/v2/*.png
//
// Left always loads from the live host, so "old" is what users see today.
// Right loads from MAP_BASE (your tree). Until /terrain is self-hosted, terrain
// requests are routed to Mapterhorn's public endpoint (TERRAIN_PREVIEW) at the
// network layer, so the style files never carry a third-party URL.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MAP_BASE || 'https://map.hatiwal.com';
const LIVE = 'https://map.hatiwal.com';
const TERRAIN_PREVIEW = process.env.TERRAIN_PREVIEW || 'https://tiles.mapterhorn.com';
const OUT = 'tmp/v2';
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { name: 'country-z6',        lang: 'en', center: [67.6939, 33.9377], zoom: 6 },
  { name: 'hindukush-z10',     lang: 'en', center: [69.10, 35.25],     zoom: 9.5 },
  { name: 'bamyan-z10',        lang: 'fa', center: [67.83, 34.82],     zoom: 10 },
  { name: 'kabul-z10',         lang: 'en', center: [69.18, 34.53],     zoom: 10 },
  { name: 'kabul-z13-ps',      lang: 'ps', center: [69.1723, 34.5281], zoom: 13 },
  { name: 'herat-z13-fa',      lang: 'fa', center: [62.199, 34.348],   zoom: 13 },
  { name: 'kabul-z16',         lang: 'en', center: [69.1810, 34.5300], zoom: 16 },
  { name: 'kabul-z16-tilt',    lang: 'en', center: [69.1810, 34.5300], zoom: 16, pitch: 55, bearing: -25 },
  { name: 'islamabad-z13-ur',  lang: 'ur', center: [73.0551, 33.7104], zoom: 13 },
];
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const W = 560, H = 520;

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const theme of THEMES) for (const v of VIEWS) {
  const p = await b.newPage({ viewport: { width: W * 2 + 12, height: H + 34 } });
  await p.route('**/map.hatiwal.com/terrain/**', (r) =>
    r.continue({ url: r.request().url().replace(/^https:\/\/map\.hatiwal\.com\/terrain/, TERRAIN_PREVIEW) }));
  const cam = `center:[${v.center}],zoom:${v.zoom},pitch:${v.pitch || 0},bearing:${v.bearing || 0}`;
  await p.setContent(`<!doctype html><html><head>
    <script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
    <script>window.__rtl = maplibregl.setRTLTextPlugin("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js", false).catch(()=>{});</script>
    <style>body{margin:0;display:flex;gap:12px;background:#888;font:600 13px system-ui}
      .c{width:${W}px} .h{height:34px;line-height:34px;padding:0 10px;background:#111;color:#fff}
      .m{width:${W}px;height:${H}px}</style></head><body>
    <div class="c"><div class="h">BEFORE — live hatiwal-${theme}-${v.lang}</div><div id="a" class="m"></div></div>
    <div class="c"><div class="h">AFTER — hatiwal-v2-${theme}-${v.lang}</div><div id="b" class="m"></div></div>
    <script>
      window.__e=[]; let idle=0;
      for (const [id,url] of [['a','${LIVE}/styles/hatiwal-${theme}-${v.lang}.json'],['b','${BASE}/styles/hatiwal-v2-${theme}-${v.lang}.json']]) {
        const m=new maplibregl.Map({container:id,style:url,${cam},attributionControl:false,fadeDuration:0,canvasContextAttributes:{preserveDrawingBuffer:true}});
        m.on('error',e=>window.__e.push(id+': '+(e.error&&e.error.message||'err')));
        m.once('idle',()=>{idle++; if(id==='b') window.__labels=m.queryRenderedFeatures().filter(f=>f.layer.type==='symbol').length;});
      }
      window.__idle=()=>idle;
    </script></body></html>`, { waitUntil: 'load' });
  try { await p.waitForFunction('window.__idle()===2', { timeout: 90000 }); } catch { console.log(`  ${theme}/${v.name}: TIMEOUT`); }
  await p.waitForTimeout(400);
  const errs = await p.evaluate('window.__e');
  const labels = await p.evaluate('window.__labels ?? 0');
  await p.screenshot({ path: `${OUT}/${theme}-${v.name}.png` });
  console.log(`  ${theme}-${v.name}.png  v2 labels=${labels}${errs.length ? '  ERRORS: ' + errs.slice(0, 3).join(' | ') : ''}`);
  await p.close();
}
await b.close();
