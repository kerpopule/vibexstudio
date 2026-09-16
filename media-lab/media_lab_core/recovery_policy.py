"""Advisory recovery-policy model, NOT a privileged supervisor or executor.

Only trusted collectors may supply observations. Returned state must be durably
committed before acting on a proposal. No code here reboots, opens a watchdog,
starts a service, writes files, or grants approval. An installed executor, durable
ledger and authenticated alert delivery require separate implementation/review.
"""
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class State:
    boot_id: str = ''
    sequence: int = -1
    failure_samples: int = 0
    reboot_requests: int = 0
    quarantined: bool = True


@dataclass(frozen=True)
class Sample:
    boot_id: str
    sequence: int
    host_stalled: bool = False
    independent_confirmation: bool = False
    quarantine_verified: bool = False
    evidence_saved: bool = False
    ledger_writable: bool = False


def observe(state: State, sample: Sample) -> tuple[State, str]:
    """Propose at most one reboot per operator-reset incident, across boots.

    Three samples mean three trusted, spaced collector observations; cadence,
    identity authentication and I/O deadlines belong to the future executor.
    """
    if not sample.boot_id:
        return replace(state, quarantined=True, failure_samples=0), 'quarantine_and_alert'
    if sample.boot_id == state.boot_id and sample.sequence <= state.sequence:
        return state, 'reject_stale_sample'
    if sample.boot_id != state.boot_id:
        state = replace(state, failure_samples=0)
    state = replace(state, boot_id=sample.boot_id, sequence=sample.sequence,
                    quarantined=True)
    if not (sample.quarantine_verified and sample.evidence_saved and sample.ledger_writable):
        return replace(state, failure_samples=0), 'quarantine_and_alert'
    if not (sample.host_stalled and sample.independent_confirmation):
        return replace(state, failure_samples=0), 'observe_and_alert'
    if state.reboot_requests >= 1:
        return state, 'budget_exhausted_alert'
    state = replace(state, failure_samples=state.failure_samples + 1)
    if state.failure_samples < 3:
        return state, 'observe_and_alert'
    return replace(state, reboot_requests=1), 'propose_reboot'
