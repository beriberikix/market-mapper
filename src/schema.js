/**
 * Turns raw tab rows into the model the layout engine consumes, applying
 * defaults for everything the author left blank.
 *
 * Design note: Config is key/value rows rather than a header row so that new
 * settings can be added later without invalidating anyone's existing sheet.
 */

export const DEFAULTS = {
  title: 'Market Map',
  subtitle: '',
  footer: '',
  date: '',
  width: 1600,
  columns: 3,
  min_cell_width: 132,
  background: '#ffffff',
  text_color: '#14161c',
  muted_color: '#6b7280',
  card_color: '#f4f5f8',
  logo_backdrop: '#2f333d',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  logo_service: 'unavatar',
  show_names: true,
};

// The palette used when Categories omits a color. Chosen to stay legible as a
// header bar with white text in both print and screen.
export const PALETTE = [
  '#3b6fd4', '#c2543c', '#2f8f6b', '#8a5cb8',
  '#c98a1e', '#3d8ba8', '#a34a72', '#5b7030',
];

/**
 * Colour helpers, shared by the renderer (header contrast) and the logo
 * pipeline (is this artwork visible against the card it sits on).
 */
export function hexToRgb(hex) {
  const raw = String(hex).replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two luminances, 1 (identical) to 21. */
export function contrastRatio(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'on']);
const FALSY = new Set(['false', 'no', 'n', '0', 'off']);

function coerce(key, value) {
  const fallback = DEFAULTS[key];
  if (typeof fallback === 'number') {
    const n = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  if (typeof fallback === 'boolean') {
    const v = String(value).trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    return fallback;
  }
  return String(value);
}

/**
 * Config rows are [key, value]. Tolerate whichever header names the author
 * used, and fall back to positional columns.
 */
function parseConfig(rows) {
  const out = { ...DEFAULTS };
  if (!rows) return out;

  for (const row of rows) {
    const keys = Object.keys(row);
    const rawKey = row.key ?? row.setting ?? row.option ?? row[keys[0]];
    const rawVal = row.value ?? row.val ?? row[keys[1]];
    if (!rawKey) continue;

    const key = String(rawKey).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (rawVal === '' || rawVal == null) continue;
    if (!(key in DEFAULTS)) continue; // ignore unknown keys rather than break

    out[key] = coerce(key, rawVal);
  }

  // A single column can never be narrower than a cell.
  out.columns = Math.max(1, Math.min(8, Math.round(out.columns)));
  return out;
}

function parseCategories(rows, config) {
  if (!rows) return [];

  return rows
    .map((row, i) => {
      const name = (row.category ?? row.name ?? row.title ?? '').trim();
      if (!name) return null;

      const spanRaw = Number(row.span ?? row.width ?? 1);
      const span = Number.isFinite(spanRaw)
        ? Math.max(1, Math.min(config.columns, Math.round(spanRaw)))
        : 1;

      const orderRaw = Number(row.order ?? row.sort ?? '');

      return {
        name,
        color: (row.color ?? row.colour ?? '').trim() || PALETTE[i % PALETTE.length],
        description: (row.description ?? row.subtitle ?? '').trim(),
        group: (row.group ?? row.parent ?? '').trim(),
        span,
        order: Number.isFinite(orderRaw) ? orderRaw : i,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

function parseCompanies(rows) {
  return rows
    .map((row) => {
      const name = (row.company ?? row.name ?? '').trim();
      if (!name) return null;

      const website = (row.website ?? row.url ?? row.site ?? '').trim();
      const domain = (row.domain ?? '').trim() || domainFrom(website);

      return {
        name,
        category: (row.category ?? row.segment ?? row.bucket ?? '').trim(),
        logo: (row.logo_url ?? row.logo ?? row.image ?? '').trim(),
        domain,
        website,
        note: (row.note ?? row.notes ?? row.stage ?? '').trim(),
        emphasis: TRUTHY.has(
          String(row.emphasis ?? row.highlight ?? row.portfolio ?? '')
            .trim()
            .toLowerCase()
        ),
      };
    })
    .filter(Boolean);
}

/**
 * "https://www.acme.co/pricing?x=1" -> "acme.co". Regex rather than `new URL`
 * so this stays dependency-free and never throws on the half-typed values
 * spreadsheets are full of ("acme.co", "www.acme.co/").
 */
function domainFrom(website) {
  const match = String(website || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);

  return match ? match[1].toLowerCase() : '';
}

/**
 * Join companies onto categories. Categories present in Companies but absent
 * from the Categories tab are appended rather than dropped — silently losing
 * rows is the worst failure mode for a tool like this.
 */
export function buildModel({ config, categories, companies }) {
  const cfg = parseConfig(config);
  const declared = parseCategories(categories, cfg);
  const rows = parseCompanies(companies);

  const byName = new Map();
  const order = [];

  for (const cat of declared) {
    const key = cat.name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, { ...cat, companies: [] });
    order.push(key);
  }

  const undeclared = [];

  for (const company of rows) {
    const key = (company.category || 'Uncategorized').toLowerCase();
    if (!byName.has(key)) {
      const name = company.category || 'Uncategorized';
      byName.set(key, {
        name,
        color: PALETTE[(order.length + undeclared.length) % PALETTE.length],
        description: '',
        group: '',
        span: 1,
        order: Number.MAX_SAFE_INTEGER,
        companies: [],
        undeclared: true,
      });
      order.push(key);
      undeclared.push(name);
    }
    byName.get(key).companies.push(company);
  }

  const buckets = order.map((k) => byName.get(k)).filter((c) => c.companies.length);
  const empties = order
    .map((k) => byName.get(k))
    .filter((c) => !c.companies.length)
    .map((c) => c.name);

  return {
    config: cfg,
    categories: buckets,
    warnings: buildWarnings({ undeclared, empties, total: rows.length }),
  };
}

function buildWarnings({ undeclared, empties, total }) {
  const warnings = [];
  if (!total) warnings.push('No companies found in the Companies tab.');
  if (undeclared.length) {
    warnings.push(
      `${undeclared.length} categor${undeclared.length === 1 ? 'y' : 'ies'} ` +
      `not listed in the Categories tab (auto-styled and placed last): ` +
      `${undeclared.slice(0, 4).join(', ')}${undeclared.length > 4 ? '…' : ''}`
    );
  }
  if (empties.length) {
    warnings.push(`Empty categories skipped: ${empties.join(', ')}`);
  }
  return warnings;
}
