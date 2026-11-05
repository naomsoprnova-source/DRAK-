"""Independent paper risk gate and a manual, display-only trade ticket."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from .crypto_core import CryptoRiskConfig, number, validate_symbol


def _fingerprint(plan: Mapping[str, Any]) -> str:
    fields = (
        "symbol", "side", "entry_price", "stop_price", "target_price",
        "quantity", "notional_usdt", "estimated_risk_usdt",
    )
    payload = {key: plan.get(key) for key in fields}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def risk_gate(
    plan: Mapping[str, Any],
    config: CryptoRiskConfig | None = None,
    *,
    current_position_usdt: float = 0.0,
    open_positions: int = 0,
    daily_loss_usdt: float = 0.0,
    orders_today: int = 0,
) -> dict[str, Any]:
    """Independently validate a proposal; PASS is not authorization or execution."""
    cfg = config or CryptoRiskConfig()
    cfg.validate()
    reasons: list[str] = []
    symbol = ""
    entry = stop = target = qty = notional = stated_risk = 0.0

    try:
        symbol = validate_symbol(plan.get("symbol"))
        entry = number(plan.get("entry_price"), "entry_price")
        stop = number(plan.get("stop_price"), "stop_price")
        target = number(plan.get("target_price"), "target_price")
        qty = number(plan.get("quantity"), "quantity")
        notional = number(plan.get("notional_usdt"), "notional_usdt")
        stated_risk = number(plan.get("estimated_risk_usdt"), "estimated_risk_usdt")
    except (ValueError, TypeError) as exc:
        reasons.append(str(exc))

    if plan.get("side") != "BUY":
        reasons.append("only long Spot BUY proposals are supported")
    if plan.get("paper_only") is not True or plan.get("execution_performed") is not False:
        reasons.append("proposal must explicitly be paper-only and unexecuted")
    if plan.get("status") != "PROPOSED" or plan.get("reasons"):
        reasons.append("sizing proposal is not clean")
    if not (entry > stop > 0 and target > entry and qty > 0 and notional > 0 and stated_risk >= 0):
        reasons.append("invalid entry/stop/target/quantity geometry")

    recomputed_risk = 0.0
    if entry > 0 and stop > 0 and qty > 0:
        expected_notional = qty * entry
        if abs(notional - expected_notional) > max(1e-8, expected_notional * 1e-6):
            reasons.append("quantity and notional do not reconcile")
        entry_cost = entry * (1.0 + cfg.slippage_rate) * (1.0 + cfg.fee_rate)
        stop_proceeds = stop * (1.0 - cfg.slippage_rate) * (1.0 - cfg.fee_rate)
        recomputed_risk = qty * max(entry_cost - stop_proceeds, 0.0)
        if stated_risk + max(1e-9, recomputed_risk * 1e-6) < recomputed_risk:
            reasons.append("reported risk is lower than independently recomputed risk")
        if recomputed_risk > cfg.capital_usdt * cfg.risk_pct / 100.0 + 1e-9:
            reasons.append("recomputed stop loss exceeds the configured risk budget")
        reward_risk = (target - entry) / (entry - stop) if entry > stop else 0.0
        if reward_risk + 1e-9 < cfg.min_reward_risk:
            reasons.append("target does not meet the minimum reward/risk ratio")

    try:
        current = number(current_position_usdt, "current_position_usdt")
        daily_loss = number(daily_loss_usdt, "daily_loss_usdt")
        open_count_value = number(open_positions, "open_positions")
        order_count_value = number(orders_today, "orders_today")
        if int(open_count_value) != open_count_value or int(order_count_value) != order_count_value:
            raise ValueError("position and order counters must be integers")
        open_count, order_count = int(open_count_value), int(order_count_value)
    except (ValueError, TypeError, OverflowError) as exc:
        current = daily_loss = open_count = order_count = 0
        reasons.append(f"invalid risk state: {exc}")

    if min(current, daily_loss, open_count, order_count) < 0:
        reasons.append("risk counters cannot be negative")
    else:
        minimum = max(
            cfg.min_notional_usdt,
            number(plan.get("min_notional_usdt", cfg.min_notional_usdt), "min_notional_usdt"),
        )
        if notional + 1e-12 < minimum:
            reasons.append("order is below minimum Spot notional")
        position_cap = cfg.capital_usdt * cfg.max_position_pct / 100.0
        if current + notional > position_cap + 1e-9:
            reasons.append("position concentration cap would be exceeded")
        reserve_limit = cfg.capital_usdt * (1.0 - cfg.cash_buffer_pct / 100.0)
        friction = cfg.fee_rate + cfg.slippage_rate
        if current + notional * (1.0 + friction) > reserve_limit + 1e-9:
            reasons.append("proposal would invade the required cash reserve")
        if open_count >= cfg.max_open_positions:
            reasons.append("maximum open positions reached")
        if daily_loss + recomputed_risk > cfg.capital_usdt * cfg.max_daily_loss_pct / 100.0 + 1e-9:
            reasons.append("daily loss limit would be exceeded")
        if order_count >= cfg.max_orders_per_day:
            reasons.append("daily proposal limit reached")

    return {
        "symbol": symbol,
        "verdict": "BLOCK" if reasons else "PASS",
        "reasons": reasons,
        "fingerprint": _fingerprint(plan) if not reasons else None,
        "recomputed_risk_usdt": recomputed_risk,
        "paper_only": True,
        "execution_performed": False,
    }


def build_manual_ticket(plan: Mapping[str, Any], verdict: Mapping[str, Any]) -> dict[str, Any]:
    """Build a human-readable ticket, never exchange API arguments."""
    if verdict.get("verdict") != "PASS" or verdict.get("paper_only") is not True:
        raise ValueError("a clean paper risk PASS is required before displaying a ticket")
    if verdict.get("fingerprint") != _fingerprint(plan):
        raise ValueError("risk verdict does not match this exact proposal")
    return {
        "symbol": validate_symbol(plan["symbol"]),
        "side": "BUY",
        "entry_price": plan["entry_price"],
        "stop_price": plan["stop_price"],
        "target_price": plan["target_price"],
        "quantity": plan["quantity"],
        "notional_usdt": plan["notional_usdt"],
        "risk_usdt": verdict["recomputed_risk_usdt"],
        "ticket_type": "DISPLAY_ONLY_PAPER_PROPOSAL",
        "requires_manual_review": True,
        "execution_performed": False,
        "note": "This ticket is informational; it cannot be sent to Binance.",
    }
