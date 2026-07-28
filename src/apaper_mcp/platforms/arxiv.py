import os
import random
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from bs4 import BeautifulSoup

from ..models import ArxivPaper

_GROUPS = {
    "cs": "computer_science",
    "econ": "economics",
    "eess": "eess",
    "math": "mathematics",
    "physics": "physics",
    "astro-ph": "physics",
    "cond-mat": "physics",
    "gr-qc": "physics",
    "hep-ex": "physics",
    "hep-lat": "physics",
    "hep-ph": "physics",
    "hep-th": "physics",
    "math-ph": "physics",
    "nlin": "physics",
    "nucl-ex": "physics",
    "nucl-th": "physics",
    "quant-ph": "physics",
    "q-bio": "q_biology",
    "q-fin": "q_finance",
    "stat": "statistics",
}


def build_arxiv_search_params(
    query: str, options: dict[str, object] | None = None
) -> dict[str, str]:
    options = options or {}
    term = query.strip()
    field = "all"
    for prefix, name in (
        ("ti:", "title"),
        ("au:", "author"),
        ("abs:", "abstract"),
        ("cat:", "all"),
        ("doi:", "doi"),
    ):
        if term.lower().startswith(prefix):
            term, field = term[len(prefix) :].strip(), name
            break
    date_from, date_to = options.get("date_from"), options.get("date_to")
    categories = options.get("categories") or []
    if not term and not date_from and not date_to:
        raise ValueError("No search criteria provided")
    max_results = max(1, int(options.get("max_results", 10)))
    size = (
        25
        if max_results <= 25
        else 50
        if max_results <= 50
        else 100
        if max_results <= 100
        else 200
    )
    if not categories and not date_from and not date_to and field == "all":
        result = {"searchtype": "all", "query": term, "start": "0", "size": str(size)}
        if options.get("sort_by") == "date":
            result["order"] = "-announced_date_first"
        return result
    result = {
        "advanced": "",
        "terms-0-operator": "AND",
        "terms-0-term": term,
        "terms-0-field": field,
    }
    groups = {
        _GROUPS.get(str(category).split(".")[0].lower()) for category in categories
    }
    groups.discard(None)
    for group in groups:
        result[f"classification-{group}"] = "y"
    result.update(
        {
            "classification-physics_archives": "all",
            "classification-include_cross_list": "include",
        }
    )
    if date_from or date_to:
        for label, value in (("date_from", date_from), ("date_to", date_to)):
            if value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
                raise ValueError(f"Invalid {label} format. Use YYYY-MM-DD: {value}")
        result.update(
            {
                "date-filter_by": "date_range",
                "date-year": "",
                "date-from_date": str(date_from or ""),
                "date-to_date": str(date_to or ""),
                "date-date_type": "submitted_date",
            }
        )
    else:
        result.update(
            {
                "date-filter_by": "all_dates",
                "date-year": "",
                "date-from_date": "",
                "date-to_date": "",
                "date-date_type": "submitted_date",
            }
        )
    result.update(
        {
            "abstracts": "show",
            "size": str(size),
            "order": "-announced_date_first"
            if options.get("sort_by") == "date"
            else "",
            "start": "0",
        }
    )
    return result


def parse_arxiv_search_html(html: str) -> list[ArxivPaper]:
    soup = BeautifulSoup(html, "html.parser")
    papers = []
    for item in soup.select("li.arxiv-result"):
        link = item.select_one("p.list-title a[href*='/abs/']")
        if not link:
            continue
        match = re.search(r"/abs/([^/?#]+)", link.get("href", ""))
        if not match:
            continue
        paper_id = re.sub(r"v\d+$", "", match.group(1), flags=re.I)
        clean = lambda value: re.sub(r"\s+", " ", value or "").strip()
        tags = [
            clean(x.get_text())
            for x in item.select("div.tags span.tag")
            if clean(x.get_text())
        ]
        pdf = next(
            (
                x.get("href", "")
                for x in item.select("p.list-title a")
                if "/pdf/" in x.get("href", "")
            ),
            f"https://arxiv.org/pdf/{paper_id}",
        )
        date_match = re.search(
            r"Submitted\s+(\d{1,2}\s+\w+,?\s+\d{4})",
            clean(
                item.select_one("p.is-size-7").get_text()
                if item.select_one("p.is-size-7")
                else ""
            ),
            re.I,
        )
        published = ""
        if date_match:
            try:
                published = (
                    datetime.strptime(date_match.group(1).replace(",", ""), "%d %B %Y")
                    .replace(tzinfo=timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            except ValueError:
                pass
        comments = {"comment": "", "journal_ref": "", "doi": ""}
        for paragraph in item.select("p.comments"):
            text = clean(paragraph.get_text())
            for label, key in (
                ("Comments", "comment"),
                ("Journal ref", "journal_ref"),
                ("doi", "doi"),
            ):
                if re.match(label + r"\s*:", text, re.I):
                    comments[key] = re.sub(label + r"\s*:\s*", "", text, flags=re.I)
        papers.append(
            {
                "paper_id": paper_id,
                "title": clean(
                    item.select_one("p.title").get_text()
                    if item.select_one("p.title")
                    else ""
                ),
                "authors": [
                    clean(x.get_text())
                    for x in item.select("p.authors a")
                    if clean(x.get_text())
                ],
                "abstract": clean(
                    (
                        item.select_one("span.abstract-full")
                        or item.select_one("span.abstract-short")
                    ).get_text()
                    if (
                        item.select_one("span.abstract-full")
                        or item.select_one("span.abstract-short")
                    )
                    else ""
                )
                .removesuffix("▽ More")
                .removesuffix("△ Less")
                .strip(),
                "categories": tags,
                "primary_category": tags[0] if tags else "",
                "published_date": published,
                "updated_date": published,
                "pdf_url": pdf,
                "url": f"https://arxiv.org/abs/{paper_id}",
                **comments,
            }
        )
    return papers


def parse_retry_after_ms(value: str | None, now: float | None = None) -> int | None:
    if not value or not value.strip():
        return None
    if value.strip().isdigit():
        return int(value.strip()) * 1000
    if " " not in value:
        return None
    try:
        return max(
            0,
            int(
                datetime.strptime(value.strip(), "%a, %d %b %Y %H:%M:%S GMT")
                .replace(tzinfo=timezone.utc)
                .timestamp()
                * 1000
                - (now if now is not None else time.time() * 1000)
            ),
        )
    except ValueError:
        return None


def compute_backoff_ms(
    attempt: int,
    retry_after_ms: int | None,
    options: dict[str, int],
    rand=random.random,
) -> int:
    delay = (
        max(options["base_ms"] * 2**attempt, retry_after_ms or 0)
        + rand() * options["jitter_ms"]
    )
    return int(min(delay, options["max_ms"]))


def looks_like_ip(text: str) -> bool:
    return bool(
        re.fullmatch(r"(\d{1,3}\.){3}\d{1,3}", text)
        or (":" in text and re.fullmatch(r"[0-9a-fA-F:]{2,45}", text))
    )
