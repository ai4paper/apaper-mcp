import re
import select
import socketserver
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from urllib.parse import quote, unquote

import httpx

_TRANSIENT = re.compile(r"socket connection|connection (?:was )?clos|connection reset|socket hang ?up|other side closed|reset by peer|unable to connect|failed to connect|could not connect|connection refused|connection timed? ?out|fetch failed|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|terminated", re.I)


def _port(value: str) -> int | None:
    return int(value) if value.isdigit() and 1 <= int(value) <= 65535 else None


def _host_port(value: str) -> tuple[str, int] | None:
    if value.startswith("["):
        end = value.find("]")
        if end < 0 or end + 1 >= len(value) or value[end + 1] != ":": return None
        port = _port(value[end + 2:])
        return (value[1:end], port) if port else None
    host, sep, raw_port = value.rpartition(":")
    port = _port(raw_port)
    return (host, port) if sep and host and port else None


def parse_proxy_url(raw: str | None) -> dict[str, object] | None:
    if not raw or not raw.strip(): return None
    value = raw.strip(); match = re.match(r"^([a-z][a-z0-9+.-]*):\/\/", value, re.I)
    scheme = (match.group(1) if match else "http").lower(); rest = value[match.end():] if match else value
    if not rest: return None
    username = password = None
    if "@" in rest:
        userinfo, _, authority = rest.rpartition("@")
        hp = _host_port(re.sub(r"[/?#].*$", "", authority))
        if not hp: return None
        host, port = hp; parts = userinfo.split(":", 1); username = unquote(parts[0]) or None
        password = unquote(parts[1]) if len(parts) == 2 and parts[1] else None
    elif rest.startswith("["):
        hp = _host_port(re.sub(r"[/?#].*$", "", rest))
        if not hp: return None
        host, port = hp
    else:
        parts = rest.split(":")
        if len(parts) == 2:
            port = _port(re.sub(r"[/?#].*$", "", parts[1])); host = parts[0]
            if not port: return None
        elif len(parts) == 4:
            port = _port(parts[1]); host, username, password = parts[0], parts[2] or None, parts[3] or None
            if not port: return None
        else: return None
    if not host.strip(): return None
    kind = "socks" if scheme.startswith("socks") else "http"
    socks_type = 4 if scheme in ("socks4", "socks4a") else 5
    authority = f"[{host}]" if ":" in host else host
    auth = f"{quote(str(username), safe='')}:{quote(str(password), safe='')}@" if username is not None and password is not None else (f"{quote(str(username), safe='')}@" if username is not None else "")
    return {"kind": kind, "socks_type": socks_type, "scheme": scheme, "host": host, "port": port, "username": username, "password": password, "href": f"{scheme}://{auth}{authority}:{port}"}


def redact_proxy(value: str) -> str:
    at = value.rfind("@")
    if at >= 0:
        start = value.find("//") + 2 if "//" in value else 0; colon = value.find(":", start)
        return value[:colon + 1] + "***" + value[at:] if colon >= start else value
    return re.sub(r"^(\s*(?:[\w+.-]+:\/\/)?[^:/\s]+:[^:/\s]+:[^:/\s]+:)\S+", r"\1***", value)


def is_transient_connection_error(error: object) -> bool:
    if getattr(error, "name", "") in ("AbortError", "TimeoutError"): return False
    parts = str(error) + " " + " ".join(str(getattr(error, attr, "")) for attr in ("code", "message"))
    cause = getattr(error, "__cause__", None)
    parts += " " + " ".join(str(getattr(cause, attr, "")) for attr in ("code", "message"))
    return bool(_TRANSIENT.search(parts))


def fetch_with_conn_retry(operation: Callable[[], object], *, method: str = "GET", retries: int = 2, backoff_ms: int = 150, sleep: Callable[[float], object] = time.sleep) -> object:
    for attempt in range(retries + 1):
        try: return operation()
        except Exception as error:
            if method.upper() not in ("GET", "HEAD") or attempt >= retries or not is_transient_connection_error(error): raise
            sleep(backoff_ms * (attempt + 1) / 1000)


def proxy_url_from_env() -> str | None:
    import os

    cfg = parse_proxy_url(os.getenv("SPIDER_PROXY"))
    if os.getenv("SPIDER_PROXY", "").strip() and not cfg:
        raise RuntimeError("SPIDER_PROXY is set but the proxy could not be initialised (unparseable SPIDER_PROXY value); refusing to send requests directly. Fix or unset SPIDER_PROXY.")
    return str(cfg["href"]) if cfg else None


class _SocksConnectHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        request = self.rfile.readline(65537)
        if not request:
            return
        try:
            method, authority, _ = request.decode("ascii").split()
            destination = _host_port(authority)
            if method != "CONNECT" or destination is None:
                self.wfile.write(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
                return
            while self.rfile.readline(65537) not in (b"\r\n", b"\n", b""):
                pass

            import socks

            if not isinstance(self.server, _SocksConnectServer):
                raise TypeError("Unexpected proxy server type")
            config = self.server.proxy_config
            username = config["username"]
            password = config["password"]
            upstream = socks.socksocket()
            upstream.set_proxy(
                socks.SOCKS4 if config["socks_type"] == 4 else socks.SOCKS5,
                str(config["host"]),
                int(str(config["port"])),
                rdns=True,
                username=str(username) if username is not None else None,
                password=str(password) if password is not None else None,
            )
            upstream.settimeout(30)
            upstream.connect(destination)
        except Exception:
            self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            return

        try:
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            self.wfile.flush()
            upstream.settimeout(None)
            sockets = (self.connection, upstream)
            while True:
                readable, _, _ = select.select(sockets, (), (), 1)
                for source in readable:
                    try:
                        data = source.recv(65536)
                    except OSError:
                        return
                    if not data:
                        return
                    try:
                        (
                            upstream
                            if source is self.connection
                            else self.connection
                        ).sendall(data)
                    except OSError:
                        return
        finally:
            upstream.close()


class _SocksConnectServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    proxy_config: dict[str, object]


@contextmanager
def selenium_proxy_from_env() -> Iterator[str | None]:
    """Yield a proxy format SeleniumBase supports, bridging SOCKS auth locally."""
    import os

    raw = os.getenv("SPIDER_PROXY")
    config = parse_proxy_url(raw)
    if raw and raw.strip() and not config:
        proxy_url_from_env()
    if not config:
        yield None
        return

    if config["kind"] == "socks" and config["username"] is not None:
        server = _SocksConnectServer(("127.0.0.1", 0), _SocksConnectHandler)
        server.proxy_config = config
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address[:2]
            yield f"{host}:{port}"
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        return

    host = f"[{config['host']}]" if ":" in str(config["host"]) else config["host"]
    endpoint = f"{host}:{config['port']}"
    if config["username"] is not None:
        password = config["password"] or ""
        yield f"{config['username']}:{password}@{endpoint}"
    elif config["kind"] == "socks":
        yield f"{config['scheme']}://{endpoint}"
    else:
        yield endpoint


def make_client(*, direct: bool = False, timeout: float = 30) -> httpx.Client:
    return httpx.Client(proxy=None if direct else proxy_url_from_env(), timeout=timeout, follow_redirects=True)
