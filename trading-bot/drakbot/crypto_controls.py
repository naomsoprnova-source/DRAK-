"""Independent paper risk gate and a manual, display-only trade ticket."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from .crypto_core import CryptoRiskConfig, number, validate_symbol


def _fingerprint(plan: Mapping[str, Any]) -> str:
    fields = ("symbol", "side", "entry_price", "stop_price", "target_price", "quantity", "notional_usdt", "estimated_risk_usdt")
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
    cfg = config or CryptoRiskConfig()
    cfg.validate()
    reasons: list[str] = []
    try:
        symbol = validate_symbol(plan.get("symbol"))
        entry = number(plan.get("entry_price"), "entry_price")
        stop = number(plan.get("stop_price"), "stop_price")
        target = number(plan.get("target_price"), "target_price")
        qty = number(plan.get("quantity"), "quantity")
        notional = number(plan.get("notional_usdt"), "notional_usdt")
        risk = number(plan.get("estimated_risk_usdt"), "estimated_risk_usdt")
    except ValueError as exc:
        symbol = str(plan.get("symbol") or "")
        entry = stop = target = qty = notional = risk = 0.0
        reasons.append(str(exc))
    if plan.get("side", "BUY") != "BUY":
        reasons.append("only long Spot BUY proposals are supported")
    if plan.get("paper_only") is not True or plan.get("execution_performed") is not False:
        reasons.append("proposal must explicitly be paper-only and unexecuted")
    if plan.get("status") != "PROPOSED" or plan.get("reasons"):
        reasons.append("sizing proposal is not clean")
    if not (entry > stop > 0 and target > entry and qty > 0 and notional > 0 and risk >= 0):
        reasons.append("invalid entry/stop/target/quantity geometry")
    if entry > 0 and qty > 0 and abs(notional - entry * qty) > max(1e-8, notional * 1e-6):
        reasons.append("quantity and notional do not reconcile")
    if risk > cfg.capital_usdt * cfg.risk_pct / 100 + 1e-9:
        reasons.append("estimated stop loss exceeds the risk budget")
    min_notional = max(cfg.min_notional_usdt, number(plan.get("min_notional_usdt", cfg.min_notional_usdt), "min_notional_usdt"))
    if notional + 1e-12 < min_notional:
        reasons.append("below minimum Spot notional")
    if current_position_usdt < 0 or open_positions < 0 or daily_loss_usdt < 0 or orders_today < 0:
        reasons.append("risk counters cannot be negative")
    if open_positions >= cfg.max_open_positions:
        reasons.append("maximum open positions reached")
    if current_position_usdt + notional > cfg.capital_usdt * cfg.max_position_pct / 100 + 1e-9:
        reasons.append("position concentration cap would be exceeded")
    if notional * (1 + cfg.fee_rate + cfg.slippage_rate) > cfg.capital_usdt * (1 - cfg.cash_buffer_pct / 100) + 1e-9:
        reasons.append("proposal would invade the required cash reserve")
    if daily_loss_usdt + risk > cfg.capital_usdt * cfg.max_daily_loss_pct / 100 + 1e-9:
        reasons.append("daily loss limit would be exceeded")
    if orders_today >= cfg.max_orders_per_day:
        reasons.append("daily proposal limit reached")
    return {
        "symbol": symbol, "verdict": "BLOCK" if reasons else "PASS",
        "reasons": reasons, "fingerprint": _fingerprint(plan) if not reasons else None,
        "paper_only": True, "execution_performed": False,
    }


def build_manual_ticket(plan: Mapping[str, Any], verdict: Mapping[str, Any]) -> dict[str, Any]:
    """Build a human-readable ticket, never exchange API arguments."""
    if verdict.get("verdict") != "PASS" or verdict.get("paper_only") is not True:
        raise ValueError("a clean paper risk PASS is required before displaying a ticket")
    if verdict.get("fingerprint") != _fingerprint(plan):
        raise ValueError("risk verdict does not match this exact proposal")
    return {
        "symbol": validate_symbol(plan["symbol"]), "side": "BUY",
        "entry_price": plan["entry_price"], "stop_price": plan["stop_price"],
        "target_price": plan["target_price"], "quantity": plan["quantity"],
        "notional_usdt": plan["notional_usdt"], "risk_usdt": plan["estimated_risk_usdt"],
        "ticket_type": "DISPLAY_ONLY_PAPER_PROPOSAL",
        "requires_manual_review": True, "execution_performed": False,
        "note": "This ticket is informational; it cannot be sent to Binance.",
    }
