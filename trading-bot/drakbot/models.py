"""Small immutable models used by the public-data backtester."""
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Any


def iso_utc(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class Candle:
    open_time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time_ms: int

    def __post_init__(self) -> None:
        values = (self.open, self.high, self.low, self.close, self.volume)
        if not all(isfinite(v) for v in values):
            raise ValueError("candle values must be finite")
        if min(self.open, self.high, self.low, self.close) <= 0 or self.volume < 0:
            raise ValueError("prices must be positive and volume non-negative")
        if self.high < max(self.open, self.close, self.low):
            raise ValueError("high is inconsistent with OHLC values")
        if self.low > min(self.open, self.close, self.high):
            raise ValueError("low is inconsistent with OHLC values")
        if self.close_time_ms < self.open_time_ms:
            raise ValueError("close time must not precede open time")


@dataclass(frozen=True)
class Trade:
    entry_time_ms: int
    exit_time_ms: int
    entry_price: float
    exit_price: float
    quantity: float
    stop_price: float
    target_price: float
    net_pnl_quote: float
    fees_quote: float
    exit_reason: str

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["entry_time_utc"] = iso_utc(self.entry_time_ms)
        result["exit_time_utc"] = iso_utc(self.exit_time_ms)
        return result
