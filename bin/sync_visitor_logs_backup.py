#!/usr/bin/env python3
"""Sync historical visitor logs from worker into local backup files."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_WORKER_BASE = "https://visitor-log-worker.jorgezuluaga.workers.dev"
DEFAULT_NDJSON = "info/visitor-logs-backup.ndjson"
DEFAULT_STATE = "info/visitor-logs-backup-state.json"
DEFAULT_SNAPSHOT = "info/visitor-logs-snapshot.json"
DEFAULT_USER_AGENT = "curl/8.0"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_existing_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    if not path.exists():
        return ids
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                continue
            rid = str(row.get("id") or row.get("_kvKey") or "").strip()
            if rid:
                ids.add(rid)
    return ids


def fetch_export_page(
    worker_base: str,
    token: str,
    cursor: str | None,
    limit: int,
    timeout: float,
    user_agent: str,
) -> dict:
    query = {"token": token, "limit": str(limit)}
    if cursor:
        query["cursor"] = cursor
    url = f"{worker_base.rstrip('/')}/logs-export?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", user_agent)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        if res.status != 200:
            raise RuntimeError(f"HTTP {res.status}")
        payload = json.loads(res.read().decode("utf-8"))
    if not isinstance(payload, dict) or not payload.get("ok"):
        raise RuntimeError(f"Respuesta inválida de logs-export: {payload}")
    return payload


def compute_snapshot(ndjson_path: Path, generated_at: str, worker_base: str) -> dict:
    total_events = 0
    unique_ips: set[str] = set()
    countries: set[str] = set()
    last_event_ts = ""
    if ndjson_path.exists():
        with ndjson_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                total_events += 1
                ip = str(row.get("ip") or "").strip()
                if ip:
                    unique_ips.add(ip)
                cc = str(row.get("country") or "").strip().upper()
                if len(cc) == 2:
                    countries.add(cc)
                ts = str(row.get("timestampServer") or "").strip()
                if ts and ts > last_event_ts:
                    last_event_ts = ts
    return {
        "generatedAt": generated_at,
        "source": worker_base.rstrip("/"),
        "totalEvents": total_events,
        "uniqueIps": len(unique_ips),
        "countries": len(countries),
        "lastEventTimestamp": last_event_ts,
        "notes": "Snapshot histórico desde backup local versionado en el repo.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync visitor logs from worker /logs-export to local backup files.",
    )
    parser.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    parser.add_argument("--token", default=os.getenv("LOG_READ_TOKEN", "").strip())
    parser.add_argument("--ndjson", default=DEFAULT_NDJSON)
    parser.add_argument("--state-json", default=DEFAULT_STATE)
    parser.add_argument("--snapshot-json", default=DEFAULT_SNAPSHOT)
    parser.add_argument("--limit", type=int, default=250, help="Page size for /logs-export (max 500).")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--max-pages", type=int, default=10000)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    args = parser.parse_args()

    if not args.token:
        raise SystemExit(
            "Falta token. Pásalo con --token TU_TOKEN o exporta LOG_READ_TOKEN.",
        )

    limit = max(1, min(500, int(args.limit)))
    max_pages = max(1, int(args.max_pages))
    ndjson_path = Path(args.ndjson)
    state_path = Path(args.state_json)
    snapshot_path = Path(args.snapshot_json)
    ndjson_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)

    state = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            state = {}
    cursor = str(state.get("nextCursor") or "").strip() or None

    existing_ids = load_existing_ids(ndjson_path)
    known_before = len(existing_ids)
    appended = 0
    fetched_logs = 0
    pages = 0
    reached_end = False

    with ndjson_path.open("a", encoding="utf-8") as out:
        while pages < max_pages:
            pages += 1
            try:
                payload = fetch_export_page(
                    worker_base=args.worker_base,
                    token=args.token,
                    cursor=cursor,
                    limit=limit,
                    timeout=args.timeout,
                    user_agent=args.user_agent,
                )
            except urllib.error.HTTPError as err:
                raise SystemExit(f"Error HTTP al consultar /logs-export: {err.code}") from err
            except urllib.error.URLError as err:
                raise SystemExit(f"Error de red al consultar /logs-export: {err}") from err
            except TimeoutError as err:
                raise SystemExit(f"Timeout al consultar /logs-export: {err}") from err

            logs = payload.get("logs")
            if not isinstance(logs, list):
                raise SystemExit("Respuesta inválida: 'logs' no es una lista.")
            fetched_logs += len(logs)

            for row in logs:
                if not isinstance(row, dict):
                    continue
                row_id = str(row.get("id") or row.get("_kvKey") or "").strip()
                if not row_id or row_id in existing_ids:
                    continue
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                existing_ids.add(row_id)
                appended += 1

            next_cursor = payload.get("nextCursor")
            list_complete = bool(payload.get("listComplete"))
            cursor = str(next_cursor or "").strip() or None
            print(
                f"Página {pages}: fetched={len(logs)} appended={appended} "
                f"cursor={'end' if not cursor else '...'}",
                flush=True,
            )
            if list_complete or not cursor:
                reached_end = True
                break

    generated_at = now_iso()
    state_payload = {
        "generatedAt": generated_at,
        "workerBase": args.worker_base.rstrip("/"),
        "nextCursor": cursor if not reached_end else "",
        "reachedEnd": reached_end,
        "pagesFetched": pages,
        "fetchedLogsThisRun": fetched_logs,
        "appendedLogsThisRun": appended,
        "knownLogsBeforeRun": known_before,
        "knownLogsAfterRun": len(existing_ids),
    }
    state_path.write_text(
        json.dumps(state_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    snapshot_payload = compute_snapshot(
        ndjson_path=ndjson_path,
        generated_at=generated_at,
        worker_base=args.worker_base,
    )
    snapshot_path.write_text(
        json.dumps(snapshot_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        "Sync completado: "
        f"pages={pages} fetched={fetched_logs} appended={appended} "
        f"known={len(existing_ids)} end={reached_end}",
        flush=True,
    )
    print(f"Backup: {ndjson_path}", flush=True)
    print(f"Snapshot: {snapshot_path}", flush=True)
    print(f"Estado: {state_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
