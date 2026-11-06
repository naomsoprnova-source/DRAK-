(function (root) {
  'use strict';

  const SOURCE = 'binance-spot';
  const SYMBOLS = Object.freeze({
    BTCUSDT: Object.freeze({ name: 'Bitcoin', short: 'BTC', color: '#f5a623' }),
    ETHUSDT: Object.freeze({ name: 'Ethereum', short: 'ETH', color: '#8f8cff' }),
    SOLUSDT: Object.freeze({ name: 'Solana', short: 'SOL', color: '#52d1ad' })
  });
  const INTERVALS = Object.freeze({ '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 });
  const STRATEGY_IDS = Object.freeze(['composite', 'ema-cross', 'rsi-rebound', 'macd', 'bollinger', 'breakout', 'trend-follow']);
  const DEFAULT_FEE_RATE = 0.001;
  const DEFAULT_SLIPPAGE_RATE = 0.0005;
  const DEFAULT_STOP_LOSS_PCT = 0.015;
  const MIN_CANDLES = 100;
  const EPSILON = 1e-10;

  function finitePositive(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(label + ' يجب أن يكون رقمًا موجبًا صالحًا.');
    return number;
  }

  function numberField(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('بيانات ' + label + ' غير صالحة.');
    return number;
  }

  function roundCents(value) { return Math.floor((value + 1e-9) * 100) / 100; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  function validateOneCandle(candle, symbol, interval, previousOpenTime) {
    if (!candle || typeof candle !== 'object' || Array.isArray(candle)) throw new Error('شمعة السوق غير صالحة.');
    if (candle.source !== SOURCE) throw new Error('مصدر الشموع ليس Binance Spot الحقيقي.');
    if (!hasOwn(SYMBOLS, candle.symbol) || (symbol && candle.symbol !== symbol)) throw new Error('رمز الشمعة غير متطابق.');
    if (!hasOwn(INTERVALS, candle.interval) || (interval && candle.interval !== interval)) throw new Error('فاصل الشمعة غير متطابق.');
    const openTime = numberField(candle.openTime, 'وقت افتتاح الشمعة');
    const closeTime = numberField(candle.closeTime, 'وقت إغلاق الشمعة');
    const open = finitePositive(candle.open, 'الافتتاح');
    const high = finitePositive(candle.high, 'الأعلى');
    const low = finitePositive(candle.low, 'الأدنى');
    const close = finitePositive(candle.close, 'الإغلاق');
    const volume = numberField(candle.volume, 'الحجم');
    const intervalMs = INTERVALS[candle.interval];
    if (!Number.isInteger(openTime) || !Number.isInteger(closeTime) || closeTime < openTime ||
        openTime % intervalMs !== 0 || closeTime !== openTime + intervalMs - 1) {
      throw new Error('توقيت الشمعة لا يطابق الفاصل المحدد بتوقيت UTC.');
    }
    if (previousOpenTime != null && openTime <= previousOpenTime) throw new Error('شموع السوق مكررة أو خارج الترتيب الزمني.');
    if (high + EPSILON < Math.max(open, close, low) || low - EPSILON > Math.min(open, close, high) || volume < 0) {
      throw new Error('قيم OHLCV غير متناسقة.');
    }
    const quoteVolume = Number(candle.quoteVolume == null ? 0 : candle.quoteVolume);
    const tradeCount = Number(candle.tradeCount == null ? 0 : candle.tradeCount);
    if (!Number.isFinite(quoteVolume) || quoteVolume < 0 || !Number.isFinite(tradeCount) || tradeCount < 0) {
      throw new Error('حجم التداول أو عدد الصفقات غير صالح.');
    }
    return {
      symbol: candle.symbol,
      interval: candle.interval,
      openTime,
      closeTime,
      time: openTime,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume,
      tradeCount,
      source: SOURCE
    };
  }

  function validateCandles(candles, options) {
    if (!Array.isArray(candles) || !candles.length) throw new Error('لا توجد شموع Binance صالحة.');
    const opts = options || {};
    const first = candles[0];
    const symbol = opts.symbol || (first && first.symbol);
    const interval = opts.interval || (first && first.interval);
    if (!hasOwn(SYMBOLS, symbol) || !hasOwn(INTERVALS, interval)) throw new Error('رمز السوق أو الفاصل غير مدعوم.');
    let previous = null;
    const normalized = candles.map((item) => {
      const candle = validateOneCandle(item, symbol, interval, previous);
      previous = candle.openTime;
      if (opts.serverTime != null && candle.closeTime >= Number(opts.serverTime)) {
        throw new Error('توجد شمعة لم تُغلق بعد؛ لا يجوز استخدامها للتحليل.');
      }
      return candle;
    });
    return normalized;
  }

  function normalizeKlines(rows, options) {
    const opts = options || {};
    const symbol = String(opts.symbol || '').toUpperCase();
    const interval = String(opts.interval || '');
    const serverTime = Number(opts.serverTime);
    if (!hasOwn(SYMBOLS, symbol) || !hasOwn(INTERVALS, interval)) throw new Error('رمز السوق أو الفاصل غير مدعوم.');
    if (!Number.isFinite(serverTime) || serverTime <= 0) throw new Error('لم يصل وقت Binance للتحقق من إغلاق الشموع.');
    if (!Array.isArray(rows)) throw new Error('استجابة Binance للشموع ليست قائمة صالحة.');
    const normalized = [];
    let previousOpenTime = null;
    rows.forEach((row) => {
      if (!Array.isArray(row) || row.length < 9) throw new Error('صيغة شمعة Binance غير مكتملة.');
      const candle = validateOneCandle({
        symbol,
        interval,
        openTime: row[0],
        open: row[1],
        high: row[2],
        low: row[3],
        close: row[4],
        volume: row[5],
        closeTime: row[6],
        quoteVolume: row[7],
        tradeCount: row[8],
        source: SOURCE
      }, symbol, interval, previousOpenTime);
      previousOpenTime = candle.openTime;
      if (candle.closeTime < serverTime) normalized.push(candle);
    });
    if (!normalized.length) throw new Error('لا توجد شموع مغلقة من Binance؛ لم تُستخدم بيانات بديلة.');
    return normalized;
  }

  function assertSeries(candles, minimum) {
    const result = validateCandles(candles);
    if (minimum && result.length < minimum) throw new Error('البيانات الحقيقية غير كافية؛ يلزم ' + minimum + ' شمعة مغلقة على الأقل.');
    return result;
  }

  function makeIndicatorSeries(candles) {
    const length = candles.length;
    const close = candles.map((candle) => candle.close);
    const volume = candles.map((candle) => candle.volume);
    const ema = (values, period) => {
      const result = new Array(values.length);
      const alpha = 2 / (period + 1);
      if (!values.length) return result;
      result[0] = values[0];
      for (let index = 1; index < values.length; index += 1) result[index] = values[index] * alpha + result[index - 1] * (1 - alpha);
      return result;
    };
    const rolling = (values, period, calculate) => {
      const result = new Array(values.length).fill(null);
      let sum = 0;
      let sumSquares = 0;
      for (let index = 0; index < values.length; index += 1) {
        sum += values[index];
        sumSquares += values[index] * values[index];
        if (index >= period) {
          sum -= values[index - period];
          sumSquares -= values[index - period] * values[index - period];
        }
        if (index >= period - 1) result[index] = calculate(sum / period, Math.max(0, sumSquares / period - (sum / period) ** 2), index);
      }
      return result;
    };
    const rsi = new Array(length).fill(null);
    for (let index = 0; index < length; index += 1) {
      if (index < 14) continue;
      let gains = 0;
      let losses = 0;
      for (let cursor = index - 13; cursor <= index; cursor += 1) {
        const difference = close[cursor] - close[cursor - 1];
        if (difference > 0) gains += difference;
        else losses -= difference;
      }
      rsi[index] = gains === 0 && losses === 0 ? 50 : losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
    }
    const ema9 = ema(close, 9);
    const ema12 = ema(close, 12);
    const ema20 = ema(close, 20);
    const ema21 = ema(close, 21);
    const ema26 = ema(close, 26);
    const ema50 = ema(close, 50);
    const macd = close.map((_, index) => ema12[index] - ema26[index]);
    const macdSignal = ema(macd, 9);
    const bollinger = rolling(close, 20, (mean, variance) => ({ mid: mean, upper: mean + 2 * Math.sqrt(variance), lower: mean - 2 * Math.sqrt(variance) }));
    const previousHigh20 = new Array(length).fill(null);
    const averageVolume20 = new Array(length).fill(null);
    for (let index = 20; index < length; index += 1) {
      let max = -Infinity;
      let volumeSum = 0;
      for (let cursor = index - 20; cursor < index; cursor += 1) {
        max = Math.max(max, candles[cursor].high);
        volumeSum += volume[cursor];
      }
      previousHigh20[index] = max;
      averageVolume20[index] = volumeSum / 20;
    }
    return { ema9, ema20, ema21, ema50, rsi, macd, macdSignal, bollinger, previousHigh20, averageVolume20 };
  }

  function analyzeAt(candles, strategy, index) {
    const bars = assertSeries(candles, 1);
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    const cursor = index == null ? bars.length - 1 : Number(index);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= bars.length) throw new Error('موضع التحليل غير صالح.');
    const indicators = makeIndicatorSeries(bars);
    return signalAt(bars, indicators, cursor, strategy);
  }

  function signalAt(candles, indicators, index, strategy) {
    const current = candles[index];
    const previous = candles[index - 1];
    const rsi = indicators.rsi[index];
    if (index < 60 || rsi == null || indicators.previousHigh20[index] == null || indicators.averageVolume20[index] == null) {
      return { action: 'wait', reason: 'نحتاج شموع Binance مغلقة أكثر قبل تحليل موثوق.', score: 0, rsi: rsi == null ? null : rsi, source: SOURCE };
    }
    const c = current.close;
    const ema9 = indicators.ema9[index];
    const ema20 = indicators.ema20[index];
    const ema21 = indicators.ema21[index];
    const ema50 = indicators.ema50[index];
    const macd = indicators.macd[index];
    const macdSignal = indicators.macdSignal[index];
    const previousMacd = indicators.macd[index - 1];
    const previousMacdSignal = indicators.macdSignal[index - 1];
    const bands = indicators.bollinger[index];
    const previousBands = indicators.bollinger[index - 1];
    const volumeAverage = indicators.averageVolume20[index];
    const previousHigh = indicators.previousHigh20[index];
    const checks = [ema9 > ema21, ema21 > ema50, c > previousHigh, rsi > 50 && rsi < 70, macd > macdSignal];
    let action = 'wait';
    let reason = 'لا توجد إشارة واضحة من الشموع المغلقة الحالية.';
    let score = Math.round(checks.filter(Boolean).length);
    if (strategy === 'composite') {
      const buy = checks.every(Boolean) && current.volume >= volumeAverage * 0.8;
      if (buy) { action = 'buy'; reason = 'اتجاه ومتوسطات وزخم واختراق وحجم متوافق على شمعة مغلقة.'; }
      else if (c < ema20 || ema9 < ema21) { action = 'sell'; reason = 'ضعف الإغلاق أو انعكاس تقاطع المتوسطات على شمعة مغلقة.'; }
    } else if (strategy === 'ema-cross') {
      if (indicators.ema9[index - 1] <= indicators.ema21[index - 1] && ema9 > ema21) { action = 'buy'; reason = 'تقاطع EMA9 فوق EMA21 بعد إغلاق الشمعة.'; }
      else if (indicators.ema9[index - 1] >= indicators.ema21[index - 1] && ema9 < ema21) { action = 'sell'; reason = 'تقاطع EMA9 تحت EMA21 بعد إغلاق الشمعة.'; }
    } else if (strategy === 'rsi-rebound') {
      const previousRsi = indicators.rsi[index - 1];
      if (previousRsi != null && previousRsi < 35 && rsi >= 35 && c > previous.close) { action = 'buy'; reason = 'ارتداد RSI فوق 35 مع إغلاق أعلى من الشمعة السابقة.'; }
      else if (rsi > 72 || (c < ema20 && rsi < 45)) { action = 'sell'; reason = 'وصول RSI إلى منطقة مرتفعة أو ضعف الإغلاق مع RSI.'; }
    } else if (strategy === 'macd') {
      if (previousMacd <= previousMacdSignal && macd > macdSignal && c > ema50) { action = 'buy'; reason = 'تقاطع MACD صاعد مع السعر فوق EMA50 بعد الإغلاق.'; }
      else if ((previousMacd >= previousMacdSignal && macd < macdSignal) || c < ema20) { action = 'sell'; reason = 'تقاطع MACD هابط أو إغلاق دون EMA20.'; }
    } else if (strategy === 'bollinger') {
      if (previous && previousBands && previous.close < previousBands.lower && c >= bands.lower && rsi < 45) { action = 'buy'; reason = 'عودة الإغلاق إلى نطاق بولينجر من أسفل مع RSI منخفض.'; }
      else if (c >= bands.mid || rsi > 68) { action = 'sell'; reason = 'وصول إلى متوسط بولينجر أو منطقة RSI مرتفعة.'; }
    } else if (strategy === 'breakout') {
      if (c > previousHigh && current.volume > volumeAverage * 1.2 && c > ema50) { action = 'buy'; reason = 'اختراق أعلى 20 شمعة مع حجم مؤكد وسعر فوق EMA50.'; }
      else if (c < ema20) { action = 'sell'; reason = 'إغلاق دون EMA20 بعد محاولة اختراق.'; }
    } else if (strategy === 'trend-follow') {
      if (ema20 > ema50 && c > ema20 && rsi >= 50 && rsi <= 70 && macd > macdSignal) { action = 'buy'; reason = 'اتجاه EMA20/50 وزخم RSI وMACD متوافق.'; }
      else if (c < ema20 || ema20 < ema50 || rsi > 75) { action = 'sell'; reason = 'ضعف الاتجاه أو وصول RSI إلى مستوى مرتفع.'; }
    }
    if (action === 'buy') score = clamp(score + 1, 0, 5);
    else if (action === 'sell') score = clamp(score - 1, 0, 5);
    return { action, reason, score, rsi, source: SOURCE, candleCloseTime: current.closeTime };
  }

  function analyze(candles, strategy) {
    const bars = assertSeries(candles, 1);
    return analyzeAt(bars, strategy, bars.length - 1);
  }

  function createAccount(options) {
    const opts = options || {};
    const startingCapital = Number(opts.startingCapital == null ? 11 : opts.startingCapital);
    const maxTradeUsd = Number(opts.maxTradeUsd == null ? 10 : opts.maxTradeUsd);
    const maxRiskPct = Number(opts.maxRiskPct == null ? 0.01 : opts.maxRiskPct);
    const feeRate = Number(opts.feeRate == null ? DEFAULT_FEE_RATE : opts.feeRate);
    const slippageRate = Number(opts.slippageRate == null ? DEFAULT_SLIPPAGE_RATE : opts.slippageRate);
    const stopLossPct = Number(opts.stopLossPct == null ? DEFAULT_STOP_LOSS_PCT : opts.stopLossPct);
    if (!Number.isFinite(startingCapital) || startingCapital < 1 || startingCapital > 1000000) throw new Error('رأس المال الافتراضي يجب أن يكون بين 1 و1,000,000 USDT.');
    if (!Number.isFinite(maxTradeUsd) || maxTradeUsd < 0.01 || maxTradeUsd > startingCapital) throw new Error('سقف المركز يجب أن يكون بين 0.01 ورأس المال المحدد.');
    if (!Number.isFinite(maxRiskPct) || maxRiskPct < 0.001 || maxRiskPct > 0.05) throw new Error('حد المخاطرة يجب أن يكون بين 0.1% و5%.');
    if (![feeRate, slippageRate, stopLossPct].every(Number.isFinite) || feeRate < 0 || feeRate > 0.05 || slippageRate < 0 || slippageRate > 0.02 || stopLossPct < 0.001 || stopLossPct > 0.1) throw new Error('قيم الرسوم أو الانزلاق أو الوقف غير صالحة.');
    return { startingCapital, cash: startingCapital, maxTradeUsd, maxRiskPct, feeRate, slippageRate, stopLossPct, position: null, history: [] };
  }

  function amountRisk(account, amount) {
    const entryPricePerDollar = 1 + account.slippageRate;
    const quantity = 1 / entryPricePerDollar;
    const stopPrice = entryPricePerDollar * (1 - account.stopLossPct);
    const exitPrice = stopPrice * (1 - account.slippageRate);
    const exitProceedsAfterFee = quantity * exitPrice * (1 - account.feeRate);
    const spentIncludingEntryFee = 1 + account.feeRate;
    return Math.max(0, (spentIncludingEntryFee - exitProceedsAfterFee) * amount);
  }

  function openPaperPosition(account, options) {
    if (!account || typeof account !== 'object') throw new Error('حالة المحاكاة غير صالحة.');
    const opts = options || {};
    const symbol = String(opts.symbol || '').toUpperCase();
    if (!hasOwn(SYMBOLS, symbol)) throw new Error('الرمز غير متاح في المختبر.');
    const interval = String(opts.interval || '15m');
    if (!hasOwn(INTERVALS, interval)) throw new Error('الإطار الزمني غير مدعوم.');
    const strategy = String(opts.strategy || 'composite');
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    if (account.position) throw new Error('يوجد مركز ورقي مفتوح بالفعل.');
    if (opts.source !== SOURCE) throw new Error('يلزم سعر حقيقي من Binance Spot لفتح مركز ورقي.');
    const price = finitePositive(opts.price, 'سعر Binance');
    const amountInput = finitePositive(opts.amount, 'مبلغ المركز');
    if (Math.abs(amountInput * 100 - Math.round(amountInput * 100)) > 1e-7) throw new Error('المبلغ يدعم منزلتين عشريتين كحد أقصى.');
    const amount = Math.round(amountInput * 100) / 100;
    if (amount > account.maxTradeUsd + EPSILON) throw new Error('المبلغ يتجاوز سقف المركز الورقي.');
    if (amount < 0.01) throw new Error('أقل مركز ورقي هو 0.01 USDT.');
    const entryPrice = price * (1 + account.slippageRate);
    const quantity = amount / entryPrice;
    const entryFee = amount * account.feeRate;
    if (amount + entryFee > account.cash + EPSILON) throw new Error('الرصيد الافتراضي غير كافٍ بعد رسوم الدخول.');
    const estimatedRisk = amountRisk(account, amount);
    if (estimatedRisk > account.startingCapital * account.maxRiskPct + EPSILON) throw new Error('المخاطرة المقدرة عند الوقف، مع الرسوم والانزلاق للجهتين، تتجاوز الحد المحدد.');
    const now = Number(opts.now == null ? Date.now() : opts.now);
    if (!Number.isFinite(now) || now <= 0) throw new Error('وقت فتح المركز غير صالح.');
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
      openedAt: now,
      source: SOURCE
    };
    return Object.assign({}, account, { cash: account.cash - amount - entryFee, position });
  }

  function closePaperPosition(account, options) {
    if (!account || !account.position) throw new Error('لا يوجد مركز ورقي لإغلاقه.');
    const opts = options || {};
    if (opts.source !== SOURCE) throw new Error('يلزم سعر إغلاق حقيقي من Binance Spot.');
    const position = account.position;
    if (position.source !== SOURCE) throw new Error('مصدر المركز غير موثوق.');
    const price = finitePositive(opts.price, 'سعر Binance');
    const exitPrice = price * (1 - account.slippageRate);
    const grossProceeds = position.quantity * exitPrice;
    const exitFee = grossProceeds * account.feeRate;
    const totalFees = position.entryFee + exitFee;
    const pnl = grossProceeds - exitFee - position.amount - position.entryFee;
    const slippageUsd = Math.max(0, position.amount - position.quantity * (position.entryPrice / (1 + account.slippageRate))) +
      Math.max(0, position.quantity * price - grossProceeds);
    const closedAt = Number(opts.now == null ? Date.now() : opts.now);
    if (!Number.isFinite(closedAt) || closedAt <= 0) throw new Error('وقت إغلاق المركز غير صالح.');
    const trade = {
      id: String(closedAt) + '-' + (account.history || []).length,
      symbol: position.symbol,
      interval: position.interval,
      strategy: position.strategy,
      amount: position.amount,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice,
      fees: totalFees,
      slippage: slippageUsd,
      pnl,
      openedAt: position.openedAt,
      closedAt,
      source: SOURCE,
      reason: String(opts.reason || '')
    };
    return Object.assign({}, account, {
      cash: account.cash + grossProceeds - exitFee,
      position: null,
      history: [trade].concat(Array.isArray(account.history) ? account.history : [])
    });
  }

  function portfolio(account, currentPrice, source) {
    if (!account || typeof account !== 'object') throw new Error('حالة المحفظة غير صالحة.');
    let markedPosition = 0;
    if (account.position) {
      if (source !== SOURCE || account.position.source !== SOURCE) throw new Error('تقييم المركز يتطلب آخر سعر حقيقي من Binance Spot.');
      const price = finitePositive(currentPrice, 'سعر Binance');
      const expectedExitPrice = price * (1 - account.slippageRate);
      markedPosition = account.position.quantity * expectedExitPrice * (1 - account.feeRate);
    }
    const equity = account.cash + markedPosition;
    const history = Array.isArray(account.history) ? account.history : [];
    const realizedPnl = history.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
    const wins = history.filter((trade) => Number(trade.pnl) > 0).length;
    return {
      cash: account.cash,
      equity,
      totalPnl: equity - account.startingCapital,
      realizedPnl,
      tradeCount: history.length,
      trades: history.length,
      winRate: history.length ? wins / history.length * 100 : null
    };
  }

  function liquidationEquity(account, price) {
    return portfolio(account, price, SOURCE).equity;
  }

  function riskSizedAmount(account) {
    const riskPerDollar = amountRisk(account, 1);
    if (riskPerDollar <= 0) return 0;
    const byRisk = account.startingCapital * account.maxRiskPct / riskPerDollar;
    const byCash = account.cash / (1 + account.feeRate);
    return roundCents(Math.min(account.maxTradeUsd, byCash, byRisk));
  }

  function exitAtCandle(position, candle) {
    if (candle.open <= position.stopPrice) return candle.open;
    if (candle.open >= position.targetPrice) return candle.open;
    const stopTouched = candle.low <= position.stopPrice;
    const targetTouched = candle.high >= position.targetPrice;
    if (stopTouched && targetTouched) return position.stopPrice;
    if (stopTouched) return position.stopPrice;
    if (targetTouched) return position.targetPrice;
    return null;
  }

  function maxGapCount(candles) {
    const intervalMs = INTERVALS[candles[0].interval];
    let count = 0;
    for (let index = 1; index < candles.length; index += 1) {
      if (candles[index].openTime - candles[index - 1].openTime !== intervalMs) count += 1;
    }
    return count;
  }

  function runSegment(candles, indicators, startIndex, endIndex, strategy, options) {
    const opts = options || {};
    let account = createAccount({
      startingCapital: opts.startingCapital,
      maxTradeUsd: opts.maxTradeUsd,
      maxRiskPct: opts.maxRiskPct,
      feeRate: opts.feeRate,
      slippageRate: opts.slippageRate,
      stopLossPct: opts.stopLossPct
    });
    const firstTradable = Math.max(60, startIndex);
    let highWater = account.startingCapital;
    let maxDrawdownUsd = 0;
    let maxDrawdownPct = 0;
    const updateDrawdown = (equity) => {
      highWater = Math.max(highWater, equity);
      const drawdown = Math.max(0, highWater - equity);
      maxDrawdownUsd = Math.max(maxDrawdownUsd, drawdown);
      if (highWater > 0) maxDrawdownPct = Math.max(maxDrawdownPct, drawdown / highWater * 100);
    };
    for (let index = firstTradable; index < endIndex; index += 1) {
      const candle = candles[index];
      const signal = signalAt(candles, indicators, index, strategy);
      if (account.position) {
        const exitPrice = exitAtCandle(account.position, candle);
        if (exitPrice != null) account = closePaperPosition(account, { price: exitPrice, now: candle.closeTime, source: SOURCE, reason: 'وقف أو هدف ورقي' });
      }
      updateDrawdown(liquidationEquity(account, candle.close));
      const nextCandle = index + 1 < endIndex ? candles[index + 1] : null;
      if (account.position && signal.action === 'sell' && nextCandle) {
        account = closePaperPosition(account, { price: nextCandle.open, now: nextCandle.openTime, source: SOURCE, reason: 'إشارة خروج بعد الإغلاق' });
        updateDrawdown(liquidationEquity(account, nextCandle.open));
      }
      if (!account.position && signal.action === 'buy' && nextCandle) {
        const amount = riskSizedAmount(account);
        if (amount >= 0.01) {
          account = openPaperPosition(account, {
            symbol: candle.symbol,
            interval: candle.interval,
            price: nextCandle.open,
            amount,
            strategy,
            source: SOURCE,
            now: nextCandle.openTime
          });
          updateDrawdown(liquidationEquity(account, nextCandle.open));
        }
      }
    }
    const lastCandle = candles[endIndex - 1];
    if (account.position) {
      account = closePaperPosition(account, { price: lastCandle.close, now: lastCandle.closeTime, source: SOURCE, reason: 'تصفية نهاية فترة الاختبار' });
      updateDrawdown(account.cash);
    }
    const equity = account.cash;
    const history = account.history;
    const wins = history.filter((trade) => trade.pnl > 0).length;
    const fees = history.reduce((sum, trade) => sum + trade.fees, 0);
    const slippage = history.reduce((sum, trade) => sum + trade.slippage, 0);
    return {
      startingCapital: account.startingCapital,
      finalEquity: equity,
      netPnl: equity - account.startingCapital,
      returnPct: (equity - account.startingCapital) / account.startingCapital * 100,
      winRate: history.length ? wins / history.length * 100 : null,
      tradeCount: history.length,
      wins,
      maxDrawdownUsd,
      maxDrawdownPct,
      fees,
      slippage,
      fromTime: candles[firstTradable].openTime,
      toTime: lastCandle.closeTime,
      fromIndex: firstTradable,
      toIndexExclusive: endIndex
    };
  }

  function runBacktest(candles, strategy, options) {
    const bars = assertSeries(candles, MIN_CANDLES);
    if (!STRATEGY_IDS.includes(strategy)) throw new Error('الاستراتيجية غير معروفة.');
    if (maxGapCount(bars) > 0) throw new Error('توجد فجوات في الشموع التاريخية؛ أعد جلب البيانات قبل الاختبار.');
    const opts = Object.assign({ startingCapital: 11, maxTradeUsd: 10, maxRiskPct: 0.01, feeRate: DEFAULT_FEE_RATE, slippageRate: DEFAULT_SLIPPAGE_RATE, stopLossPct: DEFAULT_STOP_LOSS_PCT }, options || {});
    createAccount(opts);
    if (bars.length < 200) throw new Error('اختبار زمني 70/30 يحتاج 200 شمعة Binance مغلقة على الأقل.');
    const split = Math.floor(bars.length * 0.7);
    if (split <= 60 || bars.length - split < 60) throw new Error('الفترة التاريخية لا تسمح بتقسيم 70/30 صالح.');
    const indicators = makeIndicatorSeries(bars);
    const development = runSegment(bars, indicators, 60, split, strategy, opts);
    const evaluation = runSegment(bars, indicators, split, bars.length, strategy, opts);
    return {
      source: SOURCE,
      symbol: bars[0].symbol,
      interval: bars[0].interval,
      sampleCount: bars.length,
      splitPct: 70,
      evaluationPct: 30,
      splitIndex: split,
      warmupCandles: 60,
      development,
      evaluation,
      assumptions: { feeRate: opts.feeRate, slippageRate: opts.slippageRate, stopLossPct: opts.stopLossPct, maxRiskPct: opts.maxRiskPct }
    };
  }

  function compareStrategies(candles, options) {
    return STRATEGY_IDS.map((strategy) => {
      const result = runBacktest(candles, strategy, options);
      return { strategy, symbol: result.symbol, interval: result.interval, sampleCount: result.sampleCount, development: result.development, evaluation: result.evaluation, source: SOURCE };
    });
  }

  root.DrakPaperEngine = Object.freeze({
    SOURCE,
    SYMBOLS,
    INTERVALS,
    STRATEGY_IDS,
    normalizeKlines,
    validateCandles,
    analyze,
    analyzeAt,
    makeIndicatorSeries,
    createAccount,
    openPaperPosition,
    closePaperPosition,
    portfolio,
    runBacktest,
    compareStrategies
  });
})(typeof window !== 'undefined' ? window : globalThis);
