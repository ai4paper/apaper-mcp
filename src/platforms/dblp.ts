import type { DblpBibtexResult, DblpPublication } from "../types.js";

const REQUEST_TIMEOUT_MS = 10_000;
const HEADERS = {
  "User-Agent": "apaper-mcp/0.1.0 (https://github.com/ai4paper/apaper-mcp)",
  Accept: "application/json",
};

type SearchOptions = {
  maxResults?: number;
  yearFrom?: number;
  yearTo?: number;
  venueFilter?: string;
  includeBibtex?: boolean;
};

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function normalizeAuthors(authorsData: unknown): string[] {
  const rawAuthors = (authorsData as { author?: unknown })?.author;
  const authors = Array.isArray(rawAuthors) ? rawAuthors : rawAuthors ? [rawAuthors] : [];

  return authors
    .map((author) => {
      if (typeof author === "string") {
        return author;
      }

      if (author && typeof author === "object" && "text" in author) {
        const text = (author as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }

      return "";
    })
    .filter(Boolean);
}

export function parseDblpApiResponse(payload: unknown): DblpPublication[] {
  const hits = (payload as { result?: { hits?: { hit?: unknown } } })?.result?.hits?.hit;
  const publications = Array.isArray(hits) ? hits : hits ? [hits] : [];

  return publications.map((publication) => {
    const info = (publication as { info?: Record<string, unknown> }).info ?? {};
    const url = typeof info.url === "string" ? info.url : "";
    const fallbackKey = typeof (publication as { key?: unknown }).key === "string"
      ? String((publication as { key?: string }).key).replace(/^dblp:/, "")
      : "";

    return {
      title: typeof info.title === "string" ? info.title : "",
      authors: normalizeAuthors(info.authors),
      venue: typeof info.venue === "string" ? info.venue : "",
      year: typeof info.year === "string" || typeof info.year === "number" ? Number(info.year) : undefined,
      type: typeof info.type === "string" ? info.type : "",
      doi: typeof info.doi === "string" ? info.doi : "",
      ee: typeof info.ee === "string" ? info.ee : "",
      url,
      dblpKey: url.replace("https://dblp.org/rec/", "") || fallbackKey,
    } satisfies DblpPublication;
  });
}

export function filterDblpResults(
  results: DblpPublication[],
  options: Omit<SearchOptions, "maxResults" | "includeBibtex">,
): DblpPublication[] {
  return results.filter((result) => {
    if (options.yearFrom !== undefined && result.year !== undefined && result.year < options.yearFrom) {
      return false;
    }

    if (options.yearTo !== undefined && result.year !== undefined && result.year > options.yearTo) {
      return false;
    }

    if (options.venueFilter && !result.venue.toLowerCase().includes(options.venueFilter.toLowerCase())) {
      return false;
    }

    return true;
  });
}

export function toDblpBibtexResults(results: DblpBibtexResult[]): DblpBibtexResult[] {
  return results.filter((result) => Boolean(result.bibtex.trim()));
}

async function fetchDblpPublications(singleQuery: string, maxResults: number): Promise<DblpPublication[]> {
  const url = new URL("https://dblp.org/search/publ/api");
  url.searchParams.set("q", singleQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("h", String(maxResults));

  const response = await fetch(url, {
    headers: HEADERS,
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`DBLP API error: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return parseDblpApiResponse(payload);
}

export async function fetchDblpBibtexEntry(dblpKey: string): Promise<string> {
  if (!dblpKey.trim()) {
    return "";
  }

  const urls = [
    `https://dblp.org/rec/${dblpKey}.bib`,
    ...(dblpKey.includes(":") ? [`https://dblp.org/rec/${dblpKey.replaceAll(":", "/")}.bib`] : []),
  ];

  for (const url of urls) {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    });

    if (response.ok) {
      const bibtex = await response.text();
      if (bibtex.trim()) {
        return bibtex;
      }
    }
  }

  return "";
}

export async function searchDblpPublications(
  query: string,
  options: SearchOptions = {},
): Promise<Array<DblpPublication | DblpBibtexResult>> {
  const maxResults = options.maxResults ?? 10;
  const normalizedQuery = query.toLowerCase();
  const subqueries = normalizedQuery.includes(" or ")
    ? normalizedQuery.split(" or ").map((part) => part.trim()).filter(Boolean)
    : [query];

  const seen = new Set<string>();
  const combined: DblpPublication[] = [];

  for (const subquery of subqueries) {
    const results = await fetchDblpPublications(subquery, maxResults);

    for (const result of results) {
      const identifier = `${result.title}::${result.year ?? ""}`;
      if (!seen.has(identifier)) {
        combined.push(result);
        seen.add(identifier);
      }
    }
  }

  const filtered = filterDblpResults(combined, options).slice(0, maxResults);
  if (!options.includeBibtex) {
    return filtered;
  }

  const bibtexResults = await Promise.all(
    filtered.map(async (result) => ({
      dblpKey: result.dblpKey,
      bibtex: await fetchDblpBibtexEntry(result.dblpKey),
    })),
  );

  return toDblpBibtexResults(bibtexResults);
}
