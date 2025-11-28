#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ERA RINF Operational Points exporter (seek pagination, TDA-Defaults)

Features
--------
- Zwei-Stufen-Export:
  A) stabile Seek-Pagination (ohne OFFSET) nur für OP-IRIs
  B) OP-Details + Owner(IM) + Platform-Props + Language + LineRef in Batches via VALUES
- Spalten:
  - TDA-Default-Spalten (inkl. NOT_ACTIVE-Logik)
  - ID: bevorzugt UOPID, sonst P_ID (SHA1)
  - P_ID: SHA1 des OP-IRI (Uppercase-Name: P_ID)
  - URL: OP-IRI (im Browser auflösbar)
  - TAF_TAP_LOCATION_PRIMARY_CODE: nur Ziffern (damit INT-kompatibel)
  - Optional: Extra-Predicate-Spalten via --include-extras-columns
- Robust gegen Virtuoso-Limits (keine OFFSETs; form-encoded SPARQL; Fallbacks)

Beispiel:
 cd D
"""

import argparse
import csv
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Iterable, List, Optional, Sequence

import requests

from topology_client import TopologyAPIClient, resolve_api_base

ERA_ENDPOINT_DEFAULT = "https://prod.virtuoso.ecdp.tech.ec.europa.eu/sparql"
RINF_GRAPH = "<http://data.europa.eu/949/graph/rinf>"
ERA = "http://data.europa.eu/949/"
GEO = "http://www.opengis.net/ont/geosparql#"
SKOS = "http://www.w3.org/2004/02/skos/core#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
SKOS_GRAPH = "<http://data.europa.eu/949/graph/skos>"

# Fallback-Namen für OP-Typen, falls aus dem Graph nur Codes kommen
OPTYPE_CODE2NAME = {
    "10": "station",
    "20": "small station",
    "30": "passenger terminal",
    "40": "freight terminal",
    "50": "depot or workshop",
    "60": "train technical services",
    "70": "passenger stop",
    "80": "junction",
    "90": "border point",
}

ISO3_TO_ISO2 = {
    "AUT": "AT","BEL":"BE","BGR":"BG","HRV":"HR","CYP":"CY","CZE":"CZ",
    "DNK":"DK","EST":"EE","FIN":"FI","FRA":"FR","DEU":"DE","GRC":"GR",
    "HUN":"HU","IRL":"IE","ITA":"IT","LVA":"LV","LTU":"LT","LUX":"LU",
    "MLT":"MT","NLD":"NL","POL":"PL","PRT":"PT","ROU":"RO","SVK":"SK",
    "SVN":"SI","ESP":"ES","SWE":"SE","CHE":"CH","NOR":"NO","ISL":"IS",
    "GBR":"GB","ALB":"AL","MKD":"MK","SRB":"RS","MNE":"ME","BIH":"BA",
}

# „Core“-Extras (optional)
CORE_OP_PREDICATES = [
    f"<{ERA}operatingLanguage>",
    f"<{ERA}digitalSchematicOverview>",
    f"<{ERA}hasSchematicOverviewOPDigitalForm>",
]
ALL_OP_PREDICATES = CORE_OP_PREDICATES + [
    f"<{ERA}railwayLocation>",
    f"<{ERA}kilometer>",
    f"<{ERA}nationalLineIdentification>",
]

PLATFORM_HEIGHT_PRED = f"<{ERA}platformHeight>"
PLATFORM_LENGTH_PRED = f"<{ERA}lengthOfPlatform>"
TRACK_HAS_PLATFORM = f"<{ERA}platformEdge>"
TRACK_HAS_PLATFORM_ALT = f"<{ERA}platform>"

# ---------------- helpers ----------------

def sha1_id(s: str) -> str:
    import hashlib
    return hashlib.sha1(s.encode("utf-8")).hexdigest()

def iri_tail(iri: str) -> str:
    if not iri:
        return ""
    if "#" in iri:
        return iri.rsplit("#",1)[-1]
    return iri.rstrip("/").rsplit("/",1)[-1]

def iso3_to_iso2(iso3: str) -> str:
    return ISO3_TO_ISO2.get(iso3.upper(), iso3[:2].upper())

def unique_join(values: Iterable[str]) -> str:
    seen = []
    for v in values or []:
        if v and v not in seen:
            seen.append(v)
    return "|".join(seen)

OP_NAMESPACE = uuid.UUID("7df5a887-af6a-4b7c-8e12-47ffc4d2d6a1")


def build_normalizer(prefix: Optional[str], fill: str):
    if not prefix:
        return lambda value: value
    fill = fill or ""
    if fill:
        pattern = re.compile(
            r'^' + re.escape(prefix) + r'(?:' + re.escape(fill) + r')*(.+)$',
        )
    else:
        pattern = re.compile(r'^' + re.escape(prefix) + r'(.+)$')

    def normalize(value: Optional[str]):
        if value is None:
            return None
        s = str(value).strip()
        match = pattern.match(s)
        return match.group(1) if match else s

    return normalize


def normalize_attribute_key(name: str) -> str:
    tokens = re.split(r"[^A-Za-z0-9]+", name)
    tokens = [token for token in tokens if token]
    if not tokens:
        return name.lower()
    first = tokens[0].lower()
    rest = [token.capitalize() for token in tokens[1:]]
    return first + "".join(rest)

def http_post_sparql(query: str, timeout: int, retries: int, endpoint: str) -> dict:
    # Form-encoded → raw → GET (Fallbackkaskade)
    ua = "ERA-OPS-Exporter/1.2"
    last = None
    for attempt in range(1, retries+1):
        try:
            r = requests.post(
                endpoint,
                headers={
                    "Accept": "application/sparql-results+json",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "User-Agent": ua,
                },
                data={"query": query},
                timeout=timeout,
            )
            if r.status_code == 200:
                return r.json()
            # raw
            r2 = requests.post(
                endpoint,
                headers={
                    "Accept": "application/sparql-results+json",
                    "Content-Type": "application/sparql-query; charset=UTF-8",
                    "User-Agent": ua,
                },
                data=query.encode("utf-8"),
                timeout=timeout,
            )
            if r2.status_code == 200:
                return r2.json()
            # GET
            r3 = requests.get(
                endpoint,
                headers={"Accept":"application/sparql-results+json","User-Agent": ua},
                params={"query": query},
                timeout=timeout,
            )
            if r3.status_code == 200:
                return r3.json()
            last = (r.status_code, r.text[:200], r2.status_code, r2.text[:200], r3.status_code, r3.text[:200])
        except Exception as e:
            last = e
        if attempt < retries:
            time.sleep(min(1.5*attempt, 8.0))
    raise RuntimeError(f"SPARQL failed after {retries} attempts: {last}")

# -------------- Stage A: OP-IRIs (seek pagination) --------------

def build_op_iris_seek_query(country_iri: str, limit: int, after: str) -> str:
    after_escaped = after.replace("\\", "\\\\").replace('"', '\\"')
    return f"""
PREFIX era:  <{ERA}>
SELECT ?op ?s
FROM {RINF_GRAPH}
WHERE {{
  VALUES ?country {{ <{country_iri}> }}
  ?op a era:OperationalPoint ; era:inCountry ?country .
  BIND(STR(?op) AS ?s)
  FILTER(?s > "{after_escaped}")
}}
ORDER BY ?s
LIMIT {limit}
"""

def fetch_all_op_iris(country_iso3: str, page_size: int, timeout: int, retries: int, endpoint: str) -> List[str]:
    country_iri = f"http://publications.europa.eu/resource/authority/country/{country_iso3}"
    op_iris: List[str] = []
    seen: set = set()
    after = ""
    page = 0
    stalled = 0
    while True:
        q = build_op_iris_seek_query(country_iri, page_size, after)
        data = http_post_sparql(q, timeout, retries, endpoint)
        rows = data.get("results", {}).get("bindings", [])
        if not rows:
            print(f"[info] OP IRIs done at page={page}. Total distinct={len(op_iris)}")
            break
        added = 0
        last_s = after
        for b in rows:
            op = b.get("op", {}).get("value")
            s  = b.get("s", {}).get("value")
            if not op or not s:
                continue
            if op not in seen:
                seen.add(op)
                op_iris.append(op)
                added += 1
            last_s = s
        page += 1
        print(f"[info] OP IRIs page={page}: +{added} (distinct {len(op_iris)}) after='{last_s[-24:]}'")
        if last_s == after:
            stalled += 1
        else:
            stalled = 0
        after = last_s
        if len(rows) < page_size:
            print(f"[info] last page incomplete ({len(rows)}/{page_size}) → stop")
            break
        if stalled >= 2:
            print("[warn] seek pagination stalled (after unchanged twice) → stop to avoid loop")
            break
    return op_iris

# -------------- Stage B: Details + Extras (VALUES) --------------

def build_op_details_query(op_iris: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    return f"""
PREFIX era:  <{ERA}>
PREFIX geo:  <{GEO}>
SELECT ?op ?name ?u1 ?u2 ?plc ?validFrom ?validTo ?opType ?wkt
FROM {RINF_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  OPTIONAL {{ ?op era:opName ?name }}
  OPTIONAL {{ ?op era:uopid ?u1 }} OPTIONAL {{ ?op era:uniqueOPID ?u2 }}
  OPTIONAL {{ ?op era:tafTAPCode ?plc }}
  OPTIONAL {{ ?op era:validityStartDate ?validFrom }}
  OPTIONAL {{ ?op era:validityEndDate   ?validTo }}
  OPTIONAL {{ ?op era:opType ?opType }}
  OPTIONAL {{ ?op geo:hasGeometry/geo:asWKT ?wkt }}
}}
"""

def build_imcodes_query(op_iris: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    return f"""
PREFIX era:  <{ERA}>
SELECT ?op ?imCode
FROM {RINF_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  OPTIONAL {{ ?op era:track/era:imCode ?imCode }}
}}
"""

def build_platforms_query(op_iris: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    return f"""
PREFIX era:  <{ERA}>
PREFIX skos: <{SKOS}>
SELECT ?op ?heightLabel ?len
FROM {RINF_GRAPH}
FROM {SKOS_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  OPTIONAL {{
    ?op era:track ?tr .
    ?tr {TRACK_HAS_PLATFORM} ?pe .
    OPTIONAL {{ ?pe {PLATFORM_LENGTH_PRED} ?len }}
    OPTIONAL {{
      ?pe {PLATFORM_HEIGHT_PRED} ?h .
      OPTIONAL {{ ?h skos:prefLabel ?hLbl }}
      BIND( COALESCE(?hLbl, STR(?h)) AS ?heightLabel )
    }}
  }}
  OPTIONAL {{
    ?op era:track ?tr2 .
    ?tr2 {TRACK_HAS_PLATFORM_ALT} ?pe2 .
    OPTIONAL {{ ?pe2 {PLATFORM_LENGTH_PRED} ?len }}
    OPTIONAL {{
      ?pe2 {PLATFORM_HEIGHT_PRED} ?h2 .
      OPTIONAL {{ ?h2 skos:prefLabel ?hLbl2 }}
      BIND( COALESCE(?hLbl2, STR(?h2)) AS ?heightLabel )
    }}
  }}
}}
"""


def build_operating_lang_query(op_iris: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    return f"""
PREFIX era:  <{ERA}>
SELECT ?op ?lang
FROM {RINF_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  OPTIONAL {{ ?op era:operatingLanguage ?lang }}
}}
"""



def build_line_reference_query(op_iris: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    return f"""
PREFIX era:  <{ERA}>
PREFIX rdfs: <{RDFS}>
SELECT ?op ?km ?lineNat
FROM {RINF_GRAPH}
FROM {SKOS_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  OPTIONAL {{
    ?op (era:lineReference|era:railwayLocation) ?lr .
    OPTIONAL {{ ?lr era:kilometer ?km }}
    OPTIONAL {{
      ?lr (era:lineNationalId|era:nationalLineIdentification) ?line .
      OPTIONAL {{ ?line rdfs:label ?lnLbl }}
      BIND( COALESCE(?lnLbl, STR(?line)) AS ?lineNat )
    }}
  }}
}}
"""
def build_extras_query(op_iris: List[str], predicates: List[str]) -> str:
    vals = " ".join(f"<{x}>" for x in op_iris)
    unions = []
    for p in predicates:
        unions.append(f"{{ ?op {p} ?val . BIND('{p}' AS ?pred) }}")
    body = " UNION ".join(unions) if unions else "{ BIND('' AS ?pred) BIND('' AS ?val) }"
    return f"""
SELECT ?op ?pred ?val
FROM {RINF_GRAPH}
WHERE {{
  VALUES ?op {{ {vals} }}
  {body}
}}
"""

def batched(seq: Sequence[str], size: int):
    for i in range(0, len(seq), size):
        yield seq[i:i+size]

def fetch_in_batches(op_iris: List[str], build_query_fn, timeout: int, retries: int,
                     chunk_size: int, parallel: int, label: str, endpoint: str) -> List[dict]:
    all_rows: List[dict] = []
    batches = list(batched(op_iris, chunk_size))
    total = len(batches)
    if total == 0:
        return all_rows
    with ThreadPoolExecutor(max_workers=parallel) as ex:
        futures = []
        for idx, chunk in enumerate(batches, start=1):
            q = build_query_fn(chunk)
            futures.append(ex.submit(http_post_sparql, q, timeout, retries, endpoint))
            print(f"[info] {label}: queued batch {idx}/{total} ({len(chunk)} ops)")
        done = 0
        for fut in as_completed(futures):
            try:
                res = fut.result()
                rows = res.get("results", {}).get("bindings", [])
                all_rows.extend(rows)
            except Exception as e:
                print(f"[warn] {label}: batch failed with {e}")
            finally:
                done += 1
                if done % max(1, total//10) == 0 or done == total:
                    print(f"[info] {label}: progress {done}/{total}")
    return all_rows

def row_bool_not_active(valid_from: Optional[str], valid_to: Optional[str], as_of: Optional[str]) -> str:
    from datetime import datetime, timezone
    fmt = "%Y-%m-%d"
    if as_of:
        try:
            now = datetime.strptime(as_of, fmt).replace(tzinfo=timezone.utc)
        except Exception:
            now = datetime.now(timezone.utc)
    else:
        now = datetime.now(timezone.utc)
    def parse(d):
        try: return datetime.strptime(d, fmt).replace(tzinfo=timezone.utc) if d else None
        except: return None
    vfrom = parse(valid_from); vto = parse(valid_to)
    if vfrom and now < vfrom: return "true"
    if vto and now > vto: return "true"
    return "false"

# ---------------- orchestrator ----------------

def export_ops(
    country_iso3: str,
    outfile: Optional[str],
    *,
    props_mode: str = "core",
    add_predicates: Optional[List[str]] = None,
    always_include_extras: bool = True,
    include_extras_columns: bool = False,
    page_size: int = 5000,
    chunk_labels: int = 400,
    chunk_extras: int = 120,
    parallel: int = 3,
    timeout: int = 90,
    retries: int = 7,
    as_of: Optional[str] = None,
    endpoint_url: str = ERA_ENDPOINT_DEFAULT,
    emit_1900_row: bool = True,
    type_as_code: bool = False,
    api_client: Optional[TopologyAPIClient] = None,
    normalize_prefix: Optional[str] = None,
    normalize_fillchar: str = "0",
):

    # Stage A: OP-IRIs einsammeln
    op_iris = fetch_all_op_iris(country_iso3, page_size, timeout, retries, endpoint_url)
    if not op_iris:
        print("[warn] no OPs found"); return
    print(f"[info] total OP IRIs: {len(op_iris)} — fetching details...")

    # Stage B1: Details
    det_rows = fetch_in_batches(op_iris, build_op_details_query, timeout, retries,
                                chunk_labels, parallel, "op-details", endpoint_url)
    det_by_op: Dict[str, dict] = {}
    for b in det_rows:
        op = b.get("op",{}).get("value")
        if not op: continue
        det_by_op[op] = b

    # Stage B2: Owner (IM)
    im_rows = fetch_in_batches(op_iris, build_imcodes_query, timeout, retries,
                               chunk_labels, parallel, "owners", endpoint_url)
    im_by_op: Dict[str, List[str]] = {}
    for b in im_rows:
        op = b.get("op",{}).get("value"); im = b.get("imCode",{}).get("value")
        if op and im: im_by_op.setdefault(op, []).append(im)

    # Stage B3: Platform props
    plat_rows = fetch_in_batches(op_iris, build_platforms_query, timeout, retries,
                                 chunk_extras, parallel, "platforms", endpoint_url)
    h_by_op: Dict[str, List[str]] = {}; l_by_op: Dict[str, List[str]] = {}
    for b in plat_rows:
        op = b.get("op",{}).get("value")
        h  = b.get("heightLabel",{}).get("value"); ln = b.get("len",{}).get("value")
        if op:
            if h: h_by_op.setdefault(op, []).append(h)
            if ln: l_by_op.setdefault(op, []).append(ln)

    # Stage B4: Language
    lang_rows = fetch_in_batches(op_iris, build_operating_lang_query, timeout, retries,
                                 chunk_extras, parallel, "op-language", endpoint_url)
    lang_by_op: Dict[str, List[str]] = {}
    for b in lang_rows:
        op = b.get("op",{}).get("value"); lang = b.get("lang",{}).get("value")
        if op and lang: lang_by_op.setdefault(op, []).append(lang)

    
    # Stage B5: LineReference (Kilometer + National Line)
    line_rows = fetch_in_batches(op_iris, build_line_reference_query, timeout, retries,
                                 chunk_extras, parallel, "line-ref", endpoint_url)
    km_by_op: Dict[str, List[str]] = {}
    nat_by_op: Dict[str, List[str]] = {}
    for b in line_rows:
        op  = b.get("op",   {}).get("value")
        km  = b.get("km",   {}).get("value")
        nat = b.get("lineNat",{}).get("value")
        if not op:
            continue
        if km:
            km_by_op.setdefault(op, []).append(km)
        if nat:
            nat_by_op.setdefault(op, []).append(nat)

# Extras, parallel, "sol-ids", endpoint_url)
    sol_by_op: Dict[str, List[str]] = {}
    # Extras
    if props_mode.lower() not in ("none","core","all"):
        print(f"[warn] unknown --props-mode '{props_mode}', using 'core'"); props_mode="core"
    predicates: List[str] = []
    if props_mode == "core":
        predicates = CORE_OP_PREDICATES.copy()
    elif props_mode == "all":
        predicates = ALL_OP_PREDICATES.copy()
    add_predicates = add_predicates or []
    for p in add_predicates:
        p = p.strip()
        if not p: continue
        predicates.append(p if (p.startswith("<") and p.endswith(">")) else f"<{p}>")
    predicates = sorted(set(predicates))

    extras_map: Dict[str, Dict[str, List[str]]] = {}
    extras_cols: List[str] = []
    if predicates:
        extra_rows = fetch_in_batches(op_iris, lambda ch: build_extras_query(ch, predicates),
                                      timeout, retries, chunk_extras, parallel, "extras", endpoint_url)
        for b in extra_rows:
            op = b.get("op",{}).get("value"); pred = b.get("pred",{}).get("value"); val = b.get("val",{}).get("value")
            if not op or not pred: continue
            extras_map.setdefault(op, {}).setdefault(pred, []).append(val)
        if include_extras_columns:
            extras_cols = [iri_tail(p.strip("<>")) for p in predicates]

    # CSV Schema: nur TDA + P_ID + URL (+ optional Extras)
    tda_cols = [
        "VALID_FROM","ID","NAME","NOT_ACTIVE","Owner","Country","Type",
        "TDA_PARKING_NODE","LANGUAGE","TAF_TAP_COUNTRY_CODE_I_S_O",
        "TAF_TAP_LOCATION_PRIMARY_CODE","TSI_Z_DE_NOT_RELEVANT_FOR_PATH_ORDERING",
        "LATITUDE","LONGITUDE","TDA_USABLE_LENGTH","TDA_PLATFORM_HEIGHT","TDA_KILOMETER","TDA_LINE_NATIONAL",
        "TDA_PARENT_NET_NODE",
    ]
    fieldnames = tda_cols + ["P_ID","URL"] + (extras_cols if extras_cols else [])

    country_iso3_u = country_iso3.upper()

    sink = OperationalPointSink(
        outfile,
        fieldnames,
        api_client=api_client,
        normalize_prefix=normalize_prefix,
        normalize_fillchar=normalize_fillchar,
    )
    for op in op_iris:
        b = det_by_op.get(op, {})
        name = b.get("name",{}).get("value","")
        u1 = b.get("u1",{}).get("value",""); u2 = b.get("u2",{}).get("value","")
        plc = b.get("plc",{}).get("value","")
        valid_from = b.get("validFrom",{}).get("value","")
        valid_to   = b.get("validTo",{}).get("value","")
        opType_iri = b.get("opType",{}).get("value","")
        wkt = b.get("wkt",{}).get("value","")

        optype_id = iri_tail(opType_iri) if opType_iri else ""
        if optype_id.startswith("rinf/"):
            optype_id = optype_id.rsplit("/",1)[-1]
        optype_name = OPTYPE_CODE2NAME.get(optype_id, "")

        # lat/lon
        lat = lon = ""
        if wkt.startswith("POINT(") and wkt.endswith(")"):
            try:
                parts = wkt[6:-1].split()
                lon, lat = parts[0], parts[1]
            except Exception:
                pass

        # Country ISO2 (für TAF_TAP_COUNTRY_CODE_I_S_O)
        iso2 = plc[:2].upper() if plc and len(plc)>=2 else iso3_to_iso2(country_iso3_u)

        # PLC nur Ziffern
        plc_numeric = ""
        if plc:
            digits = "".join(ch for ch in plc if ch.isdigit())
            plc_numeric = digits if digits else ""

        # ID: UOPID zuerst, sonst P_ID
        id_value = (u1 or u2) if (u1 or u2) else sha1_id(op)

        type_value = optype_id if type_as_code else optype_name

        out = {
            "VALID_FROM": valid_from,
            "ID": id_value,
            "NAME": name,
            "NOT_ACTIVE": row_bool_not_active(valid_from, valid_to, as_of),
            "Owner": unique_join(im_by_op.get(op, [])),
            "Country": country_iso3_u,
            "Type": type_value,
            "TDA_PARKING_NODE": "",
            "LANGUAGE": unique_join(lang_by_op.get(op, [])),
            "TAF_TAP_COUNTRY_CODE_I_S_O": iso2,
            "TAF_TAP_LOCATION_PRIMARY_CODE": plc_numeric,
            "TSI_Z_DE_NOT_RELEVANT_FOR_PATH_ORDERING": "",
            "LATITUDE": lat,
            "LONGITUDE": lon,
            "TDA_USABLE_LENGTH": unique_join(l_by_op.get(op, [])),
            "TDA_PLATFORM_HEIGHT": unique_join(h_by_op.get(op, [])),
            "TDA_KILOMETER": unique_join(km_by_op.get(op, [])),
            "TDA_LINE_NATIONAL": unique_join(nat_by_op.get(op, [])),
            "TDA_PARENT_NET_NODE": "",
            "P_ID": sha1_id(op),
            "URL": op or "",
        }
        out["_OP_IRI"] = op
        out["_OP_TYPE_CODE"] = optype_id
        out["_OP_TYPE_LABEL"] = optype_name
        out["_UOPID_PRIMARY"] = u1
        out["_UOPID_SECONDARY"] = u2
        out["_VALID_TO"] = valid_to

        # Optional: Extra-Prädikat-Spalten
        for tail in extras_cols:
            full = None
            for key in extras_map.get(op, {}):
                if iri_tail(key.strip("<>")) == tail:
                    full = key; break
            out[tail] = unique_join(extras_map.get(op, {}).get(full, [])) if full else ""

        # ➊ Basis-Zeile ab 1900-01-01 mit NOT_ACTIVE=true (falls aktiviert)
        if emit_1900_row:
            base = dict(out)
            base["VALID_FROM"] = "1900-01-01"
            base["NOT_ACTIVE"] = "true"
            sink.write_csv_only(base)

        sink.write(out)

    sink.finish()
    if api_client:
        print(f"[done] uploaded {sink.record_count} operational points via API")
    if outfile:
        print(f"[done] ops -> {outfile} ({sink.record_count} rows)")

class OperationalPointSink:
    EXCLUDED_ATTR_COLUMNS = {
        "validFrom",
    }

    def __init__(
        self,
        csv_path: Optional[str],
        fieldnames: List[str],
        *,
        api_client: Optional[TopologyAPIClient],
        normalize_prefix: Optional[str],
        normalize_fillchar: str,
    ):
        self.api_client = api_client
        self.records: List[dict] = []
        self.record_count = 0
        self._normalize = build_normalizer(normalize_prefix, normalize_fillchar)
        self._file = None
        self._writer = None
        if csv_path:
            self._file = open(csv_path, "w", newline="", encoding="utf-8")
            self._writer = csv.DictWriter(
                self._file,
                fieldnames=fieldnames,
                delimiter=';',
            )
            self._writer.writeheader()

    def write_csv_only(self, row: dict) -> None:
        if self._writer:
            self._writer.writerow(row)

    def write(self, row: dict) -> None:
        if self._writer:
            self._writer.writerow(row)
        converted = self._convert_row(row)
        self.records.append(converted)
        self.record_count += 1

    def finish(self) -> None:
        if self._file:
            self._file.close()
        if self.api_client and self.records:
            self.api_client.replace_operational_points(self.records)

    def _convert_row(self, row: dict) -> dict:
        raw_id = row.get("ID") or ""
        raw_unique = (
            row.get("_UOPID_PRIMARY")
            or row.get("_UOPID_SECONDARY")
            or raw_id
        )
        unique_op_id = self._normalize(raw_unique) or raw_unique
        op_id = str(uuid.uuid5(OP_NAMESPACE, unique_op_id))
        lat = row.get("LATITUDE")
        lon = row.get("LONGITUDE")
        valid_from = row.get("VALID_FROM") or row.get("valid_from") or ""

        attributes = []
        for key, value in row.items():
            if key.startswith("_"):
                continue
            key_norm = normalize_attribute_key(key)
            if key_norm in self.EXCLUDED_ATTR_COLUMNS:
                continue
            if key_norm == "validFrom":
                continue
            if value is None or (isinstance(value, str) and value == ""):
                continue
            attr_value = str(value)
            if key_norm == "id":
                attr_value = unique_op_id
            attr = {"key": key_norm, "value": attr_value}
            if valid_from:
                attr["validFrom"] = valid_from
            attributes.append(attr)

        record: dict = {
            "opId": op_id,
            "uniqueOpId": unique_op_id,
        }
        if attributes:
            record["attributes"] = attributes
        return record

# ---------------- CLI ----------------

def main():
    ap = argparse.ArgumentParser(description="Export ERA RINF Operational Points (seek pagination, TDA defaults)")
    ap.add_argument("--country", required=True, help="ISO3 country code, e.g. DEU, FRA, CHE")
    ap.add_argument("--outfile", help="Optional CSV output path (legacy compatibility)")
    ap.add_argument("--props-mode", choices=["none","core","all"], default="core",
                    help="Welche Extra-Prädikate laden (core/all/none)")
    ap.add_argument("--add-predicate", action="append", default=[],
                    help="Zusätzliche Prädikat-IRI(s) (wiederholbar). volle IRI oder <IRI>")
    ap.add_argument("--always-include-extras", action="store_true",
                    help="(Kompat.) steuert Inhalte, Header nur mit --include-extras-columns")
    ap.add_argument("--include-extras-columns", action="store_true",
                    help="Extra-Prädikate als eigene Spalten ins CSV aufnehmen")
    ap.add_argument("--page-size", type=int, default=5000, help="Seek-Seitengröße für OP-IRIs")
    ap.add_argument("--chunk-labels", type=int, default=400, help="Batch-Größe für Details/Owner")
    ap.add_argument("--chunk-extras", type=int, default=120, help="Batch-Größe für Platform/Lang/LineRef/Extras")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--retries", type=int, default=7)
    ap.add_argument("--as-of", default=None, help="Datum für NOT_ACTIVE (YYYY-MM-DD)")
    ap.add_argument("--endpoint-url", default=ERA_ENDPOINT_DEFAULT, help="SPARQL Endpoint URL überschreiben")
    ap.add_argument("--no-1900-row", action="store_true",
                help="Keinen 1900-01-01 NOT_ACTIVE=true Basis-Datensatz je OP erzeugen")
    ap.add_argument("--type-as-code", action="store_true",
                help="Spalte 'Type' als numerischen OP-Type-Code (z. B. 10,80,90) ausgeben")
    ap.add_argument("--api-base", help="Backend API Basis (z. B. http://localhost:3000/api/v1). Defaults zu $TOPOLOGY_API_BASE.")
    ap.add_argument("--api-timeout", type=int, default=120, help="Timeout für Backend-Aufrufe (Sekunden).")
    ap.add_argument("--import-source", default="era_ops_export", help="Kennung für Import-Events.")
    ap.add_argument("--skip-events", action="store_true", help="Keine Import-Events an das Backend schicken.")
    ap.add_argument("--normalize-prefix", help="Optionales Prefix für ID-Normalisierung (z. B. DE).")
    ap.add_argument("--normalize-fillchar", default="0", help="Füllzeichen hinter dem Prefix (default: 0).")
    args = ap.parse_args()

    api_base = resolve_api_base(args.api_base)
    if not api_base and not args.outfile:
        ap.error("Either --outfile oder --api-base (oder TOPOLOGY_API_BASE) muss angegeben werden.")
    api_client = TopologyAPIClient(api_base, timeout=args.api_timeout) if api_base else None
    kinds = ["operational-points"]
    try:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=kinds,
                message=f"Import {args.country.upper()} gestartet",
                source=args.import_source,
            )
        export_ops(
            country_iso3=args.country.upper(),
            outfile=args.outfile,
            props_mode=args.props_mode,
            add_predicates=args.add_predicate,
            always_include_extras=args.always_include_extras,
            include_extras_columns=args.include_extras_columns,
            page_size=args.page_size,
            chunk_labels=args.chunk_labels,
            chunk_extras=args.chunk_extras,
            parallel=args.parallel,
            timeout=args.timeout,
            retries=args.retries,
            as_of=args.as_of,
            endpoint_url=args.endpoint_url,
            emit_1900_row=not args.no_1900_row,
            type_as_code=args.type_as_code,
            api_client=api_client,
            normalize_prefix=args.normalize_prefix,
            normalize_fillchar=args.normalize_fillchar,
        )
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=kinds,
                message=f"Import {args.country.upper()} abgeschlossen",
                source=args.import_source,
            )
    except Exception as exc:
        if api_client and not args.skip_events:
            api_client.send_event(
                "failed",
                kinds=kinds,
                message=f"Import fehlgeschlagen: {exc}",
                source=args.import_source,
            )
        raise

if __name__ == "__main__":
    main()
