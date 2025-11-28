#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ERA SoL exporter (All-in-One v1.4)
- Robustly fills NAME, FROM, TO, ATTRIBUTE_LINE
  * FROM/TO: prefer OP uopid; fallback to OP rdfs:label; fallback to last URI segment
  * NAME: SoL skos/rdfs; else composed "FROM_NAME – TO_NAME"; else last SoL segment
  * ATTRIBUTE_LINE: era:nationalLineIdentification (label of the NationalRailwayLine)
- Owner via imCode or via linked IM (unchanged)
- Track props: protectionLegacySystem, trackLoadCapability, etc. (unchanged)
- Label resolution for concept URIs + NationalRailwayLine
"""

from __future__ import annotations
import argparse, csv, random, time, json, re, uuid
from typing import Any, Dict, Iterable, List, Tuple
from urllib.parse import unquote, urlparse
import requests

from topology_client import TopologyAPIClient, resolve_api_base

SPARQL_ENDPOINT   = "https://prod.virtuoso.ecdp.tech.ec.europa.eu/sparql"
GRAPH_RINF        = "http://data.europa.eu/949/graph/rinf"
SOL_BASE_DEFAULT  = "http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/"
SOL_NAMESPACE = uuid.UUID("1b085a6b-3fd1-4b03-9bc4-5f8b793ef872")

PREFIXES = """\
PREFIX era:  <http://data.europa.eu/949/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

CSV_HEADER = [
    "VALID_FROM","ID","NAME","NOT_ACTIVE","Owner","Country","FROM","TO","LENGTH",
    "ATTRIBUTE_LINE","TDA_CLASS_OF_TRACK","TDA_KV_Codification","TDA_TRACK_WIDTH",
    "TDA_MAX_SPEED","TDA_PROTECTION_LEGACY_SYSTEM","TDA_COMMUICATION_INFRASTRUCTURE",
    "TDA_ETCS_LEVEL","TDA_TSI_PANTOGRAPH_HEAD","TDA_OTHER_PANTOGRAPH_HEAD","TDA_CONTACT_LINE_SYSTEM","TDA_CONTACT_FORCE_PERMITTED","TDA_GRADIENT_PROFILE","URL"
]


def normalize_attribute_key(name: str) -> str:
    tokens = re.split(r"[^A-Za-z0-9]+", name)
    tokens = [token for token in tokens if token]
    if not tokens:
        return name.lower()
    first = tokens[0].lower()
    rest = [token.capitalize() for token in tokens[1:]]
    return first + "".join(rest)

def build_normalizer(prefix: str | None, fill: str) -> callable:
    if not prefix:
        return lambda value: value
    fill = fill or ""
    if fill:
        pattern = re.compile(
            r'^' + re.escape(prefix) + r'(?:' + re.escape(fill) + r')*(.+)$',
        )
    else:
        pattern = re.compile(r'^' + re.escape(prefix) + r'(.+)$')

    def normalize(value: str | None) -> str | None:
        if value is None:
            return None
        s = str(value).strip()
        match = pattern.match(s)
        return match.group(1) if match else s

    return normalize

def sha1(s: str) -> str:
    import hashlib as _h
    return _h.sha1((s or "").encode("utf-8")).hexdigest()

def fmt(tpl: str, **kw) -> str:
    out = tpl
    for k,v in kw.items():
        out = out.replace(f"${k}$", str(v))
    return out

def http_post_sparql(session: requests.Session, query: str, timeout: int, retries: int, endpoint: str) -> Dict[str, Any]:
    headers = {
        "Accept":"application/sparql-results+json",
        "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
        "Accept-Encoding":"gzip, deflate",
        "Connection":"keep-alive",
        "User-Agent":"era-sols-export/all-in-one-1.4",
    }
    data = {"query": query}
    last = None
    for i in range(1, retries+1):
        try:
            r = session.post(endpoint, headers=headers, data=data, timeout=timeout)
            if r.status_code < 400:
                return r.json()
            last = (r.status_code, r.text[:250])
        except Exception as e:
            last = e
        time.sleep(min(1.0*i, 6.0) + random.uniform(0.05, 0.35))
    raise RuntimeError(f"SPARQL failed after {retries} attempts: {last}")

def http_get_jsonld(session: requests.Session, uri: str, timeout: int):
    try:
        r = session.get(uri, headers={"Accept":"application/ld+json"}, timeout=timeout)
        if r.status_code < 400:
            return r.json()
    except Exception:
        pass
    return None

def country_uri(iso3: str) -> str:
    return f"<http://publications.europa.eu/resource/authority/country/{iso3}>"

def bget(b: Dict[str,Any], k: str) -> str:
    return (b.get(k) or {}).get("value","")

# --- SPARQL templates ---

Q_SOL_IDS = PREFIXES + """\
SELECT ?sol
WHERE {
  GRAPH <$GRAPH$> {
    ?sol a era:SectionOfLine ;
         era:inCountry $COUNTRY$ .
    $PFX_CLAUSE$
  }
  FILTER(STR(?sol) > "$AFTER$")
}
ORDER BY ?sol
LIMIT $LIMIT$
"""

Q_ENDPOINTS = PREFIXES + """\
SELECT ?sol ?opS ?opE ?validFrom
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> {
    OPTIONAL { ?sol era:opStart ?opS }
    OPTIONAL { ?sol era:opEnd   ?opE }
    OPTIONAL { ?sol era:validityStartDate ?validFrom }
  }
}
"""

Q_META_NAME = PREFIXES + """\
SELECT ?sol ?name
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> {
    OPTIONAL { ?sol rdfs:label     ?name }
  }
}
"""

Q_META_OWNER = PREFIXES + """\
SELECT ?sol ?imCode
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> {
    OPTIONAL { ?sol era:imCode ?im1 }
    OPTIONAL {
      ?sol era:im ?im .
      ?im  era:imCode ?im2
    }
    BIND(COALESCE(?im1, ?im2) AS ?imCode)
  }
}
"""

Q_META_LEN = PREFIXES + """\
SELECT ?sol ?len
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> { OPTIONAL { ?sol era:lengthOfSectionOfLine ?len } }
}
"""

Q_META_NATLINE = PREFIXES + """\
SELECT ?sol ?nat
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> { OPTIONAL { ?sol era:lineNationalId ?nat } }
}
"""

Q_OP_INFO = PREFIXES + """\
SELECT ?op (COALESCE(?u1, ?u2) AS ?uop) (COALESCE(?n_op, ?lbl1, ?lbl2) AS ?name)
WHERE {
  VALUES ?op { $OPS$ }
  GRAPH <$GRAPH$> {
    OPTIONAL { ?op era:uopid ?u1 }
    OPTIONAL { ?op era:uniqueOPID ?u2 }
    OPTIONAL { ?op <http://data.europa.eu/949/name> ?n_op }
    OPTIONAL { ?op skos:prefLabel ?lbl1 }
    OPTIONAL { ?op rdfs:label ?lbl2 }
  }
}
"""

Q_TRACK_DIRS = PREFIXES + """\
SELECT ?sol ?tr ?dir
WHERE {
  VALUES ?sol { $SOLS$ }
  GRAPH <$GRAPH$> {
    ?sol a era:SectionOfLine ; era:track ?tr .
    OPTIONAL { ?tr era:direction ?dir }
  }
}
"""

Q_TR_PROP = PREFIXES + """\
SELECT ?tr ?val
WHERE {
  VALUES ?tr { $TRS$ }
  GRAPH <$GRAPH$> { $PATTERN$ }
}
"""

def fetch_sol_ids_shard(session, iso3, sol_base, shard_pfx, page_size, min_page_size, timeout, retries, endpoint, skip_on_timeout):
    after = ""
    acc: List[str] = []
    limit = page_size
    pfx_clause = ""
    if shard_pfx:
        pfx_clause = f'FILTER(STRSTARTS(STR(?sol), "{sol_base}{shard_pfx}"))'
    page = 0
    while True:
        q = fmt(Q_SOL_IDS, GRAPH=GRAPH_RINF, COUNTRY=country_uri(iso3),
                PFX_CLAUSE=pfx_clause, AFTER=after.replace('"','\\"'), LIMIT=limit)
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if limit > min_page_size:
                new_limit = max(min_page_size, limit // 2)
                print(f"[warn] sol-ids shard '{shard_pfx or '*'}' page={page} limit={limit}: {err}\n       retry with smaller limit={new_limit}")
                limit = new_limit
                continue
            if skip_on_timeout:
                print(f"[warn] sol-ids skip shard '{shard_pfx or '*'}' page={page}: {err}")
                break
            raise
        rows = [bget(b,"sol") for b in data.get("results",{}).get("bindings",[])]
        if not rows:
            break
        acc.extend(rows)
        after = rows[-1]
        page += 1
        print(f"[info] shard '{shard_pfx or '*'}': +{len(rows)} ids (acc {len(acc)}) [page={page}, limit={limit}]")
    print(f"[info] shard '{shard_pfx or '*'}': +{len(acc)}")
    return acc

def fetch_endpoints(session, sols, timeout, retries, endpoint, batch, min_batch, skip_on_timeout):
    out: Dict[str, Dict[str,str]] = {}
    idx=0; size=batch
    while idx < len(sols):
        this = sols[idx:idx+size]
        q = fmt(Q_ENDPOINTS, GRAPH=GRAPH_RINF, SOLS=" ".join(f"<{s}>" for s in this))
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] endpoints failed at idx={idx}, retry size={size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] endpoints skip batch idx={idx}, size={size}: {err}")
                idx += size; size = batch
                continue
            raise
        for b in data.get("results",{}).get("bindings",[]):
            sol = bget(b,"sol"); d = out.setdefault(sol,{})
            if "opS" in b: d["opS"] = bget(b,"opS")
            if "opE" in b: d["opE"] = bget(b,"opE")
            if "validFrom" in b: d["validFrom"] = bget(b,"validFrom")
        idx += size; size = batch
        print(f"[info] endpoints progress: {min(idx,len(sols))}/{len(sols)} SoLs")
    return out

def fetch_meta_simple(session, sols, qtpl, out_key, timeout, retries, endpoint, batch, min_batch, skip_on_timeout):
    out: Dict[str, Dict[str,str]] = {}
    idx=0; size=batch
    while idx < len(sols):
        this = sols[idx:idx+size]
        q = fmt(qtpl, GRAPH=GRAPH_RINF, SOLS=" ".join(f"<{s}>" for s in this))
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] meta[{out_key}] failed at idx={idx}, retry size...{size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] meta[{out_key}] skip batch idx={idx}, size={size}: {err}")
                idx += size; size = batch
                continue
            raise
        for b in data.get("results",{}).get("bindings",[]):
            sol = bget(b,"sol"); d = out.setdefault(sol,{})
            if out_key in b and "value" in b[out_key]:
                d[out_key] = b[out_key]["value"]
        idx += size; size = batch
        print(f"[info] meta[{out_key}] progress: {min(idx,len(sols))}/{len(sols)} SoLs")
    return out

def fetch_op_info(session, ops, timeout, retries, endpoint, batch, min_batch, skip_on_timeout) -> Dict[str, Tuple[str,str]]:
    """
    Returns { op_uri: (uopid, name) }
    """
    out: Dict[str, Tuple[str,str]] = {}
    ops = [o for o in ops if o]
    if not ops:
        return out
    idx=0; size=batch
    while idx < len(ops):
        this = ops[idx:idx+size]
        q = fmt(Q_OP_INFO, GRAPH=GRAPH_RINF, OPS=" ".join(f"<{o}>" for o in this))
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] OP info failed at idx={idx}, retry size={size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] OP info skip batch idx={idx}, size={size}: {err}")
                idx += size; size = batch
                continue
            raise
        for b in data.get("results",{}).get("bindings",[]):
            op  = bget(b,"op")
            uop = bget(b,"uop")
            nm  = bget(b,"name")
            out[op] = (uop, nm)
        idx += size; size = batch
        print(f"[info] OP info progress: {min(idx,len(ops))}/{len(ops)} ops")
    return out

def fetch_track_dirs(session, sols, timeout, retries, endpoint, batch, min_batch, skip_on_timeout):
    out: Dict[str,List[Dict[str,Any]]] = {}
    idx=0; size=batch
    while idx < len(sols):
        this = sols[idx:idx+size]
        q = fmt(Q_TRACK_DIRS, GRAPH=GRAPH_RINF, SOLS=" ".join(f"<{s}>" for s in this))
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] track-dirs failed at idx={idx}, retry size={size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] track-dirs skip batch idx={idx}, size={size}: {err}")
                idx += size; size = batch
                continue
            raise
        for b in data.get("results",{}).get("bindings",[]):
            sol = bget(b,"sol")
            out.setdefault(sol, []).append(b)
        idx += size; size = batch
        print(f"[info] track-dirs progress: {min(idx,len(sols))}/{len(sols)} SoLs")
    return out

def pick_track(rows: List[Dict[str,Any]]) -> Dict[str,Any]:
    if not rows:
        return {}
    def rank(b: Dict[str,Any]) -> int:
        d = (b.get("dir") or {}).get("value","").lower()
        if "directional" in d: return 3
        if "single" in d:     return 2
        return 1
    return sorted(rows, key=lambda x: (-rank(x), (x.get("tr") or {}).get("value","")))[0]

def fetch_track_prop(session, tracks, pattern, timeout, retries, endpoint, batch, min_batch, skip_on_timeout):
    out: Dict[str, List[str]] = {}
    if not tracks:
        return out
    idx=0; size=batch
    while idx < len(tracks):
        this = tracks[idx:idx+size]
        q = fmt(Q_TR_PROP, GRAPH=GRAPH_RINF, TRS=" ".join(f"<{t}>" for t in this), PATTERN=pattern)
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] track-prop failed at idx={idx}, retry size={size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] track-prop skip batch idx={idx}, size={size}: {err}")
                idx += size; size = batch
                continue
            raise
        for b in data.get("results",{}).get("bindings",[]):
            tr  = bget(b,"tr")
            val = bget(b,"val")
            if val:
                out.setdefault(tr, []).append(val)
        idx += size; size = batch
        print(f"[info] track-prop progress: {min(idx,len(tracks))}/{len(tracks)} tracks")
    return out

def fetch_track_prop_any(session, tracks, patterns: List[str], timeout, retries, endpoint, batch, min_batch, skip_on_timeout):
    merged: Dict[str, List[str]] = {}
    for patt in patterns:
        part = fetch_track_prop(session, tracks, patt, timeout, retries, endpoint, batch, min_batch, skip_on_timeout)
        for tr, vals in part.items():
            dst = merged.setdefault(tr, [])
            for v in vals:
                if v not in dst:
                    dst.append(v)
    return merged

# --- Labels ---

Q_LABELS = PREFIXES + """\
SELECT ?uri (COALESCE(?ld, ?le, ?ln, ?rdfs) AS ?label)
WHERE {
  VALUES ?uri { $URIS$ }
  OPTIONAL { ?uri skos:prefLabel ?ld . FILTER(LANG(?ld) = "de") }
  OPTIONAL { ?uri skos:prefLabel ?le . FILTER(LANG(?le) = "en") }
  OPTIONAL { ?uri skos:prefLabel ?ln . FILTER(LANG(?ln) = "") }
  OPTIONAL { ?uri rdfs:label ?rdfs . FILTER(LANG(?rdfs) = "" || !BOUND(LANG(?rdfs))) }
}
"""

def fallback_label_from_uri(u: str) -> str:
    try:
        path = urlparse(u).path
        last = path.strip("/").split("/")[-1]
        return unquote(last) or u
    except Exception:
        return u

def fetch_labels_for_uris(session, uris: List[str], timeout, retries, endpoint, batch, min_batch, skip_on_timeout) -> Dict[str,str]:
    out: Dict[str,str] = {}
    if not uris:
        return out
    idx=0; size=batch
    while idx < len(uris):
        this = uris[idx:idx+size]
        q = fmt(Q_LABELS, URIS=" ".join(f"<{u}>" for u in this))
        try:
            data = http_post_sparql(session, q, timeout, retries, endpoint)
            for b in data.get("results",{}).get("bindings",[]):
                u = bget(b,"uri"); lbl = bget(b,"label")
                if u:
                    out[u] = lbl or ""
        except RuntimeError as err:
            if size > min_batch:
                size = max(min_batch, size // 2)
                print(f"[warn] labels failed at idx={idx}, retry size={size}: {err}")
                continue
            if skip_on_timeout:
                print(f"[warn] labels skip batch idx={idx}, size={size}: {err}")
            # JSON-LD fallback per URI
            for u in this:
                if u in out:
                    continue
                try:
                    j = http_get_jsonld(session, u, timeout=timeout)
                    lbl = ""
                    if isinstance(j, dict):
                        def extract(d):
                            for k in ("http://www.w3.org/2004/02/skos/core#prefLabel",
                                      "http://www.w3.org/2000/01/rdf-schema#label",
                                      "prefLabel","label"):
                                v = d.get(k)
                                if isinstance(v, list) and v:
                                    x = v[0]
                                    if isinstance(x, dict):
                                        return x.get("@value") or x.get("value")
                                if isinstance(v, dict):
                                    return v.get("@value") or v.get("value")
                                if isinstance(v, str):
                                    return v
                            return None
                        if "@graph" in j and isinstance(j["@graph"], list):
                            for item in j["@graph"]:
                                if isinstance(item, dict):
                                    cand = extract(item)
                                    if cand:
                                        lbl = cand; break
                        else:
                            cand = extract(j)
                            if cand:
                                lbl = cand
                    out[u] = lbl or fallback_label_from_uri(u)
                except Exception:
                    out[u] = fallback_label_from_uri(u)
        idx += size; size = batch
        done = len([1 for u in uris[:min(idx,len(uris))] if u in out])
        print(f"[info] labels progress: {done}/{len(uris)} values")
    for u in uris:
        if u not in out:
            out[u] = fallback_label_from_uri(u)
    return out

def join_labels_for_track(value_list: List[str], label_map: Dict[str,str]) -> str:
    labels: List[str] = []
    for raw in value_list:
        parts = [p.strip() for p in (raw or "").split(";") if p.strip()]
        for p in parts:
            if p.startswith("http://") or p.startswith("https://"):
                labels.append(label_map.get(p, fallback_label_from_uri(p)))
            else:
                labels.append(p)
    seen=set(); out=[]
    for l in labels:
        if l not in seen:
            seen.add(l); out.append(l)
    return " | ".join(out)

import re, unicodedata

def _de_ascii(s: str) -> str:
    # Umlaute & ß → ASCII, diakritische Zeichen entfernen
    s = (s or "")
    s = (s
         .replace("Ä","AE").replace("Ö","OE").replace("Ü","UE")
         .replace("ä","ae").replace("ö","oe").replace("ü","ue")
         .replace("ß","ss"))
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s

def _slug_upper(s: str) -> str:
    s = _de_ascii(s)
    s = re.sub(r"[^A-Za-z0-9]+", "_", s)   # alles Nicht-Alphanum. → _
    s = re.sub(r"_+", "_", s).strip("_")   # Mehrfach-Underscores kürzen
    return s.upper()

def make_human_id(attribute_line: str, from_id: str, to_id: str, sol_uri: str) -> str:
    parts = []
    if attribute_line:
        parts.append(attribute_line)
    if from_id:
        parts.append(from_id)
    if to_id:
        parts.append(to_id)

    if not parts:
        # Fallback: URI-Fragment oder kurzer Hash
        fb = fallback_label_from_uri(sol_uri)
        fb = fb if fb else sha1(sol_uri)[:12]
        parts = [fb]

    # Sluggen und zusammenfügen
    parts = [_slug_upper(p) for p in parts if p]
    # Falls nach dem Sluggen doch alles leer ist → Hash
    return "_".join([p for p in parts if p]) or sha1(sol_uri)[:12]


# --- orchestrator ---

def export_sharded(iso3, outfile, sol_base, sol_prefixes,
                   page_size, min_page_size, timeout, retries,
                   ep_batch, ep_min, meta_batch, meta_min, op_batch, op_min,
                   trdir_batch, trdir_min, trprop_batch, trprop_min,
                   endpoint, csv_bom, skip_on_timeout,
                   limit_sols, label_batch, label_min,
                   *, api_client: TopologyAPIClient | None = None,
                   normalize_prefix: str | None = None,
                   normalize_fillchar: str = "0"):
    sink = SectionOfLineSink(
        outfile,
        csv_bom=csv_bom,
        api_client=api_client,
        normalize_prefix=normalize_prefix,
        normalize_fillchar=normalize_fillchar,
    )
    consumed = 0
    with requests.Session() as session:
        for pfx in sol_prefixes or [""]:
            if limit_sols and consumed >= limit_sols:
                break
            print(f"\n=== SHARD '{pfx or '*'}' ===")
            sol_ids = fetch_sol_ids_shard(session, iso3, sol_base, pfx, page_size, min_page_size, timeout, retries, endpoint, skip_on_timeout)
            if not sol_ids:
                print(f"[info] shard '{pfx or '*'}': 0 SoLs")
                continue

            sols_left = sol_ids
            if limit_sols:
                remain = limit_sols - consumed
                if remain <= 0:
                    break
                sols_left = sol_ids[:remain]

            endpoints = fetch_endpoints(session, sols_left, timeout, retries, endpoint, ep_batch, ep_min, skip_on_timeout)
            sols = [s for s in sols_left if s in endpoints and endpoints[s].get("opS") and endpoints[s].get("opE")]
            print(f"[info] shard '{pfx or '*'}': {len(sols)}/{len(sols_left)} SoLs with both ends")
            if not sols:
                continue

            # Meta
            meta_name   = fetch_meta_simple(session, sols, Q_META_NAME,   "name",      timeout, retries, endpoint, meta_batch, meta_min, skip_on_timeout)
            meta_owner  = fetch_meta_simple(session, sols, Q_META_OWNER,  "imCode",    timeout, retries, endpoint, meta_batch, meta_min, skip_on_timeout)
            meta_len    = fetch_meta_simple(session, sols, Q_META_LEN,    "len",       timeout, retries, endpoint, meta_batch, meta_min, skip_on_timeout)
            meta_nat    = fetch_meta_simple(session, sols, Q_META_NATLINE,"nat",       timeout, retries, endpoint, meta_batch, meta_min, skip_on_timeout)

            # OP info for FROM/TO + name fallback
            ops: List[str] = []
            for s in sols:
                e = endpoints.get(s) or {}
                if "opS" in e: ops.append(e["opS"])
                if "opE" in e: ops.append(e["opE"])
            op_info = fetch_op_info(session, ops, timeout, retries, endpoint, op_batch, op_min, skip_on_timeout)  # {op: (uopid, name)}

            # Tracks
            tr_dirs = fetch_track_dirs(session, sols, timeout, retries, endpoint, trdir_batch, trdir_min, skip_on_timeout)
            chosen_tr_by_sol={}
            for s in sols:
                t = pick_track(tr_dirs.get(s,[]))
                if t:
                    chosen_tr_by_sol[s] = bget(t,"tr")
            print(f"[info] chosen tracks: {len(chosen_tr_by_sol)}/{len(sols)}")

            all_tracks_by_sol = {s: [bget(b,"tr") for b in tr_dirs.get(s,[])] for s in sols}
            all_tracks = sorted({tr for lst in all_tracks_by_sol.values() for tr in lst if tr})
            tr_to_sol_all = {tr: s for s, lst in all_tracks_by_sol.items() for tr in lst}

            prop_patterns: Dict[str, List[str]] = {
                "classCat": [
                    " ?tr era:trackLoadCapability ?val . ",
                    " ?tr era:loadCapability/era:loadCapabilityLineCategory ?val . ",
                    " ?tr era:loadCapability ?val . ",
                ],
                "prot": [
                    " ?tr era:protectionLegacySystem ?val . ",
                    " ?tr era:trainProtectionLegacySystem ?val . ",
                ],
                "kv":    [ " ?tr era:profileNumberSwapBodies ?val . " ],
                "gauge": [ " ?tr era:wheelSetGauge ?val . " ],
                "vmax":  [ " ?tr era:maximumPermittedSpeed ?val . " ],
                "gsm":   [ " ?tr era:gsmRVersion ?val . " ],
                "etcs":  [ " ?tr era:etcsLevel ?val . " ],
                "tsiH":  [ " ?tr era:tsiPantographHead ?val . " ],
                "othH":  [ " ?tr era:otherPantographHead ?val . " ],
                "coLS":  [ " ?tr era:contactLineSystem ?val . " ],
                "peCF":  [ " ?tr era:permittedContactForce ?val . " ],
                "grPo":  [ " ?tr era:gradientProfile ?val . " ],
            }

            prop_values: Dict[str, Dict[str,List[str]]] = {}
            for key, pat_list in prop_patterns.items():
                vals_all = fetch_track_prop_any(session, all_tracks, pat_list, timeout, retries, endpoint, trprop_batch, trprop_min, skip_on_timeout)
                sol_map: Dict[str, List[str]] = {}
                for tr, vlist in vals_all.items():
                    s = tr_to_sol_all.get(tr)
                    if not s:
                        continue
                    dst = sol_map.setdefault(s, [])
                    for v in vlist:
                        if v not in dst:
                            dst.append(v)
                prop_values[key] = sol_map
                filled = sum(1 for s in sols if prop_values[key].get(s))
                print(f"[info] fill rate {key}: {filled}/{len(sols)} SoLs")

            # Collect URIs across props + natLine for label resolution
            concept_keys = ("classCat","prot","gauge","gsm","etcs","tsiH","othH","kv","coLS","peCF","grPo")
            concept_uris: List[str] = []
            for key in concept_keys:
                for vals in prop_values.get(key,{}).values():
                    for v in vals:
                        for p in (p.strip() for p in (v or "").split(";") if p.strip()):
                            if p.startswith("http://") or p.startswith("https://"):
                                concept_uris.append(p)
            # add national line URIs
            for s in sols:
                nat = (meta_nat.get(s,{}).get("nat",""))
                if nat and (nat.startswith("http://") or nat.startswith("https://")):
                    concept_uris.append(nat)
            seen=set(); uniq_uris=[]
            for u in concept_uris:
                if u not in seen:
                    seen.add(u); uniq_uris.append(u)

            labels_map = fetch_labels_for_uris(session, uniq_uris, timeout, retries, endpoint, label_batch, label_min, skip_on_timeout)

            # Output rows
            for s in sols:
                e = endpoints.get(s,{})

                owner  = (meta_owner.get(s,{}).get("imCode",""))
                length = (meta_len.get(s,{}).get("len",""))
                nat_uri= (meta_nat.get(s,{}).get("nat",""))
                nat_lbl= labels_map.get(nat_uri, nat_uri) if nat_uri else ""

                opS = e.get("opS",""); opE = e.get("opE","")
                uS, nS = op_info.get(opS, ("",""))
                uE, nE = op_info.get(opE, ("",""))

                def fallback_label_from_uri(u: str) -> str:
                    try:
                        path = urlparse(u).path
                        last = path.strip("/").split("/")[-1]
                        return unquote(last) or u
                    except Exception:
                        return u

                def choose_from_to(uopid: str, name: str, uri: str) -> str:
                    if uopid: return unquote(uopid)
                    if name:  return name
                    return fallback_label_from_uri(uri)

                from_id = choose_from_to(uS, nS, opS)
                to_id   = choose_from_to(uE, nE, opE)

                # NAME: SoL label or composed
                sol_name = (meta_name.get(s,{}).get("name","")).strip()
                if not sol_name:
                    composed = " – ".join([x for x in (nS or uS or "", nE or uE or "") if x])
                    sol_name = composed or fallback_label_from_uri(s)

                def prop_to_label(key: str) -> str:
                    vals = prop_values.get(key,{}).get(s, [])
                    return join_labels_for_track(vals, labels_map) if vals else ""

                classCat = prop_to_label("classCat"); kv = prop_to_label("kv"); gauge = prop_to_label("gauge")
                vmax     = join_labels_for_track(prop_values.get("vmax",{}).get(s, []), {})  # literals
                prot     = prop_to_label("prot");     gsm= prop_to_label("gsm"); etcs  = prop_to_label("etcs")
                tsiH     = prop_to_label("tsiH");     othH= prop_to_label("othH"); colS = prop_to_label("coLS")
                peCF     = prop_to_label("peCF");     grPo = prop_to_label("grPo")

                human_id = make_human_id(nat_lbl or (labels_map.get(nat_uri, nat_uri) if nat_uri else ""),
                         from_id, to_id, s)

                # not_active (compat) and active rows
                sink.write_csv_only([
                    "1900-01-01", human_id, sol_name, "true",
                    owner, iso3, from_id, to_id, length,
                    nat_lbl, classCat, kv, gauge, vmax, prot, gsm, etcs, tsiH, othH, colS, peCF, grPo, s
                ])
                vfrom = e.get("validFrom","") or "1900-01-01"
                sink.write([
                    vfrom, human_id, sol_name, "false",
                    owner, iso3, from_id, to_id, length,
                    nat_lbl, classCat, kv, gauge, vmax, prot, gsm, etcs, tsiH, othH, colS, peCF, grPo, s
                ])

            consumed += len(sols)
            print(f"[done] shard '{pfx or '*'}' processed {len(sols)} SoLs (total {sink.record_count})")

    sink.finish()
    if outfile:
        print(f"\n[done] wrote CSV to {outfile}")
    if api_client:
        print(f"[done] uploaded {sink.record_count} sections of line via API")

class SectionOfLineSink:
    EXCLUDED_ATTR_COLUMNS = {"validFrom"}

    def __init__(
        self,
        csv_path: str | None,
        *,
        csv_bom: bool,
        api_client: TopologyAPIClient | None,
        normalize_prefix: str | None,
        normalize_fillchar: str,
    ):
        self.api_client = api_client
        self.records: List[dict] = []
        self.record_count = 0
        self._normalize = build_normalizer(normalize_prefix, normalize_fillchar)
        self._file = None
        self._writer = None
        if csv_path:
            encoding = "utf-8-sig" if csv_bom else "utf-8"
            self._file = open(csv_path, "w", newline="", encoding=encoding)
            self._writer = csv.writer(
                self._file,
                delimiter=";",
                lineterminator="\n",
                quoting=csv.QUOTE_MINIMAL,
            )
            self._writer.writerow(CSV_HEADER)

    def write_csv_only(self, row: List[str]) -> None:
        if self._writer:
            self._writer.writerow(row)

    def write(self, row: List[str]) -> None:
        if self._writer:
            self._writer.writerow(row)
        converted = self._convert_row(row)
        self.records.append(converted)
        self.record_count += 1

    def finish(self) -> None:
        if self._file:
            self._file.close()
        if self.api_client and self.records:
            self.api_client.replace_sections_of_line(self.records)

    def _convert_row(self, row: List[str]) -> dict:
        row_dict = {CSV_HEADER[i]: row[i] if i < len(row) else "" for i in range(len(CSV_HEADER))}
        raw_id = row_dict.get("ID") or ""
        unique_sol_id = self._normalize(raw_id) or raw_id
        sol_uuid = str(uuid.uuid5(SOL_NAMESPACE, unique_sol_id))
        start_raw = row_dict.get("FROM") or ""
        end_raw = row_dict.get("TO") or ""
        start_id = self._normalize(start_raw) or start_raw
        end_id = self._normalize(end_raw) or end_raw
        length_val = row_dict.get("LENGTH")
        try:
            length_km = float(length_val) if length_val else None
        except ValueError:
            length_km = None

        record: dict = {
            "solId": sol_uuid,
            "uniqueSolId": unique_sol_id,
            "startUniqueOpId": start_id,
            "endUniqueOpId": end_id,
        }
        valid_from = row_dict.get("VALID_FROM") or ""
        attributes: List[dict] = []
        for key, value in row_dict.items():
            key_norm = normalize_attribute_key(key)
            if key_norm in self.EXCLUDED_ATTR_COLUMNS or key_norm == "validFrom":
                continue
            attr_value = value
            if key_norm == "id":
                attr_value = unique_sol_id
            elif key_norm == "from":
                key_norm = "startUniqueOpId"
                attr_value = start_id
            elif key_norm == "to":
                key_norm = "endUniqueOpId"
                attr_value = end_id
            elif key_norm == "length":
                key_norm = "lengthKm"
                attr_value = length_km if length_km is not None else value
            if attr_value is None or (isinstance(attr_value, str) and attr_value == ""):
                continue
            attr_dict = {"key": key_norm, "value": str(attr_value)}
            if valid_from:
                attr_dict["validFrom"] = valid_from
            attributes.append(attr_dict)

        nature_attr = {"key": "nature", "value": "REGULAR"}
        if valid_from:
            nature_attr["validFrom"] = valid_from
        attributes.append(nature_attr)

        if attributes:
            record["attributes"] = attributes
        return record

# --- CLI ---
def parse_prefixes(p: str) -> List[str]:
    if not p:
        return []
    return [x.strip() for x in p.split(",") if x.strip()]

def main():
    ap = argparse.ArgumentParser(description="Export ERA SoLs (All-in-One v1.4)")
    ap.add_argument("--country", required=True, help="ISO3, e.g. DEU")
    ap.add_argument("--outfile", help="Optional CSV Pfad (legacy).")
    ap.add_argument("--sol-base", default=SOL_BASE_DEFAULT)
    ap.add_argument("--sol-prefixes", default="")
    ap.add_argument("--page-size", type=int, default=1500)
    ap.add_argument("--min-page-size", type=int, default=300)
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--retries", type=int, default=7)

    ap.add_argument("--batch-endpoints", type=int, default=120)
    ap.add_argument("--min-batch-endpoints", type=int, default=40)

    ap.add_argument("--batch-meta", type=int, default=80)
    ap.add_argument("--min-batch-meta", type=int, default=10)

    ap.add_argument("--batch-opids", type=int, default=120)
    ap.add_argument("--min-batch-opids", type=int, default=40)

    ap.add_argument("--batch-track-dirs", type=int, default=120)
    ap.add_argument("--min-batch-track-dirs", type=int, default=40)

    ap.add_argument("--batch-track-prop", type=int, default=80)
    ap.add_argument("--min-batch-track-prop", type=int, default=30)

    ap.add_argument("--batch-labels", type=int, default=20)
    ap.add_argument("--min-batch-labels", type=int, default=5)

    ap.add_argument("--endpoint-url", default=SPARQL_ENDPOINT)
    ap.add_argument("--csv-bom", action="store_true")
    ap.add_argument("--skip-on-timeout", action="store_true")

    ap.add_argument("--limit-sols", type=int, default=0, help="process at most N SoLs (0=no limit)")
    ap.add_argument("--api-base", help="Backend API Basis (z. B. http://localhost:3000/api/v1). Defaults zu $TOPOLOGY_API_BASE.")
    ap.add_argument("--api-timeout", type=int, default=120)
    ap.add_argument("--import-source", default="era_sols_export")
    ap.add_argument("--skip-events", action="store_true")
    ap.add_argument("--normalize-prefix", help="Optionales Prefix zur Normalisierung (z. B. DE).")
    ap.add_argument("--normalize-fillchar", default="0")

    args = ap.parse_args()

    api_base = resolve_api_base(args.api_base)
    if not api_base and not args.outfile:
        ap.error("Either --outfile oder --api-base (oder TOPOLOGY_API_BASE) muss angegeben werden.")
    api_client = TopologyAPIClient(api_base, timeout=args.api_timeout) if api_base else None
    kinds = ["sections-of-line"]
    try:
        if api_client and not args.skip_events:
            api_client.send_event(
                "in-progress",
                kinds=kinds,
                message=f"SoL-Import {args.country.upper()} gestartet",
                source=args.import_source,
            )
        export_sharded(
            iso3=args.country.upper(),
            outfile=args.outfile,
            sol_base=args.sol_base,
            sol_prefixes=parse_prefixes(args.sol_prefixes),
            page_size=args.page_size, min_page_size=args.min_page_size,
            timeout=args.timeout, retries=args.retries,
            ep_batch=args.batch_endpoints, ep_min=args.min_batch_endpoints,
            meta_batch=args.batch_meta, meta_min=args.min_batch_meta,
            op_batch=args.batch_opids, op_min=args.min_batch_opids,
            trdir_batch=args.batch_track_dirs, trdir_min=args.min_batch_track_dirs,
            trprop_batch=args.batch_track_prop, trprop_min=args.min_batch_track_prop,
            endpoint=args.endpoint_url, csv_bom=args.csv_bom, skip_on_timeout=args.skip_on_timeout,
            limit_sols=args.limit_sols,
            label_batch=args.batch_labels, label_min=args.min_batch_labels,
            api_client=api_client,
            normalize_prefix=args.normalize_prefix,
            normalize_fillchar=args.normalize_fillchar,
        )
        if api_client and not args.skip_events:
            api_client.send_event(
                "succeeded",
                kinds=kinds,
                message=f"SoL-Import {args.country.upper()} abgeschlossen",
                source=args.import_source,
            )
    except Exception as exc:
        if api_client and not args.skip_events:
            api_client.send_event(
                "failed",
                kinds=kinds,
                message=f"SoL-Import fehlgeschlagen: {exc}",
                source=args.import_source,
            )
        raise


if __name__ == "__main__":
    main()
