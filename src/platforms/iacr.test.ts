import { describe, expect, test } from "bun:test";

import {
  buildIacrSearchParams,
  isCloudflareChallenge,
  parseIacrDetailHtml,
  parseIacrSearchHtml,
} from "./iacr.js";

describe("isCloudflareChallenge", () => {
  const make = (status: number, headers: Record<string, string>) => new Response("body", { status, headers });

  test("detects the cf-mitigated challenge header", () => {
    expect(isCloudflareChallenge(make(403, { "cf-mitigated": "challenge" }))).toBe(true);
  });

  test("detects a Cloudflare 403/503 HTML block page", () => {
    expect(
      isCloudflareChallenge(make(403, { server: "cloudflare", "content-type": "text/html; charset=UTF-8" })),
    ).toBe(true);
    expect(isCloudflareChallenge(make(503, { server: "cloudflare", "content-type": "text/html" }))).toBe(true);
  });

  test("does not flag a normal PDF response or an ordinary 404", () => {
    expect(isCloudflareChallenge(make(200, { server: "cloudflare", "content-type": "application/pdf" }))).toBe(false);
    expect(isCloudflareChallenge(make(404, { server: "nginx", "content-type": "text/html" }))).toBe(false);
  });
});

describe("buildIacrSearchParams", () => {
  test("builds search params with optional year bounds", () => {
    const params = buildIacrSearchParams("crypto", 2020, 2024);

    expect(params.toString()).toBe("q=crypto&revisedafter=2020&revisedbefore=2024");
  });
});

describe("parseIacrSearchHtml", () => {
  test("parses fallback search result items", () => {
    const papers = parseIacrSearchHtml(
      `
      <div class="mb-4">
        <div class="d-flex">
          <a class="paperlink" href="/2025/1014">2025/1014</a>
          <a href="/2025/1014.pdf">(PDF)</a>
          <small class="ms-auto">Last updated: 2025-06-02</small>
        </div>
        <div class="ms-md-4">
          <strong>Post-Quantum Example</strong>
          <span class="fst-italic">Alice, Bob</span>
          <small class="badge">Cryptography</small>
          <p class="search-abstract">Short abstract.</p>
        </div>
      </div>
      `,
      false,
    );

    expect(papers).toHaveLength(1);
    expect(papers[0]?.paperId).toBe("2025/1014");
    expect(papers[0]?.title).toBe("Post-Quantum Example");
    expect(papers[0]?.categories).toEqual(["Cryptography"]);
  });
});

describe("parseIacrDetailHtml", () => {
  test("parses paper detail pages", () => {
    const paper = parseIacrDetailHtml(
      `
      <h3 class="mb-3">Detailed Title</h3>
      <p class="fst-italic">Alice and Bob</p>
      <p style="white-space: pre-wrap;">Detailed abstract.</p>
      <a class="badge bg-secondary keyword">MPC</a>
      <div>
        Publication info
        Journal reference
        History
        2024-05-01: First version
        2024-06-01: Revision
        Short URL
      </div>
      `,
      "2024/1",
    );

    expect(paper?.title).toBe("Detailed Title");
    expect(paper?.authors).toEqual(["Alice", "Bob"]);
    expect(paper?.keywords).toEqual(["MPC"]);
    expect(paper?.extra.history).toContain("2024-05-01: First version");
  });
});
