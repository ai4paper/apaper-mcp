export interface Paper {
  paperId: string;
  title: string;
  authors: string[];
  abstract: string;
  doi: string;
  publishedDate: string | null;
  pdfUrl: string;
  url: string;
  source: string;
  updatedDate?: string | null;
  categories: string[];
  keywords: string[];
  citations: number;
  references: string[];
  extra: Record<string, unknown>;
}

export interface DblpPublication {
  title: string;
  authors: string[];
  venue: string;
  year?: number;
  type: string;
  doi: string;
  ee: string;
  url: string;
  dblpKey: string;
  error?: string;
}

export interface DblpBibtexResult {
  dblpKey: string;
  bibtex: string;
}
