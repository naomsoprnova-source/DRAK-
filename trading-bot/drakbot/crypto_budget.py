"""Crypto adaptations of watchlists, news matching and paper Spot sizing."""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

from .crypto_core import CryptoRiskConfig, SymbolFilters, number, validate_symbol, size_spot_position


def validate_watchlist(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(rows, (list, tuple)):
        raise ValueError("watchlist must be a list of symbol/weight rows")
    clean: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        symbol = validate_symbol(row.get("symbol"))
        weight = number(row.get("weight_pct"), "weight_pct")
        if symbol in seen:
            raise ValueError(f"duplicate watchlist symbol: {symbol}")
        if not 0 < weight <= 100:
            raise ValueError("watchlist weights must be above 0 and at most 100")
        seen.add(symbol)
        clean.append({"symbol": symbol, "weight_pct": weight})
    if not clean or sum(x["weight_pct"] for x in clean) > 100.000001:
        raise ValueError("watchlist must be non-empty and total weight cannot exceed 100%")
    return sorted(clean, key=lambda x: (-x["weight_pct"], x["symbol"]))


def match_market_news(items: Sequence[Mapping[str, Any]], symbols: Iterable[str]) -> list[dict[str, Any]]:
    watch = {validate_symbol(s) for s in symbols}
    matches: list[dict[str, Any]] = []
    for item in items:
        title = str(item.get("title") or "").strip()
        source = str(item.get("source") or "").strip()
        affected = sorted({validate_symbol(s) for s in (item.get("symbols") or [])} & watch)
        if not title or not source or not affected:
            continue
        matches.append({
            "title": title[:300], "source": source[:120], "symbols": affected,
            "published_at": str(item.get("published_at") or ""),
            "verified": item.get("verified") is True,
            "verification_note": "source flag supplied" if item.get("verified") is True else "unverified; confirm independently",
        })
    return matches


def size_crypto_proposals(
    signals: Sequence[Mapping[str, Any]],
    config: CryptoRiskConfig | None = None,
    filters_by_symbol: Mapping[str, SymbolFilters] | None = None,
) -> list[dict[str, Any]]:
    cfg = config or CryptoRiskConfig()
    cfg.validate()
    filters = filters_by_symbol or {}
    proposals = []
    used = 0
    for signal in signals:
        symbol = validate_symbol(signal.get("symbol"))
        if signal.get("action") != "BUY":
            continue
        if used >= cfg.max_open_positions:
            proposals.append({"symbol": symbol, "status": "BLOCK", "reasons": ["maximum open positions reached"], "paper_only": True, "execution_performed": False})
            continue
        plan = size_spot_position(
            symbol, signal.get("entry_price"), signal.get("stop_price"), cfg,
            filters.get(symbol), signal.get("reward_risk"),
        )
        proposals.append(plan)
        if plan["status"] == "PROPOSED":
            used += 1
    return proposals
