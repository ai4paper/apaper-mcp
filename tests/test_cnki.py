from apaper_mcp.platforms.cnki import (
    build_cnki_query_json,
    extract_filename_from_content_disposition,
    parse_cnki_search_html,
)


def test_cnki_query_and_parser() -> None:
    query = build_cnki_query_json("zero knowledge")
    assert query["Resource"] == "CROSSDB"
    assert query["QNode"]["QGroup"][0]["Items"][0]["Value"] == "zero knowledge"
    cnki = parse_cnki_search_html(
        '<table class="result-table-list"><tr><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=x">Title</a></td><td class="author"><a class="KnowledgeNetLink">张三</a></td><td class="source"><span>Journal</span></td></tr></table>'
    )
    assert cnki[0]["source"] == "Journal"
    assert (
        extract_filename_from_content_disposition(
            "attachment; filename*=utf-8''%E6%B5%8B%E8%AF%95.pdf"
        )
        == "测试.pdf"
    )
