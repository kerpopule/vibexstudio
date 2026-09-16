"""Execute actual controller functions without importing startup services."""
import ast
from pathlib import Path
import types
import pytest

APP = Path(__file__).parents[1] / 'app.py'

def function(name, **namespace):
    tree = ast.parse(APP.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(APP), 'exec'), namespace)
    return namespace[name]

@pytest.mark.parametrize('message', ['timed out', 'Connection reset by peer', 'Remote end closed connection'])
def test_uncertain_render_never_restarts_or_reissues(tmp_path, message):
    import fcntl, re
    calls = []
    def request(*args, **kwargs):
        calls.append('request')
        raise TimeoutError(message)
    def restart(*args):
        calls.append('restart')
        return 'up'
    def hold(*args):
        # Independent descriptor must still be excluded when hold is recorded.
        with (tmp_path/'lock').open('a+') as contender:
            with pytest.raises(BlockingIOError):
                fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        calls.append('hold')
    generate = function('engine_generate', ENGINES={'h3': {'port': 1}},
                        preflight=lambda e,b:b, INFERENCE_LOCK=str(tmp_path/'lock'),
                        fcntl=fcntl, http_json=request, ensure_engine=restart,
                        H3_ENGINE_HTTP_TIMEOUT_S=100, re=re, H3_MIN_FRAMES=5,
                        H3_MAX_FRAMES=121, save_state=lambda:None,
                        hold_gpu_recovery=hold, gpu_recovery_pending=lambda:False)
    job = {'id':'fixture', 'request':{}}
    result = generate('h3', {'prompt':'fixture'}, job)
    assert calls == ['request', 'hold'], 'uncertain remote work must be reconciled, not restarted'
    assert result['ok'] is False
    assert job['recovery_required'] is True
    assert job['retryable'] is False


def test_fail_preserves_unknown_outcome_hold():
    fail = function('fail', INFRA_FAILURE_MARKS=['timed out'])
    job = {'recovery_required': True}
    fail(job, 'timed out')
    assert job['retryable'] is False


def test_admission_refuses_unresolved_previous_request_before_any_mutation():
    calls = []
    ensure = function('ensure_engine', gpu_recovery_pending=lambda:True,
                      stand_down_other_companions=lambda *a:calls.append('evict'))
    job = {}
    assert ensure('h3', job) == 'busy'
    assert calls == []


def test_queued_job_stays_visible_under_recovery_hold():
    job = {'id':'next','status':'queued'}
    run = function('run_queued_job', jobs={'next':job}, gpu_recovery_pending=lambda:True)
    assert run('next') is False
    assert job['status'] == 'queued'


def test_cloud_execution_continues_while_local_recovery_is_held():
    import time
    calls = []
    job = {'id':'cloud','status':'queued','kind':'video','engine':'fal-video'}
    def cloud(j):
        calls.append(j['id'])
        j['status'] = 'done'
    run = function('run_online_job', jobs={'cloud':job}, time=time,
                   save_state=lambda:None, job_queue_lane=lambda j:'online',
                   RUNNERS={'video':cloud}, ensure_multi_scene_storyboard=lambda j:None,
                   eta_record=lambda j:None, notify_done=lambda j:None,
                   gpu_recovery_pending=lambda:True,
                   fail=lambda *a:pytest.fail('unexpected failure'))
    assert run('cloud') is True
    assert calls == ['cloud']
    assert job['status'] == 'done'


def test_persistent_hold_survives_new_controller_and_late_success(tmp_path):
    import json, os, time
    marker = tmp_path/'hold.json'
    hold = function('hold_gpu_recovery', GPU_RECOVERY_HOLD=marker,
                    json=json, os=os, time=time)
    job = {'id':'uncertain'}
    hold('unknown', job)
    original = marker.read_bytes()
    hold('newer-error', {'id':'another'})
    assert marker.read_bytes() == original
    # Fresh process globals and even a late successful row cannot clear it.
    pending = function('gpu_recovery_pending', GPU_RECOVERY_HOLD=marker,
                       _gpu_recovery_blocked=False, jobs={'uncertain':{'status':'done'}})
    assert pending() is True


def test_partial_hold_file_is_fail_closed(tmp_path):
    marker = tmp_path/'hold.json'; marker.touch()
    pending = function('gpu_recovery_pending', GPU_RECOVERY_HOLD=marker,
                       _gpu_recovery_blocked=False, jobs={})
    assert pending() is True
