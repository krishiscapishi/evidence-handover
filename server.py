"""Small, dependency-free server for the Evidence Handover demo."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("HANDOVER_DB", ROOT / "handover.db"))
MAX_BODY = 4_000_000
KINDS = {"decision", "task", "risk", "dependency", "question"}

DEMO_FILES = [
    {
        "name": "meeting-notes.md",
        "content": """# Atlas launch handover\n\nDECISION: Keep the first launch limited to the university pilot; the team agreed on 14 October.\nTASK: Maya will prepare the pilot onboarding guide by 6 November.\nRISK: The analytics export is delayed because the vendor has not confirmed access.\nQUESTION: Who will own support after the first week?\n""",
    },
    {
        "name": "work-items.csv",
        "content": """id,work item,owner,status\nA-12,Confirm pilot access with vendor,Noah,Blocked\nA-18,Review onboarding guide,Maya,Open\nA-21,Publish support rota,Unassigned,Open\n""",
    },
    {
        "name": "decision-log.md",
        "content": """# Decision log\n\nDECISION: Use the existing university sign-in for the pilot instead of building a new account flow.\nDEPENDENCY: The pilot announcement depends on vendor access being confirmed.\nTASK: Noah will share the vendor response in the project channel when it arrives.\n""",
    },
]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                approved INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                content TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'needs_review'
            );
            """
        )


def active_project(db: sqlite3.Connection) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM projects ORDER BY id DESC LIMIT 1").fetchone()


def state(db: sqlite3.Connection) -> dict[str, Any]:
    project = active_project(db)
    if not project:
        llm_ready = all(os.environ.get(name) for name in ("LLM_API_BASE_URL", "LLM_API_KEY", "LLM_MODEL"))
        return {"project": None, "sources": [], "items": [], "llm_configured": llm_ready}
    sources = [dict(row) for row in db.execute(
        "SELECT id, name, length(content) AS characters FROM sources WHERE project_id=? ORDER BY id",
        (project["id"],),
    )]
    items = [dict(row) for row in db.execute(
        "SELECT i.*, s.name AS source_name FROM items i LEFT JOIN sources s ON s.id=i.source_id "
        "WHERE i.project_id=? ORDER BY i.id",
        (project["id"],),
    )]
    return {
        "project": {"id": project["id"], "name": project["name"], "approved": bool(project["approved"])},
        "sources": sources,
        "items": items,
        "llm_configured": all(os.environ.get(name) for name in ("LLM_API_BASE_URL", "LLM_API_KEY", "LLM_MODEL")),
    }


def add_project(db: sqlite3.Connection, name: str) -> int:
    db.execute("DELETE FROM projects")
    cursor = db.execute(
        "INSERT INTO projects(name, created_at, approved) VALUES (?, ?, 0)",
        (name[:100] or "Untitled handover", datetime.now(timezone.utc).isoformat()),
    )
    return int(cursor.lastrowid)


def add_source(db: sqlite3.Connection, project_id: int, name: str, content: str) -> int:
    cursor = db.execute(
        "INSERT INTO sources(project_id, name, content) VALUES (?, ?, ?)",
        (project_id, name[:160], content[:1_500_000]),
    )
    return int(cursor.lastrowid)


def source_rows(db: sqlite3.Connection, project_id: int) -> list[sqlite3.Row]:
    return list(db.execute("SELECT * FROM sources WHERE project_id=? ORDER BY id", (project_id,)))


def lexical_candidates(sources: list[sqlite3.Row]) -> list[dict[str, Any]]:
    """Extract labeled evidence, with a conservative keyword fallback."""
    candidates: list[dict[str, Any]] = []
    labels = {
        "decision": "decision",
        "task": "task",
        "risk": "risk",
        "dependency": "dependency",
        "question": "question",
    }
    for source in sources:
        lines = source["content"].splitlines()
        for number, raw in enumerate(lines, 1):
            line = raw.strip().lstrip("-* ").strip()
            if not line:
                continue
            match = re.match(r"(?i)^(decision|task|risk|dependency|question)\s*:\s*(.+)$", line)
            kind = labels[match.group(1).lower()] if match else ""
            text = match.group(2).strip() if match else line
            if not kind:
                if re.search(r"\b(blocked|risk|delay|at risk|could slip)\b", line, re.I):
                    kind = "risk"
                elif re.search(r"\b(depends on|dependency|blocked by|needs? .* before)\b", line, re.I):
                    kind = "dependency"
                elif "?" in line:
                    kind = "question"
                elif re.search(r"\b(decided|decision|agreed|will use|chose)\b", line, re.I):
                    kind = "decision"
                elif re.search(r"\b(will|must|todo|to-do|owner|due)\b", line, re.I):
                    kind = "task"
            if not kind:
                continue
            candidates.append({
                "kind": kind,
                "content": text[:500],
                "source_id": source["id"],
                "start_line": number,
                "end_line": number,
            })
    return candidates[:60]


def tokenize(text: str) -> set[str]:
    return {word.lower() for word in re.findall(r"[a-zA-Z0-9]{3,}", text)}


def retrieve_chunks(sources: list[sqlite3.Row]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for source in sources:
        lines = source["content"].splitlines()
        for start in range(0, len(lines), 6):
            part = lines[start:start + 6]
            text = "\n".join(part).strip()
            if text:
                chunks.append({
                    "ref": f"S{source['id']}",
                    "source_id": source["id"],
                    "name": source["name"],
                    "start_line": start + 1,
                    "end_line": start + len(part),
                    "text": text,
                })
    # Rank source chunks by lexical overlap with the handover topics.
    query = tokenize("project handover decisions tasks owners due dates risks dependencies unanswered questions blockers")
    for chunk in chunks:
        words = tokenize(chunk["text"])
        chunk["score"] = len(words & query) / max(1, len(words))
        chunk["text"] = chunk["text"][:1800]
    return sorted(chunks, key=lambda item: item["score"], reverse=True)[:12]


def call_llm(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base = os.environ.get("LLM_API_BASE_URL", "").rstrip("/")
    key = os.environ.get("LLM_API_KEY", "")
    model = os.environ.get("LLM_MODEL", "")
    if not (base and key and model):
        raise RuntimeError("LLM_API_BASE_URL, LLM_API_KEY and LLM_MODEL are needed to enable AI extraction.")
    context = "\n\n".join(
        f"[{item['ref']}] {item['name']} lines {item['start_line']}-{item['end_line']}\n{item['text']}"
        for item in chunks
    )
    prompt = (
        "Extract only useful project handover facts supported directly by the evidence below. "
        "Return a JSON array, no markdown. Each object must have kind (decision, task, risk, dependency, question), "
        "content, source_ref (one supplied S id), start_line, end_line. Keep items concise. "
        "Do not infer missing owners or dates. If a fact is uncertain or conflicting, use kind question and say why. "
        "Return [] when nothing is supported.\n\nEVIDENCE:\n" + context
    )
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "You produce source-grounded project handover drafts. Never invent evidence."},
            {"role": "user", "content": prompt},
        ],
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        result = json.loads(response.read().decode("utf-8"))
    raw = result["choices"][0]["message"]["content"]
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.I)
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("The model response was not a JSON list.")
    ref_map = {chunk["ref"]: chunk for chunk in chunks}
    normalized = []
    for row in parsed[:60]:
        if not isinstance(row, dict) or row.get("kind") not in KINDS or not str(row.get("content", "")).strip():
            continue
        chunk = ref_map.get(str(row.get("source_ref", "")))
        if not chunk:
            continue
        start = max(chunk["start_line"], min(int(row.get("start_line", chunk["start_line"])), chunk["end_line"]))
        end = max(start, min(int(row.get("end_line", start)), chunk["end_line"]))
        normalized.append({
            "kind": row["kind"],
            "content": str(row["content"]).strip()[:500],
            "source_id": chunk["source_id"],
            "start_line": start,
            "end_line": end,
        })
    return normalized


class Handler(BaseHTTPRequestHandler):
    server_version = "EvidenceHandover/1.0"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, value: Any, status: int = 200) -> None:
        data = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY:
            raise ValueError("Request is too large. Keep uploads under 2 MB for this demo.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            with connect() as db:
                self.send_json(state(db))
            return
        source_match = re.fullmatch(r"/api/sources/(\d+)", path)
        if source_match:
            with connect() as db:
                project = active_project(db)
                source = db.execute(
                    "SELECT id, name, content FROM sources WHERE id=? AND project_id=?",
                    (int(source_match.group(1)), project["id"] if project else -1),
                ).fetchone()
                if not source:
                    self.send_json({"error": "Source not found"}, 404)
                else:
                    self.send_json(dict(source))
            return
        if path == "/api/health":
            self.send_json({"ok": True})
            return
        asset = {"/": "index.html", "/styles.css": "styles.css", "/app.js": "app.js"}.get(path)
        if asset:
            data = (ROOT / asset).read_bytes()
            content_type = "text/html; charset=utf-8" if asset.endswith("html") else "text/css; charset=utf-8" if asset.endswith("css") else "text/javascript; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json({"error": "Not found"}, 404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
            with connect() as db:
                if path == "/api/demo":
                    project_id = add_project(db, "Atlas university pilot")
                    ids = [add_source(db, project_id, row["name"], row["content"]) for row in DEMO_FILES]
                    for item in lexical_candidates(source_rows(db, project_id)):
                        db.execute(
                            "INSERT INTO items(project_id, kind, content, source_id, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
                            (project_id, item["kind"], item["content"], item["source_id"], item["start_line"], item["end_line"]),
                        )
                    db.commit()
                    self.send_json(state(db))
                    return
                if path == "/api/project":
                    project_id = add_project(db, str(payload.get("name", "Untitled handover")))
                    db.commit()
                    self.send_json(state(db), 201)
                    return
                if path == "/api/sources":
                    project = active_project(db)
                    if not project:
                        project_id = add_project(db, str(payload.get("project_name", "Untitled handover")))
                    else:
                        project_id = int(project["id"])
                    files = payload.get("files", [])
                    if not isinstance(files, list) or not files:
                        raise ValueError("Choose at least one text, Markdown or CSV file.")
                    total = 0
                    for row in files:
                        name = Path(str(row.get("name", "source.txt"))).name
                        if Path(name).suffix.lower() not in {".txt", ".md", ".csv"}:
                            raise ValueError("This demo accepts .txt, .md and .csv files.")
                        content = str(row.get("content", ""))
                        total += len(content.encode("utf-8"))
                        if not content.strip():
                            continue
                        add_source(db, project_id, name, content)
                    if total > 1_500_000:
                        raise ValueError("Keep the combined upload under 1.5 MB.")
                    db.execute("UPDATE projects SET approved=0 WHERE id=?", (project_id,))
                    db.execute("DELETE FROM items WHERE project_id=?", (project_id,))
                    db.commit()
                    self.send_json(state(db), 201)
                    return
                if path == "/api/generate":
                    project = active_project(db)
                    if not project:
                        raise ValueError("Create a project and add source files first.")
                    sources = source_rows(db, int(project["id"]))
                    if not sources:
                        raise ValueError("Add at least one source file first.")
                    chunks = retrieve_chunks(sources)
                    ai_used = False
                    warning = ""
                    if os.environ.get("LLM_API_KEY"):
                        try:
                            candidates = call_llm(chunks)
                            ai_used = True
                        except (urllib.error.URLError, TimeoutError, KeyError, ValueError, RuntimeError) as error:
                            candidates = lexical_candidates(sources)
                            warning = f"AI extraction could not complete ({str(error)[:160]}). Showing evidence candidates for review instead."
                    else:
                        candidates = lexical_candidates(sources)
                    db.execute("DELETE FROM items WHERE project_id=?", (project["id"],))
                    for item in candidates:
                        db.execute(
                            "INSERT INTO items(project_id, kind, content, source_id, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
                            (project["id"], item["kind"], item["content"], item["source_id"], item["start_line"], item["end_line"]),
                        )
                    db.execute("UPDATE projects SET approved=0 WHERE id=?", (project["id"],))
                    db.commit()
                    self.send_json({**state(db), "ai_used": ai_used, "warning": warning})
                    return
                if path == "/api/approve":
                    project = active_project(db)
                    if not project:
                        raise ValueError("There is no handover to approve.")
                    rows = list(db.execute("SELECT status FROM items WHERE project_id=?", (project["id"],)))
                    if not any(row["status"] == "approved" for row in rows):
                        raise ValueError("Approve at least one evidence item before sharing the handover.")
                    if any(row["status"] == "needs_review" for row in rows):
                        raise ValueError("Approve or reject every draft item before sharing.")
                    db.execute("UPDATE projects SET approved=1 WHERE id=?", (project["id"],))
                    db.commit()
                    self.send_json(state(db))
                    return
                if path == "/api/reset":
                    db.execute("DELETE FROM projects")
                    db.commit()
                    self.send_json(state(db))
                    return
            self.send_json({"error": "Not found"}, 404)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, 400)
        except Exception as error:  # Keep the demo responsive and return a readable error.
            self.send_json({"error": f"Something went wrong: {str(error)[:180]}"}, 500)

    def do_PATCH(self) -> None:
        match = re.fullmatch(r"/api/items/(\d+)", urlparse(self.path).path)
        if not match:
            self.send_json({"error": "Not found"}, 404)
            return
        try:
            payload = self.read_json()
            status = str(payload.get("status", "needs_review"))
            content = str(payload.get("content", "")).strip()[:500]
            if status not in {"needs_review", "approved", "rejected"} or not content:
                raise ValueError("Provide item text and a valid review status.")
            with connect() as db:
                project = active_project(db)
                if not project:
                    raise ValueError("There is no active handover.")
                db.execute(
                    "UPDATE items SET content=?, status=? WHERE id=? AND project_id=?",
                    (content, status, int(match.group(1)), project["id"]),
                )
                db.execute("UPDATE projects SET approved=0 WHERE id=?", (project["id"],))
                db.commit()
                self.send_json(state(db))
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
        except Exception as error:
            self.send_json({"error": f"Could not save review: {str(error)[:160]}"}, 500)


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Evidence Handover is ready on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
