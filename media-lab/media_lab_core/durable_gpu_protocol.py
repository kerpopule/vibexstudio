"""Durable, fenced admission for Media Lab GPU work.

This module is deliberately stdlib-only so the app, engine shims, shell-launch
helpers and recovery tools can share one protocol.  A POSIX flock provides live
cross-process exclusion; SQLite provides durable ownership, monotonically
increasing fences, queue idempotency and reboot/crash quarantine.

An active or recovery lease is never aged out.  Only exact-fence reconciliation
with process, boot and memory proof may clear it.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Callable, Mapping, Sequence


class LeaseBusy(RuntimeError):
    pass


class StaleFence(RuntimeError):
    pass


class CapacityUnqualified(RuntimeError):
    pass


@dataclass
class Lease:
    fence: int
    owner: str
    pid: int
    boot_id: str
    job_id: str
    engine: str
    task: str
    phase: str
    state: str = "active"
    _fd: IO[Any] | None = field(default=None, repr=False, compare=False)


class DurableGpuProtocol:
    """One durable local-GPU owner plus an independent durable job queue."""

    _NEXT_PHASES = {
        "drain": {"unload"},
        "unload": {"reclaim"},
        "reclaim": {"load", "released"},
        "load": {"render"},
        "render": {"unload"},
    }

    def __init__(
        self,
        db_path: str | Path,
        lock_path: str | Path,
        *,
        boot_id: Callable[[], str] | None = None,
        available_gib: Callable[[], float] | None = None,
        pid_alive: Callable[[int], bool] | None = None,
        now: Callable[[], float] = time.time,
    ):
        self.db_path = Path(db_path)
        self.lock_path = Path(lock_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._boot_id = boot_id or self._read_boot_id
        self._available_gib = available_gib or self._read_available_gib
        self._pid_alive = pid_alive or self._default_pid_alive
        self._now = now
        self._initialize()

    @staticmethod
    def _read_boot_id() -> str:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()

    @staticmethod
    def _read_available_gib() -> float:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024 / 1024
        raise RuntimeError("MemAvailable is unavailable")

    @staticmethod
    def _default_pid_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=15000")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS sequence (
                    name TEXT PRIMARY KEY,
                    value INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO sequence(name, value) VALUES ('gpu_fence', 0);
                INSERT OR IGNORE INTO sequence(name, value) VALUES ('job_fence', 0);
                CREATE TABLE IF NOT EXISTS gpu_lease (
                    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                    fence INTEGER NOT NULL,
                    owner TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    boot_id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    engine TEXT NOT NULL,
                    task TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('active','recovery')),
                    reason TEXT,
                    updated REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS capacity (
                    engine TEXT NOT NULL,
                    task TEXT NOT NULL,
                    peak_gib REAL NOT NULL CHECK(peak_gib > 0),
                    reserve_gib REAL NOT NULL CHECK(reserve_gib >= 0),
                    evidence TEXT NOT NULL,
                    measured REAL NOT NULL,
                    PRIMARY KEY(engine, task)
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    lane TEXT NOT NULL CHECK(lane IN ('local','cloud')),
                    engine TEXT NOT NULL,
                    task TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('queued','running','done','cancelled','recovery')),
                    owner TEXT,
                    fence INTEGER,
                    result_hash TEXT,
                    created REAL NOT NULL,
                    updated REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS jobs_lane_state_created
                    ON jobs(lane, state, created, job_id);
                """
            )

    @staticmethod
    def _row_lease(row: sqlite3.Row, fd: IO[Any] | None = None) -> Lease:
        return Lease(
            fence=row["fence"], owner=row["owner"], pid=row["pid"],
            boot_id=row["boot_id"], job_id=row["job_id"], engine=row["engine"],
            task=row["task"], phase=row["phase"], state=row["state"], _fd=fd,
        )

    @staticmethod
    def _next_fence(db: sqlite3.Connection, name: str) -> int:
        db.execute("UPDATE sequence SET value=value+1 WHERE name=?", (name,))
        row = db.execute("SELECT value FROM sequence WHERE name=?", (name,)).fetchone()
        return int(row[0])

    def qualify(self, engine: str, task: str, *, peak_gib: float,
                reserve_gib: float, evidence: str) -> None:
        if not evidence.strip():
            raise ValueError("capacity evidence is required")
        with self._connect() as db:
            db.execute(
                "INSERT INTO capacity(engine,task,peak_gib,reserve_gib,evidence,measured) "
                "VALUES(?,?,?,?,?,?) ON CONFLICT(engine,task) DO UPDATE SET "
                "peak_gib=excluded.peak_gib,reserve_gib=excluded.reserve_gib,"
                "evidence=excluded.evidence,measured=excluded.measured",
                (engine, task, float(peak_gib), float(reserve_gib), evidence, self._now()),
            )

    def _check_capacity(self, db: sqlite3.Connection, engine: str, task: str) -> None:
        row = db.execute(
            "SELECT peak_gib,reserve_gib FROM capacity WHERE engine=? AND task=?",
            (engine, task),
        ).fetchone()
        if row is None:
            raise CapacityUnqualified(f"no measured capacity for {engine}/{task}")
        required = float(row["peak_gib"]) + float(row["reserve_gib"])
        available = float(self._available_gib())
        if available < required:
            raise CapacityUnqualified(
                f"{engine}/{task} requires {required:.1f} GiB including reserve; "
                f"only {available:.1f} GiB available"
            )

    def acquire(self, *, job_id: str, engine: str, task: str, owner: str) -> Lease:
        fd = self.lock_path.open("a+")
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise LeaseBusy("GPU live lock is held") from exc
            db = self._connect()
            try:
                db.execute("BEGIN IMMEDIATE")
                current = db.execute("SELECT * FROM gpu_lease WHERE singleton=1").fetchone()
                if current is not None:
                    raise LeaseBusy(
                        f"GPU lease {current['fence']} is {current['state']} "
                        f"for {current['owner']}:{current['job_id']}"
                    )
                self._check_capacity(db, engine, task)
                fence = self._next_fence(db, "gpu_fence")
                boot = self._boot_id()
                now = self._now()
                db.execute(
                    "INSERT INTO gpu_lease(singleton,fence,owner,pid,boot_id,job_id,engine,task,phase,state,reason,updated) "
                    "VALUES(1,?,?,?,?,?,?,?,?, 'active', NULL, ?)",
                    (fence, owner, os.getpid(), boot, job_id, engine, task, "drain", now),
                )
                db.execute("COMMIT")
                return Lease(fence, owner, os.getpid(), boot, job_id, engine, task, "drain", _fd=fd)
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
            finally:
                db.close()
        except Exception:
            fd.close()
            raise

    def _exact(self, db: sqlite3.Connection, lease: Lease) -> sqlite3.Row:
        row = db.execute("SELECT * FROM gpu_lease WHERE singleton=1").fetchone()
        if row is None or row["fence"] != lease.fence or row["owner"] != lease.owner:
            raise StaleFence(f"lease fence {lease.fence} no longer owns the GPU")
        return row

    def advance(self, lease: Lease, phase: str) -> Lease:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = self._exact(db, lease)
                if row["state"] != "active":
                    raise LeaseBusy("recovery lease cannot advance")
                if phase not in self._NEXT_PHASES.get(row["phase"], set()):
                    raise ValueError(f"invalid GPU phase transition {row['phase']} -> {phase}")
                db.execute("UPDATE gpu_lease SET phase=?,updated=? WHERE singleton=1",
                           (phase, self._now()))
                db.execute("COMMIT")
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        lease.phase = phase
        return lease

    def mark_recovery(self, lease: Lease, reason: str) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                self._exact(db, lease)
                db.execute(
                    "UPDATE gpu_lease SET state='recovery',reason=?,updated=? WHERE singleton=1",
                    (reason, self._now()),
                )
                db.execute("UPDATE jobs SET state='recovery',updated=? WHERE job_id=? AND state='running'",
                           (self._now(), lease.job_id))
                db.execute("COMMIT")
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        lease.state = "recovery"

    @staticmethod
    def _validate_reclamation(proof: Mapping[str, object], *, boot_id: str | None = None) -> None:
        if proof.get("processes_gone") is not True:
            raise ValueError("exact process proof is required")
        if proof.get("memory_recovered") is not True:
            raise ValueError("measured memory proof is required")
        if boot_id is not None and proof.get("boot_id") != boot_id:
            raise ValueError("current boot proof is required")

    def release(self, lease: Lease, *, proof: Mapping[str, object]) -> None:
        self._validate_reclamation(proof)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = self._exact(db, lease)
                if row["state"] != "active" or row["phase"] != "reclaim":
                    raise LeaseBusy("active lease may release only after reclamation")
                db.execute("DELETE FROM gpu_lease WHERE singleton=1")
                db.execute("COMMIT")
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        if lease._fd is not None:
            lease._fd.close()
            lease._fd = None

    def reconcile(self, lease: Lease, *, proof: Mapping[str, object]) -> None:
        current_boot = self._boot_id()
        self._validate_reclamation(proof, boot_id=current_boot)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = self._exact(db, lease)
                if row["state"] != "recovery":
                    raise LeaseBusy("only a recovery lease may be reconciled")
                db.execute("DELETE FROM gpu_lease WHERE singleton=1")
                db.execute("COMMIT")
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        if lease._fd is not None:
            lease._fd.close()
            lease._fd = None

    def recover_startup(self) -> None:
        boot = self._boot_id()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute("SELECT * FROM gpu_lease WHERE singleton=1").fetchone()
                if row is not None:
                    reason = None
                    if row["boot_id"] != boot:
                        reason = "boot-changed"
                    elif not self._pid_alive(int(row["pid"])):
                        reason = "owner-exited"
                    if reason:
                        db.execute(
                            "UPDATE gpu_lease SET state='recovery',reason=?,updated=? WHERE singleton=1",
                            (reason, self._now()),
                        )
                db.execute("COMMIT")
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise

    def authorize(self, *, fence: int, job_id: str, engine: str, task: str) -> bool:
        """Validate a controller-delegated engine request against the live fence."""
        with self._connect() as db:
            row = db.execute(
                "SELECT fence,job_id,engine,task,state FROM gpu_lease WHERE singleton=1"
            ).fetchone()
            return bool(
                row is not None
                and row["state"] == "active"
                and int(row["fence"]) == int(fence)
                and row["job_id"] == job_id
                and row["engine"] == engine
                and row["task"] == task
            )

    def submit(self, job_id: str, *, lane: str, engine: str, task: str,
               payload_hash: str) -> dict:
        if lane not in {"local", "cloud"}:
            raise ValueError("lane must be local or cloud")
        now = self._now()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
                if row is not None:
                    identity = (row["lane"], row["engine"], row["task"], row["payload_hash"])
                    if identity != (lane, engine, task, payload_hash):
                        raise ValueError(f"idempotency conflict for {job_id}")
                    db.execute("COMMIT")
                    return dict(row)
                db.execute(
                    "INSERT INTO jobs(job_id,lane,engine,task,payload_hash,state,created,updated) "
                    "VALUES(?,?,?,?,?,'queued',?,?)",
                    (job_id, lane, engine, task, payload_hash, now, now),
                )
                row = db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
                db.execute("COMMIT")
                return dict(row)
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise

    def claim_next(self, *, lane: str, owner: str) -> dict | None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute(
                    "SELECT * FROM jobs WHERE lane=? AND state='queued' ORDER BY created,job_id LIMIT 1",
                    (lane,),
                ).fetchone()
                if row is None:
                    db.execute("COMMIT")
                    return None
                fence = self._next_fence(db, "job_fence")
                db.execute(
                    "UPDATE jobs SET state='running',owner=?,fence=?,updated=? "
                    "WHERE job_id=? AND state='queued'",
                    (owner, fence, self._now(), row["job_id"]),
                )
                claimed = db.execute("SELECT * FROM jobs WHERE job_id=?", (row["job_id"],)).fetchone()
                db.execute("COMMIT")
                return dict(claimed)
            except Exception:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise

    def cancel(self, job_id: str) -> bool:
        with self._connect() as db:
            cur = db.execute(
                "UPDATE jobs SET state='cancelled',updated=? WHERE job_id=? AND state IN ('queued','running')",
                (self._now(), job_id),
            )
            return cur.rowcount == 1

    def complete(self, job_id: str, *, fence: int, result_hash: str) -> bool:
        with self._connect() as db:
            cur = db.execute(
                "UPDATE jobs SET state='done',result_hash=?,updated=? "
                "WHERE job_id=? AND state='running' AND fence=?",
                (result_hash, self._now(), job_id, int(fence)),
            )
            return cur.rowcount == 1

    def job(self, job_id: str) -> dict | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            return dict(row) if row is not None else None

    def snapshot(self) -> dict:
        with self._connect() as db:
            lease = db.execute("SELECT * FROM gpu_lease WHERE singleton=1").fetchone()
            jobs = db.execute(
                "SELECT lane,state,COUNT(*) AS count FROM jobs GROUP BY lane,state"
            ).fetchall()
            return {
                "lease": dict(lease) if lease is not None else None,
                "jobs": [dict(row) for row in jobs],
            }


@dataclass(frozen=True)
class TransitionHooks:
    drain: Callable[[Lease], object]
    unload: Callable[[Lease], Mapping[str, object]]
    reclaim: Callable[[Lease], Mapping[str, object]]
    load: Callable[[Lease], object]
    render: Callable[[Lease, Mapping[str, str]], object]


def run_transition_sequence(
    protocol: DurableGpuProtocol,
    items: Sequence[Mapping[str, str]],
    *,
    hooks: TransitionHooks,
    owner: str,
) -> list[object]:
    """Execute a synthetic or real mixed-engine sequence under exact fences.

    Each item is a complete drain→unload→reclaim→load→render→unload→reclaim
    transaction.  Any uncertain hook outcome leaves the durable lease in
    recovery and stops the sequence; later work is never admitted over it.
    """
    results: list[object] = []
    for item in items:
        lease: Lease | None = None
        try:
            lease = protocol.acquire(
                job_id=item["job_id"], engine=item["engine"], task=item["task"], owner=owner
            )
            hooks.drain(lease)
            protocol.advance(lease, "unload")
            initial_process = hooks.unload(lease)
            if initial_process.get("processes_gone") is not True:
                raise RuntimeError("outgoing process reclamation unverified")
            protocol.advance(lease, "reclaim")
            initial_memory = hooks.reclaim(lease)
            if initial_memory.get("memory_recovered") is not True:
                raise RuntimeError("outgoing memory reclamation unverified")
            protocol.advance(lease, "load")
            hooks.load(lease)
            protocol.advance(lease, "render")
            results.append(hooks.render(lease, item))
            protocol.advance(lease, "unload")
            final_process = hooks.unload(lease)
            if final_process.get("processes_gone") is not True:
                raise RuntimeError("final process reclamation unverified")
            protocol.advance(lease, "reclaim")
            final_memory = hooks.reclaim(lease)
            proof = {
                "processes_gone": final_process.get("processes_gone") is True,
                "memory_recovered": final_memory.get("memory_recovered") is True,
            }
            protocol.release(lease, proof=proof)
        except Exception as exc:
            if lease is not None:
                try:
                    protocol.mark_recovery(lease, f"transition-failed:{type(exc).__name__}")
                except StaleFence:
                    pass
            raise
    return results


def payload_digest(payload: Mapping[str, object]) -> str:
    """Stable queue-idempotency digest without storing request contents here."""
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
