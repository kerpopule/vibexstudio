from pathlib import Path


ROOT = Path(__file__).parents[1]
DEPLOY = ROOT / "tools" / "deploy-spark.sh"


def test_deploy_includes_gpu_capacity_receipts():
    text = DEPLOY.read_text()
    assert "+ /config/gpu-capacity-receipts.json" in text


def test_deploy_accepts_tagged_commits_without_remote_branch():
    text = DEPLOY.read_text()
    branch_line = next(line for line in text.splitlines() if line.startswith('BRANCH="$(git branch -r'))
    assert "|| true" in branch_line


def test_rollback_pointer_is_the_absolute_backup_path():
    """BACKUP is built from the remote's absolute $HOME; prefixing "~/" gave the
    malformed "~//home/..." pointer that deployed-source.json carried."""
    from pathlib import Path
    script = (Path(__file__).parents[1] / "tools" / "deploy-spark.sh").read_text()
    assert 'f"~/{backup}"' not in script
    assert '"rollback": backup,' in script
    assert 'BACKUP="$REMOTE_ABS_HOME/' in script
