(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DrakPaperEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SYMBOLS = Object.freeze({
    BTCUSDT: { label: 'BTC / USDT ورقي', base: 68420 },
    ETHUSDT: { label: 'ETH / USDT ورقي', base: 2575 },
    SOLUSDT: { label: 'SOL / USDT ورقي', base: 148.5 }
  });
  const INTERVALS = Object.freeze({ '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 });
  const STRATEGY_IDS = Object.freeze(['composite', 'ema', 'rsi', 'macd', 'bollinger', 'breakout', 'trend']);

  function finitePositive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(label + ' يجب أن يكون رقمًا موجبًا.');
    return number;
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateCandles(options) {
    const opts = options || {};
    const symbol = String(opts.symbol || 'BTCUSDT').toUpperCase();
    const interval = String(opts.interval || '15m');
    const count = Number(opts.count == null ? 240 : opts.count);
    if (!Object.prototype.hasOwnProperty.call(SYMBOLS, symbol)) throw new Error('الرمز غير متاح في المحاكاة.');
    if (!Object.prototype.hasOwnProperty.call(INTERVALS, interval)) throw new Error('الإطار الزمني غير مدعوم.');
    if (!Number.isInteger(count) || count < 1 || count > 2000) throw new Error('عدد الشموع خارج النطاق المسموح.');

    const random = mulberry32(hashString(symbol + '|' + interval));
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const step = INTERVALS[interval];
    const base = SYMBOLS[symbol].base;
    const candles = [];
    let previous = base;
    const phase = (hashString(symbol) % 1000) / 100;

    for (let index = 0; index < count; index += 1) {
      const open = previous;
      const drift = Math.sin((index + phase) / 13) * 0.0008 + Math.cos((index + phase) / 37) * 0.00035;
      const noise = (random() - 0.5) * 0.0044;
      const close = Math.max(base * 0.35, open * (1 + drift + noise));
      const wick = 0.00025 + random() * 0.0024;
      const high = Math.max(open, close) * (1 + wick);
      const low = Math.min(open, close) * (1 - wick * (0.7 + random() * 0.6));
      const volume = 80 + random() * 920 + (Math.abs(close - open) / open) * 85000;
      candles.push({ symbol, interval, time: start + index * step, open, high, low, close, volume });
      previous = close;
    }
    return candles;
  }

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    if (values.length < period) return out;
    const factor = 2 / (period + 1);
    let current = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    out[period - 1] = current;
    for (let index = period; index < values.length; index += 1) {
      current = values[index] * factor + current * (1 - factor);
      out[index] = current;
    }
    return out;
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    for (let index = period - 1; index < values.length; index += 1) {
      let total = 0;
      for (let cursor = index - period + 1; cursor <= index; cursor += 1) total += values[cursor];
      out[index] = total / period;
    }
    return out;
  }

  function rsi(values, period) {
    const length = period || 14;
    const out = Array(values.length).fill(null);
    if (values.length <= length) return out;
    let gains = 0;
    let losses = 0;
    for (let index = 1; index <= length; index += 1) {
      const delta = values[index] - values[index - 1];
      gains += Math.max(0, delta);
      losses += Math.max(0, -delta);
    }
    let averageGain = gains / length;
    let averageLoss = losses / length;
    out[length] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    for (let index = length + 1; index < values.length; index += 1) {
      const delta = values[index] - values[index - 1];
      averageGain = (averageGain * (length - 1) + Math.max(0, delta)) / length;
      averageLoss = (averageLoss * (length - 1) + Math.max(0, -delta)) / length;
      out[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
    }
    return out;
  }

  function bandAt(values, index, period) {
    const start = index - period + 1;
    if (start < 0) return null;
    const sample = values.slice(start, index + 1);
    const mean = sample.reduce((sum, item) => sum + item, 0) / period;
    const variance = sample.reduce((sum, item) => sum + (item - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    return { middle: mean, upper: mean + deviation * 2, lower: mean - deviation * 2 };
  }

  function buildIndicators(candles) {
    if (!Array.isArray(candles)) throw new Error('بيانات الشموع غير صالحة.');
    const closes = candles.map((candle) => finitePositive(candle.close, 'سعر الإغلاق'));
    const volumes = candles.map((candle) => Math.max(0, Number(candle.volume) || 0));
    const e9 = ema(closes, 9);
    const e20 = ema(closes, 20);
    const e21 = ema(closes, 21);
    const e50 = ema(closes, 50);
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    const macd = closes.map((_, index) => e12[index] == null || e26[index] == null ? null : e12[index] - e26[index]);
    const macdSignal = ema(macd.map((item) => item == null ? 0 : item), 9);
    const relativeStrength = rsi(closes, 14);
    const volumeAverage = sma(volumes, 20);
    return { closes, volumes, e9, e20, e21, e50, macd, macdSignal, relativeStrength, volumeAverage };
  }

  function analyze(candles, strategy) {
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    if (!Array.isArray(candles) || candles.length < 60) {
      return { action: 'wait', reason: 'تحتاج المحاكاة إلى 60 شمعة اصطناعية على الأقل.', score: 0, price: null, rsi: null, source: 'synthetic' };
    }
    const data = buildIndicators(candles);
    const index = candles.length - 1;
    const previous = index - 1;
    const price = data.closes[index];
    const strength = data.relativeStrength[index];
    const priorHigh = Math.max.apply(null, candles.slice(index - 20, index).map((candle) => Number(candle.high)));
    const averageVolume = data.volumeAverage[index];
    const currentBand = bandAt(data.closes, index, 20);
    const previousBand = bandAt(data.closes, previous, 20);
    const crossUp = (a, b) => a[previous] != null && b[previous] != null && a[index] != null && b[index] != null && a[previous] <= b[previous] && a[index] > b[index];
    const crossDown = (a, b) => a[previous] != null && b[previous] != null && a[index] != null && b[index] != null && a[previous] >= b[previous] && a[index] < b[index];
    const enough = Number.isFinite(strength) && Number.isFinite(data.e20[index]) && Number.isFinite(data.e50[index]);
    if (!enough || !currentBand || !previousBand || !Number.isFinite(averageVolume)) {
      return { action: 'wait', reason: 'المؤشرات لم تكتمل بعد؛ أضف شموعًا للاختبار.', score: 0, price, rsi: strength, source: 'synthetic' };
    }

    let buy = false;
    let sell = false;
    if (strategy === 'ema') {
      buy = crossUp(data.e9, data.e21);
      sell = crossDown(data.e9, data.e21);
    } else if (strategy === 'rsi') {
      buy = data.relativeStrength[previous] < 35 && strength >= 35 && price > data.closes[previous];
      sell = strength > 72 || (price < data.e20[index] && strength < 45);
    } else if (strategy === 'macd') {
      buy = crossUp(data.macd, data.macdSignal) && price > data.e50[index];
      sell = crossDown(data.macd, data.macdSignal) || price < data.e20[index];
    } else if (strategy === 'bollinger') {
      buy = data.closes[previous] < previousBand.lower && price > currentBand.lower && strength < 45;
      sell = price >= currentBand.middle || strength > 68;
    } else if (strategy === 'breakout') {
      buy = price > priorHigh && data.volumes[index] > averageVolume * 1.2 && price > data.e50[index];
      sell = price < data.e20[index];
    } else if (strategy === 'trend') {
      buy = data.e20[index] > data.e50[index] && price > data.e20[index] && strength >= 50 && strength <= 70 && data.macd[index] > data.macdSignal[index];
      sell = price < data.e20[index] || data.e20[index] < data.e50[index] || strength > 75;
    } else {
      buy = data.e9[index] > data.e21[index] && data.e21[index] > data.e50[index] && price > priorHigh && strength >= 50 && strength <= 70 && data.macd[index] > data.macdSignal[index] && data.volumes[index] >= averageVolume * 0.8;
      sell = price < data.e20[index] || data.e9[index] < data.e21[index];
    }

    const score = [data.e9[index] > data.e21[index], strength >= 50 && strength <= 70, data.macd[index] > data.macdSignal[index], data.volumes[index] >= averageVolume * 0.8, price > priorHigh].filter(Boolean).length;
    return {
      action: buy ? 'buy' : sell ? 'sell' : 'wait',
      reason: buy ? 'اكتملت شروط الاستراتيجية على بيانات اصطناعية.' : sell ? 'تحققت شروط خروج تعليمية على بيانات اصطناعية.' : 'لم تكتمل الشروط؛ لا توجد إشارة في هذه العينة.',
      score,
      price,
      rsi: strength,
      ema20: data.e20[index],
      source: 'synthetic'
    };
  }

  function createAccount(options) {
    const opts = options || {};
    const startingCapital = Number(opts.startingCapital == null ? 1000 : opts.startingCapital);
    const maxTradeUsd = Number(opts.maxTradeUsd == null ? 10 : opts.maxTradeUsd);
    const maxRiskPct = Number(opts.maxRiskPct == null ? 0.01 : opts.maxRiskPct);
    const feeRate = Number(opts.feeRate == null ? 0.001 : opts.feeRate);
    const slippageRate = Number(opts.slippageRate == null ? 0.0005 : opts.slippageRate);
    const stopLossPct = Number(opts.stopLossPct == null ? 0.015 : opts.stopLossPct);
    if (!Number.isFinite(startingCapital) || startingCapital < 100 || startingCapital > 1000000) throw new Error('رأس المال الافتراضي يجب أن يكون بين 100 و1,000,000.');
    if (!Number.isInteger(maxTradeUsd) || maxTradeUsd < 1 || maxTradeUsd > 10) throw new Error('سقف المركز الورقي يجب أن يكون عددًا صحيحًا بين 1 و10 USDT.');
    if (!Number.isFinite(maxRiskPct) || maxRiskPct < 0.001 || maxRiskPct > 0.05) throw new Error('حد المخاطرة يجب أن يكون بين 0.1% و5%.');
    if (![feeRate, slippageRate, stopLossPct].every(Number.isFinite) || feeRate < 0 || feeRate > 0.05 || slippageRate < 0 || slippageRate > 0.02 || stopLossPct < 0.001 || stopLossPct > 0.1) throw new Error('قيم الرسوم أو المخاطر غير صالحة.');
    return { startingCapital, cash: startingCapital, maxTradeUsd, maxRiskPct, feeRate, slippageRate, stopLossPct, position: null, history: [] };
  }

  function openPaperPosition(account, options) {
    if (!account || typeof account !== 'object') throw new Error('حالة المحاكاة غير صالحة.');
    const opts = options || {};
    const symbol = String(opts.symbol || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(SYMBOLS, symbol)) throw new Error('الرمز غير متاح في المحاكاة.');
    const interval = String(opts.interval || '15m');
    if (!Object.prototype.hasOwnProperty.call(INTERVALS, interval)) throw new Error('الإطار الزمني غير مدعوم.');
    const strategy = String(opts.strategy || 'composite');
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    if (account.position) throw new Error('يوجد مركز ورقي مفتوح بالفعل.');
    const price = finitePositive(opts.price, 'سعر المحاكاة');
    const amount = finitePositive(opts.amount, 'مبلغ المركز');
    if (amount > account.maxTradeUsd + 1e-9) throw new Error('المبلغ يتجاوز سقف المركز الورقي.');
    if (!Number.isInteger(amount) || amount < 1) throw new Error('قيمة المركز يجب أن تكون عددًا صحيحًا بين 1 و10 USDT.');
    if (amount > account.cash / (1 + account.feeRate) + 1e-9) throw new Error('الرصيد الافتراضي غير كافٍ.');
    const riskAmount = amount * account.stopLossPct;
    if (riskAmount > account.startingCapital * account.maxRiskPct + 1e-9) throw new Error('المخاطرة المقدرة تتجاوز الحد الافتراضي.');
    const entryPrice = price * (1 + account.slippageRate);
    const quantity = amount / entryPrice;
    const entryFee = amount * account.feeRate;
    const position = {
      symbol,
      interval,
      strategy,
      amount,
      quantity,
      entryPrice,
      entryFee,
      stopPrice: entryPrice * (1 - account.stopLossPct),
      targetPrice: entryPrice * (1 + account.stopLossPct * 2),
      openedAt: Number(opts.now == null ? Date.now() : opts.now)
    };
    return Object.assign({}, account, { cash: account.cash - amount - entryFee, position });
  }

  function closePaperPosition(account, options) {
    if (!account || !account.position) throw new Error('لا يوجد مركز ورقي لإغلاقه.');
    const opts = options || {};
    const price = finitePositive(opts.price, 'سعر المحاكاة');
    const exitPrice = price * (1 - account.slippageRate);
    const grossProceeds = account.position.quantity * exitPrice;
    const exitFee = grossProceeds * account.feeRate;
    const totalFees = account.position.entryFee + exitFee;
    const pnl = grossProceeds - exitFee - account.position.amount - account.position.entryFee;
    const trade = {
      id: String(opts.now == null ? Date.now() : opts.now) + '-' + account.history.length,
      symbol: account.position.symbol,
      interval: account.position.interval,
      strategy: account.position.strategy,
      amount: account.position.amount,
      quantity: account.position.quantity,
      entryPrice: account.position.entryPrice,
      exitPrice,
      fees: totalFees,
      pnl,
      openedAt: account.position.openedAt,
      closedAt: Number(opts.now == null ? Date.now() : opts.now),
      source: 'synthetic'
    };
    return Object.assign({}, account, {
      cash: account.cash + grossProceeds - exitFee,
      position: null,
      history: [trade].concat(Array.isArray(account.history) ? account.history : []).slice(0, 100)
    });
  }

  function portfolio(account, currentPrice) {
    const markedPosition = account.position ? account.position.quantity * finitePositive(currentPrice, 'سعر المحاكاة') : 0;
    const equity = account.cash + markedPosition;
    const realized = (account.history || []).reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
    const wins = (account.history || []).filter((trade) => Number(trade.pnl) > 0).length;
    return {
      cash: account.cash,
      equity,
      totalPnl: equity - account.startingCapital,
      realizedPnl: realized,
      trades: (account.history || []).length,
      winRate: account.history && account.history.length ? wins / account.history.length * 100 : null
    };
  }

  function runSegment(candles, strategy, startingCapital, maxTradeUsd) {
    let account = createAccount({ startingCapital, maxTradeUsd, maxRiskPct: 0.05, feeRate: 0.001, slippageRate: 0.0005, stopLossPct: 0.015 });
    const marketSymbol = candles[0] && SYMBOLS[candles[0].symbol] ? candles[0].symbol : 'BTCUSDT';
    const marketInterval = candles[0] && INTERVALS[candles[0].interval] ? candles[0].interval : '15m';
    for (let index = 60; index < candles.length - 1; index += 1) {
      const candle = candles[index];
      const signal = analyze(candles.slice(0, index + 1), strategy);
      const position = account.position;
      if (position) {
        let closePrice = null;
        if (candle.low <= position.stopPrice) closePrice = position.stopPrice;
        else if (candle.high >= position.targetPrice) closePrice = position.targetPrice;
        else if (signal.action === 'sell') closePrice = candle.close;
        if (closePrice != null) account = closePaperPosition(account, { price: closePrice, now: candle.time });
      } else if (signal.action === 'buy') {
        const amount = Math.min(account.maxTradeUsd, account.cash / (1 + account.feeRate));
        if (amount >= 1) {
          try { account = openPaperPosition(account, { symbol: marketSymbol, interval: marketInterval, price: candles[index + 1].open, amount, strategy, now: candles[index + 1].time }); }
          catch (_) { /* invalid paper entries are ignored in a statistical sample */ }
        }
      }
    }
    if (account.position) account = closePaperPosition(account, { price: candles[candles.length - 1].close, now: candles[candles.length - 1].time });
    const summary = portfolio(account, candles[candles.length - 1].close);
    return {
      startingCapital,
      finalCapital: summary.equity,
      pnl: summary.equity - startingCapital,
      returnPct: (summary.equity - startingCapital) / startingCapital * 100,
      trades: account.history.length,
      winRate: account.history.length ? account.history.filter((trade) => trade.pnl > 0).length / account.history.length * 100 : null,
      fees: account.history.reduce((sum, trade) => sum + trade.fees, 0)
    };
  }

  function runBacktest(candles, strategy, options) {
    if (!Array.isArray(candles) || candles.length < 100) throw new Error('يلزم 100 شمعة اصطناعية على الأقل للاختبار.');
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    const startingCapital = Number(options && options.startingCapital != null ? options.startingCapital : 1000);
    const maxTradeUsd = Number(options && options.maxTradeUsd != null ? options.maxTradeUsd : 10);
    if (!Number.isFinite(startingCapital) || startingCapital < 100 || !Number.isInteger(maxTradeUsd) || maxTradeUsd < 1 || maxTradeUsd > 10) throw new Error('إعدادات الاختبار غير صالحة.');
    const split = Math.floor(candles.length * 0.7);
    const development = runSegment(candles.slice(0, split), strategy, startingCapital, maxTradeUsd);
    const evaluationStart = Math.max(0, split - 60);
    const evaluation = runSegment(candles.slice(evaluationStart), strategy, startingCapital, maxTradeUsd);
    const symbol = candles[0] && SYMBOLS[candles[0].symbol] ? candles[0].symbol : 'SYNTHETIC';
    const interval = candles[0] && INTERVALS[candles[0].interval] ? candles[0].interval : 'synthetic';
    return { source: 'synthetic', symbol, interval, splitPct: 70, evaluationPct: 30, sampleCount: candles.length, development, evaluation };
  }

  return Object.freeze({ SYMBOLS, INTERVALS, STRATEGY_IDS, generateCandles, analyze, createAccount, openPaperPosition, closePaperPosition, portfolio, runBacktest });
});
