import { mkdir, writeFile } from "node:fs/promises";
import { parse, type HTMLElement } from "node-html-parser/dist/index.js";

import type { Paper } from "../types.js";

const IACR_SEARCH_URL = "https://eprint.iacr.org/search";
const IACR_BASE_URL = "https://eprint.iacr.org";
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0]!;
}

function createDocument(html: string): HTMLElement {
  return parse(html);
}

function parseDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function textContent(element: HTMLElement | null): string {
  return element?.text.trim() ?? "";
}

export function buildIacrSearchParams(query: string, yearMin?: number, yearMax?: number): URLSearchParams {
  const params = new URLSearchParams({ q: query });
  if (yearMin !== undefined) {
    params.set("revisedafter", String(yearMin));
  }
  if (yearMax !== undefined) {
    params.set("revisedbefore", String(yearMax));
  }
  return params;
}

function parseIacrSearchResultElement(element: HTMLElement): Paper | null {
  const header = element.querySelector("div.d-flex");
  const content = element.querySelector("div.ms-md-4");
  const paperLink = header?.querySelector("a.paperlink");
  if (!header || !content || !paperLink) {
    return null;
  }

  const paperId = textContent(paperLink);
  const href = paperLink.getAttribute("href") ?? "";
  const pdfLink = (Array.from(header.querySelectorAll("a")) as HTMLElement[]).find((link) => textContent(link) === "(PDF)");
  const updatedText = textContent(header.querySelector("small.ms-auto")).replace("Last updated:", "").trim();
  const updatedDate = parseDate(updatedText);

  return {
    paperId,
    title: textContent(content.querySelector("strong")),
    authors: textContent(content.querySelector("span.fst-italic"))
      .split(",")
      .map((author) => author.trim())
      .filter(Boolean),
    abstract: textContent(content.querySelector("p.search-abstract")),
    doi: "",
    publishedDate: updatedDate ?? new Date(Date.UTC(1900, 0, 1)).toISOString(),
    pdfUrl: pdfLink ? `${IACR_BASE_URL}${pdfLink.getAttribute("href") ?? ""}` : "",
    url: `${IACR_BASE_URL}${href}`,
    source: "iacr",
    updatedDate,
    categories: textContent(content.querySelector("small.badge")) ? [textContent(content.querySelector("small.badge"))] : [],
    keywords: [],
    citations: 0,
    references: [],
    extra: {},
  };
}

export function parseIacrSearchHtml(html: string, _fetchDetails = false): Paper[] {
  const document = createDocument(html);
  return Array.from(document.querySelectorAll("div.mb-4"))
    .map((element) => parseIacrSearchResultElement(element))
    .filter((paper): paper is Paper => paper !== null);
}

export function parseIacrDetailHtml(html: string, paperId: string): Paper | null {
  const document = createDocument(html);
  const lines = document.text
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);

  let publicationInfo = "";
  let historyStarted = false;
  const historyEntries: string[] = [];
  let updatedDate: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (line === "Publication info" && index + 1 < lines.length) {
      publicationInfo = lines[index + 1] ?? "";
      continue;
    }

    if (line === "History") {
      historyStarted = true;
      continue;
    }

    if (historyStarted && (line.startsWith("Short URL") || line.startsWith("License"))) {
      break;
    }

    if (historyStarted && line.includes(":")) {
      historyEntries.push(line);
      if (!updatedDate) {
        updatedDate = parseDate(line.split(":")[0] ?? "");
      }
    }
  }

  const title = textContent(document.querySelector("h3.mb-3"));
  if (!title) {
    return null;
  }

  const authors = textContent(document.querySelector("p.fst-italic"))
    .replaceAll(" and ", ",")
    .split(",")
    .map((author) => author.trim())
    .filter(Boolean);

  return {
    paperId,
    title,
    authors,
    abstract: textContent(document.querySelector('p[style="white-space: pre-wrap;"]')),
    doi: "",
    publishedDate: updatedDate ?? new Date().toISOString(),
    pdfUrl: `${IACR_BASE_URL}/${paperId}.pdf`,
    url: `${IACR_BASE_URL}/${paperId}`,
    source: "iacr",
    updatedDate,
    categories: [],
    keywords: Array.from(document.querySelectorAll("a.badge.bg-secondary.keyword"))
      .map((element) => textContent(element))
      .filter(Boolean),
    citations: 0,
    references: [],
    extra: {
      publicationInfo,
      history: historyEntries.join("; "),
    },
  };
}

export async function getIacrPaperDetails(paperId: string): Promise<Paper | null> {
  const response = await fetch(`${IACR_BASE_URL}/${paperId}`, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return null;
  }

  return parseIacrDetailHtml(await response.text(), paperId);
}

export async function searchIacrPapers(
  query: string,
  options: { maxResults?: number; fetchDetails?: boolean; yearMin?: number; yearMax?: number } = {},
): Promise<Paper[]> {
  const url = new URL(IACR_SEARCH_URL);
  url.search = buildIacrSearchParams(query, options.yearMin, options.yearMax).toString();

  const response = await fetch(url, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return [];
  }

  const fallbackResults = parseIacrSearchHtml(await response.text());
  const maxResults = options.maxResults ?? 10;
  const results: Paper[] = [];

  for (const paper of fallbackResults) {
    if (results.length >= maxResults) {
      break;
    }

    if (options.fetchDetails !== false) {
      const detailed = await getIacrPaperDetails(paper.paperId);
      results.push(detailed ?? paper);
    } else {
      results.push(paper);
    }
  }

  return results;
}

export async function downloadIacrPaperPdf(paperId: string, savePath: string): Promise<string> {
  await mkdir(savePath, { recursive: true });
  const response = await fetch(`${IACR_BASE_URL}/${paperId}.pdf`, {
    headers: { "User-Agent": getRandomUserAgent() },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return `Failed to download PDF: HTTP ${response.status}`;
  }

  const filename = `${savePath}/iacr_${paperId.replaceAll("/", "_")}.pdf`;
  await writeFile(filename, Buffer.from(await response.arrayBuffer()));
  return filename;
}
