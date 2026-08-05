/**
 * Tests tools/create-sheet.gs by running it against stand-ins for the Apps
 * Script globals.
 *
 *   node test/create-sheet.mjs
 *
 * That script is user-facing code that cannot be run here -- it only executes
 * inside Google's runtime, in someone else's account, where a bug means a
 * broken spreadsheet and a confusing authorization prompt. This at least
 * proves the logic and the validation.
 *
 * Node-only, unlike smoke.mjs: it needs to read the .gs file off disk.
 */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../tools/create-sheet.gs', import.meta.url), 'utf8');

// --- stand-ins for the Apps Script globals the script touches ---
const harness = `
var LOG = [];
var Logger = { log: function (m) { LOG.push(String(m)); } };

var SHARING = null;
var DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW' },
  getFileById: function (id) {
    return { setSharing: function (a, p) { SHARING = { id: id, access: a, permission: p }; } };
  },
};

function makeSheet(name) {
  var rows = {};
  return {
    name: name, frozen: 0, resized: [],
    getRange: function (r, c, nr, nc) {
      return {
        setValues: function (vals) {
          vals.forEach(function (row, i) {
            if (row.length !== nc) throw new Error('ragged row written to ' + name);
            rows[r + i] = row;
          });
          return this;
        },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; },
      };
    },
    setFrozenRows: function (n) { this.frozen = n; },
    autoResizeColumn: function (c) { this.resized.push(c); },
    rows: function () { return rows; },
  };
}

var CREATED = null;
var SpreadsheetApp = {
  create: function (title) {
    var sheets = { Sheet1: makeSheet('Sheet1') };
    CREATED = {
      title: title,
      getId: function () { return 'FAKE_SHEET_ID'; },
      getUrl: function () { return 'https://docs.google.com/spreadsheets/d/FAKE_SHEET_ID/edit'; },
      insertSheet: function (n) { sheets[n] = makeSheet(n); return sheets[n]; },
      getSheetByName: function (n) { return sheets[n] || null; },
      deleteSheet: function (s) { delete sheets[s.name]; },
      sheets: function () { return sheets; },
    };
    return CREATED;
  },
};
`;

const api = new Function(`
  ${harness}
  ${source}
  return {
    createMarketMap, validate,
    get CONFIG() { return CONFIG; },
    get CATEGORIES() { return CATEGORIES; }, set CATEGORIES(v) { CATEGORIES = v; },
    get COMPANIES() { return COMPANIES; }, set COMPANIES(v) { COMPANIES = v; },
    get CREATED() { return CREATED; },
    get SHARING() { return SHARING; }, set SHARING(v) { SHARING = v; },
    get LOG() { return LOG; },
    HEADERS: HEADERS,
  };
`)();

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const pristine = {
  categories: JSON.parse(JSON.stringify(api.CATEGORIES)),
  companies: JSON.parse(JSON.stringify(api.COMPANIES)),
};
const restore = () => {
  api.CATEGORIES = JSON.parse(JSON.stringify(pristine.categories));
  api.COMPANIES = JSON.parse(JSON.stringify(pristine.companies));
};

console.log('\ncreate-sheet.gs — building the spreadsheet');

const url = api.createMarketMap();
const built = api.CREATED;
const sheets = built.sheets();

check('creates exactly the three tabs the loader looks for', () => {
  assert.deepEqual(Object.keys(sheets).sort(), ['Categories', 'Companies', 'Config']);
});

check('removes the default Sheet1', () => {
  assert.equal(sheets.Sheet1, undefined);
});

check('writes the exact headers each tab needs', () => {
  for (const [tab, headers] of Object.entries(api.HEADERS)) {
    assert.deepEqual(sheets[tab].rows()[1], headers, `${tab} header row`);
  }
});

check('writes every data row beneath the header', () => {
  assert.equal(Object.keys(sheets.Companies.rows()).length, api.COMPANIES.length + 1);
  assert.equal(Object.keys(sheets.Categories.rows()).length, api.CATEGORIES.length + 1);
  assert.equal(Object.keys(sheets.Config.rows()).length, api.CONFIG.length + 1);
});

check('pads short rows so no ragged write reaches the Sheets API', () => {
  const width = api.HEADERS.Companies.length;
  for (const row of Object.values(sheets.Companies.rows())) {
    assert.equal(row.length, width);
  }
});

check('names the spreadsheet after the configured title', () => {
  assert.equal(built.title, 'Developer Tooling Landscape');
});

check('freezes the header row on every tab', () => {
  for (const tab of Object.keys(api.HEADERS)) assert.equal(sheets[tab].frozen, 1);
});

check('shares link-viewable, which is what gviz requires', () => {
  assert.equal(api.SHARING.access, 'ANYONE_WITH_LINK');
  assert.equal(api.SHARING.permission, 'VIEW');
});

check('returns a ready-to-open app URL', () => {
  assert.match(url, /^https:\/\/.+\?s=FAKE_SHEET_ID$/);
});

console.log('\ncreate-sheet.gs — validation');

const expectProblem = (label, mutate, pattern) => check(label, () => {
  restore();
  mutate();
  const problems = api.validate().join(' | ');
  assert.match(problems, pattern, `got: ${problems.slice(0, 120)}`);
});

expectProblem('rejects a category that no Categories row declares',
  () => { api.COMPANIES[0][1] = 'Sorce Control'; }, /not in CATEGORIES/);

expectProblem('rejects a full URL in the domain column',
  () => { api.COMPANIES[0][2] = 'https://www.github.com/x'; }, /use a bare domain/);

expectProblem('rejects a bare "www." domain',
  () => { api.COMPANIES[0][2] = 'www.github.com/'; }, /use a bare domain/);

expectProblem('rejects a colour that is not a hex triple',
  () => { api.CATEGORIES[0][1] = 'blue'; }, /6-digit hex/);

expectProblem('rejects a category with no companies in it',
  () => { api.CATEGORIES.push(['Ghost', '#123456', 'nobody', 9, 1]); }, /has no companies/);

expectProblem('rejects a company with no name',
  () => { api.COMPANIES[0][0] = ''; }, /has no company name/);

check('accepts the shipped template unchanged', () => {
  restore();
  assert.deepEqual(api.validate(), []);
});

check('creates nothing when validation fails', () => {
  restore();
  api.COMPANIES[0][1] = 'Nope';
  api.SHARING = null;

  assert.throws(() => api.createMarketMap(), /Fix these before running/);
  // The important half: a rejected run must not leave an orphan file in Drive.
  assert.equal(api.SHARING, null);
});

console.log(`\n${passed} checks passed\n`);
