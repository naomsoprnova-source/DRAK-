(function (root) {
  "use strict";
  const SUPPORTED_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const SUPPORTED_INTERVALS = Object.freeze(["15m", "1h", "4h", "1d"]);

  function validateRequest(symbol, interval, limit) {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanInterval = String(interval || "").trim();
    const count = Number(limit);
    if (!SUPPORTED_SYMBOLS.includes(cleanSymbol)) throw new TypeError("زوج السوق غير مدعوم.");
    if (!SUPPORTED_INTERVALS.includes(cleanInterval)) throw new TypeError("الإطار الزمني غير مدعوم.");
    if (!Number.isInteger(count) || count < 50 || count > 1000) throw new RangeError("عدد الشموع يجب أن يكون بين 50 و1000.");
    return { symbol: cleanSymbol, interval: cleanInterval, limit: count };
  }

  function parseKlines(rows, nowMs) {
    const now = Number(nowMs);
    if (!Array.isArray(rows)) throw new TypeError("استجابة الشموع غير صالحة.");
    if (!Number.isFinite(now) || now <= 0) throw new TypeError("وقت التحقق غير صالح.");
    const candles = [];
    const seen = new Set();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 7) throw new TypeError("صف الشمعة غير مكتمل.");
      const time = Number(row[0]);
      const closeTime = Number(row[6]);
      if (!Number.isSafeInteger(time) || !Number.isSafeInteger(closeTime) || time <= 0 || closeTime < time) {
        throw new TypeError("زمن الشمعة غير صالح.");
      }
      // Never parse price fields from the still-open candle.
      if (closeTime >= now) continue;
      if (seen.has(time)) throw new TypeError("توجد شموع مكررة في رد السوق.");
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (![open, high, low, close, volume].every(Number.isFinite) || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) {
        throw new TypeError("أسعار أو حجم الشمعة غير صالح.");
      }
      if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
        throw new TypeError("نطاق OHLC غير متسق.");
      }
      seen.add(time);
      candles.push({ time, open, high, low, close, volume, closeTime });
    }
    candles.sort((a, b) => a.time - b.time);
    for (let i = 1; i < candles.length; i += 1) {
      if (candles[i - 1].time >= candles[i].time) throw new TypeError("تسلسل أزمنة الشموع غير صالح.");
    }
    return candles;
  }

  const api = { SUPPORTED_SYMBOLS, SUPPORTED_INTERVALS, validateRequest, parseKlines };
  root.MarketData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
