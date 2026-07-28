from typing import Any, TypedDict


class Paper(TypedDict):
    paper_id: str
    title: str
    authors: list[str]
    abstract: str
    doi: str
    published_date: str | None
    pdf_url: str
    url: str
    source: str
    categories: list[str]
    keywords: list[str]
    citations: int
    references: list[str]
    extra: dict[str, Any]


class ArxivPaper(TypedDict):
    paper_id: str
    title: str
    authors: list[str]
    abstract: str
    categories: list[str]
    primary_category: str
    published_date: str
    updated_date: str
    pdf_url: str
    url: str
    doi: str
    journal_ref: str
    comment: str


class CnkiPaper(TypedDict):
    title: str
    authors: list[str]
    source: str
    source_link: str
    href: str
