# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [0.1.5] - 2026-06-08

### Added

- arXiv requests are throttled and retried on HTTP 429 / 5xx with exponential backoff honouring `Retry-After`; a persistent block reports the throttled IP and wait time. Tunable via `ARXIV_MIN_INTERVAL_MS`, `ARXIV_MAX_RETRIES`, `ARXIV_BACKOFF_BASE_MS`, `ARXIV_BACKOFF_MAX_MS`, `ARXIV_BACKOFF_JITTER_MS`, and `ARXIV_IP_ECHO_URL`. (#1, @isomoes)

### Fixed

- arXiv tools no longer fail on the first HTTP 429, and the search tool description no longer claims rate-limiting that was not implemented. (#1, @isomoes)

## [0.1.4] - 2026-05-17

### Added

- arXiv search support via the `search_arxiv_papers` tool, with category, date-range, and sort options. (@isomoes)
- arXiv PDF download support via the `download_arxiv_paper` tool. (@isomoes)
- `ARXIV_SEARCH_URL`, `ARXIV_ADVANCED_URL`, and `ARXIV_PDF_BASE` env overrides for routing arXiv traffic through a reachable mirror. (@isomoes)

### Changed

- arXiv search scrapes the `arxiv.org/search/` HTML page instead of `export.arxiv.org/api/query` so it works on networks where the Atom API endpoint is blocked or aggressively rate-limited. (@isomoes)

## [0.1.3] - 2026-05-16

### Added

- CNKI (中国知网) search support via the `search_cnki_papers` tool. (@isomoes)
- CNKI PDF download support via the `download_cnki_paper` tool. (@isomoes)
- Automatic IP-based CNKI session login on whitelisted institutional networks; no manual cookie management required. (@isomoes)

## [0.1.2] - 2026-03-26

### Added

- Test release to verify tag-triggered GitHub Actions publishing now that the workflow is active. (@isomoes)

## [0.1.1] - 2026-03-26

### Added

- npm packaging for `@ai4paper/apaper-mcp`, including the `apaper-mcp` CLI entrypoint. (@isomoes)
- Tag-driven GitHub Actions release publishing and changelog-backed release notes. (@isomoes)
- README updates covering npm installation and local release verification workflow. (@isomoes)

## [0.1.0] - 2026-03-26

### Added

- Initial Bun + TypeScript MCP server for academic paper research. (@isomoes)
- IACR ePrint search support with optional detail fetching and year filters. (@isomoes)
- IACR PDF download support. (@isomoes)
- DBLP search support with year filtering, venue filtering, and optional BibTeX output. (@isomoes)
- Google Scholar search support with year filtering. (@isomoes)
- Text formatters for MCP tool responses and stdio server startup entrypoint. (@isomoes)
