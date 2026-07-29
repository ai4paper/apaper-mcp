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
    assert detail["authors"] == ["Alice", "Bob"]


def test_iacr_seleniumbase_downloads_pdf_without_preview(tmp_path, monkeypatch) -> None:
    calls = []
    browser_downloads = tmp_path / "browser-downloads"
    browser_downloads.mkdir()

    class FakeBrowser:
        def __init__(self, **kwargs):
            calls.append(("config", kwargs))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def activate_cdp_mode(self, url):
            calls.append(("open", url))

        def sleep(self, seconds):
            calls.append(("sleep", seconds))

        def uc_open_with_reconnect(self, url, reconnect_time):
            calls.append(("open_reconnect", url, reconnect_time))

        def get_cookies(self):
            return (
                []
                if not any(call[0] == "captcha" for call in calls)
                else [{"name": "cf_clearance", "value": "clear"}]
            )

        def get_page_source(self):
            return (
                "Just a moment..."
                if not any(call[0] == "captcha" for call in calls)
                else "paper"
            )

        def uc_gui_click_captcha(self):
            calls.append(("captcha",))

        def get_downloaded_files(self, browser=False):
            assert browser is True
            return [path.name for path in browser_downloads.iterdir()]

        def get_browser_downloads_folder(self):
            return str(browser_downloads)

        def open(self, url):
            calls.append(("download", url))
            (browser_downloads / "2025-1.pdf").write_bytes(b"%PDF-1.7")

    target = tmp_path / "paper.pdf"
    monkeypatch.delenv("DISPLAY", raising=False)
    download_iacr_pdf(
        "https://eprint.iacr.org/2025/1.pdf", target, browser_factory=FakeBrowser
    )

    assert target.read_bytes() == b"%PDF-1.7"
    assert calls[0][0] == "config"
    assert calls[0][1]["uc"] is True
    assert calls[0][1]["test"] is True
    assert calls[0][1]["locale"] == "en"
    assert calls[0][1]["xvfb"] is True
    assert calls[0][1]["chromium_arg"] == "ozone-platform=x11"
    assert calls[0][1]["external_pdf"] is True
    assert "headed" not in calls[0][1]
    assert calls[1:] == [
        ("open_reconnect", "https://eprint.iacr.org/2025/1.pdf", 5),
        ("captcha",),
        ("sleep", 3),
        ("download", "https://eprint.iacr.org/2025/1.pdf"),
    ]


def test_iacr_captcha_prefers_gui_handler(monkeypatch) -> None:
    calls = []

    class FakeBrowser:
        def uc_open_with_reconnect(self, url, reconnect_time):
            calls.append(("open", url, reconnect_time))

        def get_cookies(self):
            if ("handle",) in calls:
                return [{"name": "cf_clearance", "value": "clear"}]
            return []

        def get_page_source(self):
            return "Just a moment..."

        def uc_gui_click_captcha(self):
            calls.append(("click",))

        def uc_gui_handle_captcha(self):
            calls.append(("handle",))

        def sleep(self, seconds):
            calls.append(("sleep", seconds))

    monkeypatch.setenv("IACR_CHALLENGE_WAIT", "1")
    iacr_platform._pass_cloudflare_challenge(
        FakeBrowser(), "https://eprint.iacr.org/2025/1.pdf"
    )

    assert calls == [
        ("open", "https://eprint.iacr.org/2025/1.pdf", 5),
        ("handle",),
        ("sleep", 3),
    ]


def test_iacr_browser_download_wait_defaults_to_ten_seconds(
    tmp_path, monkeypatch
) -> None:
    class FakeBrowser:
        def get_browser_downloads_folder(self):
            return str(tmp_path)

        def get_downloaded_files(self, browser=False):
            return []

        def open(self, url):
            pass

        def sleep(self, seconds):
            raise AssertionError("The ten-second deadline should have expired")

    times = iter((100, 110))
    monkeypatch.delenv("IACR_DOWNLOAD_WAIT", raising=False)
    monkeypatch.setattr(iacr_platform.time, "monotonic", lambda: next(times))

    with pytest.raises(TimeoutError, match="did not download"):
        iacr_platform._download_pdf_with_browser(
            FakeBrowser(), "https://eprint.iacr.org/2025/1.pdf", tmp_path / "paper.pdf"
        )
