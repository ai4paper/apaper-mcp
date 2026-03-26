import { describe, expect, test } from "bun:test";

import { extractScholarYear, parseGoogleScholarHtml } from "./googleScholar.js";

describe("extractScholarYear", () => {
  test("finds a plausible publication year", () => {
    expect(extractScholarYear("A. Author - Journal - 2024")).toBe(2024);
    expect(extractScholarYear("No year here")).toBeUndefined();
  });
});

describe("parseGoogleScholarHtml", () => {
  test("parses scholar search results into papers", () => {
    const papers = parseGoogleScholarHtml(
      `
      <div class="gs_ri">
        <h3 class="gs_rt"><a href="https://example.com/paper">[PDF] Practical ZK</a></h3>
        <div class="gs_a">Alice, Bob - Conference - 2023</div>
        <div class="gs_rs">Zero-knowledge for everyone.</div>
        <div class="gs_fl"><a href="/scholar?cites=123">Cited by 12</a></div>
      </div>
      `,
    );

    expect(papers).toHaveLength(1);
    expect(papers[0]?.title).toBe("Practical ZK");
    expect(papers[0]?.authors).toEqual(["Alice", "Bob"]);
    expect(papers[0]?.citations).toBe(12);
  });
});
