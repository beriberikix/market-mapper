/**
 * Logo resolution and embedding.
 *
 * This is the part of a market-map tool that actually breaks, so it is built
 * to degrade in stages rather than fail:
 *
 *   1. explicit logo_url from the sheet   -> best
 *   2. domain -> favicon service          -> convenient, lower quality
 *   3. neither, or the fetch failed       -> styled text chip
 *
 * Everything is converted to a data: URI up front. That keeps the live SVG and
 * the exported PNG byte-identical, and sidesteps canvas tainting entirely --
 * a remote <image href> in an SVG silently blanks the canvas on export.
 */

import { contrastRatio, hexToRgb, luminance } from './schema.js';

/**
 * Auto-fetch services, keyed by the `logo_service` config value.
 *
 * Google's s2/favicons is the obvious choice and is deliberately absent: it
 * serves images fine but sends no Access-Control-Allow-Origin header, so the
 * fetch below always fails and every domain-only row degrades to initials.
 * Verified against the live endpoint -- don't re-add it without rechecking.
 *
 * unavatar does send CORS. Resolution varies (32-128px depending on what it
 * finds), which is why an explicit logo_url still beats it.
 */
const SERVICES = {
  unavatar: (domain) => `https://unavatar.io/${encodeURIComponent(domain)}`,
};

/**
 * Auto-fetch services rate-limit, so requests are pooled and retried.
 *
 * Deliberately modest settings. Measured against unavatar with a 50-company
 * sheet: 3 retries and 5 retries both yielded exactly 39 embedded logos, but
 * the deeper backoff took 90s instead of ~20s. The limit is a hard quota for
 * anonymous callers, not a burst limit -- waiting longer does not get you more
 * logos, it just makes the map slower to draw. `logo_url` is the real fix.
 */
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;

/**
 * Total rate-limit failures before auto-fetch gives up for this run.
 *
 * Counted cumulatively, not consecutively. A consecutive counter looks like
 * the obvious choice and does not work: with several requests in flight, the
 * occasional success resets it and the breaker never trips. Measured on the
 * hosted instance with a spent quota -- a consecutive breaker still took 120s
 * to reach 43 of 50 logos.
 *
 * Cumulative is also the better signal for what is actually happening. A 429
 * here is a quota, not a blip: once some requests are being refused, the rest
 * will be too, and each one costs the full backoff ladder before failing.
 */
const BREAKER_THRESHOLD = 8;

const cache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-run, so a reload always gets a fresh chance at the quota.
 */
function createBreaker(threshold = BREAKER_THRESHOLD) {
  let rateLimited = 0;
  return {
    get tripped() {
      return rateLimited >= threshold;
    },
    recordRateLimit() {
      rateLimited += 1;
    },
  };
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. Plain async
 * runners draining a shared index -- no dependency needed.
 */
async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    }
  );
  await Promise.all(runners);
}

/**
 * 429 and 5xx are transient; everything else is a real failure worth
 * reporting immediately rather than retrying into a rate limit.
 */
async function fetchWithRetry(url) {
  let delay = BASE_BACKOFF_MS;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) return res;

    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= MAX_RETRIES) {
      throw new Error(`HTTP ${res.status}`);
    }

    // Prefer the server's own guidance when it sends one.
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 15_000)
      : delay;

    // Jitter so a batch of retries doesn't resynchronize into another burst.
    await sleep(wait + Math.random() * 400);
    delay *= 2;
  }
}

function sourceFor(company, service) {
  if (company.logo) return company.logo;
  const resolve = SERVICES[service];
  if (company.domain && resolve) return resolve(company.domain);
  return null;
}

/** Longest edge of a normalized logo. Drawn at ~40px, exported at 2x. */
const LOGO_PX = 128;

/**
 * A pixel counts as "visible" if it clears this contrast ratio against the
 * card it is drawn on. 1.25 is well below any accessibility threshold on
 * purpose -- the question is not "is this readable" but "is this there at all".
 */
const VISIBLE_CONTRAST = 1.25;

/**
 * Fraction of the image that must be visible for the logo to be usable as-is.
 *
 * Measured across 46 real logos: the two broken ones scored 0.000, and the
 * next-worst usable logo scored 0.180. Anywhere in that gap works; 0.02 is
 * chosen near the bottom of it so a legitimately sparse logo is never
 * mistaken for an invisible one.
 */
const MIN_VISIBLE_FRACTION = 0.02;

function readAsDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('could not read image'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Give an SVG explicit pixel dimensions.
 *
 * Logo services commonly return BIMI-style SVGs: a viewBox and no width or
 * height. Browsers disagree on what an <img> reports for those -- some give 0,
 * some the 300x150 CSS default -- so a square logo can rasterize squashed 2:1.
 * Deriving the size from the viewBox makes the result identical everywhere.
 */
function sizeSvg(dataUri) {
  const marker = ';base64,';
  const at = dataUri.indexOf(marker);
  if (at === -1) return dataUri; // not base64; leave it alone

  let text;
  try {
    text = atob(dataUri.slice(at + marker.length));
  } catch {
    return dataUri;
  }

  const openTag = text.match(/<svg\b[^>]*>/i);
  if (!openTag) return dataUri;
  if (/\swidth\s*=/i.test(openTag[0]) && /\sheight\s*=/i.test(openTag[0])) return dataUri;

  const viewBox = openTag[0].match(
    /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i
  );
  if (!viewBox) return dataUri;

  const vbW = parseFloat(viewBox[1]);
  const vbH = parseFloat(viewBox[2]);
  if (!(vbW > 0 && vbH > 0)) return dataUri;

  const scale = Math.min(LOGO_PX / vbW, LOGO_PX / vbH);
  const sized = openTag[0].replace(
    /<svg\b/i,
    `<svg width="${Math.round(vbW * scale)}" height="${Math.round(vbH * scale)}"`
  );

  return `data:image/svg+xml;base64,${btoa(text.replace(openTag[0], sized))}`;
}

function decode(dataUri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = dataUri;
  });
}

/**
 * Re-encode every logo as PNG.
 *
 * Services return a grab-bag of formats -- measured across 49 domains:
 * 31 png, 6 ico, 3 svg, 1 jpeg. An <image> pointing at an SVG or ICO data URI
 * is a separate nested document, and support for that varies by renderer; it
 * silently draws nothing in some of them. Rasterizing here means the SVG we
 * emit only ever contains PNG, which every renderer and the canvas export path
 * agree on.
 *
 * Vector logos lose their vector-ness, which is the deliberate trade: a
 * reliable 128px raster beats an SVG that might not draw at all. Set an
 * explicit logo_url if you need vector fidelity for a specific company.
 *
 * Data URIs never taint the canvas, so the export path stays clean.
 */
/**
 * Decide whether the artwork is actually going to show up.
 *
 * Two failures look identical to the user -- an empty tile -- but need
 * different responses, so they are separated here:
 *
 *   blank  no pixel has any alpha at all. Services do return these: unavatar
 *          served a fully transparent 128x128 PNG for one domain in the
 *          sample. There is nothing to draw, so the caller falls back to a
 *          text chip.
 *   light  the artwork is opaque but has no contrast against the card, i.e. a
 *          white logo on a light tile. There IS something to draw; it just
 *          needs a dark backdrop behind it.
 */
function assess(ctx, width, height, card) {
  const { data } = ctx.getImageData(0, 0, width, height);

  let opaque = 0;
  let visible = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha === 0) continue;
    opaque += 1;

    // Composite over the card, which is what the viewer actually sees.
    const composited = [0, 1, 2].map(
      (c) => data[i + c] * alpha + card.rgb[c] * (1 - alpha)
    );
    if (contrastRatio(luminance(composited), card.luminance) >= VISIBLE_CONTRAST) {
      visible += 1;
    }
  }

  const total = width * height;
  return {
    blank: opaque === 0,
    light: visible / total < MIN_VISIBLE_FRACTION,
  };
}

async function normalize(dataUri, isVector, card) {
  const img = await decode(isVector ? sizeSvg(dataUri) : dataUri);

  const w = img.naturalWidth || LOGO_PX;
  const h = img.naturalHeight || LOGO_PX;

  // Vector sources are scaled up to the target; raster sources are never
  // upscaled, which would only add blur.
  const scale = isVector
    ? Math.min(LOGO_PX / w, LOGO_PX / h)
    : Math.min(LOGO_PX / w, LOGO_PX / h, 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const { blank, light } = assess(ctx, canvas.width, canvas.height, card);
  if (blank) throw new Error('blank image');

  return { uri: canvas.toDataURL('image/png'), light };
}

async function toDataUri(url, card) {
  // The card colour participates in the light/blank assessment, so it belongs
  // in the cache key.
  const key = `${card.hex}|${url}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    let raw = url;
    let type = '';

    if (!url.startsWith('data:')) {
      const res = await fetchWithRetry(url);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type)) throw new Error(`not an image (${blob.type})`);
      type = blob.type;
      raw = await readAsDataUri(blob);
    } else {
      type = url.slice(5, url.indexOf(';'));
    }

    try {
      return await normalize(raw, /svg/i.test(type), card);
    } catch (err) {
      // A blank image is a definite verdict, not a re-encoding hiccup -- there
      // is genuinely nothing to draw, so never fall through to the original.
      if (/blank/.test(err.message)) throw err;

      // If re-encoding fails, the original is still better than nothing --
      // unless it is a format the renderer may not draw, where a text chip is
      // the more honest outcome.
      if (/svg|icon/i.test(type)) throw new Error(`could not rasterize ${type}`);
      return { uri: raw, light: false };
    }
  })();

  cache.set(key, promise);
  return promise;
}

/**
 * Mutates each company with `logoData` (a data: URI) or leaves it unset.
 * Never rejects: a failed logo is a text chip, not a broken map.
 *
 * Returns the names of companies whose logo could not be embedded so the UI
 * can tell the author which rows to fix.
 */
export async function embedLogos(categories, config, onProgress) {
  const rgb = hexToRgb(config.card_color) || [255, 255, 255];
  const card = { hex: config.card_color, rgb, luminance: luminance(rgb) };

  const jobs = [];

  for (const category of categories) {
    for (const company of category.companies) {
      const src = sourceFor(company, config.logo_service);
      if (!src) continue;
      jobs.push({ company, src });
    }
  }

  let done = 0;
  let abandoned = 0;
  const failed = [];
  const reasons = { rateLimited: 0, invalid: 0, other: 0 };
  const breaker = createBreaker();

  await pool(jobs, MAX_CONCURRENT, async ({ company, src }) => {
    // The quota is spent; stop paying the backoff cost for a certain failure.
    if (breaker.tripped) {
      reasons.rateLimited += 1;
      abandoned += 1;
      failed.push(company.name);
      done += 1;
      onProgress?.(done, jobs.length);
      return;
    }

    try {
      const { uri, light } = await toDataUri(src, card);
      company.logoData = uri;
      company.logoLight = light;
    } catch (err) {
      // Every failure is a text chip rather than a broken map, but the causes
      // need different fixes, so they are counted separately.
      //
      //   rateLimited - the service quota; waiting or reloading may help
      //   invalid     - the bytes are not a usable image. Observed in the
      //                 wild: unavatar served a truncated SVG (no closing
      //                 tag) for some domains. Only logo_url fixes it.
      if (/\b429\b/.test(err.message)) {
        reasons.rateLimited += 1;
        breaker.recordRateLimit();
      } else if (/decode|rasterize|not an image|blank/i.test(err.message)) {
        // A corrupt or empty payload says nothing about the quota, so it is
        // not counted toward the breaker.
        reasons.invalid += 1;
      } else {
        reasons.other += 1;
      }

      failed.push(company.name);
    } finally {
      done += 1;
      onProgress?.(done, jobs.length);
    }
  });

  return { failed, reasons, abandoned };
}

/**
 * Initials for the fallback chip: "Acme Robotics" -> "AR", "Stripe" -> "St".
 */
export function initials(name) {
  const words = name.split(/[\s/&-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}
