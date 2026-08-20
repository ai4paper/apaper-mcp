# apaper-mcp

An MCP (Model Context Protocol) server that gives AI assistants direct access to academic paper databases. It exposes a unified set of tools for searching and downloading papers across arXiv, IACR ePrint, DBLP, Google Scholar, and CNKI (中国知网), so an MCP-compatible client (Claude Code, Claude Desktop, or any other) can run literature searches, pull BibTeX entries, and fetch PDFs without leaving the chat.

## Tools

| Tool | Source | Description |
| --- | --- | --- |
| `search_arxiv_papers` | arXiv | Search with category, date-range, and sort options |
| `download_arxiv_paper` | arXiv | Download a PDF |
| `search_iacr_papers` | IACR ePrint | Search the ePrint archive |
| `download_iacr_paper` | IACR ePrint | Download a PDF |
| `search_dblp_papers` | DBLP | Search, optionally with BibTeX |
| `search_google_scholar_papers` | Google Scholar | Search |
| `search_cnki_papers` | CNKI (中国知网) | Search |
| `download_cnki_paper` | CNKI (中国知网) | Download a PDF |

arXiv tools scrape the public `arxiv.org/search/` HTML page, which works on
networks where the `export.arxiv.org` Atom API is blocked or rate-limited. If
you need to route through a mirror, set `ARXIV_SEARCH_URL`,
`ARXIV_ADVANCED_URL`, and/or `ARXIV_PDF_BASE`.

The arXiv tools throttle themselves and retry HTTP 429 / 5xx with exponential
backoff, honouring `Retry-After`; on a persistent block the error names the
throttled IP and wait time. Tune with `ARXIV_MIN_INTERVAL_MS` (`3000`),
`ARXIV_MAX_RETRIES` (`3`), `ARXIV_BACKOFF_BASE_MS` (`3000`),
`ARXIV_BACKOFF_MAX_MS` (`60000`), `ARXIV_BACKOFF_JITTER_MS` (`500`), and
`ARXIV_IP_ECHO_URL` (`""` to disable the IP lookup).

CNKI tools require institutional access. On IP-based networks the session
cookie is obtained automatically on first use — no manual login needed.

IACR ePrint sits behind Cloudflare, which intermittently serves a JS bot
challenge, most often on PDF downloads. The download tool uses Scrapling's
stealth browser and built-in Cloudflare solver, and only publishes a file after
the response bytes validate as a PDF.

## Proxy

Set `SPIDER_PROXY` to route outbound requests — arXiv, IACR, DBLP, Google
Scholar, and their PDF downloads — through a proxy. CNKI is excluded on purpose:
it authenticates by institutional IP and always uses this host's real address.
Both a standard URL and the colon-delimited form some mobile-proxy providers
hand out are accepted:

```bash
SPIDER_PROXY="socks5://user:pass@host:1086"   # standard
SPIDER_PROXY="socks5://host:1086:user:pass"   # host:port:user:pass (e.g. Kookeey)
SPIDER_PROXY="http://user:pass@host:8080"     # HTTP CONNECT proxy
```

`socks5`, `socks4`, `http`, and `https` schemes are supported (the scheme
defaults to `http` when omitted) by the Python runtime. The scheme must match
the proxy's port — a SOCKS port won't accept `http://` and vice versa. If
`SPIDER_PROXY` is set but invalid or can't be initialised, requests are blocked
rather than sent direct, so a misconfigured proxy never leaks this host's real
IP.

Flaky residential/mobile proxies routinely drop or refuse connections;
idempotent (GET) requests through the proxy are retried automatically on such
transient failures. IACR fires the most requests per search (a detail fetch per
result), so its per-request timeouts default high for slow proxies — tune with
`IACR_TIMEOUT_MS` (`30000`) and `IACR_DOWNLOAD_TIMEOUT_MS` (`600000`). IACR
downloads retry fresh browser sessions three times by default; tune the count
with `IACR_CAPTCHA_ATTEMPTS`.

## Install from PyPI

The maintained runtime requires Python 3.12+. The IACR downloader automatically
uses a `chromium` executable from `PATH`. On Arch Linux, install it from the
official repository, then run the published package directly with `uvx`:

```bash
sudo pacman -S chromium
uvx apaper-mcp
```

On systems without a packaged Chromium, install Scrapling's browser runtime
once with `uvx --from 'scrapling[fetchers]' scrapling install`. Set
`IACR_BROWSER_EXECUTABLE` to use a browser at a nonstandard path.

To install the command for repeated use:

```bash
uv tool install apaper-mcp
apaper-mcp
```

For an MCP client, use the published package as the local stdio command:

```json
{
  "mcp": {
    "apaper-mcp": {
      "type": "local",
      "command": ["uvx", "apaper-mcp"],
      "timeout": 900000,
      "enabled": true
    }
  },
  "experimental": {
    "mcp_timeout": 900000
  }
}
```

The 15-minute timeout is needed for browser-assisted IACR downloads. Some
OpenCode versions ignore the per-server value for tool calls, so the global
`experimental.mcp_timeout` fallback is included as well. Quit and restart
OpenCode after changing MCP configuration.

## Development

Clone the repository and install its development dependencies with `uv`:

```bash
uv sync
uv run apaper-mcp
```

Install Chromium through your OS package manager. If no system Chromium is
available, run `uv run scrapling install` instead.

Run tests with `uv run pytest`.

The Python source uses a standard `src` package layout. Platform-specific
clients live under `src/apaper_mcp/platforms/`, while shared server, proxy,
formatter, and model code stays in `src/apaper_mcp/`.

### Local MCP testing

Start the MCP Inspector against the Python stdio server:

```bash
npx @modelcontextprotocol/inspector uv run --directory . apaper-mcp
```

The equivalent module command is:

```bash
npx @modelcontextprotocol/inspector \
  uv run --directory . python -m apaper_mcp
```

To pass the proxy to the inspected server:

```bash
npx @modelcontextprotocol/inspector \
  -e SPIDER_PROXY="$SPIDER_PROXY" \
  uv run --directory . apaper-mcp
```

The Inspector opens a local web UI for listing tools, inspecting schemas, and
calling tools.

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
