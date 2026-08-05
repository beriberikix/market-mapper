import { fetchWorkbook, parseSheetId } from './sheets.js';
import { buildModel } from './schema.js';
import { embedLogos } from './logos.js';
import { computeLayout } from './layout.js';
import { renderSvgMarkup } from './render.js';
import { exportPng, exportSvg } from './export.js';
import { SAMPLE } from './sample.js';

const el = {
  input: document.getElementById('sheet-input'),
  load: document.getElementById('load-btn'),
  svgBtn: document.getElementById('export-svg'),
  pngBtn: document.getElementById('export-png'),
  sampleBtn: document.getElementById('sample-btn'),
  sampleLink: document.getElementById('sample-link'),
  status: document.getElementById('status'),
  stage: document.getElementById('stage'),
};

let current = null; // { markup, width, height, title }

function status(message, kind = 'info') {
  el.status.textContent = message;
  el.status.className = message ? `status status--on status--${kind}` : 'status';
}

function setBusy(busy) {
  el.load.disabled = busy;
  el.sampleBtn.disabled = busy;
  el.load.textContent = busy ? 'Loading…' : 'Load';
}

/**
 * Shared tail of both the sheet and sample paths: model -> logos -> layout ->
 * SVG. Kept in one place so the sample can never drift from the real thing.
 */
async function renderWorkbook(workbook, sourceLabel) {
  const model = buildModel(workbook);

  if (!model.categories.length) {
    status('Nothing to draw — no companies with a category were found.', 'error');
    return;
  }

  const total = model.categories.reduce((n, c) => n + c.companies.length, 0);
  status(`Fetching logos for ${total} companies…`);

  const logoResult = await embedLogos(model.categories, model.config, (done, all) => {
    status(`Fetching logos… ${done}/${all}`);
  });

  const layout = computeLayout(model);
  const markup = renderSvgMarkup(layout);

  el.stage.replaceChildren();
  el.stage.insertAdjacentHTML('beforeend', markup);

  current = {
    markup,
    width: layout.width,
    height: layout.height,
    title: model.config.title,
  };
  el.svgBtn.disabled = false;
  el.pngBtn.disabled = false;

  reportResult({
    sourceLabel,
    total,
    categories: model.categories.length,
    logoResult,
    model,
  });
}

function reportResult({ sourceLabel, total, categories, logoResult, model }) {
  const { failed, reasons } = logoResult;
  const notes = [...model.warnings];

  if (failed.length) {
    const names = `${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`;
    const causes = [];

    // Both end as a text chip, but only one of them is worth waiting out.
    if (reasons.rateLimited) {
      causes.push(
        `${reasons.rateLimited} hit the logo service's rate limit` +
        (logoResult.abandoned
          ? ` (gave up early after repeated limits — try again in a few minutes)`
          : ` (reloading may pick these up)`)
      );
    }
    if (reasons.invalid) {
      causes.push(`${reasons.invalid} returned an unusable image`);
    }
    if (reasons.other) {
      causes.push(`${reasons.other} failed to load`);
    }

    notes.push(
      `${failed.length} logo${failed.length === 1 ? '' : 's'} fell back to initials — ` +
      `${causes.join(', ')}. Set a "logo_url" to fix permanently: ${names}`
    );
  }

  const summary = `${sourceLabel}: ${total} companies across ${categories} categories.`;
  status(notes.length ? `${summary} ${notes.join(' ')}` : summary, notes.length ? 'warn' : 'info');
}

async function loadFromSheet(rawInput, { updateUrl = true } = {}) {
  const id = parseSheetId(rawInput);
  if (!id) {
    status('That does not look like a Sheet ID or Sheets URL.', 'error');
    return;
  }

  setBusy(true);
  status('Fetching sheet…');

  try {
    const workbook = await fetchWorkbook(id);
    await renderWorkbook(workbook, 'Loaded');

    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('s', id);
      history.replaceState(null, '', url);
    }
  } catch (err) {
    status(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function loadSample() {
  setBusy(true);
  try {
    await renderWorkbook(structuredClone(SAMPLE), 'Sample');
  } catch (err) {
    status(err.message, 'error');
  } finally {
    setBusy(false);
  }
}

el.load.addEventListener('click', () => loadFromSheet(el.input.value));
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadFromSheet(el.input.value);
});
el.sampleBtn.addEventListener('click', loadSample);
el.sampleLink?.addEventListener('click', loadSample);

el.svgBtn.addEventListener('click', () => {
  if (current) exportSvg(current.markup, current.title);
});

el.pngBtn.addEventListener('click', async () => {
  if (!current) return;
  try {
    await exportPng(current.markup, current.width, current.height, current.title);
  } catch (err) {
    status(`PNG export failed: ${err.message}. SVG export should still work.`, 'error');
  }
});

// ?s=<sheetId> makes one static deploy serve unlimited maps, and makes
// sharing a map the same thing as sharing a URL.
const fromUrl = new URLSearchParams(location.search).get('s');
if (fromUrl) {
  el.input.value = fromUrl;
  loadFromSheet(fromUrl, { updateUrl: false });
}
