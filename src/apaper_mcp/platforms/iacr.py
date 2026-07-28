from datetime import datetime, timezone
from urllib.parse import urlencode
from bs4 import BeautifulSoup


def build_iacr_search_params(
    query: str, year_min: int | None = None, year_max: int | None = None
) -> str:
    values = {"q": query}
    if year_min is not None:
        values["revisedafter"] = str(year_min)
    if year_max is not None:
        values["revisedbefore"] = str(year_max)
    return urlencode(values)


def is_cloudflare_challenge(response) -> bool:
    return response.headers.get("cf-mitigated") == "challenge" or (
        response.status_code in (403, 503)
        and "cloudflare" in response.headers.get("server", "").lower()
        and "text/html" in response.headers.get("content-type", "")
    )


def _paper(**kwargs):
    return {
        "paper_id": "",
        "title": "",
        "authors": [],
        "abstract": "",
        "doi": "",
        "published_date": None,
        "pdf_url": "",
        "url": "",
        "source": "iacr",
        "categories": [],
        "keywords": [],
        "citations": 0,
        "references": [],
        "extra": {},
        **kwargs,
    }


def parse_iacr_search_html(html: str, _fetch_details: bool = False) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    papers = []
    for item in soup.select("div.mb-4"):
        header, content, link = (
            item.select_one("div.d-flex"),
            item.select_one("div.ms-md-4"),
            item.select_one("a.paperlink"),
        )
        if not header or not content or not link:
            continue
        updated = (
            header.select_one("small.ms-auto")
            .get_text(strip=True)
            .replace("Last updated:", "")
            .strip()
            if header.select_one("small.ms-auto")
            else ""
        )
        try:
            updated = (
                datetime.fromisoformat(updated)
                .replace(tzinfo=timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except ValueError:
            updated = None
        pdf = next(
            (
                x.get("href")
                for x in header.select("a")
                if x.get_text(strip=True) == "(PDF)"
            ),
            "",
        )
        authors = [
            x.strip()
            for x in (
                content.select_one("span.fst-italic").get_text()
                if content.select_one("span.fst-italic")
                else ""
            ).split(",")
            if x.strip()
        ]
        papers.append(
            _paper(
                paper_id=link.get_text(strip=True),
                title=content.select_one("strong").get_text(strip=True)
                if content.select_one("strong")
                else "",
                authors=authors,
                abstract=content.select_one("p.search-abstract").get_text(strip=True)
                if content.select_one("p.search-abstract")
                else "",
                published_date=updated or "1900-01-01T00:00:00Z",
                updated_date=updated,
                pdf_url=f"https://eprint.iacr.org{pdf}",
                url=f"https://eprint.iacr.org{link.get('href', '')}",
                categories=[content.select_one("small.badge").get_text(strip=True)]
                if content.select_one("small.badge")
                else [],
            )
        )
    return papers


def parse_iacr_detail_html(html: str, paper_id: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.select_one("h3.mb-3")
    if not title:
        return None
    lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]
    history = []
    publication = ""
    started = False
    updated = None
    for index, line in enumerate(lines):
        if line == "Publication info" and index + 1 < len(lines):
            publication = lines[index + 1]
        if line == "History":
            started = True
            continue
        if started and (line.startswith("Short URL") or line.startswith("License")):
            break
        if started and ":" in line:
            history.append(line)
            if updated is None:
                try:
                    updated = (
                        datetime.fromisoformat(line.split(":", 1)[0])
                        .replace(tzinfo=timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z")
                    )
                except ValueError:
                    pass
    authors = [
        x.strip()
        for x in (
            soup.select_one("p.fst-italic").get_text()
            if soup.select_one("p.fst-italic")
            else ""
        )
        .replace(" and ", ",")
        .split(",")
        if x.strip()
    ]
    return _paper(
        paper_id=paper_id,
        title=title.get_text(strip=True),
        authors=authors,
        abstract=soup.select_one('p[style="white-space: pre-wrap;"]').get_text(
            strip=True
        )
        if soup.select_one('p[style="white-space: pre-wrap;"]')
        else "",
        published_date=updated
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        updated_date=updated,
        pdf_url=f"https://eprint.iacr.org/{paper_id}.pdf",
        url=f"https://eprint.iacr.org/{paper_id}",
        keywords=[
            x.get_text(strip=True) for x in soup.select("a.badge.bg-secondary.keyword")
        ],
        extra={"publicationInfo": publication, "history": "; ".join(history)},
    )
