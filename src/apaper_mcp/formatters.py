from datetime import datetime
from typing import Any


def _year_filter(minimum: int | None, maximum: int | None) -> str:
    if minimum is None and maximum is None:
        return ""
    return f" in year range ({minimum if minimum is not None else 'earliest'}-{maximum if maximum is not None else 'latest'})"


def format_iacr_search_response(
    papers: list[dict[str, Any]],
    query: str,
    year_min: int | None = None,
    year_max: int | None = None,
) -> str:
    if not papers:
        return f"No papers found for query: {query}{_year_filter(year_min, year_max)}"
    lines = [
        f"Found {len(papers)} IACR papers for query '{query}'{_year_filter(year_min, year_max)}:",
        "",
    ]
    for index, paper in enumerate(papers, 1):
        lines += [
            f"{index}. **{paper['title']}**",
            f"   - Paper ID: {paper['paper_id']}",
            f"   - Authors: {', '.join(paper['authors'])}",
            f"   - URL: {paper['url']}",
            f"   - PDF: {paper['pdf_url']}",
        ]
        if paper["categories"]:
            lines.append(f"   - Categories: {', '.join(paper['categories'])}")
        if paper["keywords"]:
            lines.append(f"   - Keywords: {', '.join(paper['keywords'])}")
        if paper["abstract"]:
            lines.append(f"   - Abstract: {paper['abstract']}")
        lines.append("")
    return "\n".join(lines)


def format_dblp_search_response(
    results: list[dict[str, Any]], query: str, options: dict[str, Any]
) -> str:
    filters = []
    if options.get("year_from") is not None or options.get("year_to") is not None:
        filters.append(
            f"year range ({options.get('year_from', 'earliest')}-{options.get('year_to', 'latest')})"
        )
    if options.get("venue_filter"):
        filters.append(f"venue '{options['venue_filter']}'")
    suffix = f" with filters: {', '.join(filters)}" if filters else ""
    if not results:
        return f"No papers found for query: {query}{suffix}"
    if options.get("include_bibtex"):
        lines = [
            f"Found {len(results)} DBLP BibTeX entries for query '{query}'{suffix}:",
            "",
        ]
        for index, result in enumerate(results, 1):
            lines += [
                f"{index}. DBLP Key: {result['dblp_key']}",
                "```bibtex",
                result["bibtex"],
                "```",
                "",
            ]
        return "\n".join(lines)
    lines = [f"Found {len(results)} DBLP papers for query '{query}'{suffix}:", ""]
    for index, result in enumerate(results, 1):
        lines += [
            f"{index}. **{result['title'] or 'Untitled'}**",
            f"   - DBLP Key: {result['dblp_key']}",
            f"   - Authors: {', '.join(result['authors'])}",
        ]
        if result.get("venue"):
            lines.append(f"   - Venue: {result['venue']}")
        if result.get("year"):
            lines.append(f"   - Year: {result['year']}")
        if result.get("doi"):
            lines.append(f"   - DOI: {result['doi']}")
        if result.get("url"):
            lines.append(f"   - URL: {result['url']}")
        lines.append("")
    return "\n".join(lines)


def format_google_scholar_search_response(
    papers: list[dict[str, Any]],
    query: str,
    year_low: int | None = None,
    year_high: int | None = None,
) -> str:
    if not papers:
        return f"No papers found for query: {query}{_year_filter(year_low, year_high)}"
    lines = [
        f"Found {len(papers)} Google Scholar papers for query '{query}'{_year_filter(year_low, year_high)}:",
        "",
    ]
    for index, paper in enumerate(papers, 1):
        lines += [
            f"{index}. **{paper['title']}**",
            f"   - Authors: {', '.join(paper['authors'])}",
        ]
        if paper["citations"] > 0:
            lines.append(f"   - Citations: {paper['citations']}")
        if paper.get("published_date"):
            try:
                lines.append(
                    f"   - Year: {datetime.fromisoformat(paper['published_date'].replace('Z', '+00:00')).year}"
                )
            except ValueError:
                pass
        if paper.get("url"):
            lines.append(f"   - URL: {paper['url']}")
        if paper.get("abstract"):
            lines.append(f"   - Abstract: {paper['abstract']}")
        lines.append("")
    return "\n".join(lines)


def format_arxiv_search_response(
    papers: list[dict[str, Any]], query: str, options: dict[str, Any] | None = None
) -> str:
    options = options or {}
    filters = []
    if options.get("date_from") or options.get("date_to"):
        filters.append(
            f"date range ({options.get('date_from', 'earliest')} to {options.get('date_to', 'latest')})"
        )
    if options.get("categories"):
        filters.append(f"categories [{', '.join(options['categories'])}]")
    suffix = f" with filters: {', '.join(filters)}" if filters else ""
    if not papers:
        return f"No arXiv papers found for query: {query}{suffix}"
    lines = [f"Found {len(papers)} arXiv papers for query '{query}'{suffix}:", ""]
    for index, p in enumerate(papers, 1):
        lines += [
            f"{index}. **{p['title'] or 'Untitled'}**",
            f"   - Paper ID: {p['paper_id']}",
        ]
        if p["authors"]:
            lines.append(f"   - Authors: {', '.join(p['authors'])}")
        if p["primary_category"]:
            lines.append(f"   - Primary Category: {p['primary_category']}")
        if p["categories"]:
            lines.append(f"   - Categories: {', '.join(p['categories'])}")
        if p["published_date"]:
            lines.append(f"   - Published: {p['published_date']}")
        if p["doi"]:
            lines.append(f"   - DOI: {p['doi']}")
        if p["journal_ref"]:
            lines.append(f"   - Journal Ref: {p['journal_ref']}")
        if p["url"]:
            lines.append(f"   - URL: {p['url']}")
        if p["pdf_url"]:
            lines.append(f"   - PDF: {p['pdf_url']}")
        if p["abstract"]:
            lines.append(f"   - Abstract: {p['abstract']}")
        lines.append("")
    return "\n".join(lines)


def format_cnki_search_response(papers: list[dict[str, Any]], query: str) -> str:
    if not papers:
        return f"No CNKI papers found for query: {query}"
    lines = [f"Found {len(papers)} CNKI papers for query '{query}':", ""]
    for index, p in enumerate(papers, 1):
        lines.append(f"{index}. **{p['title'] or 'Untitled'}**")
        if p["authors"]:
            lines.append(f"   - Authors: {', '.join(p['authors'])}")
        if p["source"]:
            lines.append(f"   - Source: {p['source']}")
        if p["href"]:
            lines.append(f"   - URL: {p['href']}")
        lines.append("")
    return "\n".join(lines)
