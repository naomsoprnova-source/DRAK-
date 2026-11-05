"""Read-only Binance Spot symbol filters. No credentials or order endpoints."""
from __future__ import annotations

from urllib.parse import urlparse
from typing import Any

from .api import PUBLIC_BASE_URL, _get_json
from .crypto_core import validate_symbol


_ALLOWED_HOSTS = {"data-api.binance.vision", "api.binance.com"}


def fetch_spot_filters(symbol: str, base_url: str = PUBLIC_BASE_URL) -> dict[str, float]:
    """Fetch current LOT_SIZE, PRICE_FILTER and notional rules via public GET only."""
    pair = validate_symbol(symbol)
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_HOSTS or parsed.path not in ("", "/"):
        raise ValueError("base_url must be an approved HTTPS Binance public market-data host")
    payload: Any = _get_json(
        f"{base_url.rstrip('/')}/api/v3/exchangeInfo", {"symbol": pair}
    )
    symbols = payload.get("symbols", []) if isinstance(payload, dict) else []
    if len(symbols) != 1 or str(symbols[0].get("symbol", "")).upper() != pair:
        raise ValueError(f"Binance did not return a unique exchangeInfo record for {pair}")
    item = symbols[0]
    if str(item.get("status", "")).upper() != "TRADING":
        raise ValueError(f"{pair} is not currently in TRADING status")
    if item.get("isSpotTradingAllowed") is False:
        raise ValueError(f"Spot trading is not currently allowed for {pair}")
    by_type = {str(row.get("filterType")): row for row in item.get("filters", [])}
    lot = by_type.get("LOT_SIZE")
    price = by_type.get("PRICE_FILTER")
    notional = by_type.get("NOTIONAL") or by_type.get("MIN_NOTIONAL")
    if not lot or not price or notional is None or notional.get("minNotional") is None:
        raise ValueError(f"Binance filters are incomplete for {pair}; refusing to guess")
    result = {
        "min_qty": float(lot.get("minQty", 0)),
        "step_size": float(lot.get("stepSize", 0)),
        "tick_size": float(price.get("tickSize", 0)),
        "min_notional": float(notional["minNotional"]),
    }
    if any(value < 0 for value in result.values()):
        raise ValueError(f"Binance returned invalid filters for {pair}")
    return result
