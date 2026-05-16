# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

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
