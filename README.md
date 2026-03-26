# apaper-mcp

Academic paper research MCP server built with Bun and TypeScript.

## Requirements

- Bun
- Node.js
- GitHub CLI (`gh`) for publishing

## Install

```bash
bun install
```

## Development

```bash
bun run dev
```

The server logs `apaper-mcp running on stdio` to stderr when it starts.

## Build

```bash
bun run build
```

## Test

```bash
bun run test
```

## Typecheck

```bash
bun run typecheck
```

## Run built server

```bash
bun run start
```

## Tools

- `search_iacr_papers`
  - input: `{ "query": string, "max_results"?: number, "fetch_details"?: boolean, "year_min"?: number | string, "year_max"?: number | string }`
  - output: formatted IACR ePrint paper search results
- `download_iacr_paper`
  - input: `{ "paper_id": string, "save_path"?: string }`
  - output: saved PDF path or an error message
- `search_dblp_papers`
  - input: `{ "query": string, "max_results"?: number, "year_from"?: number | string, "year_to"?: number | string, "venue_filter"?: string, "include_bibtex"?: boolean }`
  - output: formatted DBLP publication results or BibTeX entries
- `search_google_scholar_papers`
  - input: `{ "query": string, "max_results"?: number, "year_low"?: number | string, "year_high"?: number | string }`
  - output: formatted Google Scholar search results

## Local MCP testing

Start the server:

```bash
bun run dev
```

Then connect with an MCP inspector/client. One easy option is the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector bun run src/index.ts
```

That lets you inspect the server, list tools, and call them locally over stdio.

## Publish to GitHub

```bash
gh repo create ai4paper/apaper-mcp --public --source=. --remote=origin --push
```
