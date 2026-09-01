import { chromium } from 'playwright';
// `MAP_BASE=http://localhost:8099 node test/render-test.mjs` renders the styles
// in THIS working tree instead of the deployed ones.
//
// This defaulted to the live host with no override, which is a trap: a style you
// just edited is NOT what gets scored, so the suite can report 18/18 on the old
// deployed files while your change is untested — and a screenshot "before/after"
// shows no difference for the same reason. The style's tile and glyph URLs are
// absolute (the live host), so serving only the styles/ directory locally is
// enough to test a style change against real tiles.
const BASE = process.env.MAP_BASE || 'https://map.hatiwal.com';
const VIEWS = [
  { name: 'kabul',   center: [69.2075, 34.5553], zoom: 12 },
  { name: 'country', center: [67.6939, 33.9377], zoom: 6  },
  { name: 'street',  center: [69.1723, 34.5281], zoom: 15 },
];
const LANGS = ['en', 'ps', 'fa'];
const MODES = ['light', 'dark'];

const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
let pass = 0, fail = 0;
const results = [];

for (const mode of MODES) for (const lang of LANGS) for (const v of VIEWS) {
  const id = `${v.name}-${mode}-${lang}`;
  const p = await b.newPage({ viewport: { width: 640, height: 440 } });
  const bad = [];
  p.on('requestfailed', r => bad.push(`${r.failure()?.errorText} ${r.url().slice(-40)}`));
  p.on('response', r => { if (r.status() >= 400) bad.push(`HTTP${r.status()} ${r.url().slice(-40)}`); });
  const t0 = Date.now();
  await p.setContent(`<!doctype html><html><head>
    <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
    <script>
      // LOAD THE RTL TEXT PLUGIN, exactly as the web app does.
      //
      // Without it a browser renders Arabic script UNSHAPED and in logical
      // order, so "ناحیه پانزدهم" comes out as "مهدزناپ هیحان" — every letter
      // reversed and disconnected. That is not what users see: hatiwal.com calls
      // setRTLTextPlugin (map-impl.tsx) and MapLibre NATIVE shapes RTL itself on
      // mobile. So a harness without it was scoring the ps and fa cells against
      // text no product surface produces — passing on shaping it could not see,
      // and making its screenshots useless for judging the two RTL locales.
      window.__rtlReady = maplibregl
        .setRTLTextPlugin("https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js", true)
        .catch(() => {});
    </script>
    <style>html,body,#m{margin:0;height:440px;width:640px}</style></head><body><div id="m"></div><script>
    window.__e=[];window.__ready=false;
    const map=new maplibregl.Map({container:'m',style:'${BASE}/styles/hatiwal-${mode}-${lang}.json',
      center:[${v.center}],zoom:${v.zoom},attributionControl:false});
    map.on('error',e=>window.__e.push(e.error&&e.error.message||'err'));
    map.on('idle',()=>{window.__ready=true;
      window.__labels=map.queryRenderedFeatures().filter(f=>f.layer.id.includes('label')).length;
      window.__layers=map.getStyle().layers.length;});
  </script></body></html>`, { waitUntil: 'load' });
  let ok = true;
  try { await p.waitForFunction('window.__ready===true', { timeout: 40000 }); } catch { ok = false; }
  const ms = Date.now() - t0;
  const errs = await p.evaluate('window.__e');
  const labels = await p.evaluate('window.__labels ?? 0');
  await p.screenshot({ path: `tmp/shots/${id}.png` });
  await p.close();
  const good = ok && errs.length === 0 && bad.length === 0 && labels > 0;
  good ? pass++ : fail++;
  results.push({ id, ok, ms, labels, errs: errs.length, bad: bad.length, note: bad[0] || errs[0] || '' });
}
await b.close();
console.log('  view-mode-lang            idle?  ms    labels  errs  netfail  note');
for (const r of results)
  console.log(`  ${r.id.padEnd(24)} ${String(r.ok).padEnd(6)} ${String(r.ms).padEnd(5)} ${String(r.labels).padEnd(7)} ${String(r.errs).padEnd(5)} ${String(r.bad).padEnd(8)} ${r.note.slice(0,34)}`);
console.log(`\n  PASS ${pass} / FAIL ${fail} of ${results.length}`);
