const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../engine.js");
const E = global.MarketEngine;

const up = Array.from({ length: 100 }, (_, i) => {
  const close = 100 + i;
  return { open: close - 0.5, high: close + 2, low: close - 2, close, volume: 100, time: i };
});
const down = Array.from({ length: 100 }, (_, i) => {
  const close = 200 - i;
  return { open: close + 0.5, high: close + 2, low: close - 2, close, volume: 100, time: i };
});
const flat = Array.from({ length: 100 }, (_, i) => ({ open: 100, high: 101, low: 99, close: 100, volume: 100, time: i }));

assert.equal(E.sma([1, 2, 3, 4, 5], 3), 4, "SMA calculates the latest period");
assert.ok(Number.isNaN(E.sma([1, 2], 3)), "SMA rejects insufficient history");
assert.ok(E.ema(up.map((c) => c.close), 20) > 0, "EMA returns a finite positive value");
assert.equal(E.rsi(up.map((c) => c.close)), 100, "RSI for rising prices reaches 100");
assert.equal(E.rsi(down.map((c) => c.close)), 0, "RSI for falling prices reaches 0");
assert.equal(E.rsi(flat.map((c) => c.close)), 50, "RSI for unchanged prices equals 50");
assert.ok(E.atr(up) > 0, "ATR is positive on valid candles");
assert.equal(E.analyze(up).trend, "صاعد", "rising candles produce an uptrend");
assert.equal(E.analyze(down).trend, "هابط", "falling candles produce a downtrend");
assert.equal(E.analyze(flat).trend, "مختلط", "flat candles do not force a trend");
assert.throws(() => E.analyze([]), /50 شمعة/, "short history is rejected");
const malformed = up.slice();
malformed[60] = { ...malformed[60], low: malformed[60].high + 1 };
assert.throws(() => E.analyze(malformed), /غير صالحة/, "malformed OHLC is rejected");
assert.ok(Number.isNaN(E.rsi([1, 2, 3], 14)), "RSI reports insufficient history as NaN");

// Lightweight end-to-end test for app.js with a mocked DOM and market-data response.
(async () => {
  const elements = {};
  for (const id of ["symbol", "interval", "limit", "capital", "risk", "fee", "run", "status", "price", "trend", "rsi", "change", "summary", "indicators", "stop", "riskCash", "qty", "notional"]) {
    elements[id] = {
      id, value: "", textContent: "", className: "", disabled: false, children: [],
      addEventListener(event, fn) { this.listeners = this.listeners || {}; this.listeners[event] = fn; },
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    };
  }
  Object.assign(elements.symbol, { value: "BTCUSDT" });
  Object.assign(elements.interval, { value: "4h" });
  Object.assign(elements.limit, { value: "100" });
  Object.assign(elements.capital, { value: "30" });
  Object.assign(elements.risk, { value: "1" });
  Object.assign(elements.fee, { value: "0.1" });
  const originalFetch = global.fetch;
  const originalDocument = global.document;
  global.document = {
    getElementById(id) { return elements[id]; },
    createElement(tag) { return { tag, textContent: "", children: [], appendChild(child) { this.children.push(child); } }; }
  };
  const data = up.map((c, i) => [i, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), Date.now() - 1000]);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => data });
  try {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), { filename: "app.js" });
    await elements.run.listeners.click();
    assert.match(elements.status.textContent, /نجح الجلب: 100 شمعة مغلقة/);
    assert.match(elements.price.textContent, /199/);
    assert.equal(elements.indicators.children.length, 5);
    assert.notEqual(elements.qty.textContent, "غير متاح");
    assert.notEqual(elements.stop.textContent, "—");
    console.log("نجح اختبار تشغيل الواجهة ببيانات سوق وهمية.");
  } finally {
    global.fetch = originalFetch;
    global.document = originalDocument;
  }
  console.log("نجحت جميع اختبارات المحرك والواجهة.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
