import { parse, type HTMLElement } from "node-html-parser/dist/index.js";

import type { Paper } from "../types.js";

const SCHOLAR_URL = "https://scholar.google.com/scholar";
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0]!;
}

function createDocument(html: string): HTMLElement {
  return parse(html);
}

export function extractScholarYear(text: string): number | undefined {
  const matches = text.match(/\b(19\d{2}|20\d{2})\b/g);
  const year = matches?.map(Number).find((value) => value <= new Date().getUTCFullYear());
  return year;
}

export function parseGoogleScholarHtml(html: string): Paper[] {
  const document = createDocument(html);
  const results = Array.from(document.querySelectorAll("div.gs_ri")) as HTMLElement[];

  return results.flatMap((result) => {
    const titleElement = result.querySelector("h3.gs_rt");
    const infoElement = result.querySelector("div.gs_a");
    if (!titleElement || !infoElement) {
      return [];
    }

    const link = titleElement.querySelector("a");
    const rawTitle = titleElement.text.trim();
    const title = rawTitle.replaceAll("[PDF]", "").replaceAll("[HTML]", "").replaceAll("[BOOK]", "").trim();
    const infoText = infoElement.text.trim();
    const abstract = result.querySelector("div.gs_rs")?.text.trim() ?? "";
    const citedByText = Array.from(result.querySelectorAll("div.gs_fl a"))
      .map((node) => node.text.trim())
      .find((text) => text.includes("Cited by"));
    const citations = citedByText ? Number(citedByText.replace(/\D/g, "")) || 0 : 0;
    const year = extractScholarYear(infoText);
    const authors = (infoText.split(" - ")[0] ?? "")
      .split(",")
      .map((author: string) => author.trim())
      .filter(Boolean);
    const url = link?.getAttribute("href") ?? "";

    return [{
      paperId: `gs_${Math.abs(hashString(url || title))}`,
      title,
      authors,
      abstract,
      doi: "",
      publishedDate: year ? new Date(Date.UTC(year, 0, 1)).toISOString() : new Date().toISOString(),
      pdfUrl: "",
      url,
      source: "google_scholar",
      categories: [],
      keywords: [],
      citations,
      references: [],
      extra: { infoText },
    } satisfies Paper];
  });
}

function hashString(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash << 5) - hash + character.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchGoogleScholarPapers(
  query: string,
  options: { maxResults?: number; yearLow?: number; yearHigh?: number } = {},
): Promise<Paper[]> {
  const maxResults = options.maxResults ?? 10;
  const resultsPerPage = Math.min(maxResults, 10);
  const papers: Paper[] = [];

  for (let start = 0; papers.length < maxResults; start += resultsPerPage) {
    const url = new URL(SCHOLAR_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("start", String(start));
    url.searchParams.set("hl", "en");
    url.searchParams.set("as_sdt", "0,5");
    url.searchParams.set("num", String(resultsPerPage));

    if (options.yearLow !== undefined) {
      url.searchParams.set("as_ylo", String(options.yearLow));
    }

    if (options.yearHigh !== undefined) {
      url.searchParams.set("as_yhi", String(options.yearHigh));
    }

    await sleep(150);
    const response = await fetch(url, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      break;
    }

    const parsed = parseGoogleScholarHtml(await response.text());
    if (parsed.length === 0) {
      break;
    }

    papers.push(...parsed.slice(0, maxResults - papers.length));
  }

  return papers.slice(0, maxResults);
}
