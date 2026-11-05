"""FIFO paper ledger, notify-only price alerts and rebalance analysis."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable, Mapping, Sequence

from .crypto_core import number, validate_symbol


def fifo_ledger(fills: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    books: dict[str, list[dict[str, float]]] = defaultdict(list)
    realized: list[dict[str, Any]] = []
    total_fees = 0.0
    for index, fill in enumerate(fills, 1):
        symbol = validate_symbol(fill.get("symbol"))
        side = str(fill.get("side") or "").upper()
        qty = number(fill.get("quantity"), "quantity")
        price = number(fill.get("price"), "price")
        fee = number(fill.get("fee_quote", 0.0), "fee_quote")
        if side not in {"BUY", "SELL"} or min(qty, price) <= 0 or fee < 0:
            raise ValueError(f"invalid paper fill at index {index}")
        total_fees += fee
        if side == "BUY":
            books[symbol].append({"quantity": qty, "unit_cost": price + fee / qty})
            continue
        available = sum(lot["quantity"] for lot in books[symbol])
        if qty > available + 1e-12:
            raise ValueError(f"sell would create a short position in {symbol}")
        remaining = qty
        proceeds_per_unit = price - fee / qty
        pnl = 0.0
        while remaining > 1e-12:
            lot = books[symbol][0]
            used = min(remaining, lot["quantity"])
            pnl += used * (proceeds_per_unit - lot["unit_cost"])
            lot["quantity"] -= used
            remaining -= used
            if lot["quantity"] <= 1e-12:
                books[symbol].pop(0)
        realized.append({"symbol": symbol, "quantity": qty, "realized_pnl_quote": pnl, "fill_index": index})
    open_lots = {symbol: [dict(lot) for lot in lots] for symbol, lots in books.items() if lots}
    return {
        "realized_fills": realized,
        "realized_pnl_quote": sum(row["realized_pnl_quote"] for row in realized),
        "fees_quote": total_fees, "open_lots": open_lots,
        "accounting_method": "FIFO paper ledger; not tax advice",
        "execution_performed": False,
    }


def evaluate_price_alerts(
    alerts: Sequence[Mapping[str, Any]],
    prices: Mapping[str, float],
    already_triggered: Iterable[str] = (),
) -> list[dict[str, Any]]:
    seen = {str(item) for item in already_triggered}
    fired = []
    for alert in alerts:
        alert_id = str(alert.get("id") or "").strip()
        if not alert_id or alert_id in seen:
            continue
        symbol = validate_symbol(alert.get("symbol"))
        price = number(prices.get(symbol), f"price[{symbol}]")
        threshold = number(alert.get("price"), "alert price")
        operator = str(alert.get("operator") or "").lower()
        hit = operator == "above" and price >= threshold or operator == "below" and price <= threshold
        if hit:
            fired.append({
                "id": alert_id, "symbol": symbol, "price": price,
                "threshold": threshold, "operator": operator, "action": "NOTIFY_ONLY",
                "execution_performed": False,
            })
    return fired


def rebalance_analysis(
    current_values: Mapping[str, float],
    targets: Sequence[Mapping[str, Any]],
    cash_usdt: float = 0.0,
) -> dict[str, Any]:
    cash = number(cash_usdt, "cash_usdt")
    if cash < 0:
        raise ValueError("cash_usdt cannot be negative")
    total = cash + sum(number(value, "current position value") for value in current_values.values())
    if total <= 0:
        raise ValueError("portfolio equity must be positive")
    rows = []
    for target in targets:
        symbol = validate_symbol(target.get("symbol"))
        weight = number(target.get("weight_pct"), "weight_pct")
        if not 0 < weight <= 100:
            raise ValueError("target weights must be in (0, 100]")
        current = number(current_values.get(symbol, 0.0), f"current_values[{symbol}]")
        if current < 0:
            raise ValueError("position values cannot be negative")
        desired = total * weight / 100
        delta = desired - current
        rows.append({
            "symbol": symbol, "target_weight_pct": weight,
            "current_value_usdt": current, "target_value_usdt": desired,
            "difference_usdt": delta,
            "action": "BUY" if delta > 0 else "REDUCE" if delta < 0 else "HOLD",
        })
    if sum(row["target_weight_pct"] for row in rows) > 100.000001:
        raise ValueError("target weights total cannot exceed 100%")
    return {
        "equity_usdt": total, "cash_usdt": cash, "positions": rows,
        "execution_performed": False,
        "note": "analysis only; every change needs a fresh risk check and manual approval",
    }
