import { describe, expect, test } from "bun:test";

import {
  filterDblpResults,
  parseDblpApiResponse,
  toDblpBibtexResults,
} from "./dblp.js";

describe("parseDblpApiResponse", () => {
  test("parses DBLP API hits into publications", () => {
    const results = parseDblpApiResponse({
      result: {
        hits: {
          "@total": "1",
          hit: {
            info: {
              title: "Test Title",
              authors: { author: [{ text: "Alice" }, { text: "Bob" }] },
              venue: "ICLR",
              year: "2024",
              type: "Conference and Workshop Papers",
              doi: "10.1/example",
              ee: "https://example.com/pdf",
              url: "https://dblp.org/rec/conf/iclr/test",
            },
          },
        },
      },
    });

    expect(results).toEqual([
      {
        title: "Test Title",
        authors: ["Alice", "Bob"],
        venue: "ICLR",
        year: 2024,
        type: "Conference and Workshop Papers",
        doi: "10.1/example",
        ee: "https://example.com/pdf",
        url: "https://dblp.org/rec/conf/iclr/test",
        dblpKey: "conf/iclr/test",
      },
    ]);
  });
});

describe("filterDblpResults", () => {
  test("applies year and venue filters", () => {
    const filtered = filterDblpResults(
      [
        {
          title: "Keep",
          authors: [],
          venue: "NeurIPS",
          year: 2023,
          type: "conf",
          doi: "",
          ee: "",
          url: "",
          dblpKey: "a",
        },
        {
          title: "Drop",
          authors: [],
          venue: "ICLR",
          year: 2021,
          type: "conf",
          doi: "",
          ee: "",
          url: "",
          dblpKey: "b",
        },
      ],
      { yearFrom: 2022, venueFilter: "neur" },
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("Keep");
  });
});

describe("toDblpBibtexResults", () => {
  test("keeps only populated bibtex entries", () => {
    const results = toDblpBibtexResults([
      { dblpKey: "a", bibtex: "@article{a}" },
      { dblpKey: "b", bibtex: "" },
    ]);

    expect(results).toEqual([{ dblpKey: "a", bibtex: "@article{a}" }]);
  });
});
