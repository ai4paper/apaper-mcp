# apaper-mcp

An MCP (Model Context Protocol) server that gives AI assistants direct access to academic paper databases. It exposes a unified set of tools for searching and downloading papers across arXiv, IACR ePrint, DBLP, Google Scholar, and CNKI (中国知网), so an MCP-compatible client (Claude Code, Claude Desktop, or any other) can run literature searches, pull BibTeX entries, and fetch PDFs without leaving the chat.

## Tools

- `search_arxiv_papers` — search arXiv, with category, date-range, and sort options
- `download_arxiv_paper` — download an arXiv PDF
- `search_iacr_papers` — search IACR ePrint
- `download_iacr_paper` — download an IACR PDF
- `search_dblp_papers` — search DBLP, optionally with BibTeX
- `search_google_scholar_papers` — search Google Scholar
- `search_cnki_papers` — search CNKI (中国知网)
- `download_cnki_paper` — download a CNKI PDF

arXiv tools scrape the public `arxiv.org/search/` HTML page, which works on
networks where the `export.arxiv.org` Atom API is blocked or rate-limited. If
you need to route through a mirror, set `ARXIV_SEARCH_URL`,
`ARXIV_ADVANCED_URL`, and/or `ARXIV_PDF_BASE`.

CNKI tools require institutional access. On IP-based networks the session
cookie is obtained automatically on first use — no manual login needed.

## Install

From npm:

```bash
npm install -g @ai4paper/apaper-mcp
```

## MCP client config

```json
{
  "mcp": {
    "apaper-mcp": {
      "type": "local",
      "command": ["npx", "@ai4paper/apaper-mcp"],
      "enabled": true
    }
  }
}
```

<details>
<summary>Development</summary>

### Requirements

- Bun
- Node.js

### Install from source

```bash
bun install
```

### Dev / build / test

```bash
bun run dev        # start server (logs to stderr on stdio)
bun run build
bun run test
bun run typecheck
bun run start      # run built server
```

### Tool schemas

- `search_arxiv_papers`
  - input: `{ "query": string, "max_results"?: number, "date_from"?: string, "date_to"?: string, "categories"?: string[], "sort_by"?: "relevance" | "date" }`
- `download_arxiv_paper`
  - input: `{ "paper_id": string, "save_path"?: string }` (paper_id like `2103.12345` or `2103.12345v2`)
- `search_iacr_papers`
  - input: `{ "query": string, "max_results"?: number, "fetch_details"?: boolean, "year_min"?: number | string, "year_max"?: number | string }`
- `download_iacr_paper`
  - input: `{ "paper_id": string, "save_path"?: string }`
- `search_dblp_papers`
  - input: `{ "query": string, "max_results"?: number, "year_from"?: number | string, "year_to"?: number | string, "venue_filter"?: string, "include_bibtex"?: boolean }`
- `search_google_scholar_papers`
  - input: `{ "query": string, "max_results"?: number, "year_low"?: number | string, "year_high"?: number | string }`
- `search_cnki_papers`
  - input: `{ "query": string, "page_num"?: number, "page_size"?: number }`
- `download_cnki_paper`
  - input: `{ "href": string, "save_path"?: string }` (use an `href` from `search_cnki_papers`)

### Local MCP testing

```bash
npx @modelcontextprotocol/inspector bun run src/index.ts
```

</details>
