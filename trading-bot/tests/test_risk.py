from drakbot.backtest import backtest_range
from drakbot.config import StrategyConfig
from drakbot.risk import assess_paper_entry
from drakbot.models import Candle


def test_risk_budget_limits_stop_loss_after_costs():
    result = assess_paper_entry(
        equity=100.0,
        cash=100.0,
        entry_price=10.0,
        stop_price=9.0,
        risk_fraction=0.01,
        max_position_fraction=1.0,
        fee_rate=0.001,
        slippage_rate=0.0005,
        min_notional=1.0,
    )
    assert result.allowed
    assert result.estimated_stop_loss <= result.risk_budget + 1e-12
    assert result.notional > 0


def test_position_cap_limits_exposure_even_when_stop_is_tight():
    result = assess_paper_entry(
        equity=100.0,
        cash=100.0,
        entry_price=10.0,
        stop_price=9.999,
        risk_fraction=0.01,
        max_position_fraction=0.25,
        fee_rate=0.0,
        slippage_rate=0.0,
        min_notional=1.0,
    )
    assert result.allowed
    assert result.notional == 25.0
    assert result.notional <= result.position_cap_quote


def test_cash_cap_accounts_for_entry_fee():
    result = assess_paper_entry(
        equity=100.0,
        cash=6.0,
        entry_price=10.0,
        stop_price=9.0,
        risk_fraction=0.05,
        max_position_fraction=1.0,
        fee_rate=0.001,
        slippage_rate=0.0005,
        min_notional=5.0,
    )
    assert result.allowed
    assert result.notional * 1.001 <= 6.0 + 1e-12


def test_below_minimum_notional_is_blocked_not_sized_up():
    result = assess_paper_entry(
        equity=10.0,
        cash=10.0,
        entry_price=10.0,
        stop_price=9.0,
        risk_fraction=0.01,
        max_position_fraction=0.10,
        fee_rate=0.0,
        slippage_rate=0.0,
        min_notional=5.0,
    )
    assert not result.allowed
    assert result.blocked_by == ("below_min_notional",)
    assert result.notional == 1.0


def test_backtest_enforces_and_reports_utc_daily_entry_limit():
    candles = []
    for i in range(8):
        start = i * 15 * 60 * 1000
        candles.append(Candle(start, 100.0, 101.0, 99.0, 100.0, 10.0,
                              start + 15 * 60 * 1000 - 1))
    config = StrategyConfig(
        initial_capital=100.0,
        fee_rate=0.0,
        slippage_rate=0.0,
        risk_fraction=0.05,
        max_position_fraction=0.50,
        min_notional=0.0,
        max_hold_bars=1,
        max_trades_per_day=2,
    )
    result = backtest_range(candles, [True] * len(candles), [1.0] * len(candles),
                            0, len(candles), config, min_notional=0.0)
    report = result.to_dict(candles)
    assert len(result.trades) == 2
    assert result.risk_blocks == {"daily_trade_limit": 5}
    assert report["summary"]["blocked_entry_attempts"] == 5
    assert report["risk_blocks"] == {"daily_trade_limit": 5}


def test_backtest_resets_daily_entry_limit_at_utc_midnight():
    day_ms = 24 * 60 * 60 * 1000
    first_start = day_ms - 2 * 15 * 60 * 1000  # 23:30 UTC.
    candles = []
    for i in range(6):
        start = first_start + i * 15 * 60 * 1000
        candles.append(Candle(start, 100.0, 101.0, 99.0, 100.0, 10.0,
                              start + 15 * 60 * 1000 - 1))
    config = StrategyConfig(
        initial_capital=100.0,
        fee_rate=0.0,
        slippage_rate=0.0,
        risk_fraction=0.05,
        max_position_fraction=0.50,
        min_notional=0.0,
        max_hold_bars=1,
        max_trades_per_day=1,
    )
    result = backtest_range(candles, [True] * len(candles), [1.0] * len(candles),
                            0, len(candles), config, min_notional=0.0)
    assert len(result.trades) == 2
    assert result.risk_blocks == {"daily_trade_limit": 3}
