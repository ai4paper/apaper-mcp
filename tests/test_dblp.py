from apaper_mcp.platforms.dblp import filter_dblp_results, parse_dblp_api_response


def test_dblp_parser_and_filters() -> None:
    payload = {
        "result": {
            "hits": {
                "hit": {
                    "info": {
                        "title": "T",
                        "authors": {"author": [{"text": "A"}]},
                        "year": "2024",
                        "venue": "ICLR",
                        "url": "https://dblp.org/rec/x",
                    }
                }
            }
        }
    }
    results = parse_dblp_api_response(payload)
    assert (
        filter_dblp_results(results, {"year_from": 2023, "venue_filter": "iclr"})[0][
            "dblp_key"
        ]
        == "x"
    )
