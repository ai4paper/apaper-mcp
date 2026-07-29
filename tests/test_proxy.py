import httpx
import pytest

from apaper_mcp.proxy import (
    fetch_with_conn_retry,
    is_transient_connection_error,
    parse_proxy_url,
    redact_proxy,
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
