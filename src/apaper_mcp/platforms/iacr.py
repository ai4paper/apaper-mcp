from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode, urlsplit

import mycdp
from bs4 import BeautifulSoup

from ..proxy import selenium_proxy_from_env

_CHALLENGE_INDICATORS = (
    "turnstile",
    "challenges.cloudflare",
    "just a moment",
    "verify you are human",
    "checking your browser",
    "cf-browser-verification",
    "cf-challenge",
)


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


def _cdp_page_source(browser) -> str:
    try:
        return browser.cdp.get_page_source().lower()
    except Exception:
        return ""


def _download_pdf_with_browser(browser, pdf_url: str, target: Path) -> None:
    selector = f'a[href$="{urlsplit(pdf_url).path}"]'
    challenge_wait = float(os.getenv("IACR_CHALLENGE_WAIT", "90"))
    detail_deadline = time.monotonic() + challenge_wait
    next_solve = 0.0
    while not browser.cdp.is_element_present(selector):
        now = time.monotonic()
        if now >= detail_deadline:
            raise TimeoutError("Cloudflare challenge did not complete")
        page_source = _cdp_page_source(browser)
        if any(x in page_source for x in _CHALLENGE_INDICATORS) and now >= next_solve:
            browser.cdp.solve_captcha()
            next_solve = now + 8
        browser.cdp.sleep(0.25)

    state = {
        "guid": None,
        "filename": None,
        "status": None,
        "received": 0,
        "total": 0,
        "last_progress": time.monotonic(),
    }

    def download_started(event) -> None:
        if event.url.split("?", 1)[0] == pdf_url and state["guid"] is None:
            state.update(
                guid=event.guid,
                filename=Path(event.suggested_filename).name,
                status="inProgress",
                received=0,
                total=0,
                last_progress=time.monotonic(),
            )

    def download_progress(event) -> None:
        if event.guid != state["guid"]:
            return
        if int(event.received_bytes) != state["received"]:
            state["last_progress"] = time.monotonic()
        state.update(
            status=event.state,
            received=int(event.received_bytes),
            total=int(event.total_bytes),
        )

    with tempfile.TemporaryDirectory(prefix="iacr-download-") as download_folder:
        download_dir = Path(download_folder)
        connection = browser.cdp.browser.connection
        connection.add_handler(mycdp.browser.DownloadWillBegin, download_started)
        connection.add_handler(mycdp.browser.DownloadProgress, download_progress)
        browser.get_event_loop().run_until_complete(
            connection.send(
                mycdp.browser.set_download_behavior(
                    "allow",
                    download_path=str(download_dir),
                    events_enabled=True,
                )
            )
        )
        browser.cdp.click(selector)

        challenge_deadline = time.monotonic() + challenge_wait
        configured_wait = os.getenv("IACR_DOWNLOAD_WAIT")
        hard_wait = (
            float(configured_wait)
            if configured_wait is not None
            else float(os.getenv("IACR_DOWNLOAD_TIMEOUT_MS", "600000")) / 1000
        )
        hard_deadline = time.monotonic() + hard_wait
        idle_wait = float(os.getenv("IACR_DOWNLOAD_IDLE_WAIT", "90"))
        solve_at = time.monotonic() + float(
            os.getenv("IACR_CHALLENGE_SOLVE_DELAY", "20")
        )
        solved_challenge = False

        while time.monotonic() < hard_deadline:
            now = time.monotonic()
            if state["status"] == "completed":
                break
            if state["status"] == "canceled":
                raise RuntimeError("Chrome canceled the IACR download")
            if state["guid"]:
                if now - state["last_progress"] > idle_wait:
                    source = download_dir / str(state["filename"])
                    disk_size = source.stat().st_size if source.is_file() else 0
                    raise TimeoutError(
                        "IACR download stopped making progress "
                        f"({state['received']}/{state['total']} event bytes, "
                        f"{disk_size} bytes on disk)"
                    )
            else:
                if now >= challenge_deadline:
                    raise TimeoutError("Cloudflare challenge did not complete")
                page_source = _cdp_page_source(browser)
                if (
                    any(x in page_source for x in _CHALLENGE_INDICATORS)
                    and not solved_challenge
                    and now >= solve_at
                ):
                    browser.cdp.solve_captcha()
                    solved_challenge = True
            browser.cdp.sleep(0.25)
        else:
            raise TimeoutError("IACR download exceeded its timeout")

        source = download_dir / str(state["filename"])
        if (
            not source.is_file()
            or source.read_bytes()[:4] != b"%PDF"
            or (state["total"] and source.stat().st_size != state["total"])
        ):
            raise ValueError("Chrome did not produce a complete PDF")

        partial = target.with_name(target.name + ".part")
        partial.unlink(missing_ok=True)
        try:
            shutil.copyfile(source, partial)
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)


def _download_iacr_pdf_in_process(pdf_url: str, target: Path, browser_factory) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    browser_options = {
        "uc": True,
        "locale": "en",
        "external_pdf": True,
    }
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        browser_options["xvfb"] = True
        browser_options["chromium_arg"] = "ozone-platform=x11"
    else:
        browser_options["headed"] = True
    attempts = max(1, int(os.getenv("IACR_CAPTCHA_ATTEMPTS", "3")))
    last_error = None

    with selenium_proxy_from_env() as proxy:
        if proxy:
            browser_options["proxy"] = proxy
        for attempt in range(attempts):
            target.unlink(missing_ok=True)
            try:
                with browser_factory(**browser_options) as browser:
                    browser.activate_cdp_mode(pdf_url.removesuffix(".pdf"))
                    _download_pdf_with_browser(browser, pdf_url, target)
                    if target.is_file() and target.read_bytes()[:4] == b"%PDF":
                        return
                    last_error = ValueError("Chrome did not produce a valid PDF")
            except Exception as error:
                last_error = error

    if last_error is not None:
        raise last_error
    raise ValueError("SeleniumBase did not download a valid PDF")


def download_iacr_pdf(pdf_url: str, target: Path, browser_factory=None) -> None:
    """Use SeleniumBase UC mode to pass IACR's challenge and save a PDF."""
    if browser_factory is not None:
        _download_iacr_pdf_in_process(pdf_url, target, browser_factory)
        return

    target = target.resolve()
    with tempfile.TemporaryDirectory(prefix="apaper-iacr-") as work_dir:
        result = subprocess.run(
            [sys.executable, "-m", "apaper_mcp.platforms.iacr", pdf_url, str(target)],
            cwd=work_dir,
            capture_output=True,
            text=True,
        )
    if result.returncode:
        errors = [line.strip() for line in result.stderr.splitlines() if line.strip()]
        raise RuntimeError(errors[-1] if errors else "SeleniumBase worker failed")
    if not target.is_file() or target.read_bytes()[:4] != b"%PDF":
        raise ValueError("SeleniumBase did not download a valid PDF")


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


if __name__ == "__main__":
    from seleniumbase import SB

    _download_iacr_pdf_in_process(sys.argv[1], Path(sys.argv[2]), SB)
