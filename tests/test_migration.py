from datetime import datetime, timezone
import asyncio

import httpx
import pytest

from apaper_mcp.platforms.arxiv import (
    build_arxiv_search_params,
    compute_backoff_ms,
    looks_like_ip,
    parse_arxiv_search_html,
    parse_retry_after_ms,
)
from apaper_mcp.platforms.cnki import (
    build_cnki_query_json,
    extract_filename_from_content_disposition,
    parse_cnki_search_html,
)
from apaper_mcp.platforms.dblp import filter_dblp_results, parse_dblp_api_response
from apaper_mcp.formatters import format_iacr_search_response
from apaper_mcp.platforms.iacr import parse_iacr_detail_html, parse_iacr_search_html
from apaper_mcp.proxy import (
    fetch_with_conn_retry,
    is_transient_connection_error,
    parse_proxy_url,
    redact_proxy,
)
from apaper_mcp.platforms.scholar import parse_google_scholar_html


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


def test_arxiv_params_and_parser() -> None:
    params = build_arxiv_search_params(
        "attention", {"categories": ["cs.LG"], "date_from": "2024-01-01"}
    )
    assert params["classification-computer_science"] == "y"
    assert params["date-from_date"] == "2024-01-01"
    html = """
    <li class="arxiv-result"><p class="list-title"><a href="https://arxiv.org/abs/2103.12345v2">x</a>
    <a href="https://arxiv.org/pdf/2103.12345">pdf</a></p><p class="title">Title</p>
    <p class="authors"><a>Alice</a><a>Bob</a></p><span class="abstract-short">Abstract text.</span>
    <div class="tags"><span class="tag is-link">cs.LG</span><span class="tag">cs.AI</span></div>
    <p class="is-size-7">Submitted 22 March, 2021;</p><p class="comments">Comments: Ten pages</p></li>
    """
    paper = parse_arxiv_search_html(html)[0]
    assert paper["paper_id"] == "2103.12345"
    assert paper["authors"] == ["Alice", "Bob"]
    assert paper["comment"] == "Ten pages"


def test_arxiv_retry_helpers() -> None:
    now = datetime(2026, 3, 31, 15, 8, tzinfo=timezone.utc).timestamp() * 1000
    assert parse_retry_after_ms("Mon, 31 Mar 2026 15:10:00 GMT", now) == 120_000
    assert (
        compute_backoff_ms(1, None, {"base_ms": 3000, "max_ms": 60000, "jitter_ms": 0})
        == 6000
    )
    assert looks_like_ip("2001:db8::1")
    assert not looks_like_ip("<html>blocked</html>")


def test_platform_parsers_and_helpers() -> None:
    iacr = parse_iacr_search_html(
        """<div class="mb-4"><div class="d-flex"><a class="paperlink" href="/2025/1014">2025/1014</a><a href="/2025/1014.pdf">(PDF)</a></div><div class="ms-md-4"><strong>Title</strong><span class="fst-italic">Alice, Bob</span><small class="badge">Crypto</small><p class="search-abstract">Abstract</p></div></div>"""
    )
    assert iacr[0]["paper_id"] == "2025/1014"
    detail = parse_iacr_detail_html(
        '<h3 class="mb-3">Detailed</h3><p class="fst-italic">Alice and Bob</p><a class="badge bg-secondary keyword">MPC</a><div>History\n2024-05-01: First version\nShort URL</div>',
        "2024/1",
    )
    assert detail["authors"] == ["Alice", "Bob"]
    scholar = parse_google_scholar_html(
        '<div class="gs_ri"><h3 class="gs_rt"><a href="https://example.com">[PDF] Practical ZK</a></h3><div class="gs_a">Alice, Bob - Journal - 2023</div><div class="gs_rs">Abstract</div><div class="gs_fl"><a>Cited by 12</a></div></div>'
    )
    assert scholar[0]["title"] == "Practical ZK" and scholar[0]["citations"] == 12
    cnki = parse_cnki_search_html(
        '<table class="result-table-list"><tr><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=x">Title</a></td><td class="author"><a class="KnowledgeNetLink">张三</a></td><td class="source"><span>Journal</span></td></tr></table>'
    )
    assert cnki[0]["source"] == "Journal"
    assert (
        extract_filename_from_content_disposition(
            "attachment; filename*=utf-8''%E6%B5%8B%E8%AF%95.pdf"
        )
        == "测试.pdf"
    )
    payload = {
        "result": {
            "hits": {
                "hit": {
                    "info": {
                        "title": "T",
                        "authors": {"author": [{"text": "A"}]},
                        "year": "2024",
                        "venue": "ICLR",
                        "url": "https://dblp.org/rec/x",
                    }
                }
            }
        }
    }
    results = parse_dblp_api_response(payload)
    assert (
        filter_dblp_results(results, {"year_from": 2023, "venue_filter": "iclr"})[0][
            "dblp_key"
        ]
        == "x"
    )


def test_proxy_parsing_redaction_and_transient_retry() -> None:
    config = parse_proxy_url("socks5://host:1086:user:pass")
    assert config == {
        "kind": "socks",
        "socks_type": 5,
        "scheme": "socks5",
        "host": "host",
        "port": 1086,
        "username": "user",
        "password": "pass",
        "href": "socks5://user:pass@host:1086",
    }
    assert parse_proxy_url("socks5://host:99999") is None
    assert (
        redact_proxy("socks5://user:secret@host:1080") == "socks5://user:***@host:1080"
    )
    assert is_transient_connection_error(httpx.ConnectError("ECONNRESET"))
    calls = 0

    def operation():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("socket connection was closed unexpectedly")
        return "ok"

    assert (
        fetch_with_conn_retry(operation, method="GET", retries=1, sleep=lambda _: None)
        == "ok"
    )
    assert calls == 2


def test_proxy_retry_does_not_replay_post() -> None:
    with pytest.raises(httpx.ConnectError):
        fetch_with_conn_retry(
            lambda: (_ for _ in ()).throw(httpx.ConnectError("ECONNRESET")),
            method="POST",
            retries=2,
            sleep=lambda _: None,
        )


def test_arxiv_retries_proxy_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import apaper_mcp.server as server

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


def test_cnki_query_json_contains_subject_search_contract() -> None:
    query = build_cnki_query_json("zero knowledge")
    assert query["Resource"] == "CROSSDB"
    assert query["QNode"]["QGroup"][0]["Items"][0]["Value"] == "zero knowledge"
