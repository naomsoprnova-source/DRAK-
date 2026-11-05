import pytest

from drakbot.crypto_skills import (
    CryptoRiskConfig, SymbolFilters, analyze_candles, build_manual_ticket,
    evaluate_price_alerts, fifo_ledger, match_market_events, match_market_news,
    rebalance_analysis, risk_gate, screen_spot_markets, size_crypto_proposals,
    size_spot_position, validate_symbol, validate_watchlist,
)
from drakbot.models import Candle


def test_live_mode_is_rejected():
    with pytest.raises(ValueError, match="paper-only"):
        CryptoRiskConfig(paper_only=False).validate()


def test_only_usdt_spot_pairs_are_accepted_and_leveraged_tokens_rejected():
    assert validate_symbol("btcusdt") == "BTCUSDT"
    with pytest.raises(ValueError):
        validate_symbol("BTCUSDC")
    with pytest.raises(ValueError):
        validate_symbol("BTCUPUSDT")


def test_watchlist_rejects_duplicates_and_excess_weight():
    assert len(validate_watchlist([{"symbol": "BTCUSDT", "weight_pct": 40}])) == 1
    with pytest.raises(ValueError, match="duplicate"):
        validate_watchlist([
            {"symbol": "BTCUSDT", "weight_pct": 20},
            {"symbol": "BTCUSDT", "weight_pct": 20},
        ])
    with pytest.raises(ValueError, match="total"):
        validate_watchlist([
            {"symbol": "BTCUSDT", "weight_pct": 60},
            {"symbol": "ETHUSDT", "weight_pct": 60},
        ])


def test_11_usdt_sizing_is_fee_aware_and_paper_only():
    config = CryptoRiskConfig()
    plan = size_spot_position(
        "BTCUSDT", 100.0, 99.5, config,
        SymbolFilters(min_qty=0.00001, step_size=0.00001, tick_size=0.01, min_notional=5.0),
    )
    assert plan["paper_only"] is True
    assert plan["execution_performed"] is False
    assert plan["notional_usdt"] <= 7.7
    assert plan["estimated_risk_usdt"] <= 0.11 + 1e-9
    assert plan["stop_price"] < plan["entry_price"] < plan["target_price"]


def test_high_stop_distance_can_be_blocked_by_minimum_order():
    plan = size_spot_position("BTCUSDT", 100.0, 97.0)
    assert plan["status"] == "BLOCK"
    assert any("minimum Spot notional" in reason for reason in plan["reasons"])


def test_risk_gate_and_manual_ticket_are_bound_to_exact_proposal():
    plan = size_spot_position("BTCUSDT", 100.0, 99.5)
    verdict = risk_gate(plan)
    assert verdict["verdict"] == "PASS"
    ticket = build_manual_ticket(plan, verdict)
    assert ticket["execution_performed"] is False
    plan["quantity"] = plan["quantity"] + 0.00001
    with pytest.raises(ValueError, match="does not match"):
        build_manual_ticket(plan, verdict)


def test_risk_gate_blocks_daily_loss_and_open_position_limits():
    plan = size_spot_position("BTCUSDT", 100.0, 99.5)
    verdict = risk_gate(plan, daily_loss_usdt=0.34)
    assert verdict["verdict"] == "BLOCK"
    assert any("daily loss" in reason for reason in verdict["reasons"])
    verdict = risk_gate(plan, open_positions=1)
    assert verdict["verdict"] == "BLOCK"


def test_news_and_exchange_events_require_source_and_watchlist_match():
    watch = ["BTCUSDT"]
    news = match_market_news([
        {"title": "BTC update", "source": "source-a", "symbols": watch, "verified": False},
        {"title": "ETH update", "source": "source-a", "symbols": ["ETHUSDT"]},
        {"title": "missing source", "symbols": watch},
    ], watch)
    assert len(news) == 1
    assert news[0]["verified"] is False
    events = match_market_events([
        {"title": "BTC listing notice", "source": "exchange", "event_type": "listing",
         "symbols": watch, "event_time": "2026-11-05T00:00:00Z"},
        {"title": "noise", "source": "exchange", "event_type": "rumor", "symbols": watch},
    ], watch)
    assert len(events) == 1
    assert events[0]["event_type"] == "listing"


def test_screen_excludes_bad_spread_and_ineligible_pairs():
    rows = [
        {"symbol": "BTCUSDT", "status": "TRADING", "spot_allowed": True, "quote_volume_usdt": 1_000_000,
         "bid_price": 99.9, "ask_price": 100.1, "last_price": 100, "change_24h_pct": 1},
        {"symbol": "ETHUSDT", "status": "TRADING", "spot_allowed": True, "quote_volume_usdt": 1_000_000,
         "bid_price": 99, "ask_price": 101, "last_price": 100, "change_24h_pct": 2},
        {"symbol": "BTCUPUSDT", "status": "TRADING", "spot_allowed": True, "quote_volume_usdt": 1_000_000,
         "bid_price": 99.9, "ask_price": 100.1, "last_price": 100, "change_24h_pct": 1},
    ]
    assert [r["symbol"] for r in screen_spot_markets(rows, 100_000, 40)] == ["BTCUSDT"]


def test_technical_snapshot_uses_closed_candle_data():
    candles = []
    for i in range(80):
        price = 100 + i * 0.1
        start = i * 15 * 60 * 1000
        candles.append(Candle(start, price, price + 0.2, price - 0.2, price + 0.1, 100, start + 899999))
    snapshot = analyze_candles(candles)
    assert snapshot["bias"] == "bullish"
    assert snapshot["candle_close_time_ms"] == candles[-1].close_time_ms
    assert "recommendation" in snapshot["note"]


def test_fifo_ledger_realizes_after_fees_and_prevents_short():
    result = fifo_ledger([
        {"symbol": "BTCUSDT", "side": "BUY", "quantity": 1, "price": 100, "fee_quote": 0.1},
        {"symbol": "BTCUSDT", "side": "SELL", "quantity": 0.5, "price": 110, "fee_quote": 0.1},
    ])
    assert result["realized_pnl_quote"] == pytest.approx(4.85)
    assert result["open_lots"]["BTCUSDT"][0]["quantity"] == pytest.approx(0.5)
    with pytest.raises(ValueError, match="short position"):
        fifo_ledger([{"symbol": "BTCUSDT", "side": "SELL", "quantity": 1, "price": 100}])


def test_price_alerts_notify_once_and_never_execute():
    alerts = [{"id": "a1", "symbol": "BTCUSDT", "operator": "above", "price": 100}]
    fired = evaluate_price_alerts(alerts, {"BTCUSDT": 101})
    assert fired[0]["action"] == "NOTIFY_ONLY"
    assert fired[0]["execution_performed"] is False
    assert evaluate_price_alerts(alerts, {"BTCUSDT": 101}, already_triggered=["a1"]) == []


def test_rebalance_is_analysis_only():
    result = rebalance_analysis(
        {"BTCUSDT": 4.0}, [{"symbol": "BTCUSDT", "weight_pct": 50}], cash_usdt=4.0
    )
    assert result["positions"][0]["target_value_usdt"] == pytest.approx(4.0)
    assert result["positions"][0]["action"] == "HOLD"
    assert result["execution_performed"] is False


def test_proposal_sizing_caps_number_of_open_positions():
    config = CryptoRiskConfig(max_open_positions=1)
    signals = [
        {"symbol": "BTCUSDT", "action": "BUY", "entry_price": 100, "stop_price": 99.5},
        {"symbol": "ETHUSDT", "action": "BUY", "entry_price": 100, "stop_price": 99.5},
    ]
    results = size_crypto_proposals(signals, config)
    assert len(results) == 2
    assert results[1]["status"] == "BLOCK"
    assert results[1]["execution_performed"] is False
