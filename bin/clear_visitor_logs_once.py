#!/usr/bin/env python3
"""One-shot script to clear all visitor logs from Cloudflare KV."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys


def run_cmd(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = proc.stderr.strip() or proc.stdout.strip() or "Unknown error"
        raise RuntimeError(msg)
    return proc.stdout


def list_keys(binding: str, remote: bool) -> list[str]:
    cmd = ["wrangler", "kv", "key", "list", "--binding", binding]
    cmd.append("--remote" if remote else "--local")
    raw = run_cmd(cmd)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Could not parse key list JSON: {err}") from err
    names = [item.get("name", "") for item in data if isinstance(item, dict)]
    return [name for name in names if name]


def delete_key(binding: str, key: str, remote: bool) -> None:
    cmd = ["wrangler", "kv", "key", "delete", key, "--binding", binding]
    cmd.append("--remote" if remote else "--local")
    run_cmd(cmd)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Delete all keys from a KV binding (one-shot cleanup).",
    )
    parser.add_argument(
        "--binding",
        default="VISITOR_LOGS",
        help="KV binding name in wrangler.toml (default: VISITOR_LOGS).",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="Delete from local KV storage instead of remote.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip confirmation prompt.",
    )
    args = parser.parse_args()

    remote = not args.local
    where = "remote" if remote else "local"
    binding = args.binding

    keys = list_keys(binding=binding, remote=remote)
    print(f"Found {len(keys)} keys in {where} binding '{binding}'.")
    if not keys:
        print("Nothing to delete.")
        return 0

    if not args.yes:
        answer = input("Delete ALL keys? Type 'yes' to continue: ").strip().lower()
        if answer != "yes":
            print("Cancelled.")
            return 0

    deleted = 0
    for i, key in enumerate(keys, start=1):
        delete_key(binding=binding, key=key, remote=remote)
        deleted += 1
        if i % 50 == 0 or i == len(keys):
            print(f"Deleted {i}/{len(keys)}...")

    print(f"Done. Deleted {deleted} keys from {where} binding '{binding}'.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as err:
        print(f"Error: {err}", file=sys.stderr)
        raise SystemExit(1)

