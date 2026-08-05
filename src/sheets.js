/**
 * Reads Google Sheets from the browser with no server, no API key, and no
 * build step, via the gviz endpoint.
 *
 * The sheet only needs to be shared as "Anyone with the link -> Viewer".
 * Unlike Publish-to-web, gviz addresses tabs by *name* rather than by gid,
 * which is what lets the config schema survive someone reordering tabs.
 */

const GVIZ = (id, tab) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq` +
  `?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`;

/**
 * Accepts a bare ID or any full Sheets URL and returns the ID.
 */
export function parseSheetId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // Bare IDs are long opaque strings; anything with a slash is a bad URL.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return null;
}

/**
 * gviz wraps its JSON in a JS callback:
 *   /*O_o* /
 *   google.visualization.Query.setResponse({...});
 * Slice to the outermost braces rather than regexing the wrapper, which has
 * changed shape before.
 */
function unwrap(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unrecognized response from Google Sheets');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeKey(label, index) {
  const key = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return key || `col_${index}`;
}

function cellValue(cell) {
  if (!cell) return '';
  // Prefer the formatted string: it preserves what the author actually typed
  // for dates and numbers, which is what map labels want.
  if (cell.f != null) return String(cell.f).trim();
  if (cell.v == null) return '';
  if (typeof cell.v === 'boolean') return cell.v ? 'true' : 'false';
  return String(cell.v).trim();
}

/**
 * Fetch one tab as an array of plain objects keyed by normalized header name.
 * Returns null when the tab does not exist, so optional tabs stay optional.
 */
export async function fetchTab(sheetId, tabName) {
  let res;
  try {
    res = await fetch(GVIZ(sheetId, tabName), { credentials: 'omit' });
  } catch (err) {
    throw new Error(
      `Network request to Google Sheets failed. Check the sheet is shared as ` +
      `"Anyone with the link". (${err.message})`
    );
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Google Sheets returned ${res.status}. The sheet is probably not shared ` +
      `publicly, or the ID is wrong.`
    );
  }

  const text = await res.text();

  // A private sheet redirects to an HTML sign-in page rather than erroring.
  if (/^\s*</.test(text)) {
    throw new Error(
      'Google returned a sign-in page instead of data. Share the sheet as ' +
      '"Anyone with the link -> Viewer".'
    );
  }

  const payload = unwrap(text);

  if (payload.status === 'error') {
    const detail = (payload.errors || [])
      .map((e) => e.detailed_message || e.message)
      .join('; ');
    // Missing tabs surface as an error rather than a 404.
    if (/invalid_query|sheet/i.test(detail)) return null;
    throw new Error(detail || 'Google Sheets query failed');
  }

  const table = payload.table || {};
  const cols = (table.cols || []).map((c, i) => normalizeKey(c.label, i));

  return (table.rows || [])
    .map((row) => {
      const obj = {};
      cols.forEach((key, i) => { obj[key] = cellValue((row.c || [])[i]); });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((v) => v !== ''));
}

/**
 * Fetch all tabs the map needs. Tabs are fetched concurrently; a missing
 * optional tab resolves to null rather than rejecting the whole load.
 */
export async function fetchWorkbook(sheetId) {
  const [config, categories, companies] = await Promise.all([
    fetchTab(sheetId, 'Config'),
    fetchTab(sheetId, 'Categories'),
    fetchTab(sheetId, 'Companies'),
  ]);

  if (!companies) {
    throw new Error(
      'No "Companies" tab found. The sheet needs a tab named exactly ' +
      '"Companies" (see README.md).'
    );
  }

  return { config, categories, companies };
}
