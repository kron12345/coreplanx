#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Import ERA RINF Operational Points and Sections of Line from local N-Quads extracts.
Uses extracted .nq.gz files (e.g. deu.nq.gz, che.nq.gz) and full dump for track properties.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

from topology_client import TopologyAPIClient, resolve_api_base

ERA = "http://data.europa.eu/949/"
RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>"
RDFS_LABEL = "<http://www.w3.org/2000/01/rdf-schema#label>"
SKOS_PREF = "<http://www.w3.org/2004/02/skos/core#prefLabel>"

ERA_OP = f"<{ERA}OperationalPoint>"
ERA_SOL = f"<{ERA}SectionOfLine>"
GEO_HAS = "<http://www.opengis.net/ont/geosparql#hasGeometry>"
GEO_WKT = "<http://www.opengis.net/ont/geosparql#asWKT>"

P = {
    "uopid": f"<{ERA}uopid>",
    "uniqueOPID": f"<{ERA}uniqueOPID>",
    "tafTAPCode": f"<{ERA}tafTAPCode>",
    "tafTAPLocationPrimaryCode": f"<{ERA}tafTAPLocationPrimaryCode>",
    "opType": f"<{ERA}opType>",
    "opTypeAlt": f"<{ERA}operationalPointType>",
    "opName": f"<{ERA}opName>",
    "lineReference": f"<{ERA}lineReference>",
    "nationalLineIdentification": f"<{ERA}nationalLineIdentification>",
    "railwayLocation": f"<{ERA}railwayLocation>",
    "kilometer": f"<{ERA}kilometer>",
    "latitude": f"<{ERA}latitude>",
    "longitude": f"<{ERA}longitude>",
    "inCountry": f"<{ERA}inCountry>",
    "validityStartDate": f"<{ERA}validityStartDate>",
    "validityEndDate": f"<{ERA}validityEndDate>",
    "track": f"<{ERA}track>",
    "trackId": f"<{ERA}trackId>",
    "platformEdge": f"<{ERA}platformEdge>",
    "platformEdgeAlt": f"<{ERA}platform>",
    "platformId": f"<{ERA}platformId>",
    "platformHeight": f"<{ERA}platformHeight>",
    "lengthOfPlatform": f"<{ERA}lengthOfPlatform>",
    "siding": f"<{ERA}siding>",
    "sidingId": f"<{ERA}sidingId>",
    "lengthOfSiding": f"<{ERA}lengthOfSiding>",
    "length": f"<{ERA}length>",
    "imCode": f"<{ERA}imCode>",
    "tenClassification": f"<{ERA}tenClassification>",
    "opStart": f"<{ERA}opStart>",
    "opEnd": f"<{ERA}opEnd>",
    "lengthOfSectionOfLine": f"<{ERA}lengthOfSectionOfLine>",
    "lineNationalId": f"<{ERA}lineNationalId>",
    "solNature": f"<{ERA}solNature>",
    "trackDirection": f"<{ERA}trackDirection>",
    "lineCategory": f"<{ERA}lineCategory>",
    "wheelSetGauge": f"<{ERA}wheelSetGauge>",
    "gaugingProfile": f"<{ERA}gaugingProfile>",
    "profileNumberSwapBodies": f"<{ERA}profileNumberSwapBodies>",
    "profileNumberSemiTrailers": f"<{ERA}profileNumberSemiTrailers>",
    "trainDetectionSystem": f"<{ERA}trainDetectionSystem>",
    "contactLineSystem": f"<{ERA}contactLineSystem>",
    "protectionLegacySystem": f"<{ERA}protectionLegacySystem>",
    "etcsLevel": f"<{ERA}etcsLevel>",
    "gsmrNetworkCoverage": f"<{ERA}gsmrNetworkCoverage>",
    "gsmROptionalFunctions": f"<{ERA}gsmROptionalFunctions>",
    "gsmRVersion": f"<{ERA}gsmRVersion>",
    "maximumPermittedSpeed": f"<{ERA}maximumPermittedSpeed>",
    "contactStripMaterial": f"<{ERA}contactStripMaterial>",
    "magneticBraking": f"<{ERA}magneticBraking>",
    "switchProtectControlWarning": f"<{ERA}switchProtectControlWarning>",
    "hasLevelCrossings": f"<{ERA}hasLevelCrossings>",
    "hasSevereWeatherConditions": f"<{ERA}hasSevereWeatherConditions>",
    "isQuietRoute": f"<{ERA}isQuietRoute>",
    "maximumTemperature": f"<{ERA}maximumTemperature>",
    "minimumTemperature": f"<{ERA}minimumTemperature>",
    "permittedContactForce": f"<{ERA}permittedContactForce>",
    "tsiPantographHead": f"<{ERA}tsiPantographHead>",
    "otherPantographHead": f"<{ERA}otherPantographHead>",
    "trackLoadCapability": f"<{ERA}trackLoadCapability>",
    "loadCapability": f"<{ERA}loadCapability>",
    "hasRefuelling": f"<{ERA}hasRefuelling>",
    "hasElectricShoreSupply": f"<{ERA}hasElectricShoreSupply>",
    "hasWaterRestocking": f"<{ERA}hasWaterRestocking>",
    "hasSandRestocking": f"<{ERA}hasSandRestocking>",
    "hasToiletDischarge": f"<{ERA}hasToiletDischarge>",
    "hasExternalCleaning": f"<{ERA}hasExternalCleaning>",
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

TRACK_DETAIL_PREDICATES = {
    P["trackId"],
    P["imCode"],
    P["trackDirection"],
    P["lineCategory"],
    P["wheelSetGauge"],
    P["gaugingProfile"],
    P["profileNumberSwapBodies"],
    P["profileNumberSemiTrailers"],
    P["trainDetectionSystem"],
    P["contactLineSystem"],
    P["protectionLegacySystem"],
    P["etcsLevel"],
    P["gsmrNetworkCoverage"],
    P["gsmROptionalFunctions"],
    P["gsmRVersion"],
    P["maximumPermittedSpeed"],
    P["contactStripMaterial"],
    P["tenClassification"],
    P["magneticBraking"],
    P["switchProtectControlWarning"],
    P["hasLevelCrossings"],
    P["hasSevereWeatherConditions"],
    P["isQuietRoute"],
    P["maximumTemperature"],
    P["minimumTemperature"],
    P["permittedContactForce"],
    P["tsiPantographHead"],
    P["otherPantographHead"],
    P["trackLoadCapability"],
    P["loadCapability"],
    P["validityStartDate"],
}

SIDING_DETAIL_PREDICATES = {
    P["sidingId"],
    P["lengthOfSiding"],
    P["length"],
    P["hasRefuelling"],
    P["hasElectricShoreSupply"],
    P["hasWaterRestocking"],
    P["hasSandRestocking"],
    P["hasToiletDischarge"],
    P["hasExternalCleaning"],
    P["imCode"],
    P["tenClassification"],
    P["validityStartDate"],
}

PLATFORM_EDGE_DETAIL_PREDICATES = {
    P["platformId"],
    P["platformHeight"],
    P["lengthOfPlatform"],
    P["length"],
    P["imCode"],
    P["tenClassification"],
    P["validityStartDate"],
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

ISO3_TO_ISO2 = {
    "AUT": "AT", "BEL": "BE", "BGR": "BG", "HRV": "HR", "CYP": "CY", "CZE": "CZ",
    "DNK": "DK", "EST": "EE", "FIN": "FI", "FRA": "FR", "DEU": "DE", "GRC": "GR",
    "HUN": "HU", "IRL": "IE", "ITA": "IT", "LVA": "LV", "LTU": "LT", "LUX": "LU",
    "MLT": "MT", "NLD": "NL", "POL": "PL", "PRT": "PT", "ROU": "RO", "SVK": "SK",
    "SVN": "SI", "ESP": "ES", "SWE": "SE", "CHE": "CH", "NOR": "NO", "ISL": "IS",
    "GBR": "GB", "ALB": "AL", "MKD": "MK", "SRB": "RS", "MNE": "ME", "BIH": "BA",
}

LIT_RE = re.compile(r'^"(.*)"(?:\^\^<[^>]+>|@[a-zA-Z0-9-]+)?$')
WKT_POINT_RE = re.compile(r"POINT\s*\(\s*([+-]?[0-9.]+)\s+([+-]?[0-9.]+)\s*\)")


def parse_line(line: str) -> Tuple[str, str, str] | None:
    line = line.strip()
    if not line or line[0] not in "<_":
        return None
    if line.endswith("."):
        line = line[:-1].rstrip()

    if '"' not in line:
        parts = line.split(" ", 3)
        if len(parts) < 3:
            return None
        return parts[0], parts[1], parts[2]

    tokens: List[str] = []
    buf: List[str] = []
    in_quote = False
    escape = False
    for ch in line:
        if escape:
            buf.append(ch)
            escape = False
            continue
        if ch == "\\":
            buf.append(ch)
            escape = True
            continue
        if ch == '"':
            buf.append(ch)
            in_quote = not in_quote
            continue
        if ch == " " and not in_quote:
            if buf:
                tokens.append("".join(buf))
                buf = []
            continue
        buf.append(ch)
    if buf:
        tokens.append("".join(buf))

    if len(tokens) < 3:
        return None
    return tokens[0], tokens[1], tokens[2]


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


def iso3_to_iso2(iso3: str) -> str:
    return ISO3_TO_ISO2.get(iso3.upper(), iso3[:2].upper())


def collect_subject_types(paths: List[Path]) -> Dict[str, str]:
    subject_type: Dict[str, str] = {}
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parsed = parse_line(line)
                if not parsed:
                    continue
                s, p, o = parsed
                if p != RDF_TYPE:
                    continue
                if o == ERA_OP:
                    subject_type[s] = "OP"
                elif o == ERA_SOL:
                    subject_type[s] = "SOL"
    return subject_type


def collect_triples(paths: List[Path], subject_type: Dict[str, str]) -> Tuple[dict, dict]:
    op_preds = {
        P["uopid"], P["uniqueOPID"], P["tafTAPCode"], P["tafTAPLocationPrimaryCode"],
        P["opType"], P["opTypeAlt"], P["opName"], P["lineReference"],
        P["nationalLineIdentification"], P["railwayLocation"], P["kilometer"],
        P["latitude"], P["longitude"], P["inCountry"], P["validityStartDate"],
        P["track"], P["siding"], P["imCode"], RDFS_LABEL,
    }
    sol_preds = {
        P["opStart"], P["opEnd"], P["lengthOfSectionOfLine"], P["lineNationalId"],
        P["track"], P["solNature"], P["imCode"], P["validityStartDate"],
        P["inCountry"], RDFS_LABEL,
    }
    op_triples: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    sol_triples: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))

    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parsed = parse_line(line)
                if not parsed:
                    continue
                s, p, o = parsed
                t = subject_type.get(s)
                if t == "OP" and p in op_preds:
                    op_triples[s][p].append(o)
                elif t == "SOL" and p in sol_preds:
                    sol_triples[s][p].append(o)
    return op_triples, sol_triples


def collect_track_props(full_dump: Path, tracks: Set[str]):
    pred_lookup = {p: key for key, preds in TRACK_PREDICATES.items() for p in preds}
    track_props: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    label_targets: Set[str] = set()

    if not tracks:
        return track_props, {}

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
            if o.startswith("<") and o.endswith(">"):
                label_targets.add(o)
            track_props[s][key].append(o)

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


def collect_op_geometries(
    full_dump: Path,
    subjects: Set[str],
) -> Dict[str, Dict[str, float]]:
    if not subjects:
        return {}

    op_geom: Dict[str, str] = {}
    geom_targets: Set[str] = set()
    with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if s not in subjects:
                continue
            if p == GEO_HAS and o.startswith("<"):
                op_geom[s] = o
                geom_targets.add(o)

    geom_wkt: Dict[str, str] = {}
    if geom_targets:
        with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parsed = parse_line(line)
                if not parsed:
                    continue
                s, p, o = parsed
                if s not in geom_targets:
                    continue
                if p == GEO_WKT:
                    geom_wkt[s] = o

    positions: Dict[str, Dict[str, float]] = {}
    for op_subject, geom_subject in op_geom.items():
        wkt_raw = geom_wkt.get(geom_subject)
        if not wkt_raw:
            continue
        wkt_text = lit_value(wkt_raw)
        match = WKT_POINT_RE.search(wkt_text)
        if not match:
            continue
        try:
            lng = float(match.group(1))
            lat = float(match.group(2))
        except ValueError:
            continue
        positions[op_subject] = {"lat": lat, "lng": lng}

    return positions


def collect_labels(full_dump: Path, targets: Set[str]) -> Dict[str, str]:
    labels: Dict[str, str] = {}
    if not targets:
        return labels
    with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if s not in targets:
                continue
            if p in (RDFS_LABEL, SKOS_PREF):
                labels[s] = lit_value(o)
    return labels


def collect_station_assets(
    full_dump: Path,
    track_ids: Set[str],
    siding_ids: Set[str],
) -> Tuple[
    Dict[str, Dict[str, List[str]]],
    Dict[str, Dict[str, List[str]]],
    Dict[str, Dict[str, List[str]]],
    Dict[str, List[str]],
    Dict[str, str],
]:
    track_triples: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    siding_triples: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    platform_edge_triples: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    track_platform_edges: Dict[str, List[str]] = defaultdict(list)
    platform_edges: Set[str] = set()
    label_targets: Set[str] = set()

    if not track_ids and not siding_ids:
        return track_triples, platform_edge_triples, siding_triples, track_platform_edges, {}

    with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parsed = parse_line(line)
            if not parsed:
                continue
            s, p, o = parsed
            if s in track_ids:
                if p in (P["platformEdge"], P["platformEdgeAlt"]) and o.startswith("<"):
                    track_platform_edges[s].append(o)
                    platform_edges.add(o)
                if p in TRACK_DETAIL_PREDICATES:
                    track_triples[s][p].append(o)
                    if o.startswith("<"):
                        label_targets.add(o)
            if s in siding_ids and p in SIDING_DETAIL_PREDICATES:
                siding_triples[s][p].append(o)
                if o.startswith("<"):
                    label_targets.add(o)

    if platform_edges:
        with gzip.open(full_dump, "rt", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parsed = parse_line(line)
                if not parsed:
                    continue
                s, p, o = parsed
                if s not in platform_edges:
                    continue
                if p in PLATFORM_EDGE_DETAIL_PREDICATES:
                    platform_edge_triples[s][p].append(o)
                    if o.startswith("<"):
                        label_targets.add(o)

    labels = collect_labels(full_dump, label_targets)
    return track_triples, platform_edge_triples, siding_triples, track_platform_edges, labels


def clean_value(value: str, labels: Dict[str, str]) -> str | None:
    if value is None or value == "":
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return None
    if value.startswith("<") and value.endswith(">"):
        return labels.get(value) or lit_value(value)
    return lit_value(value)


def build_op(
    subject: str,
    triples: dict,
    op_positions: Optional[Dict[str, Dict[str, float]]] = None,
) -> dict | None:
    def get_first(pred: str) -> Optional[str]:
        vals = triples.get(pred) or []
        return lit_value(vals[0]) if vals else None

    uopid = get_first(P["uopid"]) or get_first(P["uniqueOPID"])
    if not uopid:
        return None

    op_type_code = get_first(P["opType"]) or get_first(P["opTypeAlt"])
    op_type = OPTYPE_MAP.get(op_type_code, "OTHER") if op_type_code else "OTHER"
    name = get_first(P["opName"]) or get_first(RDFS_LABEL) or uopid

    country_val = get_first(P["inCountry"])
    country_iso2 = None
    if country_val and country_val.startswith("http"):
        country_iso2 = iso3_to_iso2(country_val.rsplit("/", 1)[-1])
    elif country_val:
        country_iso2 = iso3_to_iso2(country_val)

    lat = get_first(P["latitude"])
    lon = get_first(P["longitude"])
    position = None
    try:
        if lat and lon:
            position = {"lat": float(lat), "lng": float(lon)}
    except ValueError:
        position = None
    if not position and op_positions:
        position = op_positions.get(subject)

    op = {
        "opId": f"OP-{uopid}",
        "uniqueOpId": uopid,
        "countryCode": country_iso2 or "",
        "name": name,
        "opType": op_type,
    }
    if position:
        op["position"] = position

    attrs = []

    def add_attr(key: str, value: Optional[str]):
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


def build_sol(subject: str, triples: dict, op_map: Dict[str, str], track_props: dict, labels: dict) -> dict | None:
    def get_first(pred: str) -> Optional[str]:
        vals = triples.get(pred) or []
        return vals[0] if vals else None

    sol_id = subject.strip("<>").rstrip("/").rsplit("/", 1)[-1]

    start_raw = get_first(P["opStart"])
    end_raw = get_first(P["opEnd"])

    def map_op(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        if value.startswith("<") and value.endswith(">"):
            return op_map.get(value) or lit_value(value)
        return lit_value(value)

    start_id = map_op(start_raw)
    end_id = map_op(end_raw)
    if not start_id or not end_id:
        return None

    sol: dict = {
        "solId": sol_id,
        "uniqueSolId": sol_id,
        "startUniqueOpId": start_id,
        "endUniqueOpId": end_id,
        "nature": "REGULAR",
    }

    length_raw = get_first(P["lengthOfSectionOfLine"])
    if length_raw:
        length_val = lit_value(length_raw)
        try:
            sol["lengthKm"] = float(length_val)
        except ValueError:
            pass

    attrs = []

    def add_attr(key: str, value: Optional[str]):
        if value is None:
            return
        v = clean_value(value, labels) if isinstance(value, str) else value
        if v is None or v == "":
            return
        attrs.append({"key": key, "value": str(v)})

    add_attr("solNatureCode", get_first(P["solNature"]))
    add_attr("lineNationalId", get_first(P["lineNationalId"]))
    add_attr("imCode", get_first(P["imCode"]))
    add_attr("validityStartDate", get_first(P["validityStartDate"]))
    add_attr("label", lit_value(get_first(RDFS_LABEL)) if get_first(RDFS_LABEL) else None)

    country_val = get_first(P["inCountry"])
    if country_val:
        add_attr("countryCode", iso3_to_iso2(lit_value(country_val)))

    track_ids = [v for v in (triples.get(P["track"], []) or []) if v.startswith("<")]
    if track_ids:
        add_attr("trackCount", str(len(track_ids)))

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

    if any(attr["key"] == "contactLineSystem" for attr in attrs):
        add_attr("electrified", "true")

    if attrs:
        sol["attributes"] = attrs
    return sol


def build_station_area(op: dict) -> dict:
    station_area = {
        "stationAreaId": f"SA-{op['uniqueOpId']}",
        "uniqueOpId": op["uniqueOpId"],
        "name": op.get("name") or op["uniqueOpId"],
    }
    if op.get("position"):
        station_area["position"] = op["position"]
    attrs = []
    for attr in op.get("attributes", []) or []:
        if attr.get("key") in ("uopid", "opTypeCode", "tafTAPCode", "tafTAPLocationPrimaryCode"):
            attrs.append(attr)
    if attrs:
        station_area["attributes"] = attrs
    return station_area


def build_track(
    track_iri: str,
    triples: dict,
    unique_op_id: Optional[str],
    platform_edges: List[str],
    labels: Dict[str, str],
) -> dict | None:
    track_key = track_iri.strip("<>").rstrip("/").rsplit("/", 1)[-1]
    track: dict = {
        "trackKey": track_key,
        "uniqueOpId": unique_op_id or "",
    }

    def get_first(pred: str) -> Optional[str]:
        vals = triples.get(pred) or []
        return vals[0] if vals else None

    track_id_raw = get_first(P["trackId"])
    if track_id_raw:
        track["trackId"] = clean_value(track_id_raw, labels) or lit_value(track_id_raw)

    if platform_edges:
        track["platformEdgeIds"] = [
            edge.strip("<>").rstrip("/").rsplit("/", 1)[-1]
            for edge in platform_edges
        ]

    attrs = []

    def add_attr(key: str, value: Optional[str]):
        if value is None:
            return
        v = clean_value(value, labels) if isinstance(value, str) else value
        if v is None or v == "":
            return
        attrs.append({"key": key, "value": str(v)})

    for pred, key in (
        (P["imCode"], "imCode"),
        (P["trackDirection"], "trackDirection"),
        (P["lineCategory"], "lineCategory"),
        (P["wheelSetGauge"], "wheelSetGauge"),
        (P["gaugingProfile"], "gaugingProfile"),
        (P["profileNumberSwapBodies"], "profileNumberSwapBodies"),
        (P["profileNumberSemiTrailers"], "profileNumberSemiTrailers"),
        (P["trainDetectionSystem"], "trainDetectionSystem"),
        (P["contactLineSystem"], "contactLineSystem"),
        (P["protectionLegacySystem"], "trainProtectionLegacySystem"),
        (P["etcsLevel"], "etcsLevel"),
        (P["gsmrNetworkCoverage"], "gsmrNetworkCoverage"),
        (P["gsmROptionalFunctions"], "gsmROptionalFunctions"),
        (P["gsmRVersion"], "gsmRVersion"),
        (P["maximumPermittedSpeed"], "maximumPermittedSpeed"),
        (P["contactStripMaterial"], "contactStripMaterial"),
        (P["tenClassification"], "tenClassification"),
        (P["magneticBraking"], "magneticBraking"),
        (P["switchProtectControlWarning"], "switchProtectControlWarning"),
        (P["hasLevelCrossings"], "hasLevelCrossings"),
        (P["hasSevereWeatherConditions"], "hasSevereWeatherConditions"),
        (P["isQuietRoute"], "isQuietRoute"),
        (P["maximumTemperature"], "maximumTemperature"),
        (P["minimumTemperature"], "minimumTemperature"),
        (P["permittedContactForce"], "permittedContactForce"),
        (P["tsiPantographHead"], "tsiPantographHead"),
        (P["otherPantographHead"], "otherPantographHead"),
        (P["trackLoadCapability"], "trackLoadCapability"),
        (P["loadCapability"], "loadCapability"),
        (P["validityStartDate"], "validityStartDate"),
    ):
        for val in triples.get(pred) or []:
            add_attr(key, val)

    electrified = any(attr["key"] == "contactLineSystem" for attr in attrs)
    if electrified:
        add_attr("electrified", "true")

    if attrs:
        track["attributes"] = attrs
    return track


def build_platform_edge(
    edge_iri: str,
    triples: dict,
    track_key: Optional[str],
    labels: Dict[str, str],
) -> dict | None:
    edge_id = edge_iri.strip("<>").rstrip("/").rsplit("/", 1)[-1]
    edge: dict = {
        "platformEdgeId": edge_id,
    }
    if track_key:
        edge["trackKey"] = track_key

    def get_first(pred: str) -> Optional[str]:
        vals = triples.get(pred) or []
        return vals[0] if vals else None

    platform_id = get_first(P["platformId"])
    if platform_id:
        edge["platformId"] = clean_value(platform_id, labels) or lit_value(platform_id)

    length_raw = get_first(P["lengthOfPlatform"]) or get_first(P["length"])
    if length_raw:
        length_val = clean_value(length_raw, labels) or lit_value(length_raw)
        try:
            edge["lengthMeters"] = float(length_val)
        except (ValueError, TypeError):
            edge["lengthMeters"] = length_val

    height_raw = get_first(P["platformHeight"])
    if height_raw:
        edge["platformHeight"] = clean_value(height_raw, labels) or lit_value(height_raw)

    attrs = []

    def add_attr(key: str, value: Optional[str]):
        if value is None:
            return
        v = clean_value(value, labels) if isinstance(value, str) else value
        if v is None or v == "":
            return
        attrs.append({"key": key, "value": str(v)})

    for pred, key in (
        (P["imCode"], "imCode"),
        (P["tenClassification"], "tenClassification"),
        (P["validityStartDate"], "validityStartDate"),
    ):
        for val in triples.get(pred) or []:
            add_attr(key, val)

    if attrs:
        edge["attributes"] = attrs
    return edge


def build_platforms_from_edges(edges: List[dict]) -> List[dict]:
    by_platform: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    for edge in edges:
        unique_op_id = edge.get("uniqueOpId")
        platform_id = edge.get("platformId")
        if not unique_op_id or not platform_id:
            continue
        by_platform[(unique_op_id, str(platform_id))].append(edge)

    platforms: List[dict] = []
    for (unique_op_id, platform_id), grouped in by_platform.items():
        platform_key = f"{unique_op_id}:{platform_id}"
        platform_edge_ids = [edge["platformEdgeId"] for edge in grouped if edge.get("platformEdgeId")]
        lengths = [
            edge.get("lengthMeters")
            for edge in grouped
            if isinstance(edge.get("lengthMeters"), (int, float))
        ]
        height_counts: Dict[str, int] = defaultdict(int)
        for edge in grouped:
            height = edge.get("platformHeight")
            if height:
                height_counts[str(height)] += 1
        platform: dict = {
            "platformKey": platform_key,
            "platformId": platform_id,
            "uniqueOpId": unique_op_id,
            "platformEdgeIds": platform_edge_ids,
        }
        if lengths:
            platform["lengthMeters"] = max(lengths)
        if height_counts:
            platform["platformHeight"] = max(height_counts.items(), key=lambda item: item[1])[0]
        platforms.append(platform)
    return platforms


def build_siding(
    siding_iri: str,
    triples: dict,
    unique_op_id: Optional[str],
    labels: Dict[str, str],
) -> dict | None:
    siding_key = siding_iri.strip("<>").rstrip("/").rsplit("/", 1)[-1]
    siding: dict = {
        "sidingKey": siding_key,
        "uniqueOpId": unique_op_id or "",
    }

    def get_first(pred: str) -> Optional[str]:
        vals = triples.get(pred) or []
        return vals[0] if vals else None

    siding_id = get_first(P["sidingId"])
    if siding_id:
        siding["sidingId"] = clean_value(siding_id, labels) or lit_value(siding_id)

    length_raw = get_first(P["lengthOfSiding"]) or get_first(P["length"])
    if length_raw:
        length_val = clean_value(length_raw, labels) or lit_value(length_raw)
        try:
            siding["lengthMeters"] = float(length_val)
        except (ValueError, TypeError):
            siding["lengthMeters"] = length_val

    attrs = []

    def add_attr(key: str, value: Optional[str]):
        if value is None:
            return
        v = clean_value(value, labels) if isinstance(value, str) else value
        if v is None or v == "":
            return
        attrs.append({"key": key, "value": str(v)})

    def add_bool_field(field: str, pred: str):
        val = get_first(pred)
        if val is None:
            return
        v = clean_value(val, labels) or lit_value(val)
        if isinstance(v, str):
            lowered = v.strip().lower()
            if lowered in ("true", "false"):
                siding[field] = lowered == "true"
                return
        add_attr(field, v)

    add_bool_field("hasRefuelling", P["hasRefuelling"])
    add_bool_field("hasElectricShoreSupply", P["hasElectricShoreSupply"])
    add_bool_field("hasWaterRestocking", P["hasWaterRestocking"])
    add_bool_field("hasSandRestocking", P["hasSandRestocking"])
    add_bool_field("hasToiletDischarge", P["hasToiletDischarge"])
    add_bool_field("hasExternalCleaning", P["hasExternalCleaning"])

    for pred, key in (
        (P["imCode"], "imCode"),
        (P["tenClassification"], "tenClassification"),
        (P["validityStartDate"], "validityStartDate"),
    ):
        for val in triples.get(pred) or []:
            add_attr(key, val)

    if attrs:
        siding["attributes"] = attrs
    return siding


def parse_extracts(values: Iterable[str]) -> List[Path]:
    paths: List[Path] = []
    for value in values:
        for part in value.split(","):
            part = part.strip()
            if part:
                paths.append(Path(part))
    return paths


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extract", required=True, action="append", help="Path(s) to extracted .nq.gz")
    ap.add_argument("--full", required=True, help="Path to full dump .nq.gz")
    ap.add_argument("--api-base", help="Backend API base (e.g. http://localhost:3000/api/v1)")
    ap.add_argument("--skip-ops", action="store_true")
    ap.add_argument("--skip-sols", action="store_true")
    ap.add_argument("--skip-station-areas", action="store_true")
    ap.add_argument("--skip-tracks", action="store_true")
    ap.add_argument("--skip-platform-edges", action="store_true")
    ap.add_argument("--skip-platforms", action="store_true")
    ap.add_argument("--skip-sidings", action="store_true")
    ap.add_argument("--skip-events", action="store_true")
    ap.add_argument("--import-source", default="era_local_import")
    args = ap.parse_args()

    extract_paths = parse_extracts(args.extract)
    if not extract_paths:
        raise SystemExit("No extract files provided.")
    full_dump = Path(args.full)

    api_base = resolve_api_base(args.api_base)
    if not api_base:
        raise SystemExit("--api-base (or TOPOLOGY_API_BASE) is required.")
    api_client = TopologyAPIClient(api_base)

    subject_type = collect_subject_types(extract_paths)
    op_triples, sol_triples = collect_triples(extract_paths, subject_type)
    missing_geo_subjects = {
        subject
        for subject, triples in op_triples.items()
        if not (triples.get(P["latitude"]) and triples.get(P["longitude"]))
    }
    op_positions = collect_op_geometries(full_dump, missing_geo_subjects)

    if not args.skip_ops:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["operational-points"],
                message="Lokaler OP-Import gestartet",
                source=args.import_source,
            )
        ops: List[dict] = []
        op_map: Dict[str, str] = {}
        op_by_uid: Dict[str, dict] = {}
        seen: set[str] = set()
        for subject, triples in op_triples.items():
            op = build_op(subject, triples, op_positions)
            if not op:
                continue
            uid = op.get("uniqueOpId")
            if not uid or uid in seen:
                continue
            seen.add(uid)
            op_map[subject] = uid
            op_by_uid[uid] = op
            ops.append(op)
        api_client.replace_operational_points(ops)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["operational-points"],
                message=f"Lokaler OP-Import abgeschlossen ({len(ops)} Datensaetze).",
                source=args.import_source,
            )
    else:
        op_map = {}
        op_by_uid = {}
        for s, t in op_triples.items():
            op = build_op(s, t, op_positions)
            if op and op.get("uniqueOpId"):
                op_map[s] = op["uniqueOpId"]
                op_by_uid[op["uniqueOpId"]] = op

    if not args.skip_sols:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["sections-of-line"],
                message="Lokaler SoL-Import gestartet",
                source=args.import_source,
            )
        track_ids: Set[str] = set()
        for triples in sol_triples.values():
            for track in triples.get(P["track"], []) or []:
                if track.startswith("<"):
                    track_ids.add(track)
        track_props, labels = collect_track_props(full_dump, track_ids)

        sols: List[dict] = []
        seen_sol: set[str] = set()
        for subject, triples in sol_triples.items():
            sol = build_sol(subject, triples, op_map, track_props, labels)
            if not sol:
                continue
            sid = sol.get("solId")
            if not sid or sid in seen_sol:
                continue
            seen_sol.add(sid)
            sols.append(sol)
        api_client.replace_sections_of_line(sols)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["sections-of-line"],
                message=f"Lokaler SoL-Import abgeschlossen ({len(sols)} Datensaetze).",
                source=args.import_source,
            )

    track_ids: Set[str] = set()
    siding_ids: Set[str] = set()
    track_to_op: Dict[str, str] = {}
    siding_to_op: Dict[str, str] = {}
    for subject, triples in op_triples.items():
        uid = op_map.get(subject)
        if not uid:
            continue
        for track in triples.get(P["track"], []) or []:
            if track.startswith("<"):
                track_ids.add(track)
                track_to_op[track] = uid
        for siding in triples.get(P["siding"], []) or []:
            if siding.startswith("<"):
                siding_ids.add(siding)
                siding_to_op[siding] = uid

    track_triples, platform_edge_triples, siding_triples, track_platform_edges, asset_labels = collect_station_assets(
        full_dump,
        track_ids,
        siding_ids,
    )

    if not args.skip_station_areas:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["station-areas"],
                message="Lokaler Stationsbereich-Import gestartet",
                source=args.import_source,
            )
        station_areas = [build_station_area(op) for op in op_by_uid.values()]
        api_client.replace_station_areas(station_areas)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["station-areas"],
                message=f"Lokaler Stationsbereich-Import abgeschlossen ({len(station_areas)} Datensaetze).",
                source=args.import_source,
            )

    tracks: List[dict] = []
    platform_edges: List[dict] = []

    if not args.skip_tracks:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["tracks"],
                message="Lokaler Gleis-Import gestartet",
                source=args.import_source,
            )
        for track_iri, triples in track_triples.items():
            track = build_track(
                track_iri,
                triples,
                track_to_op.get(track_iri),
                track_platform_edges.get(track_iri, []),
                asset_labels,
            )
            if track:
                tracks.append(track)
        api_client.replace_tracks(tracks)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["tracks"],
                message=f"Lokaler Gleis-Import abgeschlossen ({len(tracks)} Datensaetze).",
                source=args.import_source,
            )

    if not args.skip_platform_edges:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["platform-edges"],
                message="Lokaler Bahnsteigkanten-Import gestartet",
                source=args.import_source,
            )
        edge_to_track_key: Dict[str, str] = {}
        edge_to_track_iri: Dict[str, str] = {}
        for track_iri, edges in track_platform_edges.items():
            track_key = track_iri.strip("<>").rstrip("/").rsplit("/", 1)[-1]
            for edge in edges:
                edge_to_track_key[edge] = track_key
                edge_to_track_iri[edge] = track_iri
        for edge_iri, triples in platform_edge_triples.items():
            edge = build_platform_edge(edge_iri, triples, edge_to_track_key.get(edge_iri), asset_labels)
            if not edge:
                continue
            track_key = edge_to_track_key.get(edge_iri)
            if track_key:
                edge["trackKey"] = track_key
            track_iri = edge_to_track_iri.get(edge_iri)
            unique_op_id = track_to_op.get(track_iri, "") if track_iri else ""
            if not unique_op_id and track_key:
                # fallback: resolve uniqueOpId by trackKey
                for track in tracks:
                    if track.get("trackKey") == track_key:
                        unique_op_id = track.get("uniqueOpId")
                        break
            if unique_op_id:
                edge["uniqueOpId"] = unique_op_id
            platform_edges.append(edge)
        api_client.replace_platform_edges(platform_edges)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["platform-edges"],
                message=f"Lokaler Bahnsteigkanten-Import abgeschlossen ({len(platform_edges)} Datensaetze).",
                source=args.import_source,
            )

    if not args.skip_platforms:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["platforms"],
                message="Lokaler Bahnsteig-Import gestartet",
                source=args.import_source,
            )
        platforms = build_platforms_from_edges(platform_edges)
        api_client.replace_platforms(platforms)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["platforms"],
                message=f"Lokaler Bahnsteig-Import abgeschlossen ({len(platforms)} Datensaetze).",
                source=args.import_source,
            )

    if not args.skip_sidings:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=["sidings"],
                message="Lokaler Abstellgleis-Import gestartet",
                source=args.import_source,
            )
        sidings: List[dict] = []
        for siding_iri, triples in siding_triples.items():
            siding = build_siding(siding_iri, triples, siding_to_op.get(siding_iri), asset_labels)
            if siding:
                sidings.append(siding)
        api_client.replace_sidings(sidings)
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=["sidings"],
                message=f"Lokaler Abstellgleis-Import abgeschlossen ({len(sidings)} Datensaetze).",
                source=args.import_source,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
