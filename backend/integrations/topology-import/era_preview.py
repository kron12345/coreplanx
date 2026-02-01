#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Generate small preview JSONs for ERA extracts with extra SoL track properties.
Values are sanitized to avoid links/IRIs in output.
"""

from __future__ import annotations

import argparse
import gzip
import json
import random
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple

ERA = "http://data.europa.eu/949/"
RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>"
RDFS_LABEL = "<http://www.w3.org/2000/01/rdf-schema#label>"
SKOS_PREF = "<http://www.w3.org/2004/02/skos/core#prefLabel>"
ERA_OP = f"<{ERA}OperationalPoint>"
ERA_SOL = f"<{ERA}SectionOfLine>"

P = {
    "uopid": f"<{ERA}uopid>",
    "uniqueOPID": f"<{ERA}uniqueOPID>",
    "tafTAPCode": f"<{ERA}tafTAPCode>",
    "tafTAPLocationPrimaryCode": f"<{ERA}tafTAPLocationPrimaryCode>",
    "opType": f"<{ERA}opType>",
    "opName": f"<{ERA}opName>",
    "lineReference": f"<{ERA}lineReference>",
    "nationalLineIdentification": f"<{ERA}nationalLineIdentification>",
    "railwayLocation": f"<{ERA}railwayLocation>",
    "kilometer": f"<{ERA}kilometer>",
    "latitude": f"<{ERA}latitude>",
    "longitude": f"<{ERA}longitude>",
    "validityStartDate": f"<{ERA}validityStartDate>",
    "validityEndDate": f"<{ERA}validityEndDate>",
    "track": f"<{ERA}track>",
    "siding": f"<{ERA}siding>",
    "imCode": f"<{ERA}imCode>",
    "opStart": f"<{ERA}opStart>",
    "opEnd": f"<{ERA}opEnd>",
    "lengthOfSectionOfLine": f"<{ERA}lengthOfSectionOfLine>",
    "length": f"<{ERA}length>",
    "lineNationalId": f"<{ERA}lineNationalId>",
    "solNature": f"<{ERA}solNature>",
}

TRACK_PREDICATES = {
    "trackLoadCapability": [
        f"<{ERA}trackLoadCapability>",
        f"<{ERA}loadCapability>",
        f"<{ERA}loadCapability/era:loadCapabilityLineCategory>",
    ],
    "trainProtectionLegacySystems": [
        f"<{ERA}protectionLegacySystem>",
        f"<{ERA}trainProtectionLegacySystem>",
    ],
    "etcsLevel": [f"<{ERA}etcsLevel>"],
    "gsmRVersion": [f"<{ERA}gsmRVersion>"],
    "contactLineSystem": [f"<{ERA}contactLineSystem>"],
    "maxSpeed": [f"<{ERA}maximumPermittedSpeed>"],
    "wheelSetGauge": [f"<{ERA}wheelSetGauge>"],
    "profileNumberSwapBodies": [f"<{ERA}profileNumberSwapBodies>"],
    "tsiPantographHead": [f"<{ERA}tsiPantographHead>"],
    "otherPantographHead": [f"<{ERA}otherPantographHead>"],
    "permittedContactForce": [f"<{ERA}permittedContactForce>"],
    "gradientProfile": [f"<{ERA}gradientProfile>"],
}

OPTYPE_MAP = {
    "10": "STATION",
    "20": "SMALL_STATION",
    "30": "PASSENGER_TERMINAL",
    "40": "FREIGHT_TERMINAL",
    "50": "DEPOT_OR_WORKSHOP",
    "60": "TRAIN_TECHNICAL_SERVICES",
    "70": "PASSENGER_STOP",
    "80": "JUNCTION",
    "90": "BORDER_POINT",
    "110": "OTHER",
    "120": "OTHER",
    "140": "OTHER",
}

LIT_RE = re.compile(r'^\"(.*)\"(?:\\^\\^<[^>]+>|@[a-zA-Z0-9-]+)?$')


def parse_line(line: str) -> Tuple[str, str, str] | None:
    line = line.strip()
    if not line or line[0] not in "<_":
        return None
    parts = line.split(" ", 3)
    if len(parts) < 3:
        return None
    return parts[0], parts[1], parts[2]


def lit_value(value: str) -> str:
    m = LIT_RE.match(value)
    if m:
        return m.group(1)
    if "^^<" in value:
        return value.split("^^", 1)[0].strip('"')
    if value.startswith("<") and value.endswith(">"):
        tail = value[1:-1].rstrip("/").rsplit("/", 1)[-1]
        return tail
    return value.strip('"')


def load_subjects(path: Path):
    subject_type = {}
    subjects = {"OP": [], "SOL": []}
    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if p == RDF_TYPE:
                if o == ERA_OP:
                    subject_type[s] = "OP"
                    subjects["OP"].append(s)
                elif o == ERA_SOL:
                    subject_type[s] = "SOL"
                    subjects["SOL"].append(s)
    return subject_type, subjects


def collect_triples(path: Path, wanted: Set[str]):
    data = {s: {} for s in wanted}
    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if s not in data:
                continue
            data[s].setdefault(p, []).append(o)
    return data


def collect_track_props(full_dump: Path, tracks: Set[str]):
    pred_lookup = {p: key for key, preds in TRACK_PREDICATES.items() for p in preds}
    track_props: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    label_targets: Set[str] = set()

    with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if s not in tracks:
                continue
            key = pred_lookup.get(p)
            if not key:
                continue
            value = o
            if value.startswith("<") and value.endswith(">"):
                label_targets.add(value)
            track_props[s][key].append(value)

    labels: Dict[str, str] = {}
    if label_targets:
        with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parsed = parse_line(line)
                if not parsed:
                    continue
                s, p, o = parsed
                if s not in label_targets:
                    continue
                if p in (RDFS_LABEL, SKOS_PREF):
                    labels[s] = lit_value(o)

    return track_props, labels


def clean_value(value: str, labels: Dict[str, str]) -> str | None:
    if value is None or value == "":
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return None
    if value.startswith("<") and value.endswith(">"):
        return labels.get(value) or lit_value(value)
    return lit_value(value)


def build_op(triples: dict) -> dict | None:
    def get_first(pred):
        vals = triples.get(pred) or []
        return lit_value(vals[0]) if vals else None

    uopid = get_first(P["uopid"]) or get_first(P["uniqueOPID"])
    if not uopid:
        return None

    op_type_code = get_first(P["opType"])
    op_type = OPTYPE_MAP.get(op_type_code, "OTHER") if op_type_code else None
    name = get_first(P["opName"]) or get_first(RDFS_LABEL)

    op = {
        "opId": f"OP-{uopid}",
        "uniqueOpId": uopid,
    }
    if name:
        op["name"] = name
    if op_type:
        op["opType"] = op_type

    attrs = []

    def add_attr(key, value):
        if value is None or value == "":
            return
        if value.startswith("http://") or value.startswith("https://"):
            return
        attrs.append({"key": key, "value": value})

    add_attr("uopid", uopid)
    add_attr("opTypeCode", op_type_code)
    add_attr("tafTAPCode", get_first(P["tafTAPCode"]))
    add_attr("tafTAPLocationPrimaryCode", get_first(P["tafTAPLocationPrimaryCode"]))
    add_attr("lineReference", get_first(P["lineReference"]))
    add_attr("nationalLineIdentification", get_first(P["nationalLineIdentification"]))
    add_attr("railwayLocation", get_first(P["railwayLocation"]))
    add_attr("kilometer", get_first(P["kilometer"]))
    add_attr("imCode", get_first(P["imCode"]))
    add_attr("validityStartDate", get_first(P["validityStartDate"]))

    track_count = len(triples.get(P["track"], []))
    siding_count = len(triples.get(P["siding"], []))
    if track_count:
        add_attr("trackCount", str(track_count))
    if siding_count:
        add_attr("sidingCount", str(siding_count))

    if attrs:
        op["attributes"] = attrs
    return op


def build_sol(subject: str, triples: dict, track_props: dict, labels: dict) -> dict:
    def get_first(pred):
        vals = triples.get(pred) or []
        return lit_value(vals[0]) if vals else None

    sol_id = subject.strip("<>").rstrip("/").rsplit("/", 1)[-1]
    sol = {"solId": sol_id}

    start_id = get_first(P["opStart"])
    end_id = get_first(P["opEnd"])
    if start_id:
        sol["startUniqueOpId"] = start_id
    if end_id:
        sol["endUniqueOpId"] = end_id

    length_km = get_first(P["lengthOfSectionOfLine"])
    if length_km:
        if re.fullmatch(r"[0-9]+(\\.[0-9]+)?", length_km):
            sol["lengthKm"] = float(length_km)
        else:
            sol["lengthKm"] = length_km

    attrs = []

    def add_attr(key, value):
        v = clean_value(value, labels) if isinstance(value, str) else value
        if v is None or v == "":
            return
        attrs.append({"key": key, "value": str(v)})

    add_attr("solNatureCode", get_first(P["solNature"]))
    add_attr("lineNationalId", get_first(P["lineNationalId"]))
    add_attr("imCode", get_first(P["imCode"]))
    add_attr("lengthRaw", get_first(P["length"]))
    add_attr("validityStartDate", get_first(P["validityStartDate"]))

    track_count = len(triples.get(P["track"], []))
    if track_count:
        add_attr("trackCount", str(track_count))

    label = get_first(RDFS_LABEL)
    if label:
        add_attr("label", label)

    # Enrich with track properties
    track_ids = [v for v in (triples.get(P["track"], []) or []) if v.startswith("<")]
    seen = set()
    for track_id in track_ids:
        for key, vals in (track_props.get(track_id) or {}).items():
            for val in vals:
                cv = clean_value(val, labels)
                if cv is None:
                    continue
                tag = f"{key}:{cv}"
                if tag in seen:
                    continue
                seen.add(tag)
                add_attr(key, cv)

    # Derived electrification indicator
    if any(attr["key"] == "contactLineSystem" for attr in attrs):
        add_attr("electrified", "true")

    if attrs:
        sol["attributes"] = attrs
    return sol


def preview(extract_path: Path, full_dump: Path, out_path: Path, seed=42, sample=50):
    random.seed(seed)
    _, subjects = load_subjects(extract_path)
    op_sample = set(random.sample(subjects["OP"], min(sample, len(subjects["OP"]))))
    sol_sample = set(random.sample(subjects["SOL"], min(sample, len(subjects["SOL"]))))
    wanted = op_sample | sol_sample

    triples = collect_triples(extract_path, wanted)

    # collect track ids for SoL
    track_ids = set()
    for s in sol_sample:
        for t in triples.get(s, {}).get(P["track"], []) or []:
            if t.startswith("<"):
                track_ids.add(t)

    track_props, labels = collect_track_props(full_dump, track_ids)

    ops = []
    sols = []
    for s in op_sample:
        op = build_op(triples.get(s, {}))
        if op:
            ops.append(op)
    for s in sol_sample:
        sol = build_sol(s, triples.get(s, {}), track_props, labels)
        if sol:
            sols.append(sol)

    out = {
        "sample": {
            "operationalPoints": ops,
            "sectionsOfLine": sols,
        }
    }
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extract", required=True, help="Path to extracted .nq.gz (DEU/CHE)")
    ap.add_argument("--full", required=True, help="Path to full dump .nq.gz")
    ap.add_argument("--out", required=True, help="Output JSON path")
    ap.add_argument("--sample", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    preview(Path(args.extract), Path(args.full), Path(args.out), seed=args.seed, sample=args.sample)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
