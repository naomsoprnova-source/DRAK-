"""Read-only CLI wrapper for DRAK's eleven paper-only crypto workflows."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

from .crypto_skills import (
    CryptoRiskConfig, SymbolFilters, analyze_candles, build_manual_ticket,
    evaluate_price_alerts, fifo_ledger, match_market_events, match_market_news,
    rebalance_analysis, risk_gate, screen_spot_markets, size_crypto_proposals,
    size_spot_position, validate_watchlist,
)
from .exchange_filters import fetch_spot_filters
from .models import Candle

ACTIONS = (
    "watchlist", "news", "size", "proposals", "events", "analyze",
    "screener", "risk", "ticket", "ledger", "alerts", "rebalance",
)


def dispatch(action: str, payload: dict[str, Any]) -> Any:
    """Dispatch one pure calculation. Input JSON is read only; nothing is written."""
    if action == "watchlist":
        return validate_watchlist(payload["rows"])
    if action == "news":
        return match_market_news(payload["items"], payload["symbols"])
    if action == "size":
        config = CryptoRiskConfig(**payload.get("config", {}))
        filter_data = payload.get("filters", {})
        if payload.get("fetch_current_filters") is True:
            filter_data = fetch_spot_filters(
                payload["symbol"], payload.get("api_base_url", "https://data-api.binance.vision")
            )
        filters = SymbolFilters(**filter_data)
        return size_spot_position(
            payload["symbol"], payload["entry_price"], payload["stop_price"],
            config, filters, payload.get("reward_risk"),
        )
    if action == "proposals":
        config = CryptoRiskConfig(**payload.get("config", {}))
        filters = {
            symbol: SymbolFilters(**values)
            for symbol, values in payload.get("filters_by_symbol", {}).items()
        }
        return size_crypto_proposals(payload["signals"], config, filters)
    if action == "events":
        return match_market_events(payload["events"], payload["symbols"])
    if action == "analyze":
        candles = [Candle(**row) for row in payload["candles"]]
        return analyze_candles(candles)
    if action == "screener":
        return screen_spot_markets(
            payload["markets"], payload.get("min_quote_volume_usdt", 500_000),
            payload.get("max_spread_bps", 40),
        )
    if action == "risk":
        config = CryptoRiskConfig(**payload.get("config", {}))
        return risk_gate(
            payload["plan"], config,
            current_position_usdt=payload.get("current_position_usdt", 0),
            open_positions=payload.get("open_positions", 0),
            daily_loss_usdt=payload.get("daily_loss_usdt", 0),
            orders_today=payload.get("orders_today", 0),
        )
    if action == "ticket":
        return build_manual_ticket(payload["plan"], payload["verdict"])
    if action == "ledger":
        return fifo_ledger(payload["fills"])
    if action == "alerts":
        return evaluate_price_alerts(
            payload["alerts"], payload["prices"], payload.get("already_triggered", [])
        )
    if action == "rebalance":
        return rebalance_analysis(
            payload["current_values"], payload["targets"], payload.get("cash_usdt", 0)
        )
    raise ValueError(f"unknown action: {action}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DRAK crypto skills: public market data, paper-only calculations, no order execution"
    )
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("--input", required=True, help="JSON input file; it is read only")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("input JSON root must be an object")
        result = dispatch(args.action, payload)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        if isinstance(result, dict) and (result.get("status") == "BLOCK" or result.get("verdict") == "BLOCK"):
            return 1
        return 0
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        print(f"DRAK skills error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
