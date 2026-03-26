import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  formatDblpSearchResponse,
  formatGoogleScholarSearchResponse,
  formatIacrSearchResponse,
} from "./formatters.js";
import { searchDblpPublications } from "./platforms/dblp.js";
import { searchGoogleScholarPapers } from "./platforms/googleScholar.js";
import { downloadIacrPaperPdf, searchIacrPapers } from "./platforms/iacr.js";

const server = new McpServer({
  name: "apaper-mcp",
  version: "0.1.0",
});

const intLikeSchema = z.union([z.number().int(), z.string()]);

function asTextResult(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function parseOptionalInteger(value: number | string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label} format. Please provide a valid integer.`);
  }

  return parsed;
}

server.registerTool<any, any>(
  "search_iacr_papers",
  {
    title: "Search IACR Papers",
    description: "Search academic papers from the IACR ePrint Archive.",
    inputSchema: {
      query: z.string(),
      max_results: z.number().int().positive().default(10),
      fetch_details: z.boolean().default(true),
      year_min: intLikeSchema.optional(),
      year_max: intLikeSchema.optional(),
    } as any,
  },
  async (args: any) => {
    try {
      const yearMin = parseOptionalInteger(args?.year_min, "year_min");
      const yearMax = parseOptionalInteger(args?.year_max, "year_max");
      const papers = await searchIacrPapers(args.query, {
        maxResults: args.max_results,
        fetchDetails: args.fetch_details,
        yearMin,
        yearMax,
      });

      return asTextResult(formatIacrSearchResponse(papers, args.query, yearMin, yearMax));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid")) {
        return asTextResult(`Error: ${error.message}`);
      }

      return asTextResult(`Error searching IACR papers: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
);

server.registerTool<any, any>(
  "download_iacr_paper",
  {
    title: "Download IACR Paper",
    description: "Download the PDF for an IACR ePrint paper.",
    inputSchema: {
      paper_id: z.string(),
      save_path: z.string().default("./downloads"),
    } as any,
  },
  async (args: any) => {
    try {
      const result = await downloadIacrPaperPdf(args.paper_id, args.save_path);
      if (result.startsWith("Failed") || result.startsWith("Error")) {
        return asTextResult(`Download failed: ${result}`);
      }

      return asTextResult(`PDF downloaded successfully to: ${result}`);
    } catch (error) {
      return asTextResult(`Error downloading IACR paper: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
);

server.registerTool<any, any>(
  "search_dblp_papers",
  {
    title: "Search DBLP Papers",
    description: "Search DBLP for publications and optional BibTeX entries.",
    inputSchema: {
      query: z.string(),
      max_results: z.number().int().positive().default(10),
      year_from: intLikeSchema.optional(),
      year_to: intLikeSchema.optional(),
      venue_filter: z.string().optional(),
      include_bibtex: z.boolean().default(false),
    } as any,
  },
  async (args: any) => {
    try {
      const yearFrom = parseOptionalInteger(args?.year_from, "year_from");
      const yearTo = parseOptionalInteger(args?.year_to, "year_to");
      const results = await searchDblpPublications(args.query, {
        maxResults: args.max_results,
        yearFrom,
        yearTo,
        venueFilter: args.venue_filter,
        includeBibtex: args.include_bibtex,
      });

      return asTextResult(
        formatDblpSearchResponse(results, args.query, {
          yearFrom,
          yearTo,
          venueFilter: args.venue_filter,
          includeBibtex: args.include_bibtex,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid")) {
        return asTextResult(`Error: ${error.message}`);
      }

      return asTextResult(`Error searching DBLP: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
);

server.registerTool<any, any>(
  "search_google_scholar_papers",
  {
    title: "Search Google Scholar Papers",
    description: "Search academic papers from Google Scholar.",
    inputSchema: {
      query: z.string(),
      max_results: z.number().int().positive().default(10),
      year_low: intLikeSchema.optional(),
      year_high: intLikeSchema.optional(),
    } as any,
  },
  async (args: any) => {
    try {
      const yearLow = parseOptionalInteger(args?.year_low, "year_low");
      const yearHigh = parseOptionalInteger(args?.year_high, "year_high");
      const papers = await searchGoogleScholarPapers(args.query, {
        maxResults: args.max_results,
        yearLow,
        yearHigh,
      });

      return asTextResult(formatGoogleScholarSearchResponse(papers, args.query, yearLow, yearHigh));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid")) {
        return asTextResult(`Error: ${error.message}`);
      }

      return asTextResult(`Error searching Google Scholar: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("apaper-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
