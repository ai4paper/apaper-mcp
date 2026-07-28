import hashlib
from datetime import datetime, timezone
import re
from bs4 import BeautifulSoup


def parse_google_scholar_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    papers = []
    for result in soup.select("div.gs_ri"):
        title_element, info = (
            result.select_one("h3.gs_rt"),
            result.select_one("div.gs_a"),
        )
        if not title_element or not info:
            continue
        link = title_element.select_one("a")
        title = re.sub(r"\[(?:PDF|HTML|BOOK)\]", "", title_element.get_text()).strip()
        info_text = info.get_text(strip=True)
        years = re.findall(r"\b(?:19|20)\d{2}\b", info_text)
        year = int(years[0]) if years else None
        cited = next(
            (
                x.get_text()
                for x in result.select("div.gs_fl a")
                if "Cited by" in x.get_text()
            ),
            "",
        )
        citations = int(re.sub(r"\D", "", cited) or 0)
        url = link.get("href", "") if link else ""
        published = (
            datetime(year, 1, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            if year
            else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        papers.append(
            {
                "paper_id": "gs_"
                + str(
                    int(hashlib.sha256((url or title).encode()).hexdigest()[:12], 16)
                ),
                "title": title,
                "authors": [
                    x.strip() for x in info_text.split(" - ")[0].split(",") if x.strip()
                ],
                "abstract": result.select_one("div.gs_rs").get_text(strip=True)
                if result.select_one("div.gs_rs")
                else "",
                "doi": "",
                "published_date": published,
                "pdf_url": "",
                "url": url,
                "source": "google_scholar",
                "categories": [],
                "keywords": [],
                "citations": citations,
                "references": [],
                "extra": {"infoText": info_text},
            }
        )
    return papers
