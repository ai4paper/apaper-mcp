from datetime import datetime, timezone

from apaper_mcp.platforms.arxiv import (
    build_arxiv_search_params,
    compute_backoff_ms,
    looks_like_ip,
    parse_arxiv_search_html,
    parse_retry_after_ms,
)


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
