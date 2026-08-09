import asyncio
import time

import httpx
from mcp.shared.memory import create_connected_server_and_client_session

import apaper_mcp.server as server


def test_arxiv_retries_proxy_timeout(monkeypatch) -> None:
    monkeypatch.setenv("ARXIV_MAX_RETRIES", "1")
    monkeypatch.setenv("ARXIV_MIN_INTERVAL_MS", "0")
    monkeypatch.setenv("ARXIV_BACKOFF_BASE_MS", "0")
    monkeypatch.setenv("ARXIV_BACKOFF_MAX_MS", "0")
    monkeypatch.setenv("ARXIV_BACKOFF_JITTER_MS", "0")
    calls = 0

    async def fake_get(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("proxy read timeout")
        return httpx.Response(
            200, text="ok", request=httpx.Request("GET", "https://arxiv.org")
        )

    monkeypatch.setattr(server, "_get", fake_get)
    response = asyncio.run(server._arxiv_get("https://arxiv.org/search/", timeout=1))
    assert response.status_code == 200
    assert calls == 2


def test_iacr_download_uses_seleniumbase_directly(monkeypatch, tmp_path) -> None:
    calls = []

    async def fake_get(*args, **kwargs):
        raise AssertionError("IACR downloads should not make an HTTP preflight request")

    def fake_download(url, target):
        calls.append((url, target))
        target.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(server, "_get", fake_get)
    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    result = asyncio.run(server.download_iacr_paper("2025/1", str(tmp_path)))

    target = tmp_path / "iacr_2025_1.pdf"
    assert result == str(target)
    assert calls == [("https://eprint.iacr.org/2025/1.pdf", target)]


def test_iacr_download_defaults_to_downloads_directory(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)

    def fake_download(url, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    result = asyncio.run(server.download_iacr_paper("2025/1"))

    assert result == "downloads/iacr_2025_1.pdf"
    assert (tmp_path / result).read_bytes() == b"%PDF-1.7"


def test_iacr_download_returns_before_browser_cleanup(monkeypatch, tmp_path) -> None:
    def fake_download(url, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"%PDF-1.7")
        time.sleep(0.2)

    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    async def call_download():
        started = time.monotonic()
        result = await server.download_iacr_paper("2025/1", str(tmp_path))
        elapsed = time.monotonic() - started
        await asyncio.sleep(0.25)
        return result, elapsed

    result, elapsed = asyncio.run(call_download())

    assert result == str(tmp_path / "iacr_2025_1.pdf")
    assert elapsed < 0.15


def test_iacr_download_failure_is_an_mcp_tool_error(monkeypatch, tmp_path) -> None:
    def fake_download(url, target):
        raise RuntimeError("Cloudflare challenge did not complete")

    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    async def call_download():
        async with create_connected_server_and_client_session(server.mcp) as session:
            return await session.call_tool(
                "download_iacr_paper",
                {"paper_id": "2026/1623", "save_path": str(tmp_path)},
            )

    result = asyncio.run(call_download())

    assert result.isError is True
    assert "Cloudflare challenge did not complete" in result.content[0].text
