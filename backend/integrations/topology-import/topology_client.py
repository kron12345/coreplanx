#!/usr/bin/env python3
from __future__ import annotations

import os
from typing import Any, Iterable, Optional, Sequence

import requests


class TopologyAPIClient:
    """Thin wrapper around the backend topology endpoints."""

    def __init__(self, base_url: str, timeout: int = 120):
        if not base_url:
            raise ValueError('base_url is required for TopologyAPIClient')
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout

    def replace_operational_points(self, items: Sequence[dict[str, Any]]) -> None:
        self._put('/planning/topology/operational-points', items)

    def replace_sections_of_line(self, items: Sequence[dict[str, Any]]) -> None:
        self._put('/planning/topology/sections-of-line', items)

    def send_event(
        self,
        status: str,
        *,
        kinds: Optional[Sequence[str]] = None,
        message: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        payload: dict[str, Any] = {'status': status}
        if kinds:
            payload['kinds'] = list(kinds)
        if message:
            payload['message'] = message
        if source:
            payload['source'] = source
        return self._post('/planning/topology/import/events', payload)

    def _put(self, path: str, items: Sequence[dict[str, Any]]) -> Optional[dict[str, Any]]:
        payload = {'items': list(items)}
        url = f"{self.base_url}{path}"
        resp = requests.put(url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        if resp.content:
            return resp.json()
        return None

    def _post(self, path: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
        url = f"{self.base_url}{path}"
        resp = requests.post(url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        if resp.content:
            return resp.json()
        return None


def resolve_api_base(cli_value: Optional[str]) -> Optional[str]:
    if cli_value:
        return cli_value
    env_value = os.getenv('TOPOLOGY_API_BASE')
    if env_value:
        return env_value
    return None
