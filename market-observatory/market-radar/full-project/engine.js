(function (root) {
  "use strict";

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
  }

  function validSeries(values) {
    return Array.isArray(values) && values.every(Number.isFinite);
  }

  function sma(values, period) {
    if (!validSeries(values) || !Number.isInteger(period) || period < 1 || values.length < period) return NaN;
    return mean(values.slice(-period));
  }

  function ema(values, period) {
    if (!validSeries(values) || !Number.isInteger(period) || period < 1 || values.length < period) return NaN;
    const alpha = 2 / (period + 1);
    let value = mean(values.slice(0, period));
    for (let i = period; i < values.length; i += 1) value = values[i] * alpha + value * (1 - alpha);
    return value;
  }

  // RSI using Wilder's original smoothing method.
  function rsi(values, period = 14) {
    if (!validSeries(values) || !Number.isInteger(period) || period < 1 || values.length < period + 1) return NaN;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
      const delta = values[i] - values[i - 1];
      if (delta > 0) gain += delta;
      else loss -= delta;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < values.length; i += 1) {
      const delta = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    if (avgGain === 0) return 0;
    const relativeStrength = avgGain / avgLoss;
    return 100 - 100 / (1 + relativeStrength);
  }

  function validCandles(candles) {
    return Array.isArray(candles) && candles.every((candle) => {
      if (!candle || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return false;
      if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return false;
      return candle.high >= candle.low && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
    });
  }

  // ATR with Wilder smoothing. Each true range after the first candle includes the previous close.
  function atr(candles, period = 14) {
    if (!validCandles(candles) || !Number.isInteger(period) || period < 1 || candles.length < period + 1) return NaN;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i += 1) {
      const candle = candles[i];
      const previousClose = candles[i - 1].close;
      trueRanges.push(Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      ));
    }
    let value = mean(trueRanges.slice(0, period));
    for (let i = period; i < trueRanges.length; i += 1) value = (value * (period - 1) + trueRanges[i]) / period;
    return value;
  }

  function analyze(candles) {
    // SMA50 is part of the trend gate, so require 50 complete candles.
    if (!Array.isArray(candles) || candles.length < 50) {
      throw new Error("يلزم توفر 50 شمعة مغلقة على الأقل لتحليل الاتجاه.");
    }
    if (!validCandles(candles)) throw new Error("بيانات الشموع غير صالحة أو تحتوي أسعارًا غير منطقية.");

    const closes = candles.map((candle) => candle.close);
    const price = closes[closes.length - 1];
    const previous = closes[closes.length - 2];
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const ema20 = ema(closes, 20);
    const rsi14 = rsi(closes, 14);
    const atr14 = atr(candles, 14);
    if (![price, previous, sma20, sma50, ema20, rsi14, atr14].every(Number.isFinite) || previous <= 0) {
      throw new Error("تعذر حساب المؤشرات من البيانات المستلمة.");
    }

    let trend = "مختلط";
    if (price > sma20 && ema20 > sma50) trend = "صاعد";
    else if (price < sma20 && ema20 < sma50) trend = "هابط";

    const votes = [price > sma20, price > ema20, rsi14 > 50].filter(Boolean).length;
    let signal = "انتظار";
    if (trend === "صاعد" && votes >= 2 && rsi14 < 70) signal = "ميل صعودي غير مؤكد";
    else if (trend === "هابط" && votes <= 1 && rsi14 > 30) signal = "ميل هبوطي غير مؤكد";

    return {
      price,
      previous,
      change: ((price - previous) / previous) * 100,
      sma20,
      sma50,
      ema20,
      rsi: rsi14,
      atr: atr14,
      trend,
      signal,
      stopDistance: 2 * atr14
    };
  }

  root.MarketEngine = { analyze, sma, ema, rsi, atr };
})(typeof globalThis !== "undefined" ? globalThis : this);
