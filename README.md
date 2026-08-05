# Market Mapper

Generates VC-style market maps from a Google Sheet. No backend, no build step,
no dependencies — a static page that reads your sheet directly in the browser
and renders SVG you can export straight into a deck.

The sheet is the whole interface: companies, categories, colors, and layout all
live in tabs you edit.

**Live instance:** https://beriberikix.github.io/market-mapper/

Append `?s=<your sheet id>` to load your own map.

## Running it

ES modules need a real HTTP origin — opening `index.html` over `file://` will
fail on module CORS. Any static server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To deploy elsewhere, upload the directory to any static host (Netlify, Vercel,
S3, a folder behind nginx). There is nothing to build.

This repo deploys itself to GitHub Pages on every push to `main` via
`.github/workflows/deploy.yml`. The smoke test gates the deploy, and the
upload step publishes the repository as-is — no bundler, no install step.

Click **Load sample** to see the format without setting up a sheet.

## Pointing it at a sheet

1. Share the sheet as **Anyone with the link → Viewer**. It is read via
   Google's `gviz` endpoint, so no API key and no Publish-to-web step.
2. Paste the sheet ID or its full URL into the input and hit Load.

### Starting from the sample CSVs

`sample/` holds a ready-made 50-company map — one CSV per tab.

1. Create a blank Google Sheet.
2. **File → Import → Upload → `Companies.csv`**, and choose
   **Insert new sheet(s)**. Repeat for `Categories.csv` and `Config.csv`.
3. The tabs will be named after the files, which is exactly what the app looks
   for. Delete the default empty `Sheet1`.
4. Share as **Anyone with the link → Viewer**, then paste the URL into the app.

Import each file separately — "Replace current sheet" will overwrite a tab
rather than adding one, and the tab names are what the loader matches on.

The sheet ID is loaded into the URL as `?s=<id>`, so **sharing a map is just
sharing the link** — one deployment serves unlimited maps.

## Sheet schema

Three tabs, matched by name. Only `Companies` is required.

### `Companies` (required)

| Column | Required | Notes |
|---|---|---|
| `company` | ✅ | Display name. `name` also accepted. |
| `category` | ✅ | Must match a `Categories` row to be styled; otherwise auto-styled and placed last. |
| `logo_url` | | Direct image URL. **The reliable path — see Logos below.** |
| `domain` | | e.g. `stripe.com`. Used to auto-fetch a favicon when `logo_url` is absent. |
| `website` | | Full URL; `domain` is derived from it if `domain` is blank. |
| `note` | | Free text (stage, ARR, whatever). Parsed but not yet drawn. |
| `emphasis` | | `TRUE` draws an outline — useful for portfolio companies. |

### `Categories` (optional but recommended)

| Column | Notes |
|---|---|
| `category` | Must match the `category` values in `Companies`. |
| `color` | Hex, e.g. `#3b6fd4`. Falls back to a built-in palette. |
| `description` | Small text under the category title. |
| `order` | Numeric sort. Defaults to row order. |
| `span` | `2` makes the category twice as wide. Capped at `columns`. |

Reading order carries meaning in a market map, so categories are packed
row-major in the order you set — never rearranged to save vertical space.

### `Config` (optional)

Key/value rows, two columns headed `key` and `value`:

| Key | Default | Notes |
|---|---|---|
| `title` | `Market Map` | |
| `subtitle` | — | |
| `date` | — | Drawn under the subtitle. |
| `footer` | — | Bottom-left. Good for sourcing/disclaimer. |
| `columns` | `3` | 1–8. |
| `width` | `1600` | Canvas width in px; height is derived. |
| `min_cell_width` | `132` | Lower it to pack more logos per row. |
| `background` | `#ffffff` | |
| `text_color` | `#14161c` | |
| `muted_color` | `#6b7280` | |
| `card_color` | `#f4f5f8` | Company tile fill. |
| `font` | system stack | Any CSS font-family value. |
| `logo_service` | `unavatar` | `none` disables auto-fetch. |
| `show_names` | `TRUE` | `FALSE` for a logos-only map. |

Unknown keys are ignored rather than erroring, so the schema can grow without
breaking existing sheets.

## Logos

This is the part that actually breaks, so it degrades in stages:

1. **`logo_url`** — a direct image URL. Best quality, always works.
2. **`domain`** — auto-fetched via [unavatar.io](https://unavatar.io). Zero
   effort, but resolution varies (32–128px depending on what it finds).
3. **Neither, or the fetch failed** — a styled chip with the company's initials.

Every fetched logo is re-encoded to PNG via canvas before embedding. Services
return a grab-bag of formats — measured across 49 domains: 31 png, 6 ico,
3 svg, 1 jpeg — and an `<image>` pointing at an SVG or ICO data URI is a nested
document that some renderers silently refuse to draw. Normalizing means the
emitted SVG only ever contains PNG.

### What to expect from auto-fetch

Measured against this repo's 50-company sample sheet, in Chrome:

- **~39 of 50 logos embed.** The rest fall back to initials.
- **9 failures were the rate limit.** unavatar enforces a hard quota for
  anonymous callers. Retrying deeper does not help: 3 retries and 5 retries
  both returned exactly 39 logos, but the deeper backoff took 90s instead of
  ~20s. The retry policy is tuned accordingly.
- **2 failures were corrupt upstream data** — unavatar served a truncated SVG
  (872 bytes, ending mid-path, no closing tag) for those domains. No retry
  policy fixes that.

The status bar reports the split, since only the rate-limited ones are worth
reloading for. **For a map that's actually going in a deck, fill in `logo_url`.**

Google's `s2/favicons` is the obvious choice for step 2 and is deliberately
**not** used: it serves images fine but sends no `Access-Control-Allow-Origin`
header (verified against the live endpoint), so every fetch fails and every
domain-only row degrades to initials. Clearbit's free logo API is gone. Don't
re-add either without re-checking CORS.

Every logo is inlined as a `data:` URI before rendering. That keeps the live
view and the exported PNG byte-identical and avoids canvas tainting — a remote
`<image href>` in an SVG silently produces a blank PNG on export.

When logos can't be embedded, the status bar names them so you know which rows
need a `logo_url`.

## Export

- **SVG** — serialization of the exact element on screen. Vector, editable in
  Figma or Illustrator, restyleable by hand.
- **PNG** — the same markup rasterized at 2× through a canvas.

Because both come from one layout pass, the export always matches the screen.

## Tests

```sh
node test/smoke.mjs
# or, with no Node installed:
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/smoke.mjs
```

20 checks over parsing, geometry, and serialization — including that no company
is ever silently dropped, that category boxes never overlap or escape the
canvas, and that XML is properly escaped. Deliberately free of `node:` builtins
so it runs on a bare JS engine; this repo has no toolchain.

## Layout

```
sheets.js   gviz fetch + tab -> rows
schema.js   rows -> model, with defaults and warnings
logos.js    logo resolution + data: URI embedding
layout.js   model -> absolute geometry (pure, no DOM writes)
render.js   geometry -> SVG string
export.js   SVG string -> .svg / .png download
main.js     wiring and status reporting
```

SVG rather than HTML/CSS is the load-bearing decision: export fidelity is what
decides whether a tool like this gets used or just admired, and serializing the
live SVG makes an exact export free.

## Known gaps

- `note` is parsed but not drawn — no design for it yet.
- Category `group` is parsed but not rendered as a visual grouping.
- Category boxes in a row are sized to their content, so a row's boxes can end
  at different heights. Equalizing them is a one-line change in `layout.js` if
  you prefer the tidier look.
- unavatar returns whatever it can find, so logo resolution and background
  treatment vary company to company. `logo_url` is the fix for any that look
  bad in a final map.
- Logos with white artwork and a transparent background (Fivetran, in the
  sample) nearly vanish against the light card fill. A per-company background
  swatch would fix it; there's no design for one yet.
- A 50-company map takes ~20s to load, almost entirely logo fetching against a
  rate limit. Sheets with `logo_url` filled in are much faster.
- During a rate-limit backoff the progress counter stalls, which reads as a
  hang. It isn't, but it should say so.
