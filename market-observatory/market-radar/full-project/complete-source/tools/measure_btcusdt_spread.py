#!/usr/bin/env python3
"""Collect 25 read-only Binance Spot depth snapshots, one per hour over 24h."""
from __future__ import annotations

import csv
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SYMBOL = "BTCUSDT"
SAMPLE_COUNT = 25  # t=0 through t=24h, so the full 24-hour span is covered.
INTERVAL_SECONDS = 60 * 60
DEPTH_LIMIT = 5
API_URL = f"https://api.binance.com/api/v3/depth?symbol={SYMBOL}&limit={DEPTH_LIMIT}"
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "reports"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch_snapshot() -> dict[str, str | float]:
    request = Request(API_URL, headers={"Accept": "application/json", "User-Agent": "MarketRadarSpreadObserver/1.0"})
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"Binance HTTP {response.status}")
        book = json.loads(response.read().decode("utf-8"))
    bids, asks = book.get("bids"), book.get("asks")
    if not bids or not asks:
        raise RuntimeError("Order book response is missing bids or asks")
    best_bid = max(bids, key=lambda level: float(level[0]))
    best_ask = min(asks, key=lambda level: float(level[0]))
    bid_price, ask_price = float(best_bid[0]), float(best_ask[0])
    midpoint = (bid_price + ask_price) / 2
    if midpoint <= 0:
        raise RuntimeError("Invalid midpoint")
    spread = ask_price - bid_price
    return {
        "bid": bid_price,
        "bid_qty": float(best_bid[1]),
        "ask": ask_price,
        "ask_qty": float(best_ask[1]),
        "midpoint": midpoint,
        "spread_abs": spread,
        "spread_bps": spread / midpoint * 10_000,
        "half_spread_bps": spread / midpoint * 5_000,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    csv_path = OUTPUT_DIR / f"btcusdt_depth_spread_hourly_{stamp}.csv"
    summary_path = OUTPUT_DIR / f"btcusdt_depth_spread_summary_{stamp}.json"
    fields = ["sample", "scheduled_at_utc", "observed_at_utc", "bid", "bid_qty", "ask", "ask_qty", "midpoint", "spread_abs", "spread_bps", "half_spread_bps", "status", "error"]
    successful_spreads: list[float] = []
    monotonic_start = time.monotonic()

    print(f"Started read-only {SYMBOL} depth sampling: {SAMPLE_COUNT} samples across 24 hours.", flush=True)
    print(f"CSV: {csv_path}", flush=True)
    with csv_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        file.flush()
        for sample_index in range(SAMPLE_COUNT):
            target_elapsed = sample_index * INTERVAL_SECONDS
            while True:
                remaining = target_elapsed - (time.monotonic() - monotonic_start)
                if remaining <= 0:
                    break
                time.sleep(min(60, remaining))
            scheduled_at = (started.timestamp() + target_elapsed)
            scheduled_iso = datetime.fromtimestamp(scheduled_at, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            row: dict[str, str | int | float] = {
                "sample": sample_index + 1,
                "scheduled_at_utc": scheduled_iso,
                "observed_at_utc": utc_now(),
                "status": "ok",
                "error": "",
            }
            try:
                row.update(fetch_snapshot())
                successful_spreads.append(float(row["spread_bps"]))
                print(f"Sample {sample_index + 1}/{SAMPLE_COUNT}: spread={float(row['spread_bps']):.8f} bps at {row['observed_at_utc']}", flush=True)
            except (HTTPError, URLError, TimeoutError, OSError, ValueError, RuntimeError) as error:
                row["status"] = "error"
                row["error"] = f"{type(error).__name__}: {error}"
                print(f"Sample {sample_index + 1}/{SAMPLE_COUNT}: failed ({row['error']})", flush=True)
            writer.writerow(row)
            file.flush()

    finished = utc_now()
    summary = {
        "symbol": SYMBOL,
        "source": "Binance Spot GET /api/v3/depth?limit=5",
        "started_at_utc": started.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "finished_at_utc": finished,
        "scheduled_samples": SAMPLE_COUNT,
        "successful_samples": len(successful_spreads),
        "failed_samples": SAMPLE_COUNT - len(successful_spreads),
        "sample_interval_seconds": INTERVAL_SECONDS,
        "spread_bps": {
            "mean": statistics.mean(successful_spreads) if successful_spreads else None,
            "median": statistics.median(successful_spreads) if successful_spreads else None,
            "worst_maximum": max(successful_spreads) if successful_spreads else None,
        },
        "interpretation": "Top-of-book spread snapshots only; not realized execution slippage and not a measure of market impact for larger orders.",
        "csv_path": str(csv_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Completed. Summary: {summary_path}", flush=True)


if __name__ == "__main__":
    main()
