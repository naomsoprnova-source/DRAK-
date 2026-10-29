from drakbot.backtest import backtest_range
from drakbot.config import StrategyConfig
from drakbot.indicators import atr, ema, macd, rsi, sma
from drakbot.models import Candle
from drakbot.strategy import aggregate_complete_hours, entry_signals


def candle(i, open_, high, low, close, volume=10.0):
    start = i * 15 * 60 * 1000
    return Candle(start, open_, high, low, close, volume, start + 15 * 60 * 1000 - 1)


def test_ema_and_sma_have_explicit_warmup():
    assert ema([1, 2, 3, 4], 3) == [None, None, 2.0, 3.0]
    assert sma([1, 2, 3, 4], 3) == [None, None, 2.0, 3.0]


def test_rsi_constant_series_is_neutral_after_warmup():
    values = rsi([100.0] * 20, 14)
    assert values[:14] == [None] * 14
    assert values[14] == 50.0
    assert values[-1] == 50.0


def test_atr_and_macd_warm_up_without_lookahead_values():
    candles = [candle(i, 100 + i, 102 + i, 99 + i, 101 + i) for i in range(40)]
    values = atr(candles, 14)
    assert values[12] is None
    assert values[13] is not None
    line, signal, hist = macd([100 + i for i in range(50)])
    assert line[24] is None and line[25] is not None
    assert signal[32] is None and signal[33] is not None
    assert hist[33] is not None


def test_only_complete_hourly_groups_are_aggregated():
    candles = [candle(i, 10 + i, 12 + i, 9 + i, 11 + i) for i in range(5)]
    hourly = aggregate_complete_hours(candles)
    assert len(hourly) == 1
    assert hourly[0].open == candles[0].open
    assert hourly[0].close == candles[3].close
    assert hourly[0].volume == 40.0


def test_stop_wins_when_stop_and_target_are_both_touched_and_costs_are_charged():
    candles = [
        candle(0, 100, 101, 99, 100),
        candle(1, 100, 104, 97, 102),  # Both modeled stop and target are crossed.
        candle(2, 102, 103, 101, 102),
    ]
    signals = [True, False, False]
    atr_values = [1.0, 1.0, 1.0]
    cfg = StrategyConfig(initial_capital=11, fee_rate=0.001, slippage_rate=0.0005,
                         risk_fraction=0.05, min_notional=0, max_hold_bars=5)
    result = backtest_range(candles, signals, atr_values, 0, 3, cfg, min_notional=0)
    assert len(result.trades) == 1
    assert result.trades[0].exit_reason == "stop_ambiguous_bar"
    assert result.trades[0].net_pnl_quote < 0
    assert result.total_fees_quote > 0
    assert result.final_equity < 11


def test_no_signal_keeps_paper_balance_unchanged_and_no_orders_exist():
    candles = [candle(i, 100, 101, 99, 100) for i in range(3)]
    cfg = StrategyConfig(min_notional=0)
    result = backtest_range(candles, [False] * 3, [1.0] * 3, 0, 3, cfg, min_notional=0)
    assert result.final_equity == 11
    assert not result.trades
    assert result.summary()["trade_count"] == 0


def test_strategy_returns_aligned_signal_and_atr_arrays():
    candles = []
    for i in range(600):
        price = 100 + i * 0.02
        candles.append(candle(i, price, price + 0.5, price - 0.5, price + 0.1, 20))
    signals, atr_values = entry_signals(candles, StrategyConfig())
    assert len(signals) == len(candles)
    assert len(atr_values) == len(candles)
    assert isinstance(signals[0], bool)


def test_cli_source_contains_no_order_or_private_account_routes():
    from pathlib import Path
    source_root = Path(__file__).parents[1] / "drakbot"
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_root.glob("*.py"))
    lowered = source.lower()
    assert "requests.post" not in lowered
    assert "requests.put" not in lowered
    assert "requests.delete" not in lowered
    assert "/api/v3/order" not in lowered
    assert "/api/v3/account" not in lowered
