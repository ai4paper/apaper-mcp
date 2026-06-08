import { describe, expect, test } from "bun:test";

import {
  buildArxivSearchParams,
  buildArxivSearchUrl,
  computeBackoffMs,
  createThrottle,
  isRetryableStatus,
  looksLikeIp,
  parseArxivSearchHtml,
  parseRetryAfterMs,
} from "./arxiv.js";

describe("buildArxivSearchParams", () => {
  test("plain query uses simple search params (no advanced form)", () => {
    const params = buildArxivSearchParams("transformer");
    expect(params.get("searchtype")).toBe("all");
    expect(params.get("query")).toBe("transformer");
    expect(params.get("size")).toBe("25");
    expect(params.has("advanced")).toBe(false);
  });

  test("detects ti: / au: / abs: field prefixes (switches to advanced form)", () => {
    expect(buildArxivSearchParams("ti:attention").get("terms-0-field")).toBe("title");
    expect(buildArxivSearchParams("au:Hinton").get("terms-0-field")).toBe("author");
    expect(buildArxivSearchParams("abs:diffusion").get("terms-0-field")).toBe("abstract");
    expect(buildArxivSearchParams("au:Hinton").get("terms-0-term")).toBe("Hinton");
  });

  test("applies date range and switches sort order on sort_by=date", () => {
    const params = buildArxivSearchParams("rl", {
      dateFrom: "2024-01-01",
      dateTo: "2024-06-30",
      sortBy: "date",
    });
    expect(params.get("date-filter_by")).toBe("date_range");
    expect(params.get("date-from_date")).toBe("2024-01-01");
    expect(params.get("date-to_date")).toBe("2024-06-30");
    expect(params.get("order")).toBe("-announced_date_first");
  });

  test("maps cs.* categories to the computer_science classification group", () => {
    const params = buildArxivSearchParams("x", { categories: ["cs.LG", "cs.AI"] });
    expect(params.get("classification-computer_science")).toBe("y");
    expect(params.get("classification-include_cross_list")).toBe("include");
  });

  test("rounds max_results up to the next arXiv page size bucket", () => {
    expect(buildArxivSearchParams("x", { maxResults: 30 }).get("size")).toBe("50");
    expect(buildArxivSearchParams("x", { maxResults: 75 }).get("size")).toBe("100");
    expect(buildArxivSearchParams("x", { maxResults: 150 }).get("size")).toBe("200");
  });

  test("throws on empty query without date range", () => {
    expect(() => buildArxivSearchParams("")).toThrow("No search criteria provided");
  });

  test("rejects invalid date format", () => {
    expect(() => buildArxivSearchParams("x", { dateFrom: "2024/01/01" })).toThrow(/Invalid date_from format/);
  });
});

describe("buildArxivSearchUrl", () => {
  test("plain query targets arxiv.org/search/ with simple params", () => {
    const url = buildArxivSearchUrl("transformer");
    expect(url.startsWith("https://arxiv.org/search/?")).toBe(true);
    expect(url).toContain("query=transformer");
    expect(url).not.toContain("advanced=");
  });

  test("filtered query targets arxiv.org/search/advanced with form params", () => {
    const url = buildArxivSearchUrl("attention", { categories: ["cs.LG"], dateFrom: "2023-01-01" });
    expect(url.startsWith("https://arxiv.org/search/advanced?")).toBe(true);
    expect(url).toContain("advanced=");
    expect(url).toContain("terms-0-term=attention");
    expect(url).toContain("classification-computer_science=y");
    expect(url).toContain("date-from_date=2023-01-01");
  });
});

describe("parseArxivSearchHtml", () => {
  test("extracts paper fields from a sample search result", () => {
    const html = `
      <ol id="results">
        <li class="arxiv-result">
          <div class="is-marginless">
            <p class="list-title is-inline-block">
              <a href="https://arxiv.org/abs/2103.12345">arXiv:2103.12345</a>
              <span>&nbsp;[<a href="https://arxiv.org/pdf/2103.12345">pdf</a>, <a href="https://arxiv.org/format/2103.12345">other</a>]&nbsp;</span>
            </p>
            <div class="tags is-inline-block">
              <span class="tag is-small is-link tooltip" data-tooltip="Machine Learning">cs.LG</span>
              <span class="tag is-small is-grey tooltip" data-tooltip="Artificial Intelligence">cs.AI</span>
            </div>
          </div>
          <p class="title is-5 mathjax">Attention Is All You Need (Again)</p>
          <p class="authors">
            <span class="has-text-black-bis has-text-weight-semibold">Authors:</span>
            <a href="/search/?searchtype=author&amp;query=A">Alice Example</a>,
            <a href="/search/?searchtype=author&amp;query=B">Bob Example</a>
          </p>
          <p class="abstract mathjax">
            <span class="search-hit">Abstract</span>:
            <span class="abstract-short">Short text...</span>
            <span class="abstract-full">This is the full abstract about attention.</span>
          </p>
          <p class="is-size-7">
            <span>Submitted</span> 22 March, 2021;
            <span>originally announced</span> March 2021.
          </p>
          <p class="comments is-size-7"><span>Comments:</span> 10 pages, 5 figures</p>
          <p class="comments is-size-7"><span>Journal ref:</span> NeurIPS 2021</p>
        </li>
      </ol>
    `;

    const papers = parseArxivSearchHtml(html);
    expect(papers).toHaveLength(1);
    const paper = papers[0]!;
    expect(paper.paperId).toBe("2103.12345");
    expect(paper.title).toBe("Attention Is All You Need (Again)");
    expect(paper.authors).toEqual(["Alice Example", "Bob Example"]);
    expect(paper.primaryCategory).toBe("cs.LG");
    expect(paper.categories).toEqual(["cs.LG", "cs.AI"]);
    expect(paper.abstract).toBe("This is the full abstract about attention.");
    expect(paper.pdfUrl).toBe("https://arxiv.org/pdf/2103.12345");
    expect(paper.url).toBe("https://arxiv.org/abs/2103.12345");
    expect(paper.comment).toBe("10 pages, 5 figures");
    expect(paper.journalRef).toBe("NeurIPS 2021");
    expect(paper.publishedDate.startsWith("2021-03-22")).toBe(true);
  });

  test("strips version suffix and falls back to short abstract when full is missing", () => {
    const html = `
      <li class="arxiv-result">
        <p class="list-title is-inline-block"><a href="https://arxiv.org/abs/2401.99999v3">x</a></p>
        <p class="title is-5 mathjax">T</p>
        <p class="abstract mathjax"><span class="abstract-short">Just the short text.</span></p>
      </li>
    `;
    const papers = parseArxivSearchHtml(html);
    expect(papers[0]?.paperId).toBe("2401.99999");
    expect(papers[0]?.abstract).toBe("Just the short text.");
  });

  test("returns empty array when no results are present", () => {
    expect(parseArxivSearchHtml("<html><body><p>No results.</p></body></html>")).toEqual([]);
  });
});

describe("isRetryableStatus", () => {
  test("treats 429 and 5xx gateway errors as retryable", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  test("does not retry success or client errors other than 429", () => {
    for (const status of [200, 301, 400, 403, 404, 410]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe("parseRetryAfterMs", () => {
  test("parses delta-seconds form", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "120" }))).toBe(120_000);
  });

  test("parses HTTP-date form relative to now", () => {
    const now = Date.parse("2026-03-31T15:08:00Z");
    const ms = parseRetryAfterMs(new Headers({ "retry-after": "Mon, 31 Mar 2026 15:10:00 GMT" }), now);
    expect(ms).toBe(120_000);
  });

  test("clamps a past HTTP-date to zero rather than going negative", () => {
    const now = Date.parse("2026-03-31T15:10:00Z");
    const ms = parseRetryAfterMs(new Headers({ "retry-after": "Mon, 31 Mar 2026 15:08:00 GMT" }), now);
    expect(ms).toBe(0);
  });

  test("accepts a zero-second delay", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "0" }))).toBe(0);
  });

  test("rejects non-integer delta-seconds rather than coercing them", () => {
    // Negative would otherwise clamp to 0 ("retry now"); the others would
    // coerce to absurd or fractional delays via Number().
    expect(parseRetryAfterMs(new Headers({ "retry-after": "-120" }))).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "1e10" }))).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "1.5" }))).toBeNull();
  });

  test("returns null when the header is absent or unparseable", () => {
    expect(parseRetryAfterMs(new Headers())).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "   " }))).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "soon" }))).toBeNull();
  });
});

describe("looksLikeIp", () => {
  test("accepts IPv4 and IPv6 addresses", () => {
    expect(looksLikeIp("203.0.113.5")).toBe(true);
    expect(looksLikeIp("2001:db8::1")).toBe(true);
    expect(looksLikeIp("::1")).toBe(true);
  });

  test("rejects HTML error pages and other junk", () => {
    expect(looksLikeIp("<!DOCTYPE html><html>Too Many Requests</html>")).toBe(false);
    expect(looksLikeIp("a.b.c.d")).toBe(false);
    expect(looksLikeIp("...")).toBe(false);
    expect(looksLikeIp("")).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  const opts = { baseMs: 3_000, maxMs: 60_000, jitterMs: 0 };

  test("grows exponentially with the attempt number", () => {
    expect(computeBackoffMs(0, null, opts)).toBe(3_000);
    expect(computeBackoffMs(1, null, opts)).toBe(6_000);
    expect(computeBackoffMs(2, null, opts)).toBe(12_000);
  });

  test("caps the delay at maxMs", () => {
    expect(computeBackoffMs(10, null, opts)).toBe(60_000);
  });

  test("keeps the cap hard even when jitter is added", () => {
    const jittered = { baseMs: 3_000, maxMs: 60_000, jitterMs: 500 };
    expect(computeBackoffMs(10, null, jittered, () => 1)).toBeLessThanOrEqual(60_000);
  });

  test("never waits less than the server's Retry-After", () => {
    expect(computeBackoffMs(0, 30_000, opts)).toBe(30_000);
  });

  test("still caps a long Retry-After at maxMs", () => {
    expect(computeBackoffMs(0, 600_000, opts)).toBe(60_000);
  });

  test("adds bounded jitter using the injected RNG", () => {
    const jittered = { baseMs: 3_000, maxMs: 60_000, jitterMs: 500 };
    expect(computeBackoffMs(0, null, jittered, () => 0)).toBe(3_000);
    expect(computeBackoffMs(0, null, jittered, () => 1)).toBe(3_500);
  });
});

describe("createThrottle", () => {
  test("spaces successive calls by at least the minimum interval", async () => {
    const throttle = createThrottle(40);
    const start = Date.now();
    await throttle();
    await throttle();
    await throttle();
    // Three calls => two gaps of >=40ms each (the first call is immediate).
    expect(Date.now() - start).toBeGreaterThanOrEqual(75);
  });

  test("serialises concurrent callers instead of releasing them at once", async () => {
    const throttle = createThrottle(30);
    const stamps: number[] = [];
    const start = Date.now();
    await Promise.all(
      [0, 1, 2].map(() => throttle().then(() => stamps.push(Date.now() - start))),
    );
    stamps.sort((a, b) => a - b);
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(20);
    expect(stamps[2]! - stamps[1]!).toBeGreaterThanOrEqual(20);
  });
});
