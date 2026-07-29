import asyncio

import httpx

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


def test_iacr_download_uses_seleniumbase_for_cloudflare(monkeypatch, tmp_path) -> None:
    response = httpx.Response(
        403,
        headers={
            "cf-mitigated": "challenge",
            "content-type": "text/html",
        },
        request=httpx.Request("GET", "https://eprint.iacr.org/2025/1.pdf"),
    )
    calls = []

    async def fake_get(*args, **kwargs):
        return response

    def fake_download(url, target):
        calls.append((url, target))
        target.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(server, "_get", fake_get)
    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    result = asyncio.run(server.download_iacr_paper("2025/1", str(tmp_path)))

    target = tmp_path / "iacr_2025_1.pdf"
    assert result == str(target)
    assert calls == [("https://eprint.iacr.org/2025/1.pdf", target)]


def test_iacr_download_uses_seleniumbase_when_http_request_fails(
    monkeypatch, tmp_path
) -> None:
    request = httpx.Request("GET", "https://eprint.iacr.org/2024/1.pdf")
    calls = []

    async def failed_get(*args, **kwargs):
        raise httpx.RemoteProtocolError("proxy disconnected", request=request)

    def fake_download(url, target):
        calls.append((url, target))
        target.write_bytes(b"%PDF-1.7")

    monkeypatch.setattr(server, "_get", failed_get)
    monkeypatch.setattr(server, "download_iacr_pdf", fake_download)

    result = asyncio.run(server.download_iacr_paper("2024/1", str(tmp_path)))

    target = tmp_path / "iacr_2024_1.pdf"
    assert result == str(target)
    assert calls == [("https://eprint.iacr.org/2024/1.pdf", target)]
