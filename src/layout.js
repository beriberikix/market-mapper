/**
 * Pure geometry. Computes absolute positions for every element, so the
 * renderer is a dumb serializer and the exported SVG is identical to what is
 * on screen.
 *
 * Categories are packed row-major (not masonry) because reading order carries
 * meaning in a market map -- a masonry pack would silently reorder the
 * author's argument to save vertical space.
 */

const PAD = 48;
const GUTTER = 22;

const TITLE_SIZE = 34;
const SUBTITLE_SIZE = 16;
const META_SIZE = 12;

const CAT_HEADER_H = 38;
const CAT_DESC_H = 20;
const CAT_PAD = 14;
const CAT_TITLE_SIZE = 15;

const CELL_GAP = 10;
const CELL_PAD = 8;
const LOGO_H = 40;
const LABEL_SIZE = 11;
const LABEL_LINE_H = 14;
const MAX_LABEL_LINES = 2;

let ctx;
function measure(text, size, weight = 400, font = 'sans-serif') {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${size}px ${font}`;
  return ctx.measureText(text).width;
}

/**
 * Greedy wrap, then truncate to `maxLines`.
 *
 * Wrapping the full string before truncating (rather than bailing out mid-loop)
 * is what makes the ellipsis honest: we only know text was dropped once we know
 * how many lines it actually wanted.
 */
function wrap(text, maxWidth, size, font, maxLines = MAX_LABEL_LINES) {
  const fits = (s) => measure(s, size, 400, font) <= maxWidth;
  if (fits(text)) return [text];

  const all = [];
  let line = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || fits(candidate)) {
      // `!line` forces a too-wide single word onto its own line; it gets
      // ellipsized below rather than looping forever.
      line = candidate;
    } else {
      all.push(line);
      line = word;
    }
  }
  if (line) all.push(line);

  const dropped = all.length > maxLines;
  const lines = all.slice(0, maxLines);
  const last = lines.length - 1;

  if (dropped || !fits(lines[last])) {
    let s = lines[last];
    while (s.length > 1 && !fits(`${s}…`)) s = s.slice(0, -1);
    lines[last] = `${s}…`;
  }

  return lines;
}

function cellHeight() {
  return CELL_PAD + LOGO_H + 6 + MAX_LABEL_LINES * LABEL_LINE_H + CELL_PAD;
}

function layoutCategory(category, x, y, width, config) {
  const innerW = width - CAT_PAD * 2;
  const minCell = config.min_cell_width;

  const perRow = Math.max(1, Math.floor((innerW + CELL_GAP) / (minCell + CELL_GAP)));
  const cellW = (innerW - CELL_GAP * (perRow - 1)) / perRow;
  const cellH = cellHeight();

  const headerH = CAT_HEADER_H + (category.description ? CAT_DESC_H : 0);
  const rows = Math.ceil(category.companies.length / perRow);

  const cells = category.companies.map((company, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const cx = x + CAT_PAD + col * (cellW + CELL_GAP);
    const cy = y + headerH + CAT_PAD + row * (cellH + CELL_GAP);

    return {
      company,
      x: cx,
      y: cy,
      w: cellW,
      h: cellH,
      logo: {
        x: cx + cellW / 2,
        y: cy + CELL_PAD,
        maxW: cellW - CELL_PAD * 2,
        maxH: LOGO_H,
      },
      labelLines: config.show_names
        ? wrap(company.name, cellW - 8, LABEL_SIZE, config.font)
        : [],
      labelY: cy + CELL_PAD + LOGO_H + 6 + LABEL_SIZE,
    };
  });

  const height = headerH + CAT_PAD + rows * cellH + (rows - 1) * CELL_GAP + CAT_PAD;

  return {
    category,
    x,
    y,
    w: width,
    h: height,
    headerH,
    titleY: y + CAT_HEADER_H / 2,
    descY: y + CAT_HEADER_H + CAT_DESC_H / 2,
    cells,
  };
}

export function computeLayout(model) {
  const { config, categories } = model;

  const width = config.width;
  const colCount = config.columns;
  const colW = (width - PAD * 2 - GUTTER * (colCount - 1)) / colCount;

  // ---- header ----
  let cursorY = PAD;
  const header = { title: null, subtitle: null, meta: null };

  if (config.title) {
    cursorY += TITLE_SIZE;
    header.title = { x: PAD, y: cursorY, size: TITLE_SIZE };
    cursorY += 10;
  }
  if (config.subtitle) {
    cursorY += SUBTITLE_SIZE;
    header.subtitle = { x: PAD, y: cursorY, size: SUBTITLE_SIZE };
    cursorY += 6;
  }
  if (config.date) {
    cursorY += META_SIZE;
    header.meta = { x: PAD, y: cursorY, size: META_SIZE };
    cursorY += 4;
  }
  if (header.title || header.subtitle || header.meta) cursorY += 22;

  // ---- category packing, row-major, honoring span ----
  const boxes = [];
  let col = 0;
  let rowY = cursorY;
  let rowH = 0;

  for (const category of categories) {
    const span = Math.min(category.span, colCount);

    if (col + span > colCount) {
      // Close the current row.
      rowY += rowH + GUTTER;
      rowH = 0;
      col = 0;
    }

    const x = PAD + col * (colW + GUTTER);
    const w = span * colW + (span - 1) * GUTTER;
    const box = layoutCategory(category, x, rowY, w, config);

    boxes.push(box);
    rowH = Math.max(rowH, box.h);
    col += span;
  }

  let height = rowY + rowH + PAD;

  // ---- footer ----
  let footer = null;
  if (config.footer) {
    footer = { x: PAD, y: height - PAD / 2 + META_SIZE / 2, size: META_SIZE };
    height += META_SIZE + 8;
  }

  return { width, height: Math.round(height), header, boxes, footer, config };
}

export { measure, wrap };
