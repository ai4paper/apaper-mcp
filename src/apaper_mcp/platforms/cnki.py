import re
from urllib.parse import unquote, urljoin
from bs4 import BeautifulSoup


def build_cnki_query_json(value: str) -> dict:
    return {
        "Platform": "",
        "Resource": "CROSSDB",
        "Classid": "WD0FTY92",
        "Products": "CJFQ,CAPJ,WWJD,CJTL,CDFD,CMFD,CPFD,IPFD,CPVD,WWPD,CCND,SCSF,SCHF,SCSD,SOSD,SNAD,CCJD,WBFD,WWBD,CCVD,CJFN",
        "QNode": {
            "QGroup": [
                {
                    "Key": "Subject",
                    "Title": "",
                    "Logic": 0,
                    "Items": [
                        {
                            "Field": "SU",
                            "Value": value,
                            "Operator": "TOPRANK",
                            "Logic": 0,
                            "Title": "主题",
                        }
                    ],
                    "ChildItems": [],
                }
            ]
        },
        "ExScope": 1,
        "SearchType": 2,
        "Rlang": "BOTH",
        "KuaKuCode": "YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV",
        "Expands": {},
        "SearchFrom": 4,
    }


def parse_cnki_search_html(
    html: str, base_url: str = "https://kns.cnki.net/"
) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    papers = []
    for row in soup.select(
        "table.result-table-list tbody tr, table.result-table-list tr"
    ):
        title = row.select_one("td.name a.fz14")
        if (
            not title
            or not title.get("href")
            or title["href"].startswith("javascript:")
            or "/kcms2/article/abstract" not in title["href"]
        ):
            continue
        source = row.select_one("td.source")
        source_link = ""
        source_name = ""
        if source:
            source_a = next(
                (
                    x
                    for x in source.select("a")
                    if x.get("href")
                    and ("knavi/detail" in x["href"] or "thinker.cnki.net" in x["href"])
                ),
                None,
            )
            if source_a:
                source_name, source_link = (
                    source_a.get_text(strip=True),
                    urljoin(base_url, source_a["href"]),
                )
            else:
                source_name = next(
                    (
                        x.get_text(strip=True)
                        for x in source.select("span")
                        if x.get_text(strip=True) not in ("—",)
                    ),
                    source.get_text(" ", strip=True),
                )
        papers.append(
            {
                "title": title.get_text(strip=True),
                "authors": [
                    x.get_text(strip=True)
                    for x in row.select("td.author a.KnowledgeNetLink")
                ],
                "source": source_name,
                "source_link": source_link,
                "href": urljoin(base_url, title["href"]),
            }
        )
    return papers


def extract_filename_from_content_disposition(disposition: str) -> str:
    match = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", disposition, re.I)
    if match:
        return unquote(match.group(1).strip())
    match = re.search(r"filename\s*=\s*\"?([^\";]+)", disposition, re.I)
    return unquote(match.group(1).strip()) if match else ""
