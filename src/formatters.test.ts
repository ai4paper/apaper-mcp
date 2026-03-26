import { describe, expect, test } from "bun:test";

import {
  formatDblpSearchResponse,
  formatGoogleScholarSearchResponse,
  formatIacrSearchResponse,
} from "./formatters.js";
import type { DblpBibtexResult, DblpPublication, Paper } from "./types.js";

const samplePaper: Paper = {
  paperId: "2025/1014",
  title: "Sample Paper",
  authors: ["Alice", "Bob"],
  abstract: "A concise abstract.",
  doi: "",
  publishedDate: "2025-06-02T00:00:00.000Z",
  pdfUrl: "https://example.com/paper.pdf",
  url: "https://example.com/paper",
  source: "iacr",
  categories: ["Cryptography"],
  keywords: ["MPC"],
  citations: 4,
  references: [],
  extra: {},
};

describe("formatIacrSearchResponse", () => {
  test("formats paper results with year filters", () => {
    const text = formatIacrSearchResponse([samplePaper], "crypto", 2024, 2025);

    expect(text).toContain("Found 1 IACR papers for query 'crypto' in year range (2024-2025):");
    expect(text).toContain("1. **Sample Paper**");
    expect(text).toContain("- Paper ID: 2025/1014");
    expect(text).toContain("- Abstract: A concise abstract.");
  });

  test("formats no-results message", () => {
    expect(formatIacrSearchResponse([], "crypto")).toBe(
      "No papers found for query: crypto",
    );
  });
});

describe("formatDblpSearchResponse", () => {
  test("formats standard DBLP publication results", () => {
    const results: DblpPublication[] = [
      {
        title: "Attention Is All You Need",
        authors: ["A", "B"],
        venue: "NeurIPS",
        year: 2017,
        type: "Conference and Workshop Papers",
        doi: "10.1/example",
        ee: "https://example.com/ee",
        url: "https://dblp.org/rec/conf/nips/foo",
        dblpKey: "conf/nips/foo",
      },
    ];

    const text = formatDblpSearchResponse(results, "transformer", { venueFilter: "NeurIPS" });

    expect(text).toContain("Found 1 DBLP papers for query 'transformer' with filters: venue 'NeurIPS':");
    expect(text).toContain("- Venue: NeurIPS");
    expect(text).toContain("- DOI: 10.1/example");
  });

  test("formats BibTeX-only results", () => {
    const results: DblpBibtexResult[] = [
      {
        dblpKey: "conf/nips/foo",
        bibtex: "@inproceedings{foo}",
      },
    ];

    const text = formatDblpSearchResponse(results, "transformer", { includeBibtex: true });

    expect(text).toContain("Found 1 DBLP BibTeX entries for query 'transformer':");
    expect(text).toContain("```bibtex");
  });
});

describe("formatGoogleScholarSearchResponse", () => {
  test("formats scholar results with year range", () => {
    const text = formatGoogleScholarSearchResponse([samplePaper], "zk", 2022, 2025);

    expect(text).toContain("Found 1 Google Scholar papers for query 'zk' in year range (2022-2025):");
    expect(text).toContain("- Citations: 4");
    expect(text).toContain("- Year: 2025");
  });
});
