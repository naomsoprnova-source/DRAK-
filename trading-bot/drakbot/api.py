"""Read-only client for Binance public Spot market data (no API keys)."""
import csv
import time
from pathlib import Path
from typing import Any

import requests

from .models import Candle

PUBLIC_BASE_URL = "https://data-api.binance.vision"
INTERVAL_MS = {"15m": 15 * 60 * 1000, "1h": 60 * 60 * 1000}
KLINE_LIMIT = 1000


class MarketDataError(RuntimeError):
    pass


def _get_json(url: str, params: dict[str, Any], timeout: float = 15.0) -> Any:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if response.status_code in (418, 429):
                delay = min(float(response.headers.get("Retry-After", 2 ** attempt)), 30.0)
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.5 * (2 ** attempt))
    raise MarketDataError(f"تعذر جلب بيانات Binance العامة: {last_error or 'rate limit'}")


def fetch_spot_klines(
    symbol: str,
    start_ms: int,
    end_ms: int,
    interval: str = "15m",
    base_url: str = PUBLIC_BASE_URL,
) -> list[Candle]:
    if interval not in INTERVAL_MS:
        raise ValueError(f"Unsupported interval: {interval}")
    if start_ms >= end_ms:
        raise ValueError("start_ms must be earlier than end_ms")
    url = f"{base_url.rstrip('/')}/api/v3/klines"
    step = INTERVAL_MS[interval]
    cursor = start_ms
    candles: list[Candle] = []
    while cursor < end_ms:
        payload = _get_json(url, {"symbol": symbol.upper(), "interval": interval,
                                  "startTime": cursor, "endTime": end_ms, "limit": KLINE_LIMIT})
        if not isinstance(payload, list):
            raise MarketDataError(f"Unexpected klines response: {payload}")
        if not payload:
            break
        for row in payload:
            if not isinstance(row, list) or len(row) < 7:
                raise MarketDataError("Malformed kline row returned by Binance")
            candle = Candle(
                open_time_ms=int(row[0]), open=float(row[1]), high=float(row[2]),
                low=float(row[3]), close=float(row[4]), volume=float(row[5]),
                close_time_ms=int(row[6]),
            )
            if start_ms <= candle.open_time_ms and candle.close_time_ms <= end_ms:
                candles.append(candle)
        last_open_ms = int(payload[-1][0])
        next_cursor = last_open_ms + step
        if next_cursor <= cursor:
            raise MarketDataError("Binance pagination did not advance")
        cursor = next_cursor
        if len(payload) < KLINE_LIMIT:
            break
        time.sleep(0.05)
    deduplicated = {c.open_time_ms: c for c in candles}
    result = [deduplicated[t] for t in sorted(deduplicated)]
    if not result:
        raise MarketDataError(f"No complete {interval} candles returned for {symbol}")
    return result


def fetch_min_notional(symbol: str, base_url: str = PUBLIC_BASE_URL) -> float:
    payload = _get_json(f"{base_url.rstrip('/')}/api/v3/exchangeInfo", {"symbol": symbol.upper()})
    symbols = payload.get("symbols", []) if isinstance(payload, dict) else []
    if not symbols:
        raise MarketDataError(f"No exchangeInfo symbol filters returned for {symbol}")
    filters = {item.get("filterType"): item for item in symbols[0].get("filters", [])}
    for filter_name in ("NOTIONAL", "MIN_NOTIONAL"):
        item = filters.get(filter_name)
        if item and item.get("minNotional") is not None:
            return float(item["minNotional"])
    raise MarketDataError(f"No NOTIONAL/MIN_NOTIONAL filter found for {symbol}")


def write_candles_csv(candles: list[Candle], path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(("open_time_ms", "open", "high", "low", "close", "volume", "close_time_ms"))
        for c in candles:
            writer.writerow((c.open_time_ms, f"{c.open:.12g}", f"{c.high:.12g}", f"{c.low:.12g}",
                             f"{c.close:.12g}", f"{c.volume:.12g}", c.close_time_ms))


def read_candles_csv(path: str | Path) -> list[Candle]:
    candles: list[Candle] = []
    with Path(path).open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        required = {"open_time_ms", "open", "high", "low", "close", "volume", "close_time_ms"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"CSV must contain columns: {', '.join(sorted(required))}")
        for row in reader:
            candles.append(Candle(
                open_time_ms=int(row["open_time_ms"]), open=float(row["open"]), high=float(row["high"]),
                low=float(row["low"]), close=float(row["close"]), volume=float(row["volume"]),
                close_time_ms=int(row["close_time_ms"]),
            ))
    candles.sort(key=lambda c: c.open_time_ms)
    if any(a.open_time_ms == b.open_time_ms for a, b in zip(candles, candles[1:])):
        raise ValueError("CSV contains duplicate candle open times")
    return candles
