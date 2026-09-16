"""Synthetic recovery policy only: no GPU, systemctl, watchdog or network calls."""
from dataclasses import asdict, replace
import json
import pytest
from media_lab_core.recovery_policy import State, Sample, observe


def sample(sequence, **changes):
    return replace(Sample(boot_id='boot-a', sequence=sequence, host_stalled=True,
        independent_confirmation=True, quarantine_verified=True,
        evidence_saved=True, ledger_writable=True), **changes)


@pytest.mark.parametrize('field', ['quarantine_verified', 'evidence_saved', 'ledger_writable'])
def test_no_reboot_until_quarantine_and_evidence_are_durable(field):
    state = State()
    for i in range(10):
        state, decision = observe(state, sample(i, **{field: False}))
        assert decision == 'quarantine_and_alert'
        assert state.quarantined
        assert state.reboot_requests == 0


def test_reboot_proposal_requires_three_independently_confirmed_samples():
    state = State()
    state, first = observe(state, sample(1))
    state, second = observe(state, sample(2))
    state, third = observe(state, sample(3))
    assert (first, second, third) == ('observe_and_alert', 'observe_and_alert', 'propose_reboot')
    assert state.reboot_requests == 1


def test_restart_and_boot_change_do_not_replenish_reboot_budget(tmp_path):
    state = State()
    for i in range(3):
        state, _ = observe(state, sample(i))
    assert state.reboot_requests == 1
    ledger = tmp_path/'ledger.json'
    ledger.write_text(json.dumps(asdict(state)))
    state = State(**json.loads(ledger.read_text()))
    for i in range(20):
        state, decision = observe(state, sample(i, boot_id='boot-b'))
        assert decision != 'propose_reboot'
        assert state.reboot_requests == 1
        assert state.quarantined


def test_missing_peer_confirmation_never_proposes_reboot():
    state = State()
    for i in range(20):
        state, decision = observe(state, sample(i, independent_confirmation=False))
        assert decision != 'propose_reboot'
    assert state.reboot_requests == 0


def test_healthy_sample_breaks_failure_streak_without_clearing_quarantine():
    state, _ = observe(State(), sample(1))
    state, _ = observe(state, sample(2, host_stalled=False))
    assert state.failure_samples == 0
    assert state.quarantined
    state, decision = observe(state, sample(3))
    assert state.failure_samples == 1
    assert decision == 'observe_and_alert'


def test_replayed_samples_cannot_advance_decision():
    state, _ = observe(State(), sample(5))
    original = state
    for i in [5, 4, 5]:
        state, decision = observe(state, sample(i))
        assert state == original
        assert decision == 'reject_stale_sample'


def test_missing_boot_identity_is_rejected():
    state, decision = observe(State(), sample(1, boot_id=''))
    assert decision == 'quarantine_and_alert'
    assert state.reboot_requests == 0
