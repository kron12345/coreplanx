#!/usr/bin/env python3
import argparse
import csv
import io
import re
import sys

def build_pattern(prefix: str, fill: str) -> re.Pattern:
    if not prefix:
        raise ValueError("Prefix must not be empty.")
    if fill == "":
        pattern = r'^' + re.escape(prefix) + r'(.+)$'
    else:
        pattern = r'^' + re.escape(prefix) + r'(?:' + re.escape(fill) + r')*(.+)$'
    return re.compile(pattern)

def normalize_id(value: str, pattern: re.Pattern) -> str:
    if value is None:
        return value
    s = str(value).strip()
    m = pattern.match(s)
    return m.group(1) if m else s

def autodetect_dialect(sample: str):
    sniffer = csv.Sniffer()
    try:
        dialect = sniffer.sniff(sample, delimiters=[',',';','\t','|'])
        has_header = sniffer.has_header(sample)
    except csv.Error:
        class SimpleDialect(csv.Dialect):
            delimiter = ','
            quotechar = '"'
            escapechar = None
            doublequote = True
            skipinitialspace = False
            lineterminator = '\n'
            quoting = csv.QUOTE_MINIMAL
        dialect = SimpleDialect()
        has_header = True
    return dialect, has_header

def process(infile: str, outfile: str, inplace: bool, columns: list[str], prefix: str, fill: str):
    if inplace and outfile:
        print("Specify either --out or --inplace, not both.", file=sys.stderr)
        sys.exit(2)
    if not inplace and not outfile:
        print("Either --out or --inplace is required.", file=sys.stderr)
        sys.exit(2)

    with open(infile, 'r', encoding='utf-8-sig', newline='') as f:
        data = f.read()
    dialect, _ = autodetect_dialect(data[:10000])
    reader = csv.DictReader(io.StringIO(data), dialect=dialect)

    missing = [c for c in columns if c not in reader.fieldnames]
    if missing:
        print(f"ERROR: Missing expected column(s): {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    pattern = build_pattern(prefix, fill)

    rows = list(reader)
    changed = 0
    for row in rows:
        for col in columns:
            old = row.get(col, '')
            new = normalize_id(old, pattern)
            if new != old:
                changed += 1
                row[col] = new

    outpath = infile if inplace else outfile
    with open(outpath, 'w', encoding='utf-8-sig', newline='') as out_f:
        writer = csv.DictWriter(out_f, fieldnames=reader.fieldnames, dialect=dialect)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done. {changed} cell(s) normalized in {', '.join(columns)} with prefix='{prefix}' and fill='{fill}'. Wrote: {outpath}")

def main():
    parser = argparse.ArgumentParser(description="Normalize SoL endpoints by stripping a leading PREFIX and repeated FILL characters in FROM/TO.")
    parser.add_argument('--in', dest='infile', required=True, help='Input SoL CSV path')
    parser.add_argument('--out', dest='outfile', help='Output CSV path (omit when using --inplace)')
    parser.add_argument('--inplace', action='store_true', help='Edit input file in place')
    parser.add_argument('--columns', nargs='+', default=['FROM','TO'], help='Column(s) to normalize (default: FROM TO)')
    parser.add_argument('--prefix', default='DE', help="Leading prefix to strip (default: DE). Example: CH")
    parser.add_argument('--fillchar', default='0', help="Fill characters to strip after the prefix, repeated (default: '0'). Example: '_'")
    args = parser.parse_args()
    process(args.infile, args.outfile, args.inplace, args.columns, args.prefix, args.fillchar)

if __name__ == '__main__':
    main()
