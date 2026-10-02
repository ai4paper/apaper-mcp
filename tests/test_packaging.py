from pathlib import Path
import tomllib


def test_mcp_dependency_requires_v2() -> None:
    pyproject = tomllib.loads(Path("pyproject.toml").read_text())

    assert "mcp>=2,<3" in pyproject["project"]["dependencies"]
