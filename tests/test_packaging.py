from pathlib import Path
import tomllib


def test_mcp_dependency_excludes_incompatible_v2() -> None:
    pyproject = tomllib.loads(Path("pyproject.toml").read_text())

    assert "mcp>=1.12,<2" in pyproject["project"]["dependencies"]
