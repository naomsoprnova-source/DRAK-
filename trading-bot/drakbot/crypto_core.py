"""Paper-only crypto risk configuration and Binance Spot sizing primitives."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN, ROUND_UP
from math import isfinite
import re
from typing import Any

SYMBOL_RE = re.compile(r"^[A-Z0-9]{5,24}$")
LEVERAGED_SUFFIXES = ("UP", "DOWN", "BULL", "BEAR")
STABLE_BASES = {"USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USDP", "EUR", "USDE"}


def number(value: Any, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not isfinite(result):
        raise ValueError(f"{name} must be a finite number")
    return result


def validate_symbol(value: Any) -> str:
    symbol = str(value or "").strip().upper()
    if not SYMBOL_RE.fullmatch(symbol) or not symbol.endswith("USDT"):
        raise ValueError("symbol must be a Binance Spot USDT pair such as BTCUSDT")
    base = symbol[:-4]
    if base in STABLE_BASES or base.endswith(LEVERAGED_SUFFIXES):
        raise ValueError("stablecoin-to-stablecoin and leveraged-token pairs are excluded")
    return symbol


def floor_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    units = (Decimal(str(value)) / Decimal(str(step))).to_integral_value(rounding=ROUND_DOWN)
    return float(units * Decimal(str(step)))


def ceil_tick(value: float, tick: float) -> float:
    if tick <= 0:
        return value
    units = (Decimal(str(value)) / Decimal(str(tick))).to_integral_value(rounding=ROUND_UP)
    return float(units * Decimal(str(tick)))


@dataclass(frozen=True)
class CryptoRiskConfig:
    capital_usdt: float = 11.0
    cash_buffer_pct: float = 20.0
    max_position_pct: float = 70.0
    risk_pct: float = 1.0
    fee_rate: float = 0.001
    slippage_rate: float = 0.0005
    min_notional_usdt: float = 5.0
    min_reward_risk: float = 2.0
    max_open_positions: int = 1
    max_orders_per_day: int = 3
    max_daily_loss_pct: float = 3.0
    paper_only: bool = True

    def validate(self) -> None:
        for name in ("capital_usdt", "min_notional_usdt", "min_reward_risk"):
            if number(getattr(self, name), name) <= 0:
                raise ValueError(f"{name} must be positive")
        if not 0 <= number(self.cash_buffer_pct, "cash_buffer_pct") < 100:
            raise ValueError("cash_buffer_pct must be in [0, 100)")
        if not 0 < number(self.max_position_pct, "max_position_pct") <= 100:
            raise ValueError("max_position_pct must be in (0, 100]")
        if not 0 < number(self.risk_pct, "risk_pct") <= 1:
            raise ValueError("risk_pct is capped at 1% of equity")
        if not 0 <= number(self.fee_rate, "fee_rate") < 0.05:
            raise ValueError("fee_rate must be in [0, 0.05)")
        if not 0 <= number(self.slippage_rate, "slippage_rate") < 0.05:
            raise ValueError("slippage_rate must be in [0, 0.05)")
        for name in ("max_open_positions", "max_orders_per_day"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        if not 0 < number(self.max_daily_loss_pct, "max_daily_loss_pct") <= 5:
            raise ValueError("max_daily_loss_pct must be in (0, 5]")
        if self.paper_only is not True:
            raise ValueError("DRAK crypto skills are paper-only; live mode is unsupported")


@dataclass(frozen=True)
class SymbolFilters:
    min_qty: float = 0.0
    step_size: float = 0.0
    tick_size: float = 0.0
    min_notional: float = 5.0

    def validate(self) -> None:
        for name in ("min_qty", "step_size", "tick_size", "min_notional"):
            if number(getattr(self, name), name) < 0:
                raise ValueError(f"{name} must not be negative")


def size_spot_position(
    symbol: str, entry_price: float, stop_price: float,
    config: CryptoRiskConfig | None = None,
    filters: SymbolFilters | None = None,
    reward_risk: float | None = None,
) -> dict[str, Any]:
    """Calculate a long Spot proposal. It does not create or send an exchange order."""
    cfg = config or CryptoRiskConfig()
    flt = filters or SymbolFilters(min_notional=cfg.min_notional_usdt)
    cfg.validate()
    flt.validate()
    pair = validate_symbol(symbol)
    entry = number(entry_price, "entry_price")
    stop = number(stop_price, "stop_price")
    rr = cfg.min_reward_risk if reward_risk is None else number(reward_risk, "reward_risk")
    reasons: list[str] = []
    if entry <= 0 or stop <= 0 or stop >= entry:
        raise ValueError("long Spot sizing requires positive entry and a stop below entry")
    if rr < cfg.min_reward_risk:
        reasons.append("reward/risk is below the configured minimum")
    tick_stop = floor_step(stop, flt.tick_size)
    if tick_stop <= 0 or tick_stop >= entry:
        reasons.append("stop becomes invalid after tick-size rounding")
    target = ceil_tick(entry + (entry - tick_stop) * rr, flt.tick_size)
    friction = cfg.fee_rate + cfg.slippage_rate
    entry_cost_per_unit = entry * (1 + cfg.slippage_rate) * (1 + cfg.fee_rate)
    stop_proceeds_per_unit = tick_stop * (1 - cfg.slippage_rate) * (1 - cfg.fee_rate)
    loss_per_unit = entry_cost_per_unit - stop_proceeds_per_unit
    if loss_per_unit <= 0:
        raise ValueError("modeled loss per unit must be positive")
    risk_budget = cfg.capital_usdt * cfg.risk_pct / 100
    spendable = cfg.capital_usdt * (1 - cfg.cash_buffer_pct / 100)
    position_cap = cfg.capital_usdt * cfg.max_position_pct / 100
    max_notional = min(spendable / (1 + friction), position_cap)
    quantity_by_risk = risk_budget / loss_per_unit
    quantity_by_budget = max_notional / (entry * (1 + friction))
    raw_qty = min(quantity_by_risk, quantity_by_budget)
    qty = floor_step(raw_qty, flt.step_size)
    if qty < flt.min_qty:
        reasons.append("quantity is below the current Binance LOT_SIZE minimum")
    notional = qty * entry
    minimum_notional = max(cfg.min_notional_usdt, flt.min_notional)
    if notional + 1e-12 < minimum_notional:
        reasons.append("risk-sized position is below Binance's minimum Spot notional")
    estimated_loss = qty * loss_per_unit
    if estimated_loss > risk_budget + 1e-9:
        reasons.append("rounded position exceeds the configured risk budget")
    if notional * (1 + friction) > spendable + 1e-9:
        reasons.append("position would consume the required cash reserve")
    if notional > position_cap + 1e-9:
        reasons.append("position exceeds the configured concentration cap")
    status = "BLOCK" if reasons else "PROPOSED"
    return {
        "symbol": pair, "side": "BUY", "entry_price": entry, "stop_price": tick_stop,
        "target_price": target, "reward_risk": rr, "quantity": qty,
        "notional_usdt": notional, "estimated_risk_usdt": estimated_loss,
        "risk_budget_usdt": risk_budget, "cash_buffer_usdt": cfg.capital_usdt * cfg.cash_buffer_pct / 100,
        "max_position_usdt": position_cap, "min_notional_usdt": minimum_notional,
        "fees_and_slippage_rate_per_side": friction, "status": status,
        "reasons": reasons, "paper_only": True, "execution_performed": False,
    }
