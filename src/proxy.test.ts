import { describe, expect, test } from "bun:test";

import {
  fetchWithConnRetry,
  installProxy,
  isTransientConnectionError,
  parseProxyUrl,
  redactProxy,
} from "./proxy.js";

describe("parseProxyUrl", () => {
  test("parses the colon-delimited provider form (host:port:user:pass)", () => {
    const cfg = parseProxyUrl("socks5://mobile.kookeey.info:1086:8410-ba47a:49f6");
    expect(cfg).toEqual({
      kind: "socks",
      socksType: 5,
      scheme: "socks5",
      host: "mobile.kookeey.info",
      port: 1086,
      username: "8410-ba47a",
      password: "49f6",
      href: "socks5://8410-ba47a:49f6@mobile.kookeey.info:1086",
    });
  });

  test("parses the standard user:pass@host:port form", () => {
    const cfg = parseProxyUrl("socks5://user:secret@127.0.0.1:1080");
    expect(cfg).toMatchObject({
      kind: "socks",
      socksType: 5,
      host: "127.0.0.1",
      port: 1080,
      username: "user",
      password: "secret",
      href: "socks5://user:secret@127.0.0.1:1080",
    });
  });

  test("parses socks with no auth", () => {
    const cfg = parseProxyUrl("socks5://127.0.0.1:1080");
    expect(cfg).toMatchObject({ kind: "socks", host: "127.0.0.1", port: 1080, href: "socks5://127.0.0.1:1080" });
    expect(cfg?.username).toBeUndefined();
    expect(cfg?.password).toBeUndefined();
  });

  test("classifies socks4 and socks4a as SOCKS4", () => {
    expect(parseProxyUrl("socks4://127.0.0.1:1080")?.socksType).toBe(4);
    expect(parseProxyUrl("socks4a://127.0.0.1:1080")?.socksType).toBe(4);
    expect(parseProxyUrl("socks5h://127.0.0.1:1080")?.socksType).toBe(5);
  });

  test("classifies http and https proxies as kind=http", () => {
    expect(parseProxyUrl("http://user:pass@proxy.example:8080")).toMatchObject({
      kind: "http",
      host: "proxy.example",
      port: 8080,
      username: "user",
      password: "pass",
    });
    expect(parseProxyUrl("https://proxy.example:3128")?.kind).toBe("http");
  });

  test("defaults the scheme to http when none is given", () => {
    expect(parseProxyUrl("proxy.example:8080")).toMatchObject({ kind: "http", scheme: "http", port: 8080 });
  });

  test("percent-decodes credentials in the standard form", () => {
    const cfg = parseProxyUrl("socks5://us%40er:p%3Ass@127.0.0.1:1080");
    expect(cfg?.username).toBe("us@er");
    expect(cfg?.password).toBe("p:ss");
    // …and re-encodes them when rebuilding href.
    expect(cfg?.href).toBe("socks5://us%40er:p%3Ass@127.0.0.1:1080");
  });

  test("preserves '/' in a colon-form password (no truncation)", () => {
    const cfg = parseProxyUrl("socks5://host:1080:user:aB3/xZ9");
    expect(cfg?.password).toBe("aB3/xZ9");
    expect(cfg?.host).toBe("host");
    expect(cfg?.port).toBe(1080);
    expect(cfg?.href).toBe("socks5://user:aB3%2FxZ9@host:1080");
  });

  test("preserves '/', '?', '#' in a standard-form password", () => {
    expect(parseProxyUrl("socks5://user:aB3/xZ9@host:1080")?.password).toBe("aB3/xZ9");
    expect(parseProxyUrl("socks5://user:pa?ss@host:1080")?.password).toBe("pa?ss");
    expect(parseProxyUrl("socks5://user:pa#ss@host:1080")?.password).toBe("pa#ss");
  });

  test("splits userinfo at the LAST '@' so a password may contain '@'", () => {
    const cfg = parseProxyUrl("socks5://user:p@ss@host:1080");
    expect(cfg?.username).toBe("user");
    expect(cfg?.password).toBe("p@ss");
    expect(cfg?.host).toBe("host");
    expect(cfg?.port).toBe(1080);
  });

  test("parses IPv6 proxy hosts and stores them without brackets", () => {
    const noAuth = parseProxyUrl("socks5://[::1]:1080");
    expect(noAuth).toMatchObject({ host: "::1", port: 1080, href: "socks5://[::1]:1080" });

    const withAuth = parseProxyUrl("socks5://user:pass@[2001:db8::1]:1080");
    expect(withAuth).toMatchObject({ host: "2001:db8::1", port: 1080 });
    expect(withAuth?.href).toBe("socks5://user:pass@[2001:db8::1]:1080");
  });

  test("strips a trailing path/query before the authority", () => {
    expect(parseProxyUrl("http://proxy.example:8080/some/path?x=1")).toMatchObject({
      host: "proxy.example",
      port: 8080,
    });
  });

  test("returns null for blank or unparseable values", () => {
    expect(parseProxyUrl(undefined)).toBeNull();
    expect(parseProxyUrl("")).toBeNull();
    expect(parseProxyUrl("   ")).toBeNull();
    expect(parseProxyUrl("socks5://")).toBeNull();
    expect(parseProxyUrl("not-a-proxy")).toBeNull(); // no port, single token
    expect(parseProxyUrl("socks5://host:notaport")).toBeNull();
    expect(parseProxyUrl("socks5://host:99999")).toBeNull(); // port out of range
    expect(parseProxyUrl("socks5://host:1:2")).toBeNull(); // 3 colon-parts is ambiguous
  });
});

describe("redactProxy", () => {
  test("masks the password in the standard form", () => {
    expect(redactProxy("socks5://user:secret@127.0.0.1:1080")).toBe("socks5://user:***@127.0.0.1:1080");
  });

  test("masks the password in the colon-delimited form", () => {
    expect(redactProxy("socks5://mobile.kookeey.info:1086:8410-ba47a:49f6")).toBe(
      "socks5://mobile.kookeey.info:1086:8410-ba47a:***",
    );
  });

  test("leaves a credential-free proxy untouched", () => {
    expect(redactProxy("socks5://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
  });

  test("masks the colon form even when the port is non-numeric", () => {
    // This shape reaches the raw-value log path (parse fails on the bad port).
    expect(redactProxy("socks5://host:10A6:user:SECRET")).toBe("socks5://host:10A6:user:***");
  });

  test("masks a standard-form password containing '/' or ':'", () => {
    expect(redactProxy("socks5://user:se/cr:et@host:1080")).toBe("socks5://user:***@host:1080");
  });
});

describe("isTransientConnectionError", () => {
  test("matches Bun's 'socket connection was closed unexpectedly'", () => {
    expect(
      isTransientConnectionError(
        new Error("The socket connection was closed unexpectedly. For more information, pass `verbose: true`..."),
      ),
    ).toBe(true);
  });

  test("matches common connection-drop codes/messages", () => {
    expect(isTransientConnectionError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientConnectionError({ cause: { code: "UND_ERR_SOCKET" } })).toBe(true);
    expect(isTransientConnectionError(new Error("other side closed"))).toBe(true);
    expect(isTransientConnectionError({ cause: { message: "terminated" } })).toBe(true);
  });

  test("matches connection-establishment failures from flaky proxies", () => {
    expect(isTransientConnectionError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(
      true,
    );
    expect(isTransientConnectionError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isTransientConnectionError(new Error("fetch failed"))).toBe(true);
  });

  test("does NOT match timeouts, aborts, or unrelated errors", () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isTransientConnectionError(timeout)).toBe(false);
    expect(isTransientConnectionError(abort)).toBe(false);
    expect(isTransientConnectionError(new Error("HTTP 404 not found"))).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
  });
});

describe("fetchWithConnRetry", () => {
  const noSleep = async () => {};
  const resp = (status: number) => new Response("ok", { status });

  test("retries an idempotent GET after a transient drop, then succeeds", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error("The socket connection was closed unexpectedly");
      return resp(200);
    };
    const r = await fetchWithConnRetry(doFetch, "url", { method: "GET" }, { sleep: noSleep });
    expect(r.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("defaults to GET (retries) and gives up after exhausting retries", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      throw new Error("ECONNRESET");
    };
    await expect(fetchWithConnRetry(doFetch, "url", undefined, { retries: 2, sleep: noSleep })).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(calls).toBe(3); // initial + 2 retries
  });

  test("never replays a non-idempotent POST", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      throw new Error("socket connection was closed unexpectedly");
    };
    await expect(fetchWithConnRetry(doFetch, "url", { method: "POST" }, { sleep: noSleep })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("does not retry a non-transient error", async () => {
    let calls = 0;
    const doFetch = async () => {
      calls += 1;
      throw new Error("HTTP 500");
    };
    await expect(fetchWithConnRetry(doFetch, "url", {}, { sleep: noSleep })).rejects.toThrow(/HTTP 500/);
    expect(calls).toBe(1);
  });
});

describe("installProxy (fail-closed)", () => {
  test("blocks requests when SPIDER_PROXY is set but unparseable", async () => {
    const saved = globalThis.fetch;
    try {
      const result = await installProxy({ SPIDER_PROXY: "@@garbage@@" } as NodeJS.ProcessEnv);
      expect(result).toBeNull();
      expect(globalThis.fetch).not.toBe(saved); // fetch was replaced with a blocker
      await expect(fetch("https://example.com")).rejects.toThrow(/could not be initialised/);
    } finally {
      globalThis.fetch = saved;
    }
  });

  test("is a no-op when SPIDER_PROXY is unset", async () => {
    const saved = globalThis.fetch;
    try {
      const result = await installProxy({} as NodeJS.ProcessEnv);
      expect(result).toBeNull();
      expect(globalThis.fetch).toBe(saved); // untouched — requests go direct as before
    } finally {
      globalThis.fetch = saved;
    }
  });
});
