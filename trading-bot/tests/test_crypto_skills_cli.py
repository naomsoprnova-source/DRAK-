from drakbot import exchange_filters
from drakbot.skills_cli import dispatch


def test_fetch_spot_filters_uses_public_exchange_info_and_parses_filters(monkeypatch):
    payload = {
        "symbols": [{
            "symbol": "BTCUSDT", "status": "TRADING", "isSpotTradingAllowed": True,
            "filters": [
                {"filterType": "LOT_SIZE", "minQty": "0.00001", "stepSize": "0.00001"},
                {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
                {"filterType": "NOTIONAL", "minNotional": "5"},
            ],
        }]
    }
    calls = []
    monkeypatch.setattr(exchange_filters, "_get_json", lambda url, params: calls.append((url, params)) or payload)
    result = exchange_filters.fetch_spot_filters("BTCUSDT")
    assert result == {"min_qty": 0.00001, "step_size": 0.00001, "tick_size": 0.01, "min_notional": 5.0}
    assert calls[0][0].startswith("https://data-api.binance.vision/api/v3/exchangeInfo")
    assert calls[0][1] == {"symbol": "BTCUSDT"}


def test_fetch_spot_filters_rejects_untrusted_host():
    import pytest
    with pytest.raises(ValueError, match="approved HTTPS"):
        exchange_filters.fetch_spot_filters("BTCUSDT", "https://example.invalid")


def test_skill_cli_dispatches_watchlist_as_read_only_calculation():
    result = dispatch("watchlist", {"rows": [{"symbol": "BTCUSDT", "weight_pct": 60}]})
    assert result == [{"symbol": "BTCUSDT", "weight_pct": 60.0}]


def test_skill_cli_sizes_paper_proposal_without_fetching_exchange_filters():
    result = dispatch("size", {
        "symbol": "BTCUSDT", "entry_price": 100, "stop_price": 99.5,
        "filters": {"min_qty": 0, "step_size": 0, "tick_size": 0, "min_notional": 5},
    })
    assert result["paper_only"] is True
    assert result["execution_performed"] is False
    assert result["status"] in {"PROPOSED", "BLOCK"}


def test_crypto_modules_contain_no_order_submission_routes():
    from pathlib import Path
    root = Path(__file__).parents[1] / "drakbot"
    source = "\n".join(
        p.read_text(encoding="utf-8")
        for p in list(root.glob("crypto_*.py")) + [root / "exchange_filters.py", root / "skills_cli.py"]
    ).lower()
    assert "requests.post" not in source
    assert "requests.put" not in source
    assert "requests.delete" not in source
    assert "/api/v3/order" not in source
    assert "/api/v3/account" not in source
