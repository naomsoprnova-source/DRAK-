"""Indicator implementations with explicit warm-up values (None)."""
from collections.abc import Sequence
from typing import Optional

from .models import Candle

NumberSeries = list[Optional[float]]


def ema(values: Sequence[float], period: int) -> NumberSeries:
    if period < 1:
        raise ValueError("period must be positive")
    result: NumberSeries = [None] * len(values)
    if len(values) < period:
        return result
    seed = sum(values[:period]) / period
    result[period - 1] = seed
    alpha = 2.0 / (period + 1.0)
    previous = seed
    for i in range(period, len(values)):
        previous = alpha * values[i] + (1.0 - alpha) * previous
        result[i] = previous
    return result


def sma(values: Sequence[float], period: int) -> NumberSeries:
    if period < 1:
        raise ValueError("period must be positive")
    result: NumberSeries = [None] * len(values)
    running = 0.0
    for i, value in enumerate(values):
        running += value
        if i >= period:
            running -= values[i - period]
        if i >= period - 1:
            result[i] = running / period
    return result


def rsi(closes: Sequence[float], period: int = 14) -> NumberSeries:
    if period < 1:
        raise ValueError("period must be positive")
    result: NumberSeries = [None] * len(closes)
    if len(closes) <= period:
        return result
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    def value(gain: float, loss: float) -> float:
        if loss == 0:
            return 50.0 if gain == 0 else 100.0
        return 100.0 - 100.0 / (1.0 + gain / loss)

    result[period] = value(avg_gain, avg_loss)
    for candle_index in range(period + 1, len(closes)):
        change_index = candle_index - 1
        avg_gain = ((period - 1) * avg_gain + gains[change_index]) / period
        avg_loss = ((period - 1) * avg_loss + losses[change_index]) / period
        result[candle_index] = value(avg_gain, avg_loss)
    return result


def macd(
    closes: Sequence[float], fast_period: int = 12, slow_period: int = 26, signal_period: int = 9
) -> tuple[NumberSeries, NumberSeries, NumberSeries]:
    if fast_period >= slow_period:
        raise ValueError("fast_period must be less than slow_period")
    fast = ema(closes, fast_period)
    slow = ema(closes, slow_period)
    line: NumberSeries = [None] * len(closes)
    dense_line: list[float] = []
    dense_indices: list[int] = []
    for i, (fast_value, slow_value) in enumerate(zip(fast, slow)):
        if fast_value is not None and slow_value is not None:
            line[i] = fast_value - slow_value
            dense_line.append(line[i])
            dense_indices.append(i)
    dense_signal = ema(dense_line, signal_period)
    signal: NumberSeries = [None] * len(closes)
    histogram: NumberSeries = [None] * len(closes)
    for index, dense_index in enumerate(dense_indices):
        if dense_signal[index] is not None:
            signal[dense_index] = dense_signal[index]
            histogram[dense_index] = line[dense_index] - dense_signal[index]  # type: ignore[operator]
    return line, signal, histogram


def atr(candles: Sequence[Candle], period: int = 14) -> NumberSeries:
    if period < 1:
        raise ValueError("period must be positive")
    true_ranges: list[float] = []
    for i, candle in enumerate(candles):
        previous_close = candles[i - 1].close if i else candle.close
        true_ranges.append(max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        ))
    result: NumberSeries = [None] * len(candles)
    if len(candles) < period:
        return result
    previous = sum(true_ranges[:period]) / period
    result[period - 1] = previous
    for i in range(period, len(candles)):
        previous = ((period - 1) * previous + true_ranges[i]) / period
        result[i] = previous
    return result
