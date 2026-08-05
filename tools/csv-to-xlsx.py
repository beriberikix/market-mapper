#!/usr/bin/env python3
"""
Bundle Config.csv, Categories.csv and Companies.csv into a single .xlsx you can
drag into Google Drive, so the three tabs arrive in one upload instead of three
imports.

    python3 tools/csv-to-xlsx.py sample/ -o market-map.xlsx
    python3 tools/csv-to-xlsx.py Config.csv Categories.csv Companies.csv

The worksheet name comes from each file's stem, so Companies.csv becomes a tab
named Companies -- which is exactly what the loader matches on. Rename the
files, not the tabs.

Standard library only: an .xlsx is a ZIP of XML parts, and writing the handful
this needs is less trouble than asking anyone to pip install a spreadsheet
library. No openpyxl, no pandas, no build step -- same as the rest of the repo.

Every cell is written as an inline string. Nothing is coerced to a number or a
date, which is deliberate: the app parses its own types out of the sheet, and
Excel's guessing is what turns a colour like #3b6fd4 into something else or
reads a version number as a date.
"""

import argparse
import csv
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

# Order matters only for how the tabs are laid out in the finished sheet.
PREFERRED_ORDER = ["Config", "Categories", "Companies"]

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
CT_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
CT_WORKSHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"

# Excel forbids these in a sheet name, and silently mangles names over 31 chars.
INVALID_SHEET_CHARS = r"[]:*?/\\"
XML_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def column_ref(index):
    """0 -> A, 25 -> Z, 26 -> AA."""
    ref = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        ref = chr(65 + rem) + ref
    return ref


def clean_sheet_name(stem):
    name = "".join(c for c in stem if c not in INVALID_SHEET_CHARS).strip("'")
    return (name or "Sheet")[:31]


def cell_xml(row_number, col_index, value):
    text = XML_ILLEGAL.sub("", str(value))
    if not text:
        return ""  # an empty cell is best represented by no cell at all
    ref = f"{column_ref(col_index)}{row_number}"
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def sheet_xml(rows):
    width = max((len(r) for r in rows), default=0)
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        f'<worksheet xmlns="{NS_MAIN}">',
    ]

    if width:
        # Freeze the header row, matching what create-sheet.gs does.
        out.append(
            '<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>"
        )
        out.append(f'<cols><col min="1" max="{width}" width="22" customWidth="1"/></cols>')

    out.append("<sheetData>")
    for r, row in enumerate(rows, start=1):
        cells = "".join(cell_xml(r, c, v) for c, v in enumerate(row))
        if cells:
            out.append(f'<row r="{r}">{cells}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def workbook_xml(names):
    sheets = "".join(
        f'<sheet name="{escape(n)}" sheetId="{i}" r:id="rId{i}"/>'
        for i, n in enumerate(names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_REL}"><sheets>{sheets}</sheets></workbook>'
    )


def workbook_rels_xml(count):
    rels = "".join(
        f'<Relationship Id="rId{i}" Type="{NS_REL}/worksheet" '
        f'Target="worksheets/sheet{i}.xml"/>'
        for i in range(1, count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{NS_PKG_REL}">{rels}</Relationships>'
    )


def content_types_xml(count):
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="{CT_WORKSHEET}"/>'
        for i in range(1, count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Types xmlns="{NS_CT}">'
        '<Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/xl/workbook.xml" ContentType="{CT_SHEET}"/>'
        f"{overrides}</Types>"
    )


def root_rels_xml():
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{NS_PKG_REL}">'
        f'<Relationship Id="rId1" Type="{NS_REL}/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def write_xlsx(path, tabs):
    """tabs: list of (sheet_name, rows)."""
    names = [name for name, _ in tabs]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types_xml(len(tabs)))
        z.writestr("_rels/.rels", root_rels_xml())
        z.writestr("xl/workbook.xml", workbook_xml(names))
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(len(tabs)))
        for i, (_, rows) in enumerate(tabs, start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(rows))


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [row for row in csv.reader(f)]
    while rows and not any(cell.strip() for cell in rows[-1]):
        rows.pop()
    return rows


def collect(inputs):
    files = []
    for item in inputs:
        p = Path(item)
        if p.is_dir():
            files.extend(sorted(p.glob("*.csv")))
        elif p.is_file():
            files.append(p)
        else:
            sys.exit(f"error: no such file or directory: {item}")

    if not files:
        sys.exit("error: no CSV files found")

    def rank(p):
        stem = p.stem
        return (PREFERRED_ORDER.index(stem) if stem in PREFERRED_ORDER else len(PREFERRED_ORDER),
                stem)

    return sorted(files, key=rank)


def main():
    ap = argparse.ArgumentParser(
        description="Bundle CSVs into one .xlsx, one worksheet per file."
    )
    ap.add_argument("inputs", nargs="+", help="CSV files, or a directory of them")
    ap.add_argument("-o", "--output", default="market-map.xlsx", help="output path")
    args = ap.parse_args()

    files = collect(args.inputs)
    tabs = []
    seen = set()

    for path in files:
        name = clean_sheet_name(path.stem)
        if name.lower() in seen:
            sys.exit(f"error: two inputs would both become a tab named {name!r}")
        seen.add(name.lower())
        tabs.append((name, read_csv(path)))

    write_xlsx(args.output, tabs)

    missing = [t for t in ("Config", "Categories", "Companies") if t not in [n for n, _ in tabs]]
    print(f"wrote {args.output}")
    for name, rows in tabs:
        body = max(len(rows) - 1, 0)
        print(f"  {name:<12} {body} row{'' if body == 1 else 's'}")
    if "Companies" in missing:
        print("\nwarning: no Companies tab — the app requires one", file=sys.stderr)
    elif missing:
        print(f"\nnote: no {', '.join(missing)} tab; defaults will be used", file=sys.stderr)


if __name__ == "__main__":
    main()
