"""Conservative, fully configurable defaults for the paper-only prototype."""
from dataclasses import dataclass


@dataclass(frozen=True)
class StrategyConfig:
    initial_capital: float = 11.0
    fee_rate: float = 0.001  # 0.10% per side; no VIP discount assumed.
    slippage_rate: float = 0.0005  # 5 bps adverse execution assumption per side.
    risk_fraction: float = 0.01  # 1% of current equity at the modeled stop.
    min_notional: float = 5.0  # Overridden by current public symbol filters when available.
    ema_fast: int = 9
    ema_slow: int = 21
    rsi_period: int = 14
    rsi_min: float = 50.0
    rsi_max: float = 70.0
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    atr_period: int = 14
    stop_atr_multiple: float = 1.5
    reward_risk_ratio: float = 2.0
    volume_period: int = 20
    htf_ema_fast: int = 20
    htf_ema_slow: int = 50
    max_hold_bars: int = 96  # One day on 15-minute candles.
    train_fraction: float = 0.70

    def validate(self) -> None:
        if self.initial_capital <= 0:
            raise ValueError("initial_capital must be positive")
        if not 0 <= self.fee_rate < 0.1:
            raise ValueError("fee_rate must be in [0, 0.1)")
        if not 0 <= self.slippage_rate < 0.1:
            raise ValueError("slippage_rate must be in [0, 0.1)")
        if not 0 < self.risk_fraction <= 0.05:
            raise ValueError("risk_fraction must be in (0, 0.05]")
        if self.min_notional < 0:
            raise ValueError("min_notional must not be negative")
        if self.ema_fast >= self.ema_slow:
            raise ValueError("ema_fast must be less than ema_slow")
        if self.macd_fast >= self.macd_slow:
            raise ValueError("macd_fast must be less than macd_slow")
        if self.rsi_min < 0 or self.rsi_max > 100 or self.rsi_min >= self.rsi_max:
            raise ValueError("RSI bounds must satisfy 0 <= min < max <= 100")
        if self.stop_atr_multiple <= 0 or self.reward_risk_ratio <= 0:
            raise ValueError("stop and reward/risk multiples must be positive")
        if self.max_hold_bars < 1:
            raise ValueError("max_hold_bars must be at least 1")
        if not 0 < self.train_fraction < 1:
            raise ValueError("train_fraction must be between 0 and 1")
