#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import json
import lzma
from dataclasses import dataclass
from typing import Dict, Any, Iterable, List, Tuple

from dotenv import load_dotenv
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from pyoxigraph import parse, RdfFormat

RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"
ERA = "http://data.europa.eu/949/"
ERA_OP = ERA + "OperationalPoint"
ERA_IN_COUNTRY = ERA + "inCountry"

@dataclass(frozen=True)
class Cfg:
    db_url: str
    path: str
    batch: int

def cfg() -> Cfg:
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    path = os.getenv("ERA_NQ_XZ")
    batch = int(os.getenv("BATCH_SIZE", "5000"))
    if not db_url:
        raise SystemExit("Missing DATABASE_URL")
    if not path:
        raise SystemExit("Missing ERA_NQ_XZ")
    return Cfg(db_url, path, batch)

def q_to_str(term) -> str:
    # pyoxigraph terms stringify already as IRI strings for NamedNode
    return str(term)

def open_quads_xz(path: str):
    # Stream: lzma.open liefert einen File-Stream; pyoxigraph.parse kann input=BinaryIO nehmen
    f = lzma.open(path, "rb")
    return f

def pass1_register_ops(conn: psycopg.Connection, path: str, batch: int) -> int:
    """
    Pass 1:
    - Finde alle Quads mit (s rdf:type era:OperationalPoint)
    - Upsert op_uri in operational_points (data bleibt leer)
    """
    upsert_sql = """
        insert into operational_points (op_uri, data)
        values (%s, '{}'::jsonb)
        on conflict (op_uri) do nothing
    """

    total = 0
    buf: List[Tuple[str]] = []

    with open_quads_xz(path) as f:
        for quad in parse(input=f, format=RdfFormat.N_QUADS):
            s = q_to_str(quad.subject)
            p = q_to_str(quad.predicate)
            o = q_to_str(quad.object)

            if p == RDF_TYPE and o == ERA_OP:
                buf.append((s,))
                if len(buf) >= batch:
                    with conn.cursor() as cur:
                        cur.executemany(upsert_sql, buf)
                    conn.commit()
                    total += len(buf)
                    print(f"[pass1] registered OPs: {total}")
                    buf.clear()

    if buf:
        with conn.cursor() as cur:
            cur.executemany(upsert_sql, buf)
        conn.commit()
        total += len(buf)
        print(f"[pass1] registered OPs: {total}")

    return total

def pass2_update_ops(conn: psycopg.Connection, path: str, batch: int) -> int:
    """
    Pass 2:
    - Sammle label & inCountry für Subjects, die in operational_points existieren
    - Schreibe in Batch über eine TEMP staging table + join-update
    """
    with conn.cursor() as cur:
        cur.execute("create temporary table if not exists op_stage (op_uri text primary key, data jsonb) on commit drop;")
        conn.commit()

    def flush(stage: Dict[str, Dict[str, Any]]) -> int:
        if not stage:
            return 0

        rows = [(k, json.dumps(v, ensure_ascii=False)) for k, v in stage.items()]

        with conn.cursor() as cur:
            cur.execute("truncate op_stage;")
            cur.executemany(
                "insert into op_stage (op_uri, data) values (%s, %s::jsonb) on conflict (op_uri) do update set data = excluded.data",
                rows
            )
            # Update nur wo OP existiert
            cur.execute("""
                update operational_points op
                set data = op.data || s.data
                from op_stage s
                where op.op_uri = s.op_uri
            """)
        conn.commit()
        return len(stage)

    total = 0
    stage: Dict[str, Dict[str, Any]] = {}

    # Optimierung: wir updaten nur, wenn Subject "NamedNode" ist
    with open_quads_xz(path) as f:
        for quad in parse(input=f, format=RdfFormat.N_QUADS):
            s = q_to_str(quad.subject)
            p = q_to_str(quad.predicate)

            if p not in (RDFS_LABEL, ERA_IN_COUNTRY):
                continue

            # Wir wollen nicht für jedes Quad eine DB-Abfrage.
            # Trick: erst sammeln, dann beim flush per join-update anwenden.
            obj = q_to_str(quad.object)

            d = stage.get(s)
            if d is None:
                d = {}
                stage[s] = d

            if p == RDFS_LABEL:
                # optional: Sprach-Tags kommen in N-Quads als Literal; pyoxigraph str() enthält die Lexicalform.
                # Wenn du Sprache brauchst, erweitern wir später.
                d["label"] = obj.strip('"')
            elif p == ERA_IN_COUNTRY:
                d["country"] = obj

            if len(stage) >= batch:
                total += flush(stage)
                print(f"[pass2] staged OP updates: {total}")
                stage.clear()

    if stage:
        total += flush(stage)
        print(f"[pass2] staged OP updates: {total}")

    return total

def run() -> int:
    c = cfg()
    print(f"[era-single] file={c.path}")
    print("[era-single] Using 2-pass streaming import (no full decompression)")

    with psycopg.connect(c.db_url) as conn:
        conn.execute("select 1")
        n1 = pass1_register_ops(conn, c.path, c.batch)
        n2 = pass2_update_ops(conn, c.path, c.batch)

    print(f"[era-single] DONE. pass1={n1} ops registered, pass2={n2} ops updated (batch-count)")
    return 0

if __name__ == "__main__":
    raise SystemExit(run())
