import { Buffer } from "node:buffer";

/**
 * Optional outbound-proxy support.
 *
 * When the `SPIDER_PROXY` env var is set, every outbound `fetch` this server
 * makes — arXiv, IACR, DBLP, Google Scholar, CNKI, and all PDF downloads — is
 * routed through the given proxy. We install it as a single chokepoint by
 * patching `globalThis.fetch` once at startup, so the platform modules need no
 * changes and any future fetch is covered too.
 *
 * Supported `SPIDER_PROXY` forms (scheme defaults to `http` when omitted):
 *
 *   socks5://user:pass@host:port      standard URL form
 *   socks5://host:port:user:pass      colon-delimited form (e.g. Kookeey)
 *   socks5://host:port                no auth
 *   socks4://host:port                SOCKS4
 *   http://user:pass@host:port        HTTP CONNECT proxy
 *   https://user:pass@host:port       HTTP CONNECT proxy reached over TLS
 *
 * Runtime split — the two JS runtimes proxy fetch very differently:
 *
 *   • Node (the published binary's runtime): the built-in `fetch` won't accept
 *     a `proxy` option and its *bundled* undici rejects a foreign dispatcher
 *     (`invalid onRequestStart`). So we route through the *installed* undici's
 *     own `fetch` paired with an undici `Dispatcher` (a SOCKS dispatcher from
 *     `fetch-socks`, or undici's `ProxyAgent` for HTTP). Both come from the same
 *     undici version, which is what makes it work. Covers SOCKS and HTTP.
 *
 *   • Bun (the `dev`/`start` scripts): its native `fetch` accepts a `proxy`
 *     URL, but only for HTTP(S) — SOCKS throws `UnsupportedProxyProtocol` — and
 *     it *silently ignores* an undici dispatcher (requests would leak direct).
 *     So under Bun we inject Bun's native `proxy` option, pointing it at the
 *     HTTP proxy directly or, for a SOCKS proxy, at a local HTTP→SOCKS bridge we
 *     spin up in-process (see {@link startSocksBridge}).
 */

/**
 * The runtime's pristine `fetch`, captured at module load — before
 * {@link installProxy} can replace `globalThis.fetch`. Callers that must NOT be
 * proxied import this instead of using the global `fetch`. CNKI is the one such
 * caller: it authenticates by institutional IP, so it has to keep this host's
 * real egress IP rather than the proxy's.
 */
export const directFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export interface ProxyConfig {
  /** "socks" routes via fetch-socks; "http" via undici's ProxyAgent. */
  kind: "socks" | "http";
  /** SOCKS protocol version; only meaningful when `kind === "socks"`. */
  socksType: 4 | 5;
  /** Lowercased URL scheme as supplied (e.g. "socks5", "http"). */
  scheme: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Normalized standard URL form with creds percent-encoded, e.g. `socks5://u:p@host:1086`. */
  href: string;
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

/** decodeURIComponent that returns the input unchanged on malformed escapes. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a port token, requiring it to be all digits and in range. */
function parsePort(token: string): number | null {
  if (!/^\d+$/.test(token)) return null;
  const port = Number(token);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Split a `host:port` (optionally an `[ipv6]:port` literal) into a bare host and
 * a validated port. The host is returned WITHOUT IPv6 brackets so it can be
 * handed straight to the SOCKS dispatcher.
 */
function splitHostPort(value: string): { host: string; port: number } | null {
  const hp = value.trim();
  if (hp.startsWith("[")) {
    const end = hp.indexOf("]");
    if (end === -1 || hp[end + 1] !== ":") return null;
    const host = hp.slice(1, end);
    const port = parsePort(hp.slice(end + 2));
    return host && port !== null ? { host, port } : null;
  }
  const idx = hp.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = hp.slice(0, idx);
  const port = parsePort(hp.slice(idx + 1));
  return host && port !== null ? { host, port } : null;
}

/** Wrap an IPv6 literal host in brackets for use in a URL; pass others through. */
function bracketHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Parse a proxy URL into a normalized {@link ProxyConfig}, or `null` if it is
 * blank or unparseable. Pure and side-effect free so it can be unit-tested.
 *
 * Accepts both the standard `scheme://[user:pass@]host:port` form and the
 * colon-delimited `scheme://host:port:user:pass` form that some mobile-proxy
 * providers (e.g. Kookeey) hand out. Credentials may contain `/`, `?`, `#`, and
 * `:` (in the standard form), so we never strip a "path" off the userinfo.
 */
export function parseProxyUrl(raw: string | undefined | null): ProxyConfig | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const schemeMatch = SCHEME_RE.exec(trimmed);
  const scheme = (schemeMatch?.[1] ?? "http").toLowerCase();
  const rest = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed;
  if (!rest) return null;

  let host: string;
  let port: number;
  let username: string | undefined;
  let password: string | undefined;

  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    // Standard form: userinfo@host:port[/path]. Userinfo is everything before
    // the LAST '@' (so a '@' in the password is fine); strip a trailing path
    // only from the host:port that follows it — never from the userinfo.
    const userinfo = rest.slice(0, at);
    const hp = splitHostPort(rest.slice(at + 1).replace(/[/?#].*$/, ""));
    if (!hp) return null;
    host = hp.host;
    port = hp.port;
    const colon = userinfo.indexOf(":");
    if (colon === -1) {
      username = safeDecode(userinfo);
    } else {
      username = safeDecode(userinfo.slice(0, colon));
      password = safeDecode(userinfo.slice(colon + 1)); // may itself contain ':'
    }
  } else if (rest.startsWith("[")) {
    // No auth, IPv6 literal: [::1]:1080 (drop any trailing path first).
    const hp = splitHostPort(rest.replace(/[/?#].*$/, ""));
    if (!hp) return null;
    host = hp.host;
    port = hp.port;
  } else {
    // No '@'. Either host:port, or the colon-delimited host:port:user:pass form.
    // The password is the LAST field and may contain '/', '?', '#', so split on
    // ':' without stripping a path. (A ':' inside a colon-form password is not
    // representable — use the standard user:pass@host form for that.)
    const parts = rest.split(":");
    if (parts.length === 2) {
      const p = parsePort(parts[1]!.replace(/[/?#].*$/, ""));
      if (p === null) return null;
      host = parts[0]!;
      port = p;
    } else if (parts.length === 4) {
      const p = parsePort(parts[1]!);
      if (p === null) return null;
      host = parts[0]!;
      port = p;
      username = parts[2];
      password = parts[3];
    } else {
      return null;
    }
  }

  host = host.trim();
  if (!host) return null;
  if (username === "") username = undefined;
  if (password === "") password = undefined;

  const kind = scheme.startsWith("socks") ? "socks" : "http";
  const socksType: 4 | 5 = scheme === "socks4" || scheme === "socks4a" ? 4 : 5;

  const auth =
    username !== undefined
      ? `${encodeURIComponent(username)}${password !== undefined ? `:${encodeURIComponent(password)}` : ""}@`
      : "";
  const href = `${scheme}://${auth}${bracketHost(host)}:${port}`;

  return { kind, socksType, scheme, host, port, username, password, href };
}

/**
 * Build an undici `Dispatcher` for the given proxy. SOCKS proxies use
 * `fetch-socks` (which handles the TLS upgrade for https targets); HTTP proxies
 * use undici's `ProxyAgent`. The proxy libraries are imported lazily so they are
 * only loaded when a proxy is actually configured.
 */
export async function buildDispatcher(cfg: ProxyConfig): Promise<unknown> {
  if (cfg.kind === "socks") {
    const { socksDispatcher } = await import("fetch-socks");
    return socksDispatcher({
      type: cfg.socksType,
      host: cfg.host,
      port: cfg.port,
      userId: cfg.username,
      password: cfg.password,
    });
  }

  const { ProxyAgent } = await import("undici");
  const opts: { uri: string; token?: string } = { uri: `${cfg.scheme}://${bracketHost(cfg.host)}:${cfg.port}` };
  if (cfg.username !== undefined) {
    const basic = Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64");
    opts.token = `Basic ${basic}`;
  }
  return new ProxyAgent(opts);
}

/**
 * Mask the password in a proxy string before logging it, in either supported
 * form. Best-effort: host, port, and username stay visible for debugging.
 */
export function redactProxy(value: string): string {
  // Standard form: mask everything between the first ':' of the userinfo and the
  // LAST '@', so any password byte (including ':' or '/') is covered.
  const at = value.lastIndexOf("@");
  if (at !== -1) {
    const schemeIdx = value.indexOf("//");
    const userStart = schemeIdx === -1 ? 0 : schemeIdx + 2;
    const colon = value.indexOf(":", userStart);
    if (colon !== -1 && colon < at) {
      return `${value.slice(0, colon + 1)}***${value.slice(at)}`;
    }
    return value; // user-only — nothing secret to mask
  }
  // Colon-delimited form: scheme://host:port:user:PASS — mask the 4th segment,
  // whether or not the port parsed as a number.
  return value.replace(/^(\s*(?:[\w+.-]+:\/\/)?[^:/\s]+:[^:/\s]+:[^:/\s]+:)\S+/, "$1***");
}

let active: ProxyConfig | null = null;

/** The proxy currently in effect, or `null` if none was installed. */
export function activeProxy(): ProxyConfig | null {
  return active;
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

// Error shapes that mean a proxied request failed to connect or the connection
// dropped mid-flight — worth a retry on a fresh connection. Flaky residential/
// mobile SOCKS proxies do this constantly: Bun surfaces it as "socket connection
// was closed unexpectedly" or "Unable to connect…", undici as ECONNRESET /
// UND_ERR_SOCKET / "terminated". A caller-side AbortSignal *timeout* is excluded
// (see the name guard) — that is the request's own deadline, not a proxy blip.
const TRANSIENT_CONN_RE =
  /socket connection|connection (?:was )?clos|connection reset|socket hang ?up|other side closed|reset by peer|unable to connect|failed to connect|could not connect|connection refused|connection timed? ?out|fetch failed|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|terminated/i;

/** Whether an error looks like a transient connection failure (not a request-timeout/abort). */
export function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.name === "AbortError" || e.name === "TimeoutError") return false;
  const parts = [e.code, e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" ");
  return TRANSIENT_CONN_RE.test(parts);
}

/**
 * Call `doFetch`, retrying idempotent (GET/HEAD) requests a few times when the
 * proxied connection drops. This gives every proxied source the resilience the
 * arXiv client already has, so a flaky proxy hiccup on one of IACR's many
 * per-result requests no longer fails the whole search. Non-idempotent methods
 * (e.g. CNKI's POSTs — which bypass the proxy anyway) are never replayed.
 */
export async function fetchWithConnRetry(
  doFetch: (input: unknown, init: unknown) => Promise<Response>,
  input: unknown,
  init: unknown,
  opts: { retries?: number; backoffMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 150;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const method = String((init as { method?: string } | undefined)?.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";

  for (let attempt = 0; ; attempt++) {
    try {
      return await doFetch(input, init);
    } catch (error) {
      if (!idempotent || attempt >= retries || !isTransientConnectionError(error)) throw error;
      await sleep(backoffMs * (attempt + 1));
    }
  }
}

/**
 * Fail closed: when SPIDER_PROXY was set but the proxy could not be installed,
 * replace `globalThis.fetch` with a stub that rejects every call, so no request
 * ever silently goes out on the real IP. CNKI is unaffected — it uses
 * {@link directFetch}, which is intentionally never proxied.
 */
function installBlockingFetch(reason: string): void {
  globalThis.fetch = (async (_input: unknown, _init?: unknown): Promise<Response> => {
    throw new Error(
      `SPIDER_PROXY is set but the proxy could not be initialised (${reason}); ` +
        `refusing to send requests directly. Fix or unset SPIDER_PROXY.`,
    );
  }) as unknown as typeof fetch;
}

/** Node path: undici's own `fetch` + a dispatcher (handles SOCKS and HTTP). */
async function installForNode(cfg: ProxyConfig): Promise<ProxyConfig | null> {
  let dispatcher: unknown;
  try {
    dispatcher = await buildDispatcher(cfg);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[apaper-mcp] Failed to initialise proxy (${redactProxy(cfg.href)}): ${reason}. Blocking direct requests.`,
    );
    installBlockingFetch(reason);
    return null;
  }

  const { fetch: undiciFetch } = await import("undici");
  const call = (i: unknown, n: unknown) => (undiciFetch as Function)(i, n) as Promise<Response>;
  globalThis.fetch = ((input: unknown, init?: { dispatcher?: unknown }) => {
    // Honour an explicit per-call dispatcher if one is ever passed.
    if (init && init.dispatcher) return call(input, init);
    return fetchWithConnRetry(call, input, { ...(init ?? {}), dispatcher });
  }) as typeof fetch;

  active = cfg;
  console.error(`[apaper-mcp] Routing outbound requests through ${redactProxy(cfg.href)} (${cfg.kind})`);
  return cfg;
}

/** Split a CONNECT target (`host:port` or `[ipv6]:port`) into host and port. */
function splitConnectTarget(target: string): { host: string; port: number } {
  if (target.startsWith("[")) {
    const end = target.indexOf("]");
    return { host: target.slice(1, end), port: Number(target.slice(end + 2)) };
  }
  const idx = target.lastIndexOf(":");
  return { host: target.slice(0, idx), port: Number(target.slice(idx + 1)) };
}

// Kept alive for the process lifetime once started.
let bridgeServer: { close(): void } | undefined;

/**
 * Start a local HTTP CONNECT proxy that tunnels through the configured SOCKS
 * proxy, returning its `http://127.0.0.1:<port>` URL. Bun's native fetch `proxy`
 * option speaks HTTP, not SOCKS, so this bridge is how SOCKS works under Bun.
 * The listener is `unref`'d so it never keeps the process alive on its own.
 */
async function startSocksBridge(cfg: ProxyConfig): Promise<string> {
  const { createServer } = await import("node:net");
  const { SocksClient } = await import("socks");

  const server = createServer((client) => {
    client.once("error", () => client.destroy());
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return; // wait for the full CONNECT request line + headers
      client.removeListener("data", onData);
      const firstLine = buf.subarray(0, buf.indexOf("\r\n")).toString("latin1");
      const leftover = buf.subarray(headerEnd + 4);
      const match = /^CONNECT\s+(\S+)\s+HTTP/i.exec(firstLine);
      if (!match) {
        client.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
        return;
      }
      const { host, port } = splitConnectTarget(match[1]!);
      SocksClient.createConnection({
        proxy: { host: cfg.host, port: cfg.port, type: cfg.socksType, userId: cfg.username, password: cfg.password },
        command: "connect",
        destination: { host, port },
      })
        .then(({ socket }) => {
          socket.once("error", () => client.destroy());
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (leftover.length) socket.write(leftover);
          socket.pipe(client);
          client.pipe(socket);
        })
        .catch(() => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    };
    client.on("data", onData);
  });

  bridgeServer = server;
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/**
 * Bun path: Bun's native fetch `proxy` option. HTTP proxies are used directly;
 * SOCKS proxies are reached through a local HTTP→SOCKS bridge (Bun's native
 * fetch can't speak SOCKS itself).
 */
async function installForBun(cfg: ProxyConfig): Promise<ProxyConfig | null> {
  let proxyUrl = cfg.href;
  if (cfg.kind === "socks") {
    try {
      proxyUrl = await startSocksBridge(cfg);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[apaper-mcp] Failed to start SOCKS bridge for ${redactProxy(cfg.href)}: ${reason}. Blocking direct requests.`,
      );
      installBlockingFetch(reason);
      return null;
    }
  }

  const original = globalThis.fetch;
  const call = (i: unknown, n: unknown) => (original as Function)(i, n) as Promise<Response>;
  globalThis.fetch = ((input: unknown, init?: { proxy?: string }) => {
    if (init && init.proxy) return call(input, init);
    return fetchWithConnRetry(call, input, { ...(init ?? {}), proxy: proxyUrl });
  }) as typeof fetch;

  active = cfg;
  console.error(`[apaper-mcp] Routing outbound requests through ${redactProxy(cfg.href)} (${cfg.kind})`);
  return cfg;
}

/**
 * Read `SPIDER_PROXY` and, if set to a valid proxy, route every outbound
 * `fetch` through it by replacing `globalThis.fetch`. Returns the active
 * {@link ProxyConfig}, or `null` when no proxy is configured.
 *
 * Fails closed: if SPIDER_PROXY is set but unparseable or its dispatcher can't
 * be built, requests are blocked (not sent direct) so a misconfigured proxy can
 * never silently leak this host's real IP. An unset/blank value is a no-op.
 * Safe to call once at startup. (CNKI always bypasses the proxy via
 * {@link directFetch} regardless.)
 */
export async function installProxy(env: NodeJS.ProcessEnv = process.env): Promise<ProxyConfig | null> {
  const raw = env.SPIDER_PROXY;
  const cfg = parseProxyUrl(raw);
  if (!cfg) {
    if (raw && raw.trim()) {
      console.error(
        `[apaper-mcp] SPIDER_PROXY is set but unparseable (${redactProxy(raw)}); blocking direct requests. ` +
          `Fix or unset it.`,
      );
      installBlockingFetch("unparseable SPIDER_PROXY value");
    }
    return null;
  }

  return isBunRuntime() ? installForBun(cfg) : installForNode(cfg);
}
