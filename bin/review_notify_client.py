#!/usr/bin/env python3
"""Cliente del worker de suscripción a reseñas."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from review_notify_secrets import load_secret

REPO = Path(__file__).resolve().parent.parent
DEFAULT_WORKER = "https://review-notify-worker.jorgezuluaga.workers.dev"


def load_token() -> str:
    return load_secret("review-notify-token")


def worker_base() -> str:
    try:
        return load_secret("review-notify-worker-url").rstrip("/")
    except FileNotFoundError:
        return DEFAULT_WORKER


def api_request(
    method: str,
    path: str,
    *,
    body: dict | None = None,
    token: str = "",
) -> dict:
    url = f"{worker_base()}{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "jorgezuluaga-review-notify/1.0 (library-sync)",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                payload.setdefault("ok", False)
                payload["_http_status"] = err.code
                return payload
        except json.JSONDecodeError:
            pass
        raise RuntimeError(f"HTTP {err.code}: {raw}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Error de red: {err}") from err
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "raw": raw}


def seed_subscribers(emails: list[str]) -> dict:
    token = load_token()
    return api_request("POST", "/admin/seed", body={"emails": emails}, token=token)


def list_subscribers() -> dict:
    token = load_token()
    return api_request("GET", "/admin/subscribers", token=token)


def list_subscriber_emails() -> list[str]:
    result = list_subscribers()
    if not result.get("ok"):
        raise RuntimeError(json.dumps(result, ensure_ascii=False))
    emails = result.get("emails")
    if isinstance(emails, list):
        return [str(e) for e in emails if e]
    return [
        str(s.get("email"))
        for s in result.get("subscribers", [])
        if isinstance(s, dict) and s.get("email")
    ]


def dedupe_subscribers() -> dict:
    token = load_token()
    return api_request("POST", "/admin/dedupe", body={}, token=token)


def unsubscribe_subscriber(email: str) -> dict:
    token = load_token()
    return api_request("POST", "/admin/unsubscribe", body={"email": email}, token=token)


def subscribe_email(email: str) -> dict:
    return api_request("POST", "/subscribe", body={"email": email})


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: review_notify_client.py seed|list|list-emails|subscribe|unsubscribe|dedupe EMAIL", file=sys.stderr)
        return 1
    cmd = sys.argv[1]
    if cmd == "seed":
        emails = sys.argv[2:]
        if not emails:
            print("Indique emails.", file=sys.stderr)
            return 1
        print(json.dumps(seed_subscribers(emails), indent=2, ensure_ascii=False))
        return 0
    if cmd == "list":
        print(json.dumps(list_subscribers(), indent=2, ensure_ascii=False))
        return 0
    if cmd == "list-emails":
        for email in list_subscriber_emails():
            print(email)
        return 0
    if cmd == "dedupe":
        print(json.dumps(dedupe_subscribers(), indent=2, ensure_ascii=False))
        return 0
    if cmd == "unsubscribe":
        if len(sys.argv) < 3:
            print("Indique email.", file=sys.stderr)
            return 1
        result = unsubscribe_subscriber(sys.argv[2])
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    if cmd == "subscribe":
        if len(sys.argv) < 3:
            print("Indique email.", file=sys.stderr)
            return 1
        print(json.dumps(subscribe_email(sys.argv[2]), indent=2, ensure_ascii=False))
        return 0
    print(f"Comando desconocido: {cmd}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
