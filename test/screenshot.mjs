const BASE = process.env.MAP_BASE || 'https://map.hatiwal.com';
import { chromium } from 'playwright';
const shots = [
  { style: 'hatiwal-light-ps', center: [69.2075, 34.5553], zoom: 12, name: 'kabul-light-ps' },
  { style: 'hatiwal-dark-ps',  center: [69.2075, 34.5553], zoom: 12, name: 'kabul-dark-ps'  },
  { style: 'hatiwal-light-en', center: [67.6939, 33.9377], zoom: 6,  name: 'afghanistan-light-en' },
];
const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
for (const s of shots) {
  const p = await b.newPage({ viewport: { width: 700, height: 500 }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><head>
    <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
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
    <style>html,body,#m{margin:0;height:500px;width:700px}</style></head>
    <body><div id="m"></div><script>
      window.__ready=false; window.__err=null;
      const map=new maplibregl.Map({container:'m',
        style:'${BASE}/styles/${s.style}.json',
        center:[${s.center}],zoom:${s.zoom},attributionControl:false});
      map.on('error',e=>{window.__err=(window.__err||'')+' | '+(e.error&&e.error.message||'err')});
      map.on('idle',()=>{window.__ready=true});
    </script></body></html>`, { waitUntil: 'load' });
  try { await p.waitForFunction('window.__ready===true', { timeout: 45000 }); }
  catch { console.log(`  ${s.name}: TIMED OUT waiting for idle`); }
  const err = await p.evaluate('window.__err');
  await p.screenshot({ path: `tmp/${s.name}.png` });
  console.log(`  ${s.name}.png rendered${err ? '  ERRORS:'+err.slice(0,200) : '  (no map errors)'}`);
  await p.close();
}
await b.close();
