# Generating a map with an LLM

Two routes. Both start from the same prompt; only the requested output differs.

| Route | You get | Effort |
|---|---|---|
| **A — CSVs** | Three files to import as tabs | 3 uploads |
| **B — Apps Script** | The whole Sheet, built and shared, in one run | 1 paste |

Route B is less work and less error-prone, because tab names and column
headers are written by the script rather than by you.

---

## The prompt

Copy this verbatim, fill in the two bracketed lines, and paste it into any
capable model. For Route B, change the last line as noted below.

````text
You are producing the data for a market map — the kind a VC publishes: a
one-page visual inventory of the companies in a market, grouped into
categories.

MARKET: [e.g. "developer tools for AI agents" or "LATAM fintech"]
ANGLE: [optional — the argument the map should make, e.g. "organized by
        where value accrues in the stack". Omit for a neutral survey.]

Produce three CSV files with these exact headers.

Config.csv — two columns, `key,value`. Include exactly these keys:
  title           short, specific; not "Market Map"
  subtitle        one clause naming who the companies serve
  date            e.g. "Q1 2026"
  footer          one line; note that categories are your judgement
  columns         3
  width           1600

Categories.csv — headers: category,color,description,order,span
  - 5 to 8 categories. Fewer than 5 is a list, not a map; more than 8 stops
    fitting on a page.
  - Categories must partition the market: a company should have exactly one
    obvious home. If two categories compete for the same companies, merge them.
  - `description` is 2-5 words saying what the category *does*, not what it is
    called. "Where code lands" beats "Source control tools".
  - `color` is a distinct hex per category. Mid-to-dark saturated tones read
    best; avoid pastels and near-greys.
  - `order` is 1..N and controls reading order. Put the categories your ANGLE
    leans on first — order carries meaning here.
  - `span` is 1, except at most one category may use 2 to signal it is the
    densest or most contested part of the market.

Companies.csv — headers: company,category,domain,logo_url,website,note,emphasis
  - 4 to 10 companies per category, 30-60 total.
  - `category` must match a Categories row EXACTLY, character for character.
  - `domain` is the bare registrable domain: "stripe.com", not
    "https://www.stripe.com/pricing". This is used to fetch the company's logo,
    so a wrong domain means a missing logo.
  - `website` is the full https URL.
  - `logo_url` and `note` may be left empty.
  - `emphasis` is empty, or TRUE for the few companies your ANGLE singles out.
    If there is no ANGLE, leave every row empty.

Rules:
  - Real companies only. If you are not confident a company exists, or not
    confident of its domain, leave it out. A short accurate map is worth more
    than a long speculative one.
  - Quote any field containing a comma: "Build, test, ship".
  - No trailing blank lines or commentary inside the CSVs.

Before you answer, verify:
  - every Companies.category appears in Categories.category, spelled identically
  - no category has fewer than 4 companies
  - every domain is bare — no scheme, no "www.", no path
  - every colour is a valid 6-digit hex with a leading #
  - at most one category has span=2

Output exactly three fenced code blocks, labelled Config.csv, Categories.csv
and Companies.csv. No prose before or after.
````

### Route B: ask for the script instead

Replace the final paragraph with:

````text
Now put that data into the Apps Script template below, replacing only the
CONFIG, CATEGORIES and COMPANIES arrays. Change nothing else. Output the
complete script in one fenced code block, no prose.

[paste the contents of tools/create-sheet.gs here]
````

---

## Route A — importing the CSVs

1. Create a blank Google Sheet.
2. **File → Import → Upload → `Companies.csv`**, choose **Insert new sheet(s)**.
3. Repeat for `Categories.csv` and `Config.csv`.
4. Delete the default empty `Sheet1`.
5. **Share → Anyone with the link → Viewer.**
6. Paste the URL into the app.

Import each file separately. "Replace current sheet" overwrites a tab instead
of adding one, and the tab names are what the loader matches on.

## Route B — running the script

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Replace the entire editor contents with the generated script.
3. Click **Run**. Google will ask you to authorize it — it needs permission to
   create a spreadsheet and to set link sharing.
4. Open **Execution log**. It prints the sheet URL and a ready-to-open
   Market Mapper link.

The script creates the three tabs with correct names and headers, freezes the
header row, sizes the columns, deletes the default `Sheet1`, and sets link
sharing to Anyone-with-the-link/Viewer.

---

## Checking the result

The app tells you when something is off, so load the map and read the status
bar rather than proof-reading the sheet:

| Status message | Cause |
|---|---|
| "N categories not listed in the Categories tab" | A `category` in Companies doesn't match a Categories row — usually a typo or a stray plural |
| "Empty categories skipped" | A Categories row nobody was assigned to |
| "N logos fell back to initials … unusable image" | Bad or missing `domain` on those rows |
| No map, "No Companies tab found" | A tab is misnamed; they must be `Config`, `Categories`, `Companies` |

## What an LLM is and isn't good at here

Good at the *structure*: category schemes, sensible groupings, plausible
coverage of a market it knows.

Unreliable at the *facts*. Expect invented companies, companies that were
acquired or shut down, and confidently wrong domains — a wrong domain is
silent, showing up only as a missing logo. Treat the output as a first draft
to edit in the Sheet, which is exactly what the Sheet is for.

Models are also weakest on private, early-stage, and non-US companies — often
the most interesting rows on a market map. Expect to add those yourself.
