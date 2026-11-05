"""Technical snapshots, market-event matching and Spot market screening."""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

from .crypto_core import number, validate_symbol, STABLE_BASES, LEVERAGED_SUFFIXES
from .indicators import atr, ema, macd, rsi, sma
from .models import Candle


def match_market_events(events: Sequence[Mapping[str, Any]], symbols: Iterable[str]) -> list[dict[str, Any]]:
    watch = {validate_symbol(s) for s in symbols}
    allowed = {"listing", "delisting", "token_unlock", "network_maintenance", "exchange_maintenance", "airdrop"}
    result = []
    for event in events:
        title = str(event.get("title") or "").strip()
        source = str(event.get("source") or "").strip()
        kind = str(event.get("event_type") or "").strip().lower()
        affected = sorted({validate_symbol(s) for s in (event.get("symbols") or [])} & watch)
        if title and source and kind in allowed and affected:
            result.append({
                "title": title[:300], "source": source[:120], "event_type": kind,
                "symbols": affected, "event_time": str(event.get("event_time") or ""),
                "verified": event.get("verified") is True,
            })
    return sorted(result, key=lambda row: row["event_time"])


def analyze_candles(candles: Sequence[Candle]) -> dict[str, Any]:
    if len(candles) < 60:
        raise ValueError("at least 60 closed candles are required")
    if any(a.open_time_ms >= b.open_time_ms for a, b in zip(candles, candles[1:])):
        raise ValueError("candles must be ordered with unique open times")
    closes = [c.close for c in candles]
    volumes = [c.volume for c in candles]
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    rsi14 = rsi(closes, 14)
    _, _, hist = macd(closes)
    atr14 = atr(candles, 14)
    vol_sma20 = sma(volumes, 20)
    i = len(candles) - 1
    required = (e9[i], e21[i], e50[i], rsi14[i], hist[i], atr14[i], vol_sma20[i])
    if any(value is None for value in required):
        raise ValueError("indicator warm-up is incomplete")
    bias = "bullish" if e9[i] > e21[i] > e50[i] else "bearish" if e9[i] < e21[i] < e50[i] else "mixed"
    return {
        "close": closes[i], "ema_9": e9[i], "ema_21": e21[i], "ema_50": e50[i],
        "rsi_14": rsi14[i], "macd_histogram": hist[i], "atr_14": atr14[i],
        "atr_pct": atr14[i] / closes[i] * 100,
        "volume_vs_sma20": volumes[i] / vol_sma20[i] if vol_sma20[i] else None,
        "bias": bias, "candle_close_time_ms": candles[i].close_time_ms,
        "note": "technical measurements only; not a buy/sell recommendation",
    }


def screen_spot_markets(
    rows: Sequence[Mapping[str, Any]],
    min_quote_volume_usdt: float = 500_000.0,
    max_spread_bps: float = 40.0,
) -> list[dict[str, Any]]:
    min_volume = number(min_quote_volume_usdt, "min_quote_volume_usdt")
    max_spread = number(max_spread_bps, "max_spread_bps")
    if min_volume < 0 or max_spread <= 0:
        raise ValueError("screen thresholds must be non-negative; spread limit must be positive")
    results = []
    for row in rows:
        try:
            symbol = validate_symbol(row.get("symbol"))
            base = symbol[:-4]
            if base in STABLE_BASES or base.endswith(LEVERAGED_SUFFIXES):
                continue
            if str(row.get("status", "TRADING")).upper() != "TRADING" or row.get("spot_allowed", True) is not True:
                continue
            volume = number(row.get("quote_volume_usdt"), "quote_volume_usdt")
            bid = number(row.get("bid_price"), "bid_price")
            ask = number(row.get("ask_price"), "ask_price")
            last = number(row.get("last_price"), "last_price")
            change = number(row.get("change_24h_pct", 0), "change_24h_pct")
            if min(bid, ask, last) <= 0 or ask < bid or volume < min_volume:
                continue
            mid = (bid + ask) / 2
            spread_bps = (ask - bid) / mid * 10_000
            if spread_bps > max_spread:
                continue
            results.append({
                "symbol": symbol, "last_price": last, "quote_volume_24h_usdt": volume,
                "change_24h_pct": change, "spread_bps": spread_bps,
                "liquidity_score": min(volume / max(min_volume, 1), 100) / (1 + spread_bps),
            })
        except (ValueError, TypeError):
            continue
    return sorted(results, key=lambda row: (-row["liquidity_score"], row["symbol"]))
