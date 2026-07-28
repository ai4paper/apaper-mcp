from typing import Any


def parse_dblp_api_response(payload: Any) -> list[dict]:
    hits = (
        payload.get("result", {}).get("hits", {}).get("hit", [])
        if isinstance(payload, dict)
        else []
    )
    if not isinstance(hits, list):
        hits = [hits] if hits else []
    result = []
    for publication in hits:
        info = publication.get("info", {})
        authors = info.get("authors", {}).get("author", [])
        if not isinstance(authors, list):
            authors = [authors] if authors else []
        authors = [a if isinstance(a, str) else a.get("text", "") for a in authors]
        url = info.get("url", "")
        result.append(
            {
                "title": info.get("title", ""),
                "authors": [a for a in authors if a],
                "venue": info.get("venue", ""),
                "year": int(info["year"])
                if str(info.get("year", "")).isdigit()
                else None,
                "type": info.get("type", ""),
                "doi": info.get("doi", ""),
                "ee": info.get("ee", ""),
                "url": url,
                "dblp_key": url.replace("https://dblp.org/rec/", "")
                or publication.get("key", "").removeprefix("dblp:"),
            }
        )
    return result


def filter_dblp_results(results: list[dict], options: dict[str, Any]) -> list[dict]:
    return [
        r
        for r in results
        if not (
            options.get("year_from") is not None
            and r.get("year") is not None
            and r["year"] < options["year_from"]
        )
        and not (
            options.get("year_to") is not None
            and r.get("year") is not None
            and r["year"] > options["year_to"]
        )
        and not (
            options.get("venue_filter")
            and options["venue_filter"].lower() not in r.get("venue", "").lower()
        )
    ]
