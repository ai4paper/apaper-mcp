# Introducing apaper-mcp

`apaper-mcp` is an MCP server for one very practical job: supporting paper work inside the conversation. Today that starts with paper discovery, but the larger direction is a more complete academic writing server where an AI client can search literature, collect references, organize source material, and assist with drafting around the same workflow. Instead of wiring separate scripts to different research sites, this project packages focused research tools behind a single Model Context Protocol interface.

The project is built with **Bun**, **TypeScript**, and the official **Model Context Protocol SDK**. It runs over stdio, which makes it easy to plug into MCP-compatible clients and local inspection tools. The current implementation focuses on three common sources: **IACR ePrint**, **DBLP**, and **Google Scholar**.

## Why this project exists

Research and writing workflows often break into too many manual steps. You search one index for cryptography preprints, another for publication metadata, and another for broad citation discovery, then move that material into notes, citations, and draft sections. `apaper-mcp` narrows that gap by turning the research side of that process into MCP tools that an assistant can call directly.

That design is especially useful when the goal is not just to find one paper, but to support iterative paper-writing tasks such as:

- narrowing a topic by year range
- comparing results across multiple sources
- pulling BibTeX-ready metadata from DBLP
- downloading an IACR PDF for closer reading
- building a cleaner literature base before outlining or drafting

## What the server exposes

At the moment, the server registers four tools:

- `search_iacr_papers` for querying the IACR ePrint archive, with optional detail fetching and year filters
- `download_iacr_paper` for saving an IACR paper PDF locally
- `search_dblp_papers` for publication lookup in DBLP, including venue filtering and optional BibTeX output
- `search_google_scholar_papers` for broader paper discovery through Google Scholar with year bounds

Each tool returns formatted text responses so MCP clients can display results cleanly without extra response shaping. That keeps the server simple while still making it useful in real workflows.

## Using it in an MCP client

One simple local configuration looks like this:

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

With that setup, an MCP-compatible client can start the server locally and call its tools during a research session.

## Example use cases

In practice, that means an assistant can use `apaper-mcp` to:

- search papers on a topic across multiple sources
- collect metadata and BibTeX for references
- download an IACR paper for closer reading
- prepare source material before outlining or drafting a paper

## How it is put together

The codebase keeps the implementation intentionally direct. The MCP entrypoint lives in `src/index.ts`, where each tool is registered with a Zod-based input schema and a small amount of argument normalization for integer-like year fields. Platform-specific fetching and parsing live in separate modules under `src/platforms/`, which keeps the transport layer and the scraping/API logic from bleeding into each other.

That split also reflects the nature of the supported sources:

- **IACR** and **Google Scholar** are handled by fetching and parsing HTML
- **DBLP** uses its JSON API and can optionally fetch BibTeX records

This is not trying to be a full academic knowledge graph or a large orchestration framework. It is a compact MCP server with a clear surface area, aimed at making paper search easier to automate and easier to integrate into AI-assisted research and writing sessions.

## Future directions

Today, `apaper-mcp` focuses on search and retrieval. The next step is to extend it into a more complete paper-writing server.

- reference management tools for collecting, deduplicating, and exporting citations across sources
- PDF processing tools for extracting metadata, section text, figures, or notes from downloaded papers
- literature review helpers for clustering papers by topic, method, or publication venue
- outlining and drafting support for turning research notes into section plans, related-work summaries, or first-pass prose
- revision tools for checking consistency between claims, citations, and bibliography entries
- submission-oriented utilities for format checks, metadata cleanup, and venue-specific packaging

Those additions would move the project from paper search into a broader research-writing workspace.

## Closing thought

`apaper-mcp` is a focused example of what MCP is good at: exposing useful capabilities in a form that AI clients can call reliably. Right now, that means less context switching, less glue code, and a cleaner path from a research question to a usable set of papers. With the right extensions, it can grow into a practical MCP server for the full paper-writing workflow rather than only the search stage.
