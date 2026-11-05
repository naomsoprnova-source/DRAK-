"""Long-only paper backtester with explicit fees, slippage and conservative fills."""
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Optional

from .config import StrategyConfig
from .models import Candle, Trade, iso_utc
from .risk import assess_paper_entry


@dataclass
class BacktestResult:
    start_index: int
    end_index: int
    initial_equity: float
    final_equity: float
    trades: list[Trade]
    equity_curve: list[float]
    benchmark_final_equity: float
    total_fees_quote: float
    risk_blocks: dict[str, int]

    def summary(self) -> dict[str, float | int]:
        pnls = [trade.net_pnl_quote for trade in self.trades]
        winners = [pnl for pnl in pnls if pnl > 0]
        losers = [pnl for pnl in pnls if pnl < 0]
        peak = self.initial_equity
        max_drawdown = 0.0
        for equity in self.equity_curve:
            peak = max(peak, equity)
            if peak > 0:
                max_drawdown = max(max_drawdown, (peak - equity) / peak)
        gross_profit = sum(winners)
        gross_loss = abs(sum(losers))
        return {
            "initial_equity": self.initial_equity,
            "final_equity": self.final_equity,
            "net_pnl_quote": self.final_equity - self.initial_equity,
            "return_pct": (self.final_equity / self.initial_equity - 1.0) * 100.0,
            "trade_count": len(self.trades),
            "win_rate_pct": (len(winners) / len(pnls) * 100.0) if pnls else 0.0,
            "max_drawdown_pct": max_drawdown * 100.0,
            "profit_factor": (gross_profit / gross_loss) if gross_loss else (float("inf") if gross_profit else 0.0),
            "total_fees_quote": self.total_fees_quote,
            "blocked_entry_attempts": sum(self.risk_blocks.values()),
            "benchmark_final_equity": self.benchmark_final_equity,
            "benchmark_return_pct": (self.benchmark_final_equity / self.initial_equity - 1.0) * 100.0,
        }

    def to_dict(self, candles: list[Candle]) -> dict:
        summary = self.summary()
        if summary["profit_factor"] == float("inf"):
            summary["profit_factor"] = "infinity"
        return {
            "period_start_utc": iso_utc(candles[self.start_index].open_time_ms),
            "period_end_utc": iso_utc(candles[self.end_index - 1].close_time_ms),
            "bars": self.end_index - self.start_index,
            "summary": summary,
            "risk_blocks": dict(self.risk_blocks),
            "trades": [trade.to_dict() for trade in self.trades],
        }


@dataclass
class _Position:
    entry_index: int
    entry_price: float
    quantity: float
    stop_price: float
    target_price: float
    entry_cost: float
    entry_fee: float


def _benchmark(candles: list[Candle], begin: int, end: int, config: StrategyConfig) -> float:
    first, last = candles[begin], candles[end - 1]
    buy_fill = first.open * (1.0 + config.slippage_rate)
    qty = config.initial_capital / (buy_fill * (1.0 + config.fee_rate))
    sell_fill = last.close * (1.0 - config.slippage_rate)
    return qty * sell_fill * (1.0 - config.fee_rate)


def backtest_range(
    candles: list[Candle],
    signals: list[bool],
    atr_values: list[Optional[float]],
    begin: int,
    end: int,
    config: StrategyConfig,
    min_notional: float | None = None,
) -> BacktestResult:
    """Simulate candles [begin, end); signals are known only at each bar close."""
    config.validate()
    if not (0 <= begin < end <= len(candles)):
        raise ValueError("invalid backtest range")
    if len(signals) != len(candles) or len(atr_values) != len(candles):
        raise ValueError("signals and ATR values must align with candles")
    if any(candles[i].open_time_ms >= candles[i + 1].open_time_ms for i in range(len(candles) - 1)):
        raise ValueError("candles must be ordered and have unique open times")

    floor_notional = config.min_notional if min_notional is None else min_notional
    cash = config.initial_capital
    position: _Position | None = None
    trades: list[Trade] = []
    equity_curve: list[float] = []
    total_fees = 0.0
    risk_blocks: dict[str, int] = {}
    entries_by_utc_day: dict[str, int] = {}

    for i in range(begin, end):
        candle = candles[i]

        # A signal formed at the previous 15m close can fill at this candle's open.
        if position is None and i > begin and signals[i - 1]:
            entry_day = datetime.fromtimestamp(candle.open_time_ms / 1000, tz=timezone.utc).date().isoformat()
            if entries_by_utc_day.get(entry_day, 0) >= config.max_trades_per_day:
                risk_blocks["daily_trade_limit"] = risk_blocks.get("daily_trade_limit", 0) + 1
            else:
                signal_atr = atr_values[i - 1]
                if signal_atr is not None and isfinite(signal_atr) and signal_atr > 0 and cash > 0:
                    entry_price = candle.open * (1.0 + config.slippage_rate)
                    stop_distance = signal_atr * config.stop_atr_multiple
                    stop_price = entry_price - stop_distance
                    target_price = entry_price + stop_distance * config.reward_risk_ratio
                    assessment = assess_paper_entry(
                        equity=cash,
                        cash=cash,
                        entry_price=entry_price,
                        stop_price=stop_price,
                        risk_fraction=config.risk_fraction,
                        max_position_fraction=config.max_position_fraction,
                        fee_rate=config.fee_rate,
                        slippage_rate=config.slippage_rate,
                        min_notional=floor_notional,
                    )
                    if not assessment.allowed:
                        for reason in assessment.blocked_by:
                            risk_blocks[reason] = risk_blocks.get(reason, 0) + 1
                    else:
                        quantity = assessment.quantity
                        notional = assessment.notional
                        entry_fee = notional * config.fee_rate
                        entry_cost = notional + entry_fee
                        cash -= entry_cost
                        total_fees += entry_fee
                        position = _Position(i, entry_price, quantity, stop_price, target_price, entry_cost, entry_fee)
                        entries_by_utc_day[entry_day] = entries_by_utc_day.get(entry_day, 0) + 1

        if position is not None:
            held_bars = i - position.entry_index + 1
            exit_reference: float | None = None
            exit_reason = ""
            # If both levels fall within one OHLC bar, assume the stop happened first.
            if candle.open <= position.stop_price:
                exit_reference, exit_reason = candle.open, "stop_gap"
            elif candle.low <= position.stop_price and candle.high >= position.target_price:
                exit_reference, exit_reason = position.stop_price, "stop_ambiguous_bar"
            elif candle.low <= position.stop_price:
                exit_reference, exit_reason = position.stop_price, "stop"
            elif candle.high >= position.target_price:
                exit_reference, exit_reason = position.target_price, "target"
            elif held_bars >= config.max_hold_bars:
                exit_reference, exit_reason = candle.close, "time_limit"
            elif i == end - 1:
                exit_reference, exit_reason = candle.close, "period_end"

            if exit_reference is not None:
                exit_price = exit_reference * (1.0 - config.slippage_rate)
                exit_notional = position.quantity * exit_price
                exit_fee = exit_notional * config.fee_rate
                proceeds = exit_notional - exit_fee
                cash += proceeds
                total_fees += exit_fee
                net_pnl = proceeds - position.entry_cost
                trades.append(Trade(
                    entry_time_ms=candles[position.entry_index].open_time_ms,
                    exit_time_ms=candle.close_time_ms,
                    entry_price=position.entry_price,
                    exit_price=exit_price,
                    quantity=position.quantity,
                    stop_price=position.stop_price,
                    target_price=position.target_price,
                    net_pnl_quote=net_pnl,
                    fees_quote=position.entry_fee + exit_fee,
                    exit_reason=exit_reason,
                ))
                position = None
                equity_curve.append(cash)
                continue

        if position is None:
            equity_curve.append(cash)
        else:
            marked_exit = candle.close * (1.0 - config.slippage_rate)
            marked_value = position.quantity * marked_exit * (1.0 - config.fee_rate)
            equity_curve.append(cash + marked_value)

    # The end-bar branch above normally closes this; retain a defensive safeguard.
    if position is not None:
        candle = candles[end - 1]
        exit_price = candle.close * (1.0 - config.slippage_rate)
        exit_notional = position.quantity * exit_price
        exit_fee = exit_notional * config.fee_rate
        proceeds = exit_notional - exit_fee
        cash += proceeds
        total_fees += exit_fee
        trades.append(Trade(
            entry_time_ms=candles[position.entry_index].open_time_ms,
            exit_time_ms=candle.close_time_ms,
            entry_price=position.entry_price,
            exit_price=exit_price,
            quantity=position.quantity,
            stop_price=position.stop_price,
            target_price=position.target_price,
            net_pnl_quote=proceeds - position.entry_cost,
            fees_quote=position.entry_fee + exit_fee,
            exit_reason="period_end",
        ))
        equity_curve[-1] = cash

    return BacktestResult(
        start_index=begin,
        end_index=end,
        initial_equity=config.initial_capital,
        final_equity=cash,
        trades=trades,
        equity_curve=equity_curve,
        benchmark_final_equity=_benchmark(candles, begin, end, config),
        total_fees_quote=total_fees,
        risk_blocks=risk_blocks,
    )
