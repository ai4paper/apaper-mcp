import asyncio
import subprocess
import socket
import sys
from pathlib import Path
from types import SimpleNamespace

import mycdp
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


def test_iacr_cdp_page_source_tolerates_navigation() -> None:
    class FakeCdp:
        def get_page_source(self):
            raise RuntimeError("Element {html} was not found")

    browser = SimpleNamespace(cdp=FakeCdp())

    assert iacr_platform._cdp_page_source(browser) == ""


def test_iacr_seleniumbase_downloads_pdf_without_preview(tmp_path, monkeypatch) -> None:
    calls = []

    class FakeConnection:
        def __init__(self):
            self.handlers = {}
            self.download_dir = None

        def add_handler(self, event_type, handler):
            self.handlers[event_type] = handler

        async def send(self, command):
            payload = next(command)
            assert payload["method"] == "Browser.setDownloadBehavior"
            assert payload["params"]["behavior"] == "allow"
            assert payload["params"]["eventsEnabled"] is True
            self.download_dir = Path(payload["params"]["downloadPath"])

    class FakeLoop:
        def run_until_complete(self, coroutine):
            return asyncio.run(coroutine)

    class FakeCdp:
        def __init__(self):
            self.connection = FakeConnection()
            self.browser = SimpleNamespace(connection=self.connection)
            self.pdf_clicked = False

        def is_element_present(self, selector):
            return True

        def get_page_source(self):
            return "Just a moment..." if self.pdf_clicked else "paper"

        def click(self, selector):
            calls.append(("download", selector))
            self.pdf_clicked = True

        def solve_captcha(self):
            calls.append(("captcha",))
            guid = "download-guid"
            content = b"%PDF-1.7"
            self.connection.handlers[mycdp.browser.DownloadWillBegin](
                mycdp.browser.DownloadWillBegin(
                    "frame", guid, "https://eprint.iacr.org/2025/1.pdf", "1.pdf"
                )
            )
            assert self.connection.download_dir is not None
            (self.connection.download_dir / "1.pdf").write_bytes(content)
            self.connection.handlers[mycdp.browser.DownloadProgress](
                mycdp.browser.DownloadProgress(
                    guid, len(content), len(content), "completed"
                )
            )

        def sleep(self, seconds):
            calls.append(("sleep", seconds))

    class FakeBrowser:
        def __init__(self, **kwargs):
            calls.append(("config", kwargs))
            self.cdp = FakeCdp()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def activate_cdp_mode(self, url):
            calls.append(("open", url))

        def get_event_loop(self):
            return FakeLoop()

    target = tmp_path / "paper.pdf"
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.setenv("SPIDER_PROXY", "http://user:pass@proxy.example:8080")
    monkeypatch.setenv("IACR_CHALLENGE_SOLVE_DELAY", "0")
    download_iacr_pdf(
        "https://eprint.iacr.org/2025/1.pdf", target, browser_factory=FakeBrowser
    )

    assert target.read_bytes() == b"%PDF-1.7"
    assert calls[0][0] == "config"
    assert calls[0][1]["uc"] is True
    assert "test" not in calls[0][1]
    assert calls[0][1]["locale"] == "en"
    assert calls[0][1]["xvfb"] is True
    assert calls[0][1]["chromium_arg"] == "ozone-platform=x11"
    assert calls[0][1]["external_pdf"] is True
    assert calls[0][1]["proxy"] == "user:pass@proxy.example:8080"
    assert "headed" not in calls[0][1]
    assert calls[1:] == [
        ("open", "https://eprint.iacr.org/2025/1"),
        ("download", 'a[href$="/2025/1.pdf"]'),
        ("captcha",),
        ("sleep", 0.25),
    ]


def test_authenticated_socks_proxy_uses_local_http_bridge(monkeypatch) -> None:
    monkeypatch.setenv("SPIDER_PROXY", "socks5://proxy.example:1080:user:pass")

    with iacr_platform.selenium_proxy_from_env() as proxy:
        assert proxy is not None
        host, port = proxy.rsplit(":", 1)
        connection = socket.create_connection((host, int(port)), timeout=1)
        connection.close()

    with pytest.raises(OSError):
        socket.create_connection((host, int(port)), timeout=0.1)


def test_iacr_retries_failed_browser_session(tmp_path, monkeypatch) -> None:
    calls = []

    class FakeBrowser:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def activate_cdp_mode(self, url):
            calls.append(("open", url))

    def fake_browser_factory(**kwargs):
        return FakeBrowser()

    def fake_download(browser, pdf_url, target):
        calls.append(("download", pdf_url))
        if len([call for call in calls if call[0] == "download"]) == 1:
            raise TimeoutError("proxy stalled")
        target.write_bytes(b"%PDF-1.7")

    monkeypatch.delenv("SPIDER_PROXY", raising=False)
    monkeypatch.setenv("IACR_CAPTCHA_ATTEMPTS", "2")
    monkeypatch.setattr(iacr_platform, "_download_pdf_with_browser", fake_download)

    iacr_platform._download_iacr_pdf_in_process(
        "https://eprint.iacr.org/2026/1623.pdf",
        tmp_path / "paper.pdf",
        fake_browser_factory,
    )

    assert [call[0] for call in calls] == ["open", "download", "open", "download"]


def test_iacr_seleniumbase_artifacts_are_isolated(tmp_path, monkeypatch) -> None:
    target = tmp_path / "downloaded" / "paper.pdf"
    worker_cwd = None
    real_run = subprocess.run

    def fake_run(command, **kwargs):
        nonlocal worker_cwd
        if command[:3] != [sys.executable, "-m", "apaper_mcp.platforms.iacr"]:
            return real_run(command, **kwargs)
        worker_cwd = kwargs["cwd"]
        assert command[:3] == [
            sys.executable,
            "-m",
            "apaper_mcp.platforms.iacr",
        ]
        Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(command[-1]).write_bytes(b"%PDF-1.7")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)

    download_iacr_pdf("https://eprint.iacr.org/2025/1.pdf", target)

    assert target.read_bytes() == b"%PDF-1.7"
    assert worker_cwd is not None
    assert not Path(worker_cwd).exists()


def test_iacr_worker_failure_uses_last_traceback_line(tmp_path, monkeypatch) -> None:
    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(
            command,
            1,
            "",
            "Traceback (most recent call last):\nTimeoutError: Browser did not download the IACR PDF\n",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(RuntimeError) as error:
        download_iacr_pdf(
            "https://eprint.iacr.org/2026/1623.pdf", tmp_path / "paper.pdf"
        )

    assert str(error.value) == "TimeoutError: Browser did not download the IACR PDF"
