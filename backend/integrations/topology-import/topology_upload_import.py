#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Callable, Dict, List, Optional

from topology_client import TopologyAPIClient, resolve_api_base

IMPORT_TARGETS: Dict[str, str] = {
    'operational-points': 'replace_operational_points',
    'sections-of-line': 'replace_sections_of_line',
    'station-areas': 'replace_station_areas',
    'tracks': 'replace_tracks',
    'platform-edges': 'replace_platform_edges',
    'platforms': 'replace_platforms',
    'sidings': 'replace_sidings',
}

VALIDITY_KEYS = {
    'validTo',
    'validToDate',
    'validToUtc',
    'validToTimestamp',
    'validUntil',
}


def read_json_payload(path: str) -> List[Dict[str, Any]]:
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        items = data.get('items')
        if isinstance(items, list):
            return items
    raise ValueError('Upload-Datei enthält weder JSON-Liste noch {items: [...]}')


def strip_invalid_validity(items: List[Dict[str, Any]]) -> None:
    for item in items:
        for key in list(item.keys()):
            if key in VALIDITY_KEYS:
                item.pop(key, None)


def resolve_import_method(client: TopologyAPIClient, kind: str) -> Callable[[List[Dict[str, Any]]], None]:
    method_name = IMPORT_TARGETS.get(kind)
    if not method_name:
        raise ValueError(f'Kein Importziel für Typ {kind} hinterlegt.')
    method = getattr(client, method_name, None)
    if not method:
        raise ValueError(f'Importziel {method_name} nicht im API-Client verfügbar.')
    return method


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Import uploaded topology JSON into backend.')
    parser.add_argument('--kind', required=True)
    parser.add_argument('--file', required=True)
    parser.add_argument('--api-base', dest='api_base')
    parser.add_argument('--import-source', dest='import_source')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_base = resolve_api_base(args.api_base)
    if not api_base:
        print('TOPOLOGY_API_BASE missing.', file=sys.stderr)
        return 2

    file_path = os.path.abspath(args.file)
    if not os.path.isfile(file_path):
        print(f'Upload-Datei nicht gefunden: {file_path}', file=sys.stderr)
        return 2

    client = TopologyAPIClient(api_base)

    try:
        items = read_json_payload(file_path)
    except Exception as exc:
        print(f'Fehler beim Lesen der Upload-Datei: {exc}', file=sys.stderr)
        return 2

    strip_invalid_validity(items)

    try:
        method = resolve_import_method(client, args.kind)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    total = len(items)
    print(f'Import starte: {args.kind} ({total} Datensaetze)')
    try:
        client.send_event(
            'in-progress',
            kinds=[args.kind],
            message=f'Upload-Import gestartet ({total} Datensaetze).',
            source=args.import_source or 'upload_import',
        )
    except Exception:
        pass

    start = time.time()
    try:
        method(items)
    except Exception as exc:
        print(f'Fehler beim API-Import: {exc}', file=sys.stderr)
        try:
            client.send_event(
                'failed',
                kinds=[args.kind],
                message=f'Upload-Import fehlgeschlagen: {exc}',
                source=args.import_source or 'upload_import',
            )
        except Exception:
            pass
        return 1

    duration = time.time() - start
    print(f'Import abgeschlossen in {duration:.1f}s')
    try:
        client.send_event(
            'succeeded',
            kinds=[args.kind],
            message=f'Upload-Import abgeschlossen ({total} Datensaetze, {duration:.1f}s).',
            source=args.import_source or 'upload_import',
        )
    except Exception:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
