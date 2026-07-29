from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
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


def _download_pdf_with_browser(browser, pdf_url: str, target: Path) -> None:
    download_dir = Path(browser.get_browser_downloads_folder())
    before = {
        name: (path.stat().st_mtime_ns, path.stat().st_size)
        for name in browser.get_downloaded_files(browser=True)
        if (path := download_dir / name).is_file()
    }
    browser.open(pdf_url)
    deadline = time.monotonic() + float(os.getenv("IACR_DOWNLOAD_WAIT", "10"))
    while time.monotonic() < deadline:
        for name in browser.get_downloaded_files(browser=True):
            path = download_dir / name
            if not path.is_file() or path.suffix.lower() != ".pdf":
                continue
            state = (path.stat().st_mtime_ns, path.stat().st_size)
            if before.get(name) != state and path.read_bytes()[:4] == b"%PDF":
                partial = target.with_name(target.name + ".part")
                partial.unlink(missing_ok=True)
                try:
                    shutil.copyfile(path, partial)
                    partial.replace(target)
                finally:
                    partial.unlink(missing_ok=True)
                return
        browser.sleep(1)
    raise TimeoutError("Browser did not download the IACR PDF")


def _pass_cloudflare_challenge(browser, pdf_url: str) -> None:
    indicators = (
        "turnstile",
        "challenges.cloudflare",
        "just a moment",
        "verify you are human",
        "checking your browser",
        "cf-browser-verification",
        "cf-challenge",
    )
    reconnect_time = float(os.getenv("IACR_RECONNECT_TIME", "5"))
    timeout = time.monotonic() + float(os.getenv("IACR_CHALLENGE_WAIT", "60"))
    browser.uc_open_with_reconnect(pdf_url, reconnect_time=reconnect_time)
    while time.monotonic() < timeout:
        cookies = {
            cookie.get("name"): cookie.get("value") for cookie in browser.get_cookies()
        }
        if cookies.get("cf_clearance"):
            return
        page_source = browser.get_page_source().lower()
        if not any(indicator in page_source for indicator in indicators):
            return
        try:
            browser.uc_gui_handle_captcha()
        except Exception:
            browser.uc_gui_click_captcha()
        browser.sleep(3)
    raise TimeoutError("Cloudflare challenge did not complete")


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
    attempts = int(os.getenv("IACR_CAPTCHA_ATTEMPTS", "2"))

    for attempt in range(attempts):
        target.unlink(missing_ok=True)
        with browser_factory(**browser_options) as browser:
            _pass_cloudflare_challenge(browser, pdf_url)
            _download_pdf_with_browser(browser, pdf_url, target)
            if target.is_file() and target.read_bytes()[:4] == b"%PDF":
                return

    if not target.is_file() or target.read_bytes()[:4] != b"%PDF":
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
        raise RuntimeError(result.stderr.strip() or "SeleniumBase worker failed")
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
