/**
 * Headless smoke test for the pure logic: schema parsing, layout geometry, and
 * SVG serialization. Stubs the one browser API layout.js touches (canvas text
 * measurement) so the whole pipeline can run outside a browser.
 *
 *   node test/smoke.mjs
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/smoke.mjs
 *
 * Deliberately free of node: builtins and structuredClone so it runs on a bare
 * JS engine -- this repo has no dependencies and shouldn't need a toolchain.
 */

// jsc exposes print() rather than console.
if (typeof console === 'undefined') {
  globalThis.console = { log: (...args) => print(args.join(' ')) };
}

// --- tiny assert, matching the slice of node:assert/strict used below ---
class AssertionError extends Error {}

const assert = Object.assign(
  function ok(value, message) {
    if (!value) throw new AssertionError(message || 'expected a truthy value');
  },
  {
    ok(value, message) {
      if (!value) throw new AssertionError(message || 'expected a truthy value');
    },
    equal(actual, expected, message) {
      if (actual !== expected) {
        throw new AssertionError(message || `expected ${expected}, got ${actual}`);
      }
    },
    deepEqual(actual, expected, message) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new AssertionError(message || `expected ${b}, got ${a}`);
    },
    match(value, regex, message) {
      if (!regex.test(String(value))) {
        throw new AssertionError(message || `${value} does not match ${regex}`);
      }
    },
  }
);

const clone = (value) => JSON.parse(JSON.stringify(value));

// --- minimal canvas stub: width proportional to length is close enough to
// exercise wrapping and ellipsis logic ---
globalThis.document = {
  createElement: () => ({
    getContext: () => ({
      font: '',
      measureText: (text) => ({ width: String(text).length * 6.2 }),
    }),
  }),
};

const { buildModel, DEFAULTS } = await import('../src/schema.js');
const { computeLayout } = await import('../src/layout.js');
const { renderSvgMarkup } = await import('../src/render.js');
const { SAMPLE } = await import('../src/sample.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nschema');

const model = buildModel(clone(SAMPLE));

check('config values are coerced to their declared types', () => {
  assert.equal(model.config.title, 'Developer Tooling Landscape');
  assert.equal(model.config.columns, 3);
  assert.equal(typeof model.config.columns, 'number');
  assert.equal(model.config.show_names, DEFAULTS.show_names);
});

check('every company row is placed in a category', () => {
  const placed = model.categories.reduce((n, c) => n + c.companies.length, 0);
  assert.equal(placed, SAMPLE.companies.length);
});

check('categories keep the order declared in the Categories tab', () => {
  assert.deepEqual(
    model.categories.map((c) => c.name),
    SAMPLE.categories.map((c) => c.category)
  );
});

check('domains are derived and colors applied', () => {
  const github = model.categories[0].companies.find((c) => c.name === 'GitHub');
  assert.equal(github.domain, 'github.com');
  assert.equal(model.categories[0].color, '#3b6fd4');
});

check('emphasis flag parses from the sheet', () => {
  const ai = model.categories.find((c) => c.name === 'AI Coding Assistants');
  assert.equal(ai.companies.find((c) => c.name === 'Claude Code').emphasis, true);
  assert.equal(ai.companies.find((c) => c.name === 'Cursor').emphasis, false);
});

check('undeclared categories are kept, not dropped, and warned about', () => {
  const withStray = clone(SAMPLE);
  withStray.companies.push({ company: 'Mystery Co', category: 'Data Infra' });

  const m = buildModel(withStray);
  const stray = m.categories.find((c) => c.name === 'Data Infra');

  assert.ok(stray, 'undeclared category should still render');
  assert.equal(stray.companies.length, 1);
  assert.match(m.warnings.join(' '), /not listed in the Categories tab/);
});

check('website-only rows still resolve a domain', () => {
  const m = buildModel({
    config: null,
    categories: null,
    companies: [{ company: 'Acme', category: 'X', website: 'https://www.acme.co/pricing' }],
  });
  assert.equal(m.categories[0].companies[0].domain, 'acme.co');
});

check('missing Categories tab falls back to palette colors', () => {
  const m = buildModel({ config: null, categories: null, companies: SAMPLE.companies });
  assert.ok(m.categories.length > 0);
  assert.match(m.categories[0].color, /^#[0-9a-f]{6}$/i);
});

console.log('\nlayout');

const layout = computeLayout(model);

check('canvas width honors config; height is derived', () => {
  assert.equal(layout.width, 1600);
  assert.ok(layout.height > 400, `height was ${layout.height}`);
});

check('every company gets exactly one positioned cell', () => {
  const cells = layout.boxes.reduce((n, b) => n + b.cells.length, 0);
  assert.equal(cells, SAMPLE.companies.length);
});

check('nothing is positioned outside the canvas', () => {
  for (const box of layout.boxes) {
    assert.ok(box.x >= 0 && box.x + box.w <= layout.width + 0.5,
      `${box.category.name} overflows horizontally`);
    assert.ok(box.y + box.h <= layout.height,
      `${box.category.name} overflows vertically`);
    for (const cell of box.cells) {
      assert.ok(cell.x >= box.x && cell.x + cell.w <= box.x + box.w + 0.5,
        `a cell escapes ${box.category.name}`);
      assert.ok(cell.y + cell.h <= box.y + box.h,
        `a cell overflows the bottom of ${box.category.name}`);
    }
  }
});

check('category boxes never overlap', () => {
  const boxes = layout.boxes;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w &&
        a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${a.category.name} overlaps ${b.category.name}`);
    }
  }
});

check('span widens a category across columns', () => {
  const wide = layout.boxes.find((b) => b.category.name === 'AI Coding Assistants');
  const narrow = layout.boxes.find((b) => b.category.name === 'CI / CD');
  assert.ok(wide.w > narrow.w * 1.8, `span=2 box was ${wide.w}, single was ${narrow.w}`);
});

check('long names wrap and ellipsize rather than overflow', () => {
  const m = buildModel({
    config: [{ key: 'columns', value: '4' }],
    categories: null,
    companies: [
      { company: 'A Company With A Preposterously Long Name Indeed', category: 'X' },
    ],
  });
  const lines = computeLayout(m).boxes[0].cells[0].labelLines;
  assert.ok(lines.length <= 2, `wrapped to ${lines.length} lines`);
  assert.match(lines.at(-1), /…$/);
});

console.log('\nrender');

const svg = renderSvgMarkup(layout);

check('output is a well-formed standalone SVG', () => {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.trim().endsWith('</svg>'));
  assert.equal((svg.match(/<svg/g) || []).length, 1);
});

check('tag nesting is balanced', () => {
  const opens = (svg.match(/<g>/g) || []).length;
  const closes = (svg.match(/<\/g>/g) || []).length;
  assert.equal(opens, closes);
});

check('every company name appears in the output', () => {
  for (const { company } of SAMPLE.companies) {
    const escaped = company.replace(/&/g, '&amp;');
    assert.ok(svg.includes(escaped), `missing "${company}"`);
  }
});

check('XML special characters are escaped', () => {
  const m = buildModel({
    config: [{ key: 'title', value: 'Tools & <Toys>' }],
    categories: null,
    companies: [{ company: 'A & B "Co"', category: 'R&D' }],
  });
  const out = renderSvgMarkup(computeLayout(m));
  assert.ok(out.includes('Tools &amp; &lt;Toys&gt;'));
  assert.ok(out.includes('A &amp; B'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(out), 'found an unescaped ampersand');
});

check('header text flips to stay legible on light category colors', () => {
  const m = buildModel({
    config: null,
    categories: [
      { category: 'Pale', color: '#f8f4d0' },
      { category: 'Deep', color: '#1a2b6d' },
    ],
    companies: [
      { company: 'One', category: 'Pale' },
      { company: 'Two', category: 'Deep' },
    ],
  });
  const out = renderSvgMarkup(computeLayout(m));
  assert.ok(out.includes('fill="#14161c">Pale'), 'dark text expected on pale header');
  assert.ok(out.includes('fill="#ffffff">Deep'), 'white text expected on deep header');
});

check('companies without logos fall back to initials', () => {
  assert.ok(svg.includes('>GH<') || svg.includes('>GC<'),
    'expected initial chips for logo-less companies');
});

// Write the rendered sample out so it can be eyeballed in a browser. Only
// possible on a runtime with a filesystem; skipped silently on a bare engine.
try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(new URL('./output.svg', import.meta.url), svg);
  console.log(`\nrendered sample -> test/output.svg (${layout.width}x${layout.height})`);
} catch {
  console.log(`\nrendered sample: ${layout.width}x${layout.height}, ${svg.length} bytes`);
}

console.log(`${passed} checks passed\n`);
