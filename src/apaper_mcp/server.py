import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

from .platforms.arxiv import (
    build_arxiv_search_params,
    compute_backoff_ms,
    parse_arxiv_search_html,
    parse_retry_after_ms,
)
from .platforms.cnki import (
    build_cnki_query_json,
    parse_cnki_search_html,
    extract_filename_from_content_disposition,
)
from .platforms.dblp import filter_dblp_results, parse_dblp_api_response
from .formatters import (
    format_arxiv_search_response,
    format_cnki_search_response,
    format_dblp_search_response,
    format_google_scholar_search_response,
    format_iacr_search_response,
)
from .platforms.iacr import (
    build_iacr_search_params,
    download_iacr_pdf,
    parse_iacr_detail_html,
    parse_iacr_search_html,
)
from .proxy import make_client
from .platforms.scholar import parse_google_scholar_html

mcp = FastMCP("apaper-mcp")
_arxiv_lock = asyncio.Lock()
_arxiv_last_request = 0.0
_cnki_cookie = ""
_iacr_download_tasks: set[asyncio.Task] = set()

CNKI_LOGIN_URL = "https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo"
CNKI_SEARCH_URL = "https://kns.cnki.net/kns8s/brief/grid"
CNKI_REFERER = "https://kns.cnki.net/"
CNKI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0 Safari/537.36",
    "Referer": CNKI_REFERER,
}
ARXIV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


async def _get(
    url: str, *, direct: bool = False, timeout: float = 30, **kwargs
) -> httpx.Response:
    def request():
        with make_client(direct=direct, timeout=timeout) as client:
            return client.get(url, **kwargs)

    return await asyncio.to_thread(request)


async def _post(
    url: str, *, direct: bool = False, timeout: float = 30, **kwargs
) -> httpx.Response:
    def request():
        with make_client(direct=direct, timeout=timeout) as client:
            return client.post(url, **kwargs)

    return await asyncio.to_thread(request)


def _cookie_header(values: list[str]) -> str:
    cookies: dict[str, str] = {}
    for raw in values:
        name, separator, value = raw.split(";", 1)[0].partition("=")
        if separator and name:
            cookies[name.strip()] = value
    return "; ".join(f"{name}={value}" for name, value in cookies.items())


def _cnki_headers() -> dict[str, str]:
    return {**CNKI_HEADERS, **({"Cookie": _cnki_cookie} if _cnki_cookie else {})}


def _cnki_search_request(value: str, page_num: int, page_size: int) -> httpx.Response:
    global _cnki_cookie
    with make_client(direct=True, timeout=20) as client:
        if not _cnki_cookie:
            login = client.post(
                CNKI_LOGIN_URL,
                headers={"Content-Type": "application/json"},
                content="{}",
            )
            if login.is_success:
                try:
                    payload = json.loads(login.text.strip().strip("()"))
                except json.JSONDecodeError:
                    payload = {}
                if payload.get("IsSuccess"):
                    _cnki_cookie = _cookie_header(login.headers.get_list("set-cookie"))
            if not _cnki_cookie:
                raise RuntimeError(
                    "CNKI login failed: this network does not appear to have IP-based access"
                )
        data = {
            "QueryJson": json.dumps(
                build_cnki_query_json(value), ensure_ascii=False, separators=(",", ":")
            ),
            "pageNum": str(page_num),
            "pageSize": str(page_size),
            "productStr": "YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,R79MZMCB,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,EMRPGLPA,J708GVCE,ML4DRIDX,NLBO1Z6R,NN3FJMUV,",
            "searchFrom": "资源范围：总库",
            "turnpage": "vLP2bNpghntZLRq9Q5Y7Qg!!",
        }
        return client.post(
            CNKI_SEARCH_URL,
            headers={
                **_cnki_headers(),
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            data=data,
        )


def _cnki_download_request(href: str) -> tuple[httpx.Response, str]:
    global _cnki_cookie
    with make_client(direct=True, timeout=60) as client:
        if not _cnki_cookie:
            _cnki_search_request("", 1, 1)
        abstract = client.get(href, headers=_cnki_headers(), timeout=20)
        abstract.raise_for_status()
        pdf = BeautifulSoup(abstract.text, "html.parser").select_one("#pdfDown")
        pdf_url = urljoin(str(abstract.url), pdf.get("href", "") if pdf else "")
        if not pdf_url:
            raise RuntimeError("No PDF download link found on the CNKI abstract page")
        response = client.get(pdf_url, headers=_cnki_headers())
        return response, response.headers.get("content-disposition", "")


async def _arxiv_get(url: str, timeout: float) -> httpx.Response:
    global _arxiv_last_request
    minimum = max(0, int(os.getenv("ARXIV_MIN_INTERVAL_MS", "3000"))) / 1000
    retries = max(0, int(os.getenv("ARXIV_MAX_RETRIES", "3")))
    backoff = {
        "base_ms": max(0, int(os.getenv("ARXIV_BACKOFF_BASE_MS", "3000"))),
        "max_ms": max(0, int(os.getenv("ARXIV_BACKOFF_MAX_MS", "60000"))),
        "jitter_ms": max(0, int(os.getenv("ARXIV_BACKOFF_JITTER_MS", "500"))),
    }
    async with _arxiv_lock:
        for attempt in range(retries + 1):
            wait = _arxiv_last_request + minimum - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                response = await _get(url, timeout=timeout, headers=ARXIV_HEADERS)
            except httpx.TimeoutException as error:
                if attempt < retries:
                    await asyncio.sleep(
                        compute_backoff_ms(attempt, None, backoff) / 1000
                    )
                    continue
                raise TimeoutError(
                    f"arXiv request timed out after {timeout:g}s contacting {url}"
                ) from error
            _arxiv_last_request = time.monotonic()
            if response.is_success:
                return response
            if (
                response.status_code not in (429, 500, 502, 503, 504)
                or attempt >= retries
            ):
                response.raise_for_status()
            retry_after = parse_retry_after_ms(response.headers.get("retry-after"))
            await asyncio.sleep(
                compute_backoff_ms(attempt, retry_after, backoff) / 1000
            )
    raise RuntimeError("arXiv retry loop exhausted")


def _integer(value: int | str | None, label: str) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {label} format. Please provide a valid integer.")


@mcp.tool()
async def search_arxiv_papers(
    query: str,
    max_results: int = 10,
    date_from: str | None = None,
    date_to: str | None = None,
    categories: list[str] | None = None,
    sort_by: str = "relevance",
) -> str:
    """Search papers on arXiv."""
    options = {
        "max_results": max_results,
        "date_from": date_from,
        "date_to": date_to,
        "categories": categories,
        "sort_by": sort_by,
    }
    params = build_arxiv_search_params(query, options)
    base = (
        os.getenv("ARXIV_ADVANCED_URL", "https://arxiv.org/search/advanced")
        if "advanced" in params
        else os.getenv("ARXIV_SEARCH_URL", "https://arxiv.org/search/")
    )
    response = await _arxiv_get(
        base
        + "?"
        + __import__("urllib.parse", fromlist=["urlencode"]).urlencode(params),
        timeout=float(os.getenv("ARXIV_TIMEOUT_MS", "60000")) / 1000,
    )
    response.raise_for_status()
    papers = parse_arxiv_search_html(response.text)[:max_results]
    return format_arxiv_search_response(papers, query, options)


@mcp.tool()
async def download_arxiv_paper(paper_id: str, save_path: str = "./downloads") -> str:
    """Download the PDF for an arXiv paper."""
    if not paper_id.strip():
        raise ValueError("paper_id is required")
    response = await _arxiv_get(
        f"{os.getenv('ARXIV_PDF_BASE', 'https://arxiv.org/pdf')}/{paper_id.strip()}",
        timeout=120,
    )
    response.raise_for_status()
    if "pdf" not in response.headers.get("content-type", ""):
        raise ValueError(
            f"Expected PDF, got {response.headers.get('content-type', 'unknown')}"
        )
    Path(save_path).mkdir(parents=True, exist_ok=True)
    target = Path(save_path) / ("arxiv_" + paper_id.replace("/", "_") + ".pdf")
    target.write_bytes(response.content)
    return str(target)


@mcp.tool()
async def search_iacr_papers(
    query: str,
    max_results: int = 10,
    fetch_details: bool = True,
    year_min: int | str | None = None,
    year_max: int | str | None = None,
) -> str:
    """Search academic papers from the IACR ePrint Archive."""
    minimum, maximum = _integer(year_min, "year_min"), _integer(year_max, "year_max")
    response = await _get(
        "https://eprint.iacr.org/search?"
        + build_iacr_search_params(query, minimum, maximum)
    )
    if not response.is_success:
        return format_iacr_search_response([], query, minimum, maximum)
    papers = parse_iacr_search_html(response.text)[:max_results]
    if fetch_details:
        detailed = []
        for paper in papers:
            detail_response = await _get(paper["url"], timeout=30)
            detail = (
                parse_iacr_detail_html(detail_response.text, paper["paper_id"])
                if detail_response.is_success
                else None
            )
            detailed.append(detail or paper)
        papers = detailed
    return format_iacr_search_response(papers, query, minimum, maximum)


@mcp.tool()
async def download_iacr_paper(paper_id: str, save_path: str = "./downloads") -> str:
    """Download the PDF for an IACR ePrint paper."""
    pdf_url = f"https://eprint.iacr.org/{paper_id}.pdf"
    target = Path(save_path) / f"iacr_{paper_id.replace('/', '_')}.pdf"
    target.unlink(missing_ok=True)
    download_task = asyncio.create_task(
        asyncio.to_thread(download_iacr_pdf, pdf_url, target)
    )
    _iacr_download_tasks.add(download_task)

    def finish(task):
        _iacr_download_tasks.discard(task)
        if not task.cancelled():
            task.exception()

    download_task.add_done_callback(finish)
    try:
        while not download_task.done():
            if target.is_file() and target.read_bytes()[:4] == b"%PDF":
                return str(target)
            await asyncio.sleep(0.05)
        await download_task
    except Exception as error:
        raise RuntimeError(f"IACR PDF download failed: {error}") from error
    if target.is_file() and target.read_bytes()[:4] == b"%PDF":
        return str(target)
    raise RuntimeError("IACR PDF download failed: no valid PDF was produced")


@mcp.tool()
async def search_dblp_papers(
    query: str,
    max_results: int = 10,
    year_from: int | str | None = None,
    year_to: int | str | None = None,
    venue_filter: str | None = None,
    include_bibtex: bool = False,
) -> str:
    """Search DBLP for publications and optional BibTeX entries."""
    options = {
        "year_from": _integer(year_from, "year_from"),
        "year_to": _integer(year_to, "year_to"),
        "venue_filter": venue_filter,
        "include_bibtex": include_bibtex,
    }
    response = await _get(
        "https://dblp.org/search/publ/api",
        params={"q": query, "format": "json", "h": max_results},
    )
    response.raise_for_status()
    results = filter_dblp_results(parse_dblp_api_response(response.json()), options)[
        :max_results
    ]
    if include_bibtex:
        bib = []
        for result in results:
            entry = await _get(f"https://dblp.org/rec/{result['dblp_key']}.bib")
            bib.append(
                {
                    "dblp_key": result["dblp_key"],
                    "bibtex": entry.text if entry.is_success else "",
                }
            )
        results = [x for x in bib if x["bibtex"].strip()]
    return format_dblp_search_response(results, query, options)


@mcp.tool()
async def search_google_scholar_papers(
    query: str,
    max_results: int = 10,
    year_low: int | str | None = None,
    year_high: int | str | None = None,
) -> str:
    """Search academic papers from Google Scholar."""
    low, high = _integer(year_low, "year_low"), _integer(year_high, "year_high")
    response = await _get(
        "https://scholar.google.com/scholar",
        params={
            "q": query,
            "hl": "en",
            "num": min(max_results, 10),
            **({"as_ylo": low} if low else {}),
            **({"as_yhi": high} if high else {}),
        },
    )
    papers = parse_google_scholar_html(response.text) if response.is_success else []
    return format_google_scholar_search_response(papers[:max_results], query, low, high)


@mcp.tool()
async def search_cnki_papers(query: str, page_num: int = 1, page_size: int = 20) -> str:
    """Search papers from CNKI using direct institutional egress."""
    response = await asyncio.to_thread(
        _cnki_search_request, query, page_num, min(max(page_size, 1), 100)
    )
    response.raise_for_status()
    return format_cnki_search_response(
        parse_cnki_search_html(response.text, "https://kns.cnki.net/"), query
    )


@mcp.tool()
async def download_cnki_paper(href: str, save_path: str = "./downloads") -> str:
    """Download a CNKI paper using direct institutional egress."""
    response, disposition = await asyncio.to_thread(_cnki_download_request, href)
    response.raise_for_status()
    if "pdf" not in response.headers.get("content-type", ""):
        raise ValueError(
            f"Expected PDF, got {response.headers.get('content-type', 'unknown')}"
        )
    Path(save_path).mkdir(parents=True, exist_ok=True)
    target = Path(save_path) / (
        extract_filename_from_content_disposition(disposition)
        or f"cnki_{int(time.time() * 1000)}.pdf"
    )
    target.write_bytes(response.content)
    return str(target)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
