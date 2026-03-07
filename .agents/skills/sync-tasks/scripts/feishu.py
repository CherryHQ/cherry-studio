#!/usr/bin/env python3
"""Feishu (Lark) Bitable API client.

Standalone module using only Python stdlib. Provides auth, wiki resolution,
field listing, record CRUD, and field-value formatting helpers.

Usage:
    from feishu import FeishuClient

    client = FeishuClient()  # reads FEISHU_TENANT_TOKEN from env
    app_token = client.get_bitable_app_token(wiki_token)
    records = client.list_records(app_token, table_id)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = "https://open.feishu.cn/open-apis"


class FeishuError(Exception):
    """Raised when a Feishu API call returns a non-zero code."""

    def __init__(self, code: int, msg: str):
        self.code = code
        super().__init__(f"Feishu API error {code}: {msg}")


class FeishuClient:
    """Minimal Feishu Bitable API client (stdlib only, no pip deps)."""

    def __init__(self, tenant_token: str | None = None):
        self.tenant_token = tenant_token or os.environ.get("FEISHU_TENANT_TOKEN", "")
        if not self.tenant_token:
            raise ValueError(
                "FEISHU_TENANT_TOKEN env var is required. "
                "Get one via /open-apis/auth/v3/tenant_access_token/internal"
            )

    # ------------------------------------------------------------------
    # Low-level HTTP
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        params: dict | None = None,
    ) -> dict:
        url = f"{BASE_URL}{path}"
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            if qs:
                url = f"{url}?{qs}"

        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.tenant_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            body_bytes = exc.read()
            try:
                err = json.loads(body_bytes.decode())
                raise FeishuError(err.get("code", exc.code), err.get("msg", str(exc)))
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise FeishuError(exc.code, str(exc))

        if result.get("code", 0) != 0:
            raise FeishuError(result["code"], result.get("msg", "unknown error"))
        return result.get("data", {})

    def _get(self, path: str, params: dict | None = None) -> dict:
        return self._request("GET", path, params=params)

    def _post(self, path: str, body: dict | None = None) -> dict:
        return self._request("POST", path, body=body)

    def _patch(self, path: str, body: dict | None = None) -> dict:
        return self._request("PATCH", path, body=body)

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    @staticmethod
    def get_tenant_token(app_id: str, app_secret: str) -> str:
        """Exchange app credentials for a tenant_access_token (2h TTL)."""
        url = f"{BASE_URL}/auth/v3/tenant_access_token/internal"
        data = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode()
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
        if result.get("code", 0) != 0:
            raise FeishuError(result["code"], result.get("msg", "auth failed"))
        return result["tenant_access_token"]

    # ------------------------------------------------------------------
    # Wiki / Bitable resolution
    # ------------------------------------------------------------------

    def get_bitable_app_token(self, wiki_token: str) -> str:
        """Resolve a wiki node token to the Bitable app_token (obj_token)."""
        data = self._get(f"/wiki/v2/spaces/get_node", params={"token": wiki_token})
        node = data.get("node", {})
        obj_token = node.get("obj_token")
        if not obj_token:
            raise FeishuError(0, f"No obj_token found for wiki node {wiki_token}")
        return obj_token

    # ------------------------------------------------------------------
    # Fields
    # ------------------------------------------------------------------

    def list_fields(self, app_token: str, table_id: str) -> list[dict]:
        """Return all field definitions for a table."""
        data = self._get(f"/bitable/v1/apps/{app_token}/tables/{table_id}/fields")
        return data.get("items", [])

    # ------------------------------------------------------------------
    # Records (auto-paginate)
    # ------------------------------------------------------------------

    def list_records(
        self,
        app_token: str,
        table_id: str,
        filter_expr: str | None = None,
        page_size: int = 500,
    ) -> list[dict]:
        """Fetch all records from a table, auto-paginating."""
        records: list[dict] = []
        page_token: str | None = None

        while True:
            params: dict[str, Any] = {"page_size": str(page_size)}
            if page_token:
                params["page_token"] = page_token
            if filter_expr:
                params["filter"] = filter_expr

            data = self._get(
                f"/bitable/v1/apps/{app_token}/tables/{table_id}/records",
                params=params,
            )
            items = data.get("items", [])
            records.extend(items)

            if not data.get("has_more"):
                break
            page_token = data.get("page_token")

        return records

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def batch_update(
        self, app_token: str, table_id: str, records: list[dict]
    ) -> dict:
        """Batch update records. Each record: {"record_id": ..., "fields": {...}}."""
        return self._post(
            f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update",
            body={"records": records},
        )

    def batch_create(
        self, app_token: str, table_id: str, records: list[dict]
    ) -> dict:
        """Batch create records. Each record: {"fields": {...}}."""
        return self._post(
            f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create",
            body={"records": records},
        )

    # ------------------------------------------------------------------
    # Field-value formatting helpers
    # ------------------------------------------------------------------

    @staticmethod
    def url_field(text: str, link: str) -> dict:
        """Format a URL-type field value."""
        return {"text": text, "link": link}

    @staticmethod
    def link_record(record_id: str) -> list[str]:
        """Format a linked-record field value (list of record IDs)."""
        return [record_id]

    @staticmethod
    def text_field(text: str) -> str:
        """Format a plain text field value."""
        return text


# ------------------------------------------------------------------
# CLI: quick connectivity test
# ------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python feishu.py <wiki_token> <table_id>")
        print("  Requires FEISHU_TENANT_TOKEN env var")
        sys.exit(1)

    wiki_token = sys.argv[1]
    table_id = sys.argv[2]

    client = FeishuClient()
    app_token = client.get_bitable_app_token(wiki_token)
    print(f"Resolved app_token: {app_token}")

    fields = client.list_fields(app_token, table_id)
    print(f"\nFields ({len(fields)}):")
    for f in fields:
        print(f"  {f['field_name']} ({f['type']}) - {f['field_id']}")

    records = client.list_records(app_token, table_id)
    print(f"\nRecords: {len(records)}")
