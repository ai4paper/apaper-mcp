import type { ArxivPaper, CnkiPaper, DblpBibtexResult, DblpPublication, Paper } from "./types.js";

function buildYearFilterMessage(min?: number, max?: number): string {
  if (min === undefined && max === undefined) {
    return "";
  }

  return ` in year range (${min ?? "earliest"}-${max ?? "latest"})`;
}

function formatPaperDateYear(paper: Paper): number | undefined {
  if (!paper.publishedDate) {
    return undefined;
  }

  const year = new Date(paper.publishedDate).getUTCFullYear();
  return year > 1900 ? year : undefined;
}

export function formatIacrSearchResponse(
  papers: Paper[],
  query: string,
  yearMin?: number,
  yearMax?: number,
): string {
  if (papers.length === 0) {
    return `No papers found for query: ${query}${buildYearFilterMessage(yearMin, yearMax)}`;
  }

  const lines = [
    `Found ${papers.length} IACR papers for query '${query}'${buildYearFilterMessage(yearMin, yearMax)}:`,
    "",
  ];

  for (const [index, paper] of papers.entries()) {
    lines.push(`${index + 1}. **${paper.title}**`);
    lines.push(`   - Paper ID: ${paper.paperId}`);
    lines.push(`   - Authors: ${paper.authors.join(", ")}`);
    lines.push(`   - URL: ${paper.url}`);
    lines.push(`   - PDF: ${paper.pdfUrl}`);

    if (paper.categories.length > 0) {
      lines.push(`   - Categories: ${paper.categories.join(", ")}`);
    }

    if (paper.keywords.length > 0) {
      lines.push(`   - Keywords: ${paper.keywords.join(", ")}`);
    }

    if (paper.abstract) {
      lines.push(`   - Abstract: ${paper.abstract}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

type DblpFilterOptions = {
  yearFrom?: number;
  yearTo?: number;
  venueFilter?: string;
  includeBibtex?: boolean;
};

function buildDblpFilterMessage(options: DblpFilterOptions): string {
  const filters: string[] = [];

  if (options.yearFrom !== undefined || options.yearTo !== undefined) {
    filters.push(`year range (${options.yearFrom ?? "earliest"}-${options.yearTo ?? "latest"})`);
  }

  if (options.venueFilter) {
    filters.push(`venue '${options.venueFilter}'`);
  }

  return filters.length > 0 ? ` with filters: ${filters.join(", ")}` : "";
}

export function formatDblpSearchResponse(
  results: Array<DblpPublication | DblpBibtexResult>,
  query: string,
  options: DblpFilterOptions,
): string {
  if (results.length === 0) {
    return `No papers found for query: ${query}${buildDblpFilterMessage(options)}`;
  }

  if (options.includeBibtex) {
    const lines = [`Found ${results.length} DBLP BibTeX entries for query '${query}'${buildDblpFilterMessage(options)}:`, ""];

    for (const [index, result] of results.entries()) {
      const bibtex = result as DblpBibtexResult;
      lines.push(`${index + 1}. DBLP Key: ${bibtex.dblpKey}`);
      lines.push(`\`\`\`bibtex`);
      lines.push(bibtex.bibtex);
      lines.push(`\`\`\``);
      lines.push("");
    }

    return lines.join("\n");
  }

  const lines = [`Found ${results.length} DBLP papers for query '${query}'${buildDblpFilterMessage(options)}:`, ""];

  for (const [index, result] of results.entries()) {
    const publication = result as DblpPublication;
    lines.push(`${index + 1}. **${publication.title || "Untitled"}**`);
    lines.push(`   - DBLP Key: ${publication.dblpKey}`);
    lines.push(`   - Authors: ${publication.authors.join(", ")}`);

    if (publication.venue) {
      lines.push(`   - Venue: ${publication.venue}`);
    }

    if (publication.year) {
      lines.push(`   - Year: ${publication.year}`);
    }

    if (publication.doi) {
      lines.push(`   - DOI: ${publication.doi}`);
    }

    if (publication.url) {
      lines.push(`   - URL: ${publication.url}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function formatGoogleScholarSearchResponse(
  papers: Paper[],
  query: string,
  yearLow?: number,
  yearHigh?: number,
): string {
  if (papers.length === 0) {
    return `No papers found for query: ${query}${buildYearFilterMessage(yearLow, yearHigh)}`;
  }

  const lines = [
    `Found ${papers.length} Google Scholar papers for query '${query}'${buildYearFilterMessage(yearLow, yearHigh)}:`,
    "",
  ];

  for (const [index, paper] of papers.entries()) {
    lines.push(`${index + 1}. **${paper.title}**`);
    lines.push(`   - Authors: ${paper.authors.join(", ")}`);

    if (paper.citations > 0) {
      lines.push(`   - Citations: ${paper.citations}`);
    }

    const year = formatPaperDateYear(paper);
    if (year) {
      lines.push(`   - Year: ${year}`);
    }

    if (paper.url) {
      lines.push(`   - URL: ${paper.url}`);
    }

    if (paper.abstract) {
      lines.push(`   - Abstract: ${paper.abstract}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

type ArxivFilterOptions = {
  dateFrom?: string;
  dateTo?: string;
  categories?: string[];
  sortBy?: "relevance" | "date";
};

function buildArxivFilterMessage(options: ArxivFilterOptions): string {
  const filters: string[] = [];
  if (options.dateFrom || options.dateTo) {
    filters.push(`date range (${options.dateFrom ?? "earliest"} to ${options.dateTo ?? "latest"})`);
  }
  if (options.categories && options.categories.length > 0) {
    filters.push(`categories [${options.categories.join(", ")}]`);
  }
  return filters.length > 0 ? ` with filters: ${filters.join(", ")}` : "";
}

export function formatArxivSearchResponse(
  papers: ArxivPaper[],
  query: string,
  options: ArxivFilterOptions = {},
): string {
  if (papers.length === 0) {
    return `No arXiv papers found for query: ${query}${buildArxivFilterMessage(options)}`;
  }

  const lines = [
    `Found ${papers.length} arXiv papers for query '${query}'${buildArxivFilterMessage(options)}:`,
    "",
  ];

  for (const [index, paper] of papers.entries()) {
    lines.push(`${index + 1}. **${paper.title || "Untitled"}**`);
    lines.push(`   - Paper ID: ${paper.paperId}`);
    if (paper.authors.length > 0) {
      lines.push(`   - Authors: ${paper.authors.join(", ")}`);
    }
    if (paper.primaryCategory) {
      lines.push(`   - Primary Category: ${paper.primaryCategory}`);
    }
    if (paper.categories.length > 0) {
      lines.push(`   - Categories: ${paper.categories.join(", ")}`);
    }
    if (paper.publishedDate) {
      lines.push(`   - Published: ${paper.publishedDate}`);
    }
    if (paper.doi) {
      lines.push(`   - DOI: ${paper.doi}`);
    }
    if (paper.journalRef) {
      lines.push(`   - Journal Ref: ${paper.journalRef}`);
    }
    if (paper.url) {
      lines.push(`   - URL: ${paper.url}`);
    }
    if (paper.pdfUrl) {
      lines.push(`   - PDF: ${paper.pdfUrl}`);
    }
    if (paper.abstract) {
      lines.push(`   - Abstract: ${paper.abstract}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatCnkiSearchResponse(papers: CnkiPaper[], query: string): string {
  if (papers.length === 0) {
    return `No CNKI papers found for query: ${query}`;
  }

  const lines = [`Found ${papers.length} CNKI papers for query '${query}':`, ""];

  for (const [index, paper] of papers.entries()) {
    lines.push(`${index + 1}. **${paper.title || "Untitled"}**`);
    if (paper.authors.length > 0) {
      lines.push(`   - Authors: ${paper.authors.join(", ")}`);
    }
    if (paper.source) {
      lines.push(`   - Source: ${paper.source}`);
    }
    if (paper.href) {
      lines.push(`   - URL: ${paper.href}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
