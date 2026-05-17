import { mkdir, writeFile } from "node:fs/promises";
import { parse, type HTMLElement } from "node-html-parser/dist/index.js";

import type { ArxivPaper } from "../types.js";

const DEFAULT_ARXIV_SEARCH_URL = "https://arxiv.org/search/";
const DEFAULT_ARXIV_ADVANCED_URL = "https://arxiv.org/search/advanced";
const DEFAULT_ARXIV_PDF_BASE = "https://arxiv.org/pdf";
const ARXIV_SEARCH_URL = process.env.ARXIV_SEARCH_URL?.trim() || DEFAULT_ARXIV_SEARCH_URL;
const ARXIV_ADVANCED_URL = process.env.ARXIV_ADVANCED_URL?.trim() || DEFAULT_ARXIV_ADVANCED_URL;
const ARXIV_PDF_BASE = process.env.ARXIV_PDF_BASE?.trim() || DEFAULT_ARXIV_PDF_BASE;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = Number(process.env.ARXIV_TIMEOUT_MS) || 60_000;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.ARXIV_DOWNLOAD_TIMEOUT_MS) || 120_000;

export type ArxivSortBy = "relevance" | "date";

export interface ArxivSearchOptions {
  maxResults?: number;
  dateFrom?: string;
  dateTo?: string;
  categories?: string[];
  sortBy?: ArxivSortBy;
}

const FIELD_PREFIX_MAP: Record<string, string> = {
  "ti:": "title",
  "au:": "author",
  "abs:": "abstract",
  "cat:": "all",
  "doi:": "doi",
};

function detectFieldPrefix(query: string): { term: string; field: string } {
  const trimmed = query.trim();
  for (const [prefix, field] of Object.entries(FIELD_PREFIX_MAP)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { term: trimmed.slice(prefix.length).trim(), field };
    }
  }
  return { term: trimmed, field: "all" };
}

function validateDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${label} format. Use YYYY-MM-DD: ${value}`);
  }
  return value;
}

export function buildArxivSearchParams(query: string, options: ArxivSearchOptions = {}): URLSearchParams {
  const { term, field } = detectFieldPrefix(query);
  const hasAdvancedFilters =
    (options.categories && options.categories.length > 0) || !!options.dateFrom || !!options.dateTo;

  if (!term && !options.dateFrom && !options.dateTo) {
    throw new Error("No search criteria provided");
  }

  // Page size: arXiv accepts 25, 50, 100, 200. Pick the smallest that covers max_results.
  const max = Math.max(1, options.maxResults ?? 10);
  const size = max <= 25 ? 25 : max <= 50 ? 50 : max <= 100 ? 100 : 200;
  const order = options.sortBy === "date" ? "-announced_date_first" : "";

  // Simple search URL works reliably for the common case (query + sort + size).
  // Use it whenever no category/date filters are needed.
  if (!hasAdvancedFilters && field === "all") {
    const params = new URLSearchParams();
    params.set("searchtype", "all");
    params.set("query", term);
    params.set("start", "0");
    params.set("size", String(size));
    if (order) params.set("order", order);
    return params;
  }

  // Advanced form — requires several default params or the page returns 0 hits.
  const params = new URLSearchParams();
  params.set("advanced", "");
  params.set("terms-0-operator", "AND");
  params.set("terms-0-term", term);
  params.set("terms-0-field", field);

  // Classification defaults required by the advanced form. If the caller passed
  // specific categories we narrow to those groups; otherwise leave physics archives
  // at "all" so all classification groups are included.
  if (options.categories && options.categories.length > 0) {
    const groups = new Set<string>();
    for (const cat of options.categories) {
      const prefix = cat.split(".")[0]?.toLowerCase() ?? "";
      const group = ARXIV_GROUP_MAP[prefix];
      if (group) groups.add(group);
    }
    for (const group of groups) {
      params.set(`classification-${group}`, "y");
    }
    params.set("classification-physics_archives", groups.has("physics") ? "all" : "all");
    params.set("classification-include_cross_list", "include");
  } else {
    params.set("classification-physics_archives", "all");
    params.set("classification-include_cross_list", "include");
  }

  if (options.dateFrom || options.dateTo) {
    params.set("date-filter_by", "date_range");
    params.set("date-year", "");
    if (options.dateFrom) params.set("date-from_date", validateDate(options.dateFrom, "date_from"));
    else params.set("date-from_date", "");
    if (options.dateTo) params.set("date-to_date", validateDate(options.dateTo, "date_to"));
    else params.set("date-to_date", "");
    params.set("date-date_type", "submitted_date");
  } else {
    params.set("date-filter_by", "all_dates");
    params.set("date-year", "");
    params.set("date-from_date", "");
    params.set("date-to_date", "");
    params.set("date-date_type", "submitted_date");
  }

  params.set("abstracts", "show");
  params.set("size", String(size));
  params.set("order", order);
  params.set("start", "0");

  return params;
}

const ARXIV_GROUP_MAP: Record<string, string> = {
  cs: "computer_science",
  econ: "economics",
  eess: "eess",
  math: "mathematics",
  physics: "physics",
  "astro-ph": "physics",
  "cond-mat": "physics",
  "gr-qc": "physics",
  "hep-ex": "physics",
  "hep-lat": "physics",
  "hep-ph": "physics",
  "hep-th": "physics",
  "math-ph": "physics",
  nlin: "physics",
  "nucl-ex": "physics",
  "nucl-th": "physics",
  "quant-ph": "physics",
  "q-bio": "q_biology",
  "q-fin": "q_finance",
  stat: "statistics",
};

export function buildArxivSearchUrl(query: string, options: ArxivSearchOptions = {}): string {
  const params = buildArxivSearchParams(query, options);
  const base = params.has("advanced") ? ARXIV_ADVANCED_URL : ARXIV_SEARCH_URL;
  return `${base}?${params.toString()}`;
}

function cleanText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function parseSubmittedDate(text: string): string {
  const match = /Submitted\s+(\d{1,2}\s+\w+,?\s+\d{4})/i.exec(text);
  if (!match) return "";
  const parsed = new Date(match[1]!.replace(",", ""));
  if (Number.isNaN(parsed.valueOf())) return "";
  return parsed.toISOString();
}

function extractFromCommentsParagraph(node: HTMLElement | null, label: string): string {
  if (!node) return "";
  const text = cleanText(node.text);
  const labelRe = new RegExp(`${label}\\s*:?\\s*`, "i");
  return text.replace(labelRe, "").trim();
}

export function parseArxivSearchHtml(html: string): ArxivPaper[] {
  const document = parse(html);
  const items = Array.from(document.querySelectorAll("li.arxiv-result")) as HTMLElement[];
  const papers: ArxivPaper[] = [];

  for (const item of items) {
    const titleLinkElem = item.querySelector("p.list-title a");
    const href = titleLinkElem?.getAttribute("href") ?? "";
    const idMatch = /\/abs\/([^/?#]+)/i.exec(href);
    if (!idMatch) continue;
    const paperIdRaw = idMatch[1]!;
    const paperId = paperIdRaw.replace(/v\d+$/i, "");

    const title = cleanText(item.querySelector("p.title")?.text);
    const authors = (Array.from(item.querySelectorAll("p.authors a")) as HTMLElement[])
      .map((a) => cleanText(a.text))
      .filter(Boolean);

    const fullAbstractElem = item.querySelector("span.abstract-full");
    const shortAbstractElem = item.querySelector("span.abstract-short");
    let abstract = cleanText(fullAbstractElem?.text ?? shortAbstractElem?.text ?? "");
    abstract = abstract.replace(/\s*△\s*Less\s*$/i, "").replace(/\s*▽\s*More\s*$/i, "").trim();

    const tagSpans = Array.from(item.querySelectorAll("div.tags span.tag")) as HTMLElement[];
    const categories = tagSpans.map((span) => cleanText(span.text)).filter(Boolean);
    const primaryCategory = categories.find((cat, idx) => {
      const span = tagSpans[idx];
      return span?.classNames?.includes("is-link") ?? false;
    }) ?? categories[0] ?? "";

    const pdfLink = (Array.from(item.querySelectorAll("p.list-title a")) as HTMLElement[]).find((a) => {
      const linkHref = a.getAttribute("href") ?? "";
      return /\/pdf\//i.test(linkHref);
    });
    const pdfUrl = pdfLink?.getAttribute("href") ?? `${ARXIV_PDF_BASE}/${paperId}`;
    const url = `https://arxiv.org/abs/${paperId}`;

    const dateText = cleanText(item.querySelector("p.is-size-7")?.text);
    const publishedDate = parseSubmittedDate(dateText);

    const commentParagraphs = Array.from(item.querySelectorAll("p.comments")) as HTMLElement[];
    let comment = "";
    let journalRef = "";
    let doi = "";
    for (const p of commentParagraphs) {
      const text = cleanText(p.text);
      if (/^Comments:/i.test(text)) {
        comment = extractFromCommentsParagraph(p, "Comments");
      } else if (/Journal ref:/i.test(text)) {
        journalRef = extractFromCommentsParagraph(p, "Journal ref");
      } else if (/^doi:/i.test(text)) {
        doi = extractFromCommentsParagraph(p, "doi");
      }
    }

    papers.push({
      paperId,
      title,
      authors,
      abstract,
      categories,
      primaryCategory,
      publishedDate,
      updatedDate: publishedDate,
      pdfUrl,
      url,
      doi,
      journalRef,
      comment,
    });
  }

  return papers;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /timed? ?out/i.test(error.message)
  );
}

export async function searchArxivPapers(
  query: string,
  options: ArxivSearchOptions = {},
): Promise<ArxivPaper[]> {
  const url = buildArxivSearchUrl(query, options);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `arXiv request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s contacting ${url}. ` +
          "Confirm the URL is reachable from this process, or set ARXIV_SEARCH_URL / ARXIV_ADVANCED_URL to a reachable mirror.",
      );
    }
    throw error;
  }

  if (response.status === 429 || response.status === 503) {
    throw new Error(
      `arXiv is rate limiting this IP (HTTP ${response.status}). Wait a minute before retrying.`,
    );
  }
  if (!response.ok) {
    throw new Error(`arXiv search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const all = parseArxivSearchHtml(html);
  const max = options.maxResults ?? 10;
  return all.slice(0, max);
}

function sanitizePaperId(paperId: string): string {
  return paperId.replace(/[\/\\?%*:|"<>]/g, "_");
}

export async function downloadArxivPaper(paperId: string, savePath = "./downloads"): Promise<string> {
  const cleanId = paperId.trim();
  if (!cleanId) {
    throw new Error("paper_id is required");
  }

  let response: Response;
  try {
    response = await fetch(`${ARXIV_PDF_BASE}/${cleanId}`, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `arXiv PDF download timed out after ${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)}s. ` +
          "Try again, raise ARXIV_DOWNLOAD_TIMEOUT_MS, or set ARXIV_PDF_BASE to a reachable mirror.",
      );
    }
    throw error;
  }

  if (response.status === 429 || response.status === 503) {
    throw new Error(
      `arXiv is rate limiting this IP (HTTP ${response.status}). Wait a minute before retrying.`,
    );
  }
  if (!response.ok) {
    throw new Error(`PDF download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf")) {
    throw new Error(`Expected PDF, got ${contentType || "unknown"}`);
  }

  await mkdir(savePath, { recursive: true });
  const filename = `arxiv_${sanitizePaperId(cleanId)}.pdf`;
  const fullPath = `${savePath.replace(/\/$/, "")}/${filename}`;
  await writeFile(fullPath, Buffer.from(await response.arrayBuffer()));
  return fullPath;
}
