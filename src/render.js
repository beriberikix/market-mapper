/**
 * Serializes a computed layout to SVG.
 *
 * SVG rather than HTML/CSS on purpose: export is the feature that decides
 * whether a tool like this gets used or just admired, and serializing the live
 * SVG guarantees the export matches the screen exactly.
 */

import { initials } from './logos.js';

const XMLNS = 'http://www.w3.org/2000/svg';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Relative luminance, so category header text stays legible whatever color
 * the author picked.
 */
function textOn(bg) {
  const hex = String(bg).replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length !== 6) return '#ffffff';

  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

  return L > 0.45 ? '#14161c' : '#ffffff';
}

function renderCell(cell, config) {
  const { company, x, y, w, h, logo } = cell;
  const parts = [];

  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
    `height="${h.toFixed(1)}" rx="6" fill="${esc(config.card_color)}"` +
    (company.emphasis ? ` stroke="${esc(config.text_color)}" stroke-width="1.5"` : '') +
    `/>`
  );

  if (company.logoData) {
    parts.push(
      `<image x="${(logo.x - logo.maxW / 2).toFixed(1)}" y="${logo.y.toFixed(1)}" ` +
      `width="${logo.maxW.toFixed(1)}" height="${logo.maxH}" ` +
      `preserveAspectRatio="xMidYMid meet" href="${esc(company.logoData)}"/>`
    );
  } else {
    // Text chip fallback: a missing logo should still read as a company.
    const size = 26;
    parts.push(
      `<circle cx="${logo.x.toFixed(1)}" cy="${(logo.y + logo.maxH / 2).toFixed(1)}" ` +
      `r="${size / 2 + 5}" fill="#ffffff"/>`,
      `<text x="${logo.x.toFixed(1)}" y="${(logo.y + logo.maxH / 2).toFixed(1)}" ` +
      `text-anchor="middle" dominant-baseline="central" font-size="14" ` +
      `font-weight="600" fill="${esc(config.muted_color)}">${esc(initials(company.name))}</text>`
    );
  }

  cell.labelLines.forEach((line, i) => {
    parts.push(
      `<text x="${(x + w / 2).toFixed(1)}" y="${(cell.labelY + i * 14).toFixed(1)}" ` +
      `text-anchor="middle" font-size="11" fill="${esc(config.text_color)}">${esc(line)}</text>`
    );
  });

  return parts.join('');
}

function renderBox(box, config) {
  const { category, x, y, w, h, headerH } = box;
  const headerText = textOn(category.color);
  const parts = [];

  // Body panel, then the header bar clipped to the same rounded top.
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
    `height="${h.toFixed(1)}" rx="10" fill="none" stroke="${esc(category.color)}" ` +
    `stroke-width="1.5" stroke-opacity="0.35"/>`,
    `<path d="M ${x.toFixed(1)} ${(y + headerH).toFixed(1)} ` +
    `L ${x.toFixed(1)} ${(y + 10).toFixed(1)} ` +
    `A 10 10 0 0 1 ${(x + 10).toFixed(1)} ${y.toFixed(1)} ` +
    `L ${(x + w - 10).toFixed(1)} ${y.toFixed(1)} ` +
    `A 10 10 0 0 1 ${(x + w).toFixed(1)} ${(y + 10).toFixed(1)} ` +
    `L ${(x + w).toFixed(1)} ${(y + headerH).toFixed(1)} Z" fill="${esc(category.color)}"/>`,
    `<text x="${(x + 14).toFixed(1)}" y="${box.titleY.toFixed(1)}" ` +
    `dominant-baseline="central" font-size="15" font-weight="600" ` +
    `fill="${headerText}">${esc(category.name)}</text>`,
    `<text x="${(x + w - 14).toFixed(1)}" y="${box.titleY.toFixed(1)}" ` +
    `text-anchor="end" dominant-baseline="central" font-size="12" ` +
    `fill="${headerText}" fill-opacity="0.75">${category.companies.length}</text>`
  );

  if (category.description) {
    // The description sits inside the colored bar, so it takes the header's
    // contrast-aware color -- muted grey on a saturated fill is unreadable.
    parts.push(
      `<text x="${(x + 14).toFixed(1)}" y="${box.descY.toFixed(1)}" ` +
      `dominant-baseline="central" font-size="12" fill="${headerText}" ` +
      `fill-opacity="0.8">${esc(category.description)}</text>`
    );
  }

  parts.push(...box.cells.map((cell) => renderCell(cell, config)));
  return `<g>${parts.join('')}</g>`;
}

export function renderSvgMarkup(layout) {
  const { width, height, header, boxes, footer, config } = layout;
  const parts = [];

  parts.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${esc(config.background)}"/>`
  );

  if (header.title) {
    parts.push(
      `<text x="${header.title.x}" y="${header.title.y}" font-size="${header.title.size}" ` +
      `font-weight="700" letter-spacing="-0.5" ` +
      `fill="${esc(config.text_color)}">${esc(config.title)}</text>`
    );
  }
  if (header.subtitle) {
    parts.push(
      `<text x="${header.subtitle.x}" y="${header.subtitle.y}" ` +
      `font-size="${header.subtitle.size}" ` +
      `fill="${esc(config.muted_color)}">${esc(config.subtitle)}</text>`
    );
  }
  if (header.meta) {
    parts.push(
      `<text x="${header.meta.x}" y="${header.meta.y}" font-size="${header.meta.size}" ` +
      `fill="${esc(config.muted_color)}">${esc(config.date)}</text>`
    );
  }

  parts.push(...boxes.map((box) => renderBox(box, config)));

  if (footer) {
    parts.push(
      `<text x="${footer.x}" y="${footer.y.toFixed(1)}" font-size="${footer.size}" ` +
      `fill="${esc(config.muted_color)}">${esc(config.footer)}</text>`
    );
  }

  // font-family is set once on the root and inherited; keeping it off every
  // <text> keeps the exported file small and easy to restyle by hand.
  return (
    `<svg xmlns="${XMLNS}" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" font-family="${esc(config.font)}">` +
    parts.join('') +
    `</svg>`
  );
}

export function renderSvgElement(layout) {
  const doc = new DOMParser().parseFromString(renderSvgMarkup(layout), 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}
