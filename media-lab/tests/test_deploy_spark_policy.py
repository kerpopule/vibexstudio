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
