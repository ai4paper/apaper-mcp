import socket
import json
from pathlib import Path
from types import SimpleNamespace

from apaper_mcp.formatters import format_iacr_search_response
import apaper_mcp.platforms.iacr as iacr_platform
from apaper_mcp.platforms.iacr import (
    download_iacr_pdf,
    parse_iacr_detail_html,
    parse_iacr_search_html,
)
import pytest


def test_format_iacr_response_preserves_wording() -> None:
    paper = {
        "paper_id": "2025/1014",
        "title": "Sample Paper",
        "authors": ["Alice", "Bob"],
        "abstract": "A concise abstract.",
        "doi": "",
        "published_date": "2025-06-02T00:00:00Z",
        "pdf_url": "https://example.com/paper.pdf",
        "url": "https://example.com/paper",
        "source": "iacr",
        "categories": ["Cryptography"],
        "keywords": ["MPC"],
        "citations": 4,
        "references": [],
        "extra": {},
    }
    text = format_iacr_search_response([paper], "crypto", 2024, 2025)
    assert "Found 1 IACR papers for query 'crypto' in year range (2024-2025):" in text
    assert "1. **Sample Paper**" in text
    assert "- Abstract: A concise abstract." in text


def test_iacr_search_and_detail_parsers() -> None:
    iacr = parse_iacr_search_html(
        """<div class="mb-4"><div class="d-flex"><a class="paperlink" href="/2025/1014">2025/1014</a><a href="/2025/1014.pdf">(PDF)</a></div><div class="ms-md-4"><strong>Title</strong><span class="fst-italic">Alice, Bob</span><small class="badge">Crypto</small><p class="search-abstract">Abstract</p></div></div>"""
    )
    assert iacr[0]["paper_id"] == "2025/1014"
    detail = parse_iacr_detail_html(
        '<h3 class="mb-3">Detailed</h3><p class="fst-italic">Alice and Bob</p><a class="badge bg-secondary keyword">MPC</a><div>History\n2024-05-01: First version\nShort URL</div>',
        "2024/1",
    )
    assert detail is not None
    assert detail["authors"] == ["Alice", "Bob"]


def _pdf_response(
    body: bytes, status: int = 200, content_type: str = "application/pdf"
):
    return SimpleNamespace(
        body=body, status=status, headers={"content-type": content_type}
    )


def test_iacr_scrapling_downloads_pdf(tmp_path, monkeypatch) -> None:
    calls = []

    class FakeFetcher:
        @classmethod
        def fetch(cls, url, **kwargs):
            profile = Path(kwargs.pop("user_data_dir"))
            prefs = json.loads((profile / "Default" / "Preferences").read_text())
            assert prefs["plugins"]["always_open_pdf_externally"] is True
            assert kwargs.pop("additional_args") == {"accept_downloads": True}
            assert callable(kwargs.pop("page_setup"))
            calls.append((url, kwargs))
            return _pdf_response(b"%PDF-1.7")

    target = tmp_path / "downloaded" / "paper.pdf"
    monkeypatch.setenv("SPIDER_PROXY", "http://user:pass@proxy.example:8080")
    monkeypatch.setenv("IACR_DOWNLOAD_TIMEOUT_MS", "12345")
    monkeypatch.setenv("IACR_CAPTCHA_ATTEMPTS", "2")
    monkeypatch.setenv("IACR_BROWSER_EXECUTABLE", "/usr/bin/chromium")

    download_iacr_pdf("https://eprint.iacr.org/2025/1.pdf", target, fetcher=FakeFetcher)

    assert target.read_bytes() == b"%PDF-1.7"
    assert not target.with_name("paper.pdf.part").exists()
    assert calls == [
        (
            "https://eprint.iacr.org/2025/1.pdf",
            {
                "solve_cloudflare": True,
                "timeout": 12345,
                "retries": 1,
                "locale": "en",
                "executable_path": "/usr/bin/chromium",
                "proxy": "http://user:pass@proxy.example:8080",
            },
        )
    ]


def test_iacr_defaults_to_bundled_chromium(tmp_path, monkeypatch) -> None:
    options = {}

    class FakeFetcher:
        @classmethod
        def fetch(cls, url, **kwargs):
            options.update(kwargs)
            return _pdf_response(b"%PDF-1.7")

    monkeypatch.delenv("IACR_BROWSER_EXECUTABLE", raising=False)
    monkeypatch.delenv("SPIDER_PROXY", raising=False)

    download_iacr_pdf(
        "https://eprint.iacr.org/2025/1.pdf", tmp_path / "paper.pdf", FakeFetcher
    )

    assert "executable_path" not in options
    assert not Path(options["user_data_dir"]).exists()


@pytest.mark.parametrize("navigation_error", [False, True])
def test_iacr_download_survives_navigation_failure(
    tmp_path, monkeypatch, navigation_error
):
    downloaded = tmp_path / "browser-download"
    downloaded.write_bytes(b"%PDF-1.5 downloaded")
    target = tmp_path / "paper.pdf"

    class FakeFetcher:
        @classmethod
        def fetch(cls, url, **kwargs):
            handlers = {}
            kwargs["page_setup"](
                SimpleNamespace(on=lambda event, fn: handlers.update({event: fn}))
            )
            handlers["download"](SimpleNamespace(path=lambda: str(downloaded)))
            assert target.read_bytes() == downloaded.read_bytes()
            if navigation_error:
                raise RuntimeError("Navigation interrupted by download")
            return _pdf_response(b"", status=403, content_type="text/html")

    monkeypatch.delenv("SPIDER_PROXY", raising=False)
    download_iacr_pdf("https://eprint.iacr.org/2026/2848.pdf", target, FakeFetcher)
    assert target.read_bytes() == b"%PDF-1.5 downloaded"
    assert not target.with_name("paper.pdf.part").exists()


def test_authenticated_socks_proxy_uses_local_http_bridge(monkeypatch) -> None:
    monkeypatch.setenv("SPIDER_PROXY", "socks5://proxy.example:1080:user:pass")

    with iacr_platform.selenium_proxy_from_env() as proxy:
        assert proxy is not None
        host, port = proxy.rsplit(":", 1)
        connection = socket.create_connection((host, int(port)), timeout=1)
        connection.close()

    with pytest.raises(OSError):
        socket.create_connection((host, int(port)), timeout=0.1)


def test_iacr_rejects_non_pdf_response_without_overwriting(
    tmp_path, monkeypatch
) -> None:
    class FakeFetcher:
        @classmethod
        def fetch(cls, url, **kwargs):
            return _pdf_response(b"<html>challenge</html>", content_type="text/html")

    target = tmp_path / "paper.pdf"
    target.write_bytes(b"existing")
    monkeypatch.delenv("SPIDER_PROXY", raising=False)

    with pytest.raises(ValueError, match="content-type: text/html"):
        download_iacr_pdf("https://eprint.iacr.org/2026/1623.pdf", target, FakeFetcher)

    assert target.read_bytes() == b"existing"


def test_iacr_rejects_http_error(tmp_path, monkeypatch) -> None:
    class FakeFetcher:
        @classmethod
        def fetch(cls, url, **kwargs):
            return _pdf_response(b"", status=503)

    monkeypatch.delenv("SPIDER_PROXY", raising=False)

    with pytest.raises(RuntimeError, match="HTTP 503"):
        download_iacr_pdf(
            "https://eprint.iacr.org/2026/1623.pdf", tmp_path / "paper.pdf", FakeFetcher
        )
