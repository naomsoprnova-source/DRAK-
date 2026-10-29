"""Deterministic long-only signals; there is no order-execution code here."""
from collections import defaultdict
from typing import Optional

from .config import StrategyConfig
from .indicators import atr, ema, macd, rsi, sma
from .models import Candle

BAR_MS = 15 * 60 * 1000
HOUR_MS = 60 * 60 * 1000


def aggregate_complete_hours(candles: list[Candle]) -> list[Candle]:
    """Aggregate only complete, contiguous UTC hours from 15-minute candles."""
    groups: dict[int, list[Candle]] = defaultdict(list)
    for candle in candles:
        groups[(candle.open_time_ms // HOUR_MS) * HOUR_MS].append(candle)
    hourly: list[Candle] = []
    for hour_start in sorted(groups):
        group = sorted(groups[hour_start], key=lambda candle: candle.open_time_ms)
        expected_times = [hour_start + offset * BAR_MS for offset in range(4)]
        if [c.open_time_ms for c in group] != expected_times:
            continue
        if any(c.close_time_ms != c.open_time_ms + BAR_MS - 1 for c in group):
            continue
        hourly.append(Candle(
            open_time_ms=hour_start,
            open=group[0].open,
            high=max(c.high for c in group),
            low=min(c.low for c in group),
            close=group[-1].close,
            volume=sum(c.volume for c in group),
            close_time_ms=group[-1].close_time_ms,
        ))
    return hourly


def entry_signals(candles: list[Candle], config: StrategyConfig) -> tuple[list[bool], list[Optional[float]]]:
    """Create close-of-bar signals, to be filled no earlier than next bar open.

    Entry: 15m EMA(9) crosses above EMA(21), RSI(14) is 50..70, MACD
    histogram is positive, volume is at/above its 20-bar SMA, and the latest
    fully closed 1h candle has close > EMA(50) and EMA(20) > EMA(50).
    """
    config.validate()
    closes = [c.close for c in candles]
    volumes = [c.volume for c in candles]
    fast = ema(closes, config.ema_fast)
    slow = ema(closes, config.ema_slow)
    rsi_values = rsi(closes, config.rsi_period)
    _, _, macd_hist = macd(closes, config.macd_fast, config.macd_slow, config.macd_signal)
    volume_sma = sma(volumes, config.volume_period)
    atr_values = atr(candles, config.atr_period)

    hourly = aggregate_complete_hours(candles)
    hourly_closes = [c.close for c in hourly]
    hourly_fast = ema(hourly_closes, config.htf_ema_fast)
    hourly_slow = ema(hourly_closes, config.htf_ema_slow)
    hourly_close_times = [c.close_time_ms for c in hourly]

    signals = [False] * len(candles)
    hour_index = -1
    for i, candle in enumerate(candles):
        while hour_index + 1 < len(hourly) and hourly_close_times[hour_index + 1] <= candle.close_time_ms:
            hour_index += 1
        if i == 0 or hour_index < 0:
            continue
        values = (fast[i - 1], fast[i], slow[i - 1], slow[i], rsi_values[i], macd_hist[i], volume_sma[i], atr_values[i])
        if any(value is None for value in values):
            continue
        h_fast, h_slow = hourly_fast[hour_index], hourly_slow[hour_index]
        if h_fast is None or h_slow is None:
            continue
        cross_up = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]  # type: ignore[operator]
        trend_up = hourly[hour_index].close > h_slow and h_fast > h_slow
        momentum_ok = config.rsi_min <= rsi_values[i] <= config.rsi_max and macd_hist[i] > 0  # type: ignore[operator]
        volume_ok = candle.volume >= volume_sma[i]  # type: ignore[operator]
        signals[i] = bool(cross_up and trend_up and momentum_ok and volume_ok and candle.close > slow[i])  # type: ignore[operator]
    return signals, atr_values
