"""Execute actual controller functions without importing startup services."""
import ast
from pathlib import Path

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
        # Ordering is the contract here. Canonical flock exclusion and stale-owner
        # rejection are exercised by the durable protocol tests.
        calls.append('hold')
    generate = function('_engine_generate_authorized', ENGINES={'h3': {'port': 1}},
                        preflight=lambda e,b:b, INFERENCE_LOCK=str(tmp_path/'lock'),
                        fcntl=fcntl, http_json=request, ensure_engine=restart,
                        H3_ENGINE_HTTP_TIMEOUT_S=100, re=re, H3_MIN_FRAMES=5,
                        H3_MAX_FRAMES=121, save_state=lambda:None,
                        hold_gpu_recovery=hold, gpu_recovery_pending=lambda:False,
                        gpu_render_ready=lambda e,t: object(),
                        delegation_headers=lambda lease: {})
    job = {'id':'fixture', 'request':{}}
    result = generate('h3', {'prompt':'fixture'}, job)
    assert calls == ['restart', 'request', 'hold'], 'uncertain remote work must be reconciled, not restarted or reissued'
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
    ensure = function('_ensure_engine_under_lease', gpu_recovery_pending=lambda:True,
                      stand_down_other_companions=lambda *a:calls.append('evict'))
    job = {}
    assert ensure('h3', job) == 'busy'
    assert calls == []


def test_queued_job_stays_visible_under_recovery_hold():
    job = {'id':'next','status':'queued'}
    run = function('run_queued_job', jobs={'next':job}, gpu_recovery_pending=lambda:True,
                   _gpu_cutover_ready=True)
    assert run('next') is False
    assert job['status'] == 'queued'


def test_picker_tolerates_queue_swap_race():
    pick = function('pick_next_job', queue=[], VIDEO_ENGINE_NAMES=(),
                    engine_up=lambda _name: False, jobs={}, job_engine=lambda _job: None)
    assert pick() is None


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


def test_video_runner_has_no_cold_container_bypass():
    tree = ast.parse(APP.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_video')
    calls = {
        call.func.id
        for call in ast.walk(node)
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
    }
    assert '_run_video_cold' not in calls


def test_cold_container_launcher_is_fail_closed():
    launcher = APP.parent / 'runner' / 'run_lab_render.sh'
    text = launcher.read_text()
    retired = text.index('FAIL=retired_unfenced_cold_path')
    docker_start = text.index('docker start')
    assert text.index('exit 77', retired) < docker_start


@pytest.mark.parametrize(('name', 'engine', 'task'), [
    ('run_music', 'music', 'generate'),
    ('_run_image', 'image', 'generate'),
    ('vb_generate', 'voice', 'generate'),
    ('run_stems', 'stems', 'separate'),
])
def test_every_local_gpu_family_enters_canonical_operation(name, engine, task):
    tree = ast.parse(APP.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    calls = [call for call in ast.walk(node)
             if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
             and call.func.id == 'gpu_operation']
    assert any(len(call.args) >= 2
               and isinstance(call.args[0], ast.Constant) and call.args[0].value == engine
               and isinstance(call.args[1], ast.Constant) and call.args[1].value == task
               for call in calls)


def test_startup_adopts_exact_idle_runtime_or_fails_closed():
    text = ast.get_source_segment(APP.read_text(), next(
        n for n in ast.parse(APP.read_text()).body
        if isinstance(n, ast.FunctionDef) and n.name == 'initialize_gpu_cutover'))
    assert text is not None
    assert 'protocol.adopt_recovered(' in text
    assert '_gpu_restart_adoption_proof(recovered)' in text
    assert 'hold_gpu_recovery(' in text
    assert '_gpu_cutover_ready = False' in text


def test_maestro_runner_consumes_exact_delegation_before_model_init():
    runner = (APP.parent / 'runner' / 'maestro_queue_runner.py').read_text()
    assert 'exact Maestro GPU lease delegation is required' in runner
    assert 'time.time() - float(delegated.get("issued_at")) <= 120' in runner
    assert runner.index('delegation_path.unlink()') < runner.index('session = init(')


def test_comfy_idle_proof_requires_empty_running_and_pending_queues():
    idle = function('_gpu_exact_idle', ENGINES={'image': {'port': 8195, 'health': '/system_stats'}},
                    http_json=lambda *_args, **_kwargs: {
                        'queue_running': [], 'queue_pending': []})
    assert idle('image') is True

    active = function('_gpu_exact_idle', ENGINES={'music': {'port': 8196, 'health': '/system_stats'}},
                      http_json=lambda *_args, **_kwargs: {
                          'queue_running': [[1, 'prompt']], 'queue_pending': []})
    assert active('music') is False


def test_comfy_system_stats_without_queue_evidence_is_not_idle():
    idle = function('_gpu_exact_idle', ENGINES={'image': {'port': 8195, 'health': '/system_stats'}},
                    http_json=lambda *_args, **_kwargs: {'devices': []})
    assert idle('image') is False


def test_direct_gpu_stage_closes_prior_queued_job_context_before_switch():
    text = ast.get_source_segment(APP.read_text(), next(
        n for n in ast.parse(APP.read_text()).body
        if isinstance(n, ast.FunctionDef) and n.name == 'gpu_operation'))
    assert text is not None
    close_at = text.index('_gpu_finish_job_operation()')
    refuse_at = text.index('nested GPU operation cannot switch engine or task')
    assert close_at < refuse_at
