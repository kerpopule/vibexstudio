from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

TERMINAL = {"succeeded", "failed", "cancelled"}
TRANSITIONS = {
    "queued": {"running", "cancelled"},
    "running": {"succeeded", "failed", "cancel_requested"},
    "cancel_requested": {"cancelled", "failed"},
    "succeeded": set(),
    "failed": set(),
    "cancelled": set(),
}


class InvalidTransition(RuntimeError):
    pass


class JobStore:
    """Small transactional queue suitable for one API and one leased GPU worker."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=30000")
        try:
            yield db
        finally:
            db.close()

    def _initialize(self) -> None:
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    epoch INTEGER NOT NULL DEFAULT 0,
                    priority INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    claimed_by TEXT,
                    lease_until REAL,
                    heartbeat_at REAL,
                    cancel_requested_at REAL,
                    result_json TEXT,
                    error TEXT
                );
                CREATE INDEX IF NOT EXISTS jobs_claim_idx
                    ON jobs(status, priority DESC, created_at ASC);
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1');
                """
            )

    def enqueue(self, kind: str, payload: dict, *, priority: int = 0, job_id: str | None = None) -> str:
        now = time.time()
        jid = job_id or uuid.uuid4().hex[:12]
        with self.connect() as db:
            db.execute(
                "INSERT INTO jobs(id,kind,payload_json,status,stage,priority,created_at,updated_at) "
                "VALUES(?,?,?,'queued','queued',?,?,?)",
                (jid, kind, json.dumps(payload, sort_keys=True), priority, now, now),
            )
        return jid

    def get(self, job_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return self._decode(row) if row else None

    def claim_next(self, worker_id: str, *, lease_seconds: float = 60) -> dict | None:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT id,epoch FROM jobs WHERE status='queued' "
                "ORDER BY priority DESC,created_at ASC LIMIT 1"
            ).fetchone()
            if row is None:
                db.execute("COMMIT")
                return None
            changed = db.execute(
                "UPDATE jobs SET status='running',stage='starting',epoch=epoch+1,"
                "claimed_by=?,lease_until=?,heartbeat_at=?,updated_at=? "
                "WHERE id=? AND status='queued' AND epoch=?",
                (worker_id, now + lease_seconds, now, now, row["id"], row["epoch"]),
            ).rowcount
            db.execute("COMMIT")
            if changed != 1:
                return None
        return self.get(row["id"])

    def heartbeat(self, job_id: str, worker_id: str, stage: str, *, lease_seconds: float = 60) -> bool:
        now = time.time()
        with self.connect() as db:
            changed = db.execute(
                "UPDATE jobs SET stage=?,heartbeat_at=?,lease_until=?,updated_at=? "
                "WHERE id=? AND claimed_by=? AND status IN ('running','cancel_requested')",
                (stage, now, now + lease_seconds, now, job_id, worker_id),
            ).rowcount
        return changed == 1

    def request_cancel(self, job_id: str) -> bool:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status,epoch FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None or row["status"] in TERMINAL:
                db.execute("ROLLBACK")
                return False
            target = "cancelled" if row["status"] == "queued" else "cancel_requested"
            changed = db.execute(
                "UPDATE jobs SET status=?,stage=?,epoch=epoch+1,cancel_requested_at=?,updated_at=? "
                "WHERE id=? AND epoch=?",
                (target, target, now, now, job_id, row["epoch"]),
            ).rowcount
            db.execute("COMMIT")
        return changed == 1

    def transition(
        self,
        job_id: str,
        worker_id: str,
        target: str,
        *,
        stage: str | None = None,
        result: dict | None = None,
        error: str | None = None,
    ) -> dict:
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status,epoch,claimed_by FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                db.execute("ROLLBACK")
                raise KeyError(job_id)
            current = row["status"]
            if row["claimed_by"] != worker_id:
                db.execute("ROLLBACK")
                raise InvalidTransition("worker does not own this job")
            if target not in TRANSITIONS.get(current, set()):
                db.execute("ROLLBACK")
                raise InvalidTransition(f"invalid transition {current} -> {target}")
            db.execute(
                "UPDATE jobs SET status=?,stage=?,epoch=epoch+1,updated_at=?,result_json=?,error=?,"
                "lease_until=CASE WHEN ? IN ('succeeded','failed','cancelled') THEN NULL ELSE lease_until END "
                "WHERE id=? AND epoch=?",
                (
                    target,
                    stage or target,
                    now,
                    json.dumps(result, sort_keys=True) if result is not None else None,
                    error,
                    target,
                    job_id,
                    row["epoch"],
                ),
            )
            db.execute("COMMIT")
        value = self.get(job_id)
        assert value is not None
        return value

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict:
        value = dict(row)
        value["payload"] = json.loads(value.pop("payload_json"))
        raw_result = value.pop("result_json")
        value["result"] = json.loads(raw_result) if raw_result else None
        return value
