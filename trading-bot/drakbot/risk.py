"""Pure risk checks for simulated long entries; no broker or network access."""
from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class PaperEntryAssessment:
    """Sizing and rule-check result for one hypothetical paper entry."""

    quantity: float
    notional: float
    estimated_stop_loss: float
    risk_budget: float
    position_cap_quote: float
    blocked_by: tuple[str, ...] = ()

    @property
    def allowed(self) -> bool:
        return not self.blocked_by


def assess_paper_entry(
    *,
    equity: float,
    cash: float,
    entry_price: float,
    stop_price: float,
    risk_fraction: float,
    max_position_fraction: float,
    fee_rate: float,
    slippage_rate: float,
    min_notional: float,
) -> PaperEntryAssessment:
    """Size a hypothetical spot-long position under risk, cash and exposure caps.

    The modeled stop loss includes entry and exit fees and adverse slippage on
    the stop fill. A small order below ``min_notional`` is blocked, not rounded
    up. The function is deterministic and has no side effects.
    """
    values = (
        equity, cash, entry_price, stop_price, risk_fraction,
        max_position_fraction, fee_rate, slippage_rate, min_notional,
    )
    if not all(isfinite(value) for value in values):
        raise ValueError("paper risk inputs must be finite")
    if equity <= 0 or cash < 0:
        raise ValueError("equity must be positive and cash must not be negative")
    if entry_price <= 0 or stop_price <= 0:
        raise ValueError("entry and stop prices must be positive")
    if not 0 < risk_fraction <= 0.05:
        raise ValueError("risk_fraction must be in (0, 0.05]")
    if not 0 < max_position_fraction <= 1:
        raise ValueError("max_position_fraction must be in (0, 1]")
    if not 0 <= fee_rate < 0.1 or not 0 <= slippage_rate < 0.1:
        raise ValueError("fee_rate and slippage_rate must be in [0, 0.1)")
    if min_notional < 0:
        raise ValueError("min_notional must not be negative")

    risk_budget = equity * risk_fraction
    position_cap_quote = equity * max_position_fraction
    if stop_price >= entry_price:
        return PaperEntryAssessment(0.0, 0.0, 0.0, risk_budget, position_cap_quote,
                                    ("invalid_stop",))

    modeled_stop_exit = stop_price * (1.0 - slippage_rate)
    loss_per_unit = entry_price * (1.0 + fee_rate) - modeled_stop_exit * (1.0 - fee_rate)
    if loss_per_unit <= 0:
        return PaperEntryAssessment(0.0, 0.0, 0.0, risk_budget, position_cap_quote,
                                    ("invalid_stop",))

    risk_limited_qty = risk_budget / loss_per_unit
    cash_limited_qty = cash / (entry_price * (1.0 + fee_rate))
    exposure_limited_qty = position_cap_quote / entry_price
    quantity = min(risk_limited_qty, cash_limited_qty, exposure_limited_qty)
    if not isfinite(quantity) or quantity <= 0:
        return PaperEntryAssessment(0.0, 0.0, 0.0, risk_budget, position_cap_quote,
                                    ("insufficient_capacity",))

    notional = quantity * entry_price
    estimated_stop_loss = quantity * loss_per_unit
    blocked_by = ("below_min_notional",) if notional + 1e-12 < min_notional else ()
    return PaperEntryAssessment(
        quantity=quantity,
        notional=notional,
        estimated_stop_loss=estimated_stop_loss,
        risk_budget=risk_budget,
        position_cap_quote=position_cap_quote,
        blocked_by=blocked_by,
    )
