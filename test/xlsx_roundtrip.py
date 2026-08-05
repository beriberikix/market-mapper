#!/usr/bin/env python3
"""
Round-trips tools/csv-to-xlsx.py: build an .xlsx from the sample CSVs, then
read it back with an independent parser and compare.

    python3 test/xlsx_roundtrip.py

The reader deliberately does not reuse the writer's helpers. It resolves each
worksheet the way a real consumer does -- sheet name to r:id, r:id to part
path, via the relationships file -- so a mismatch between the declared tab
names and the parts they point at would fail here rather than silently
producing a workbook whose tabs hold each other's data.

Nothing here can prove Google or Excel accepts the file; only opening it can do
that. What it does prove is that the package is well-formed, internally
consistent, and lossless.
"""

import csv
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

passed = 0
def check(name, condition, detail=""):
    global passed
    if not condition:
        print(f"  FAIL  {name}" + (f"\n        {detail}" if detail else ""))
        sys.exit(1)
    passed += 1
    print(f"  ok  {name}")


def read_workbook(path):
    """Independent reader: returns {sheet_name: [[cell, ...], ...]}."""
    with zipfile.ZipFile(path) as z:
        # Every declared part must actually exist.
        names = set(z.namelist())
        for required in ("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"):
            if required not in names:
                raise AssertionError(f"missing package part: {required}")

        # Every part must be well-formed XML.
        for part in names:
            if part.endswith(".xml") or part.endswith(".rels"):
                ET.fromstring(z.read(part))

        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target_by_id = {
            r.get("Id"): r.get("Target") for r in rels.findall(f"{PKG_REL}Relationship")
        }

        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        out = {}
        for sheet in workbook.find(f"{MAIN}sheets").findall(f"{MAIN}sheet"):
            name = sheet.get("name")
            target = target_by_id[sheet.get(REL_ID)]
            part = f"xl/{target}" if not target.startswith("/") else target.lstrip("/")

            grid = {}
            ws = ET.fromstring(z.read(part))
            for row in ws.iter(f"{MAIN}row"):
                r = int(row.get("r"))
                for cell in row.findall(f"{MAIN}c"):
                    ref = cell.get("r")
                    col = "".join(ch for ch in ref if ch.isalpha())
                    idx = 0
                    for ch in col:
                        idx = idx * 26 + (ord(ch) - 64)
                    t = cell.find(f"{MAIN}is/{MAIN}t")
                    grid[(r, idx - 1)] = t.text if t is not None and t.text else ""

            if not grid:
                out[name] = []
                continue
            height = max(r for r, _ in grid)
            width = max(c for _, c in grid) + 1
            out[name] = [
                [grid.get((r, c), "") for c in range(width)]
                for r in range(1, height + 1)
            ]
        return out


def read_csv_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f)]
    while rows and not any(c.strip() for c in rows[-1]):
        rows.pop()
    return rows


def normalize(rows):
    """Trailing empty cells are not data; the writer omits them."""
    out = []
    for row in rows:
        trimmed = list(row)
        while trimmed and trimmed[-1] == "":
            trimmed.pop()
        out.append(trimmed)
    return out


print("\ncsv-to-xlsx.py — round trip")

with tempfile.TemporaryDirectory() as tmp:
    xlsx = Path(tmp) / "out.xlsx"
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "csv-to-xlsx.py"),
         str(ROOT / "sample"), "-o", str(xlsx)],
        capture_output=True, text=True,
    )
    check("exits cleanly", result.returncode == 0, result.stderr.strip())
    check("produces a file", xlsx.exists() and xlsx.stat().st_size > 0)
    check("is a valid ZIP", zipfile.is_zipfile(xlsx))

    book = read_workbook(xlsx)

    check("tabs are named exactly what the loader matches on",
          sorted(book) == ["Categories", "Companies", "Config"],
          f"got {sorted(book)}")

    check("tabs are ordered Config, Categories, Companies",
          list(book) == ["Config", "Categories", "Companies"],
          f"got {list(book)}")

    for tab in ("Config", "Categories", "Companies"):
        expected = normalize(read_csv_rows(ROOT / "sample" / f"{tab}.csv"))
        actual = normalize(book[tab])
        check(f"{tab}: {len(expected) - 1} rows survive the round trip unchanged",
              actual == expected,
              next((f"row {i}: {e!r} != {a!r}"
                    for i, (e, a) in enumerate(zip(expected, actual)) if e != a),
                   f"length {len(expected)} != {len(actual)}"))

    # The values most likely to be mangled by a spreadsheet's type guessing.
    companies = book["Companies"]
    header = companies[0]
    rows = companies[1:]
    cat_col = header.index("category")
    dom_col = header.index("domain")

    check("hex colours are preserved verbatim, not reinterpreted",
          all(r[1].startswith("#") and len(r[1]) == 7 for r in book["Categories"][1:]),
          str([r[1] for r in book["Categories"][1:]][:4]))

    check("every category still matches a Categories row exactly",
          {r[cat_col] for r in rows} <= {r[0] for r in book["Categories"][1:]})

    check("domains are not turned into anything clever",
          all("." in r[dom_col] and "/" not in r[dom_col] for r in rows if r[dom_col]))

    check("emphasis survives as text the parser understands",
          any(r[header.index("emphasis")].upper() == "TRUE" for r in rows))

print(f"\n{passed} checks passed\n")
