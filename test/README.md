# Map render tests

`render-test.mjs` drives a real headless browser against the LIVE
`map.hatiwal.com` and asserts, per style variant and zoom:

- the map reaches `idle` (tiles + glyphs actually loaded)
- **zero** MapLibre errors and **zero** failed network requests
- **`labels > 0`** — the assertion that has earned its keep twice

Matrix: 3 views (country z6, city z12, street z15) × light/dark × en/ps/fa = 18 cases.

```bash
ln -sfn ../hatiwal-web/node_modules node_modules   # borrow playwright + chromium
node test/render-test.mjs
```

## Why `labels > 0` matters

It has caught two real bugs that every other signal called healthy:

1. **z15 rendered ZERO labels.** `place-label` matched only `city/town/village/region/state`, and at
   street zoom you are *inside* a city so no such point is in view — and POI labels are deliberately
   off. A beautiful map with no text on it. Fixed by widening to
   `suburb/neighbourhood/quarter/hamlet` and adding a quiet `road-label` layer from z14.
2. **An invalid expression blanked all six styles.** `text-size` was written as a `case` wrapping two
   `interpolate`s; MapLibre requires interpolate-on-zoom to be the OUTERMOST expression and rejects
   the whole style otherwise. 18/18 went to 0/18 in one run.

Neither showed up in `curl`: the HTTP responses were 200 throughout.
