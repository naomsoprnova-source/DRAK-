from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "app/src/main/assets"


class DataFlowTests(unittest.TestCase):
    def test_app_initialization_uses_the_defined_chart_renderer(self):
        app = (ROOT / "app/src/main/assets/app.js").read_text(encoding="utf-8")
        self.assertIn("function renderChart()", app)
        self.assertIn("requestAnimationFrame(renderChart)", app)
        self.assertNotIn("requestAnimationFrame(drawChart)", app)

    def test_market_refresh_uses_native_bridge_and_rejects_missing_real_prices(self):
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        self.assertIn("MarketBridge.fetchTickers()", app)
        self.assertIn("MarketBridge.fetchKlines({ symbol: requestedSymbol, interval: requestedInterval, limit: 241 })", app)
        self.assertIn("Engine.normalizeKlines(response.data", app)
        self.assertIn("source: Engine.SOURCE", app)
        self.assertIn("لا توجد أسعار بديلة", app)
        self.assertIn("window.setInterval", app)
        self.assertIn("REFRESH_INTERVAL_MS = 60000", app)

    def test_history_pagination_uses_cursor_after_last_open_time_and_closed_klines(self):
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        self.assertIn("startTime: cursor, endTime, limit: 1000", app)
        self.assertIn("const next = lastOpen + intervalMs", app)
        self.assertIn("Engine.normalizeKlines(response.data, { symbol, interval, serverTime: response.serverTime })", app)
        self.assertIn("Engine.validateCandles(result, { symbol, interval })", app)

    def test_backtest_enforces_temporal_split_next_bar_entry_costs_and_metrics(self):
        engine = (ASSETS / "paper-engine.js").read_text(encoding="utf-8")
        self.assertIn("const split = Math.floor(bars.length * 0.7)", engine)
        self.assertIn("runSegment(bars, indicators, 60, split", engine)
        self.assertIn("runSegment(bars, indicators, split, bars.length", engine)
        self.assertIn("price: nextCandle.open", engine)
        self.assertIn("signal.action === 'sell' && nextCandle", engine)
        for field in ("netPnl", "winRate", "maxDrawdownPct", "tradeCount", "fees", "slippage"):
            with self.subTest(field=field):
                self.assertRegex(engine, rf"\b{re.escape(field)}\b")
        self.assertIn("maxGapCount(bars) > 0", engine)

    def test_paper_orders_require_real_source_and_use_fractional_cent_precision(self):
        engine = (ASSETS / "paper-engine.js").read_text(encoding="utf-8")
        self.assertIn("if (opts.source !== SOURCE)", engine)
        self.assertIn("amountInput * 100", engine)
        self.assertIn("entryFee", engine)
        self.assertIn("slippageUsd", engine)
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        self.assertIn('step="0.01"', (ASSETS / "index.html").read_text(encoding="utf-8"))
        self.assertIn("refreshMarket({ quiet: true })", app)


if __name__ == "__main__":
    unittest.main()
