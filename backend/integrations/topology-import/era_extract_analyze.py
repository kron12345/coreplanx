#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Extract ERA RINF N-Quads by country (DEU/CHE) and analyze OperationalPoints/SectionsOfLine.
Works on .nq.gz dumps and streams to keep memory use low.
"""

from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, Tuple

RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>"
RDFS_LABEL = "<http://www.w3.org/2000/01/rdf-schema#label>"

ERA = "http://data.europa.eu/949/"
ERA_OP = f"<{ERA}OperationalPoint>"
ERA_SOL = f"<{ERA}SectionOfLine>"
ERA_IN_COUNTRY = f"<{ERA}inCountry>"

COUNTRY_DEU = "<http://publications.europa.eu/resource/authority/country/DEU>"
COUNTRY_CHE = "<http://publications.europa.eu/resource/authority/country/CHE>"

KEY_PREDICATES = {
    "OP": {
        RDFS_LABEL,
        f"<{ERA}uopid>",
        f"<{ERA}uniqueOPID>",
        f"<{ERA}tafTAPLocationPrimaryCode>",
        f"<{ERA}operationalPointType>",
        f"<{ERA}opName>",
        f"<{ERA}railwayLocation>",
        f"<{ERA}kilometer>",
        f"<{ERA}nationalLineIdentification>",
        f"<{ERA}inCountry>",
        f"<{ERA}latitude>",
        f"<{ERA}longitude>",
    },
    "SOL": {
        RDFS_LABEL,
        f"<{ERA}opStart>",
        f"<{ERA}opEnd>",
        f"<{ERA}lengthOfSectionOfLine>",
        f"<{ERA}lineNationalId>",
        f"<{ERA}track>",
        f"<{ERA}validityStartDate>",
        f"<{ERA}inCountry>",
    },
}


def parse_nq_line(line: str) -> Tuple[str, str, str] | None:
    line = line.strip()
    if not line or line[0] not in "<_":
        return None
    parts = line.split(" ", 3)
    if len(parts) < 3:
        return None
    return parts[0], parts[1], parts[2]


def pass1_collect_subjects(path: Path) -> Tuple[Dict[str, str], set[str], set[str]]:
    subject_type: Dict[str, str] = {}
    country_deu: set[str] = set()
    country_che: set[str] = set()

    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_nq_line(line)
            if not parsed:
                continue
            s, p, o = parsed

            if p == RDF_TYPE:
                if o == ERA_OP:
                    subject_type[s] = "OP"
                elif o == ERA_SOL:
                    subject_type[s] = "SOL"

            if p == ERA_IN_COUNTRY:
                if o == COUNTRY_DEU:
                    country_deu.add(s)
                elif o == COUNTRY_CHE:
                    country_che.add(s)

    return subject_type, country_deu, country_che


def pass2_extract(
    path: Path,
    out_deu: Path,
    out_che: Path,
    subject_type: Dict[str, str],
    country_deu: set[str],
    country_che: set[str],
) -> Tuple[int, int]:
    deu_subjects = {s for s in country_deu if subject_type.get(s) in ("OP", "SOL")}
    che_subjects = {s for s in country_che if subject_type.get(s) in ("OP", "SOL")}

    deu_count = 0
    che_count = 0

    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh, \
            gzip.open(out_deu, "wt", encoding="utf-8") as fh_deu, \
            gzip.open(out_che, "wt", encoding="utf-8") as fh_che:
        for line in fh:
            parsed = parse_nq_line(line)
            if not parsed:
                continue
            s, _, _ = parsed
            if s in deu_subjects:
                fh_deu.write(line)
                deu_count += 1
            if s in che_subjects:
                fh_che.write(line)
                che_count += 1

    return deu_count, che_count


def analyze_file(path: Path) -> dict:
    subject_type: Dict[str, str] = {}
    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_nq_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if p == RDF_TYPE:
                if o == ERA_OP:
                    subject_type[s] = "OP"
                elif o == ERA_SOL:
                    subject_type[s] = "SOL"

    pred_counts = {"OP": Counter(), "SOL": Counter()}
    pred_samples = {"OP": defaultdict(list), "SOL": defaultdict(list)}

    def sample_value(value: str) -> str:
        if value.startswith("<") and value.endswith(">"):
            tail = value[1:-1].rstrip("/").rsplit("/", 1)[-1]
            return tail
        return value.strip('"')

    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_nq_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            t = subject_type.get(s)
            if not t:
                continue
            pred_counts[t][p] += 1
            if p in KEY_PREDICATES[t]:
                samples = pred_samples[t][p]
                if len(samples) < 5:
                    samples.append(sample_value(o))

    return {
        "subjects": {
            "OP": sum(1 for v in subject_type.values() if v == "OP"),
            "SOL": sum(1 for v in subject_type.values() if v == "SOL"),
        },
        "top_predicates": {
            "OP": pred_counts["OP"].most_common(25),
            "SOL": pred_counts["SOL"].most_common(25),
        },
        "samples": pred_samples,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to .nq.gz dump")
    ap.add_argument("--out-dir", required=True, help="Output directory for DEU/CHE extracts")
    ap.add_argument("--skip-extract", action="store_true", help="Only analyze existing extracts")
    args = ap.parse_args()

    src = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_deu = out_dir / "deu.nq.gz"
    out_che = out_dir / "che.nq.gz"

    if not args.skip_extract:
        subject_type, country_deu, country_che = pass1_collect_subjects(src)
        deu_count, che_count = pass2_extract(src, out_deu, out_che, subject_type, country_deu, country_che)
        print(f"[extract] wrote {deu_count} quads to {out_deu}")
        print(f"[extract] wrote {che_count} quads to {out_che}")

    report = {
        "deu": analyze_file(out_deu),
        "che": analyze_file(out_che),
    }
    report_path = out_dir / "analysis_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[analysis] report written to {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
