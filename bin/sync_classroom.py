from __future__ import annotations

import json
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Read-only scopes for courses + student rosters (enrollment count)
SCOPES = [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
]

REPO_ROOT = Path(__file__).resolve().parents[1]

# Keep secrets/tokens under sources/ (not under assets/ nor info/)
SOURCES_DIR = REPO_ROOT / "sources"
CREDENTIALS_FILE = (
    SOURCES_DIR
    / "client_secret_428987713773-mrmi23qivei68mp2ir9l5r73iidfk2rl.apps.googleusercontent.com.json"
)
TOKEN_FILE = SOURCES_DIR / "token_classroom.json"

# Single source of truth for the site
OUTPUT_FILE = REPO_ROOT / "info" / "teaching-classroom.json"


def get_credentials() -> Credentials:
    creds: Credentials | None = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), SCOPES
            )
            # OAuth via local server, without auto-opening a browser.
            # The URL will be printed in the terminal; open it manually.
            creds = flow.run_local_server(
                host="127.0.0.1",
                port=0,
                open_browser=False,
            )
        TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    return creds


def list_courses(service) -> list[dict]:
    courses: list[dict] = []
    page_token: str | None = None
    while True:
        resp = (
            service.courses()
            .list(
                teacherId="me",
                pageSize=100,
                pageToken=page_token,
            )
            .execute()
        )
        courses.extend(resp.get("courses", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return courses


def count_students(service, course_id: str) -> int:
    total = 0
    page_token: str | None = None
    while True:
        resp = (
            service.courses()
            .students()
            .list(
                courseId=course_id,
                pageSize=100,
                pageToken=page_token,
            )
            .execute()
        )
        total += len(resp.get("students", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return total


def main() -> None:
    if not CREDENTIALS_FILE.exists():
        raise SystemExit(f"No se encontró el archivo de credenciales: {CREDENTIALS_FILE}")

    creds = get_credentials()
    service = build("classroom", "v1", credentials=creds, cache_discovery=False)

    print("Obteniendo cursos de Google Classroom…")
    raw_courses = list_courses(service)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    data: list[dict] = []
    for c in raw_courses:
        course_id = c.get("id")
        enrolled = 0
        if course_id:
            try:
                enrolled = count_students(service, course_id)
            except Exception as e:
                print(f"[ADVERTENCIA] No se pudo contar estudiantes de {course_id}: {e}")

        data.append(
            {
                "id": course_id,
                "name": c.get("name"),
                "section": c.get("section"),
                "subject": c.get("subject"),
                "creationTime": c.get("creationTime"),
                "courseState": c.get("courseState"),
                "enrollmentCount": enrolled,
            }
        )

    data.sort(key=lambda x: x.get("creationTime") or "", reverse=True)

    OUTPUT_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"OK: {len(data)} cursos guardados en {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

