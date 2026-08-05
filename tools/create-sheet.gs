/**
 * Creates a complete Market Mapper spreadsheet in one run.
 *
 * Usage:
 *   1. script.google.com -> New project
 *   2. Replace the editor contents with this file
 *   3. Replace the three data arrays below
 *   4. Run -> authorize -> read the Execution log for your URL
 *
 * Only CONFIG, CATEGORIES and COMPANIES need editing. Everything below the
 * "no need to edit" line writes the tabs, formats them, and shares the file.
 */

// ---------------------------------------------------------------------------
// DATA — replace these three arrays
// ---------------------------------------------------------------------------

var CONFIG = [
  ['title',    'Developer Tooling Landscape'],
  ['subtitle', 'Companies building for engineering teams'],
  ['date',     'Q3 2026'],
  ['footer',   'Categories are the author\'s judgement, not an industry standard.'],
  ['columns',  '3'],
  ['width',    '1600'],
];

// [category, color, description, order, span]
var CATEGORIES = [
  ['Source Control & Review', '#3b6fd4', 'Where code lands',   1, 1],
  ['CI / CD',                 '#c2543c', 'Build, test, ship',  2, 1],
  ['Observability',           '#2f8f6b', 'Knowing what broke', 3, 1],
  ['AI Coding Assistants',    '#3d8ba8', 'The fastest-moving segment', 4, 2],
];

// [company, category, domain, logo_url, website, note, emphasis]
var COMPANIES = [
  ['GitHub',    'Source Control & Review', 'github.com',    '', 'https://github.com',    '', ''],
  ['GitLab',    'Source Control & Review', 'gitlab.com',    '', 'https://gitlab.com',    '', ''],
  ['Graphite',  'Source Control & Review', 'graphite.dev',  '', 'https://graphite.dev',  '', ''],
  ['Bitbucket', 'Source Control & Review', 'bitbucket.org', '', 'https://bitbucket.org', '', ''],

  ['CircleCI',  'CI / CD', 'circleci.com',  '', 'https://circleci.com',  '', ''],
  ['Buildkite', 'CI / CD', 'buildkite.com', '', 'https://buildkite.com', '', ''],
  ['Harness',   'CI / CD', 'harness.io',    '', 'https://harness.io',    '', ''],
  ['Depot',     'CI / CD', 'depot.dev',     '', 'https://depot.dev',     '', ''],

  ['Datadog',   'Observability', 'datadoghq.com', '', 'https://datadoghq.com', '', ''],
  ['Grafana',   'Observability', 'grafana.com',   '', 'https://grafana.com',   '', ''],
  ['Honeycomb', 'Observability', 'honeycomb.io',  '', 'https://honeycomb.io',  '', ''],
  ['Sentry',    'Observability', 'sentry.io',     '', 'https://sentry.io',     '', ''],

  ['Claude Code',    'AI Coding Assistants', 'claude.com',      '', 'https://claude.com/claude-code', '', 'TRUE'],
  ['GitHub Copilot', 'AI Coding Assistants', 'github.com',      '', 'https://github.com/features/copilot', '', ''],
  ['Cursor',         'AI Coding Assistants', 'cursor.com',      '', 'https://cursor.com',      '', ''],
  ['Sourcegraph',    'AI Coding Assistants', 'sourcegraph.com', '', 'https://sourcegraph.com', '', ''],
];

// ---------------------------------------------------------------------------
// No need to edit below this line
// ---------------------------------------------------------------------------

var HEADERS = {
  Config:     ['key', 'value'],
  Categories: ['category', 'color', 'description', 'order', 'span'],
  Companies:  ['company', 'category', 'domain', 'logo_url', 'website', 'note', 'emphasis'],
};

var APP_URL = 'https://beriberikix.github.io/market-mapper/';

function createMarketMap() {
  var problems = validate();
  if (problems.length) {
    // Fail before creating anything, so a bad run leaves no orphan file in
    // Drive to clean up.
    throw new Error('Fix these before running:\n  - ' + problems.join('\n  - '));
  }

  var title = lookupConfig('title') || 'Market Map';
  var ss = SpreadsheetApp.create(title);

  writeTab(ss, 'Config', HEADERS.Config, CONFIG);
  writeTab(ss, 'Categories', HEADERS.Categories, CATEGORIES);
  writeTab(ss, 'Companies', HEADERS.Companies, COMPANIES);

  // Safe only because the three real tabs already exist -- a spreadsheet
  // cannot have zero sheets.
  var blank = ss.getSheetByName('Sheet1');
  if (blank) ss.deleteSheet(blank);

  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var url = APP_URL + '?s=' + ss.getId();
  Logger.log('Sheet:       ' + ss.getUrl());
  Logger.log('Market map:  ' + url);
  Logger.log('');
  Logger.log(COMPANIES.length + ' companies across ' + CATEGORIES.length + ' categories.');
  return url;
}

function writeTab(ss, name, headers, rows) {
  var sheet = ss.insertSheet(name);

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#eef1f6');

  if (rows.length) {
    // Pad short rows so setValues gets a strict rectangle; a ragged array
    // throws rather than filling blanks.
    var padded = rows.map(function (row) {
      var out = row.slice(0, headers.length);
      while (out.length < headers.length) out.push('');
      return out;
    });
    sheet.getRange(2, 1, padded.length, headers.length).setValues(padded);
  }

  sheet.setFrozenRows(1);
  for (var c = 1; c <= headers.length; c++) sheet.autoResizeColumn(c);
}

function lookupConfig(key) {
  for (var i = 0; i < CONFIG.length; i++) {
    if (String(CONFIG[i][0]).trim().toLowerCase() === key) return CONFIG[i][1];
  }
  return null;
}

/**
 * Catches the mistakes that actually happen when this data is machine
 * generated: a category referenced but never declared, a domain pasted as a
 * full URL, a colour that is not a colour.
 */
function validate() {
  var problems = [];

  var declared = {};
  CATEGORIES.forEach(function (row) { declared[String(row[0]).trim()] = 0; });

  COMPANIES.forEach(function (row, i) {
    var name = row[0];
    var category = String(row[1]).trim();

    if (!name) problems.push('Companies row ' + (i + 2) + ' has no company name');

    if (!(category in declared)) {
      problems.push('"' + name + '" is in category "' + category +
                    '", which is not in CATEGORIES');
    } else {
      declared[category]++;
    }

    var domain = String(row[2] || '').trim();
    if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
      problems.push('"' + name + '" has domain "' + domain +
                    '" — use a bare domain like example.com');
    }
  });

  CATEGORIES.forEach(function (row) {
    var name = String(row[0]).trim();
    if (!declared[name]) problems.push('Category "' + name + '" has no companies');
    if (!/^#[0-9a-f]{6}$/i.test(String(row[1]).trim())) {
      problems.push('Category "' + name + '" has colour "' + row[1] +
                    '" — use a 6-digit hex like #3b6fd4');
    }
  });

  return problems;
}
