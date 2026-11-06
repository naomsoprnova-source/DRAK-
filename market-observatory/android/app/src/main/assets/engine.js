(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    initialCapital: 11,
    maxPosition: 5,
    feeRate: 0.001,
    slippageRate: 0.0005,
    riskPct: 0.01,
    rewardRisk: 2,
    atrMultiple: 1.5
  });
  const STRATEGIES = Object.freeze([
    { id: "ema_cross", name: "تقاطع المتوسطات EMA", description: "إشارة عند عبور EMA 9 فوق EMA 21 بعد إغلاق الشمعة، ووقف ATR وهدف بنسبة عائد/مخاطرة 2:1." },
    { id: "rsi_recovery", name: "تعافي RSI", description: "إشارة عندما يتعافى RSI 14 صعوداً عبر 35 مع بقاء الإغلاق فوق SMA 50." },
    { id: "breakout", name: "اختراق 20 شمعة", description: "إشارة عند إغلاق السعر أعلى أعلى قمة للشموع العشرين السابقة بعد إغلاق سابق دون المستوى." }
  ]);

  function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(label + " غير صالح.");
    return number;
  }
  function positive(value, label) {
    const number = finite(value, label);
    if (number <= 0) throw new RangeError(label + " يجب أن يكون أكبر من صفر.");
    return number;
  }
  function settingsOf(settings) {
    const value = Object.assign({}, DEFAULTS, settings || {});
    value.initialCapital = positive(value.initialCapital, "رأس المال");
    value.maxPosition = positive(value.maxPosition, "حد المركز");
    value.feeRate = finite(value.feeRate, "نسبة الرسوم");
    value.slippageRate = finite(value.slippageRate, "نسبة الانزلاق");
    value.riskPct = finite(value.riskPct, "نسبة المخاطرة");
    value.rewardRisk = positive(value.rewardRisk, "مضاعف الهدف");
    value.atrMultiple = positive(value.atrMultiple, "مضاعف ATR");
    if (value.maxPosition > value.initialCapital) value.maxPosition = value.initialCapital;
    if (value.feeRate < 0 || value.feeRate > 0.02 || value.slippageRate < 0 || value.slippageRate > 0.02 || value.riskPct <= 0 || value.riskPct > 0.05) {
      throw new RangeError("إعدادات التكلفة أو المخاطرة خارج الحدود المسموحة.");
    }
    return value;
  }
  function validateCandles(candles) {
    if (!Array.isArray(candles)) throw new TypeError("قائمة الشموع غير صالحة.");
    for (const candle of candles) {
      if (!candle || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
        candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
        candle.high < Math.max(candle.open, candle.close, candle.low) || candle.low > Math.min(candle.open, candle.close, candle.high)) {
        throw new TypeError("بيانات OHLC غير صالحة.");
      }
    }
  }
  function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
  function emaAt(values, period, index) {
    if (index + 1 < period) return NaN;
    const alpha = 2 / (period + 1);
    let value = mean(values.slice(0, period));
    for (let i = period; i <= index; i += 1) value = values[i] * alpha + value * (1 - alpha);
    return value;
  }
  function smaAt(values, period, index) {
    if (index + 1 < period) return NaN;
    return mean(values.slice(index + 1 - period, index + 1));
  }
  function rsiAt(values, period, index) {
    if (index < period) return NaN;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const delta = values[i] - values[i - 1];
      gains += Math.max(delta, 0);
      losses += Math.max(-delta, 0);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i <= index; i += 1) {
      const delta = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    }
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    if (avgGain === 0) return 0;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }
  function atrAt(candles, period, index) {
    if (index < period) return NaN;
    const ranges = [];
    for (let i = 1; i <= index; i += 1) {
      const c = candles[i];
      const prev = candles[i - 1].close;
      ranges.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
    }
    let value = mean(ranges.slice(0, period));
    for (let i = period; i < ranges.length; i += 1) value = (value * (period - 1) + ranges[i]) / period;
    return value;
  }
  function highestHigh(candles, start, end) {
    let high = -Infinity;
    for (let i = start; i <= end; i += 1) high = Math.max(high, candles[i].high);
    return high;
  }
  function strategySignal(candles, strategyId, index, closes) {
    if (index < 1) return { signal: false, reason: "تاريخ غير كافٍ لتأكيد إشارة مغلقة." };
    if (strategyId === "ema_cross") {
      const before = emaAt(closes, 9, index - 1) <= emaAt(closes, 21, index - 1);
      const crossed = emaAt(closes, 9, index) > emaAt(closes, 21, index);
      return { signal: before && crossed, reason: before && crossed ? "أغلق EMA 9 أعلى EMA 21." : "لا يوجد تقاطع صعودي جديد بين EMA 9 وEMA 21." };
    }
    if (strategyId === "rsi_recovery") {
      const previous = rsiAt(closes, 14, index - 1);
      const current = rsiAt(closes, 14, index);
      const trend = smaAt(closes, 50, index);
      const crossed = previous < 35 && current >= 35 && closes[index] > trend;
      return { signal: crossed, reason: crossed ? "تعافى RSI عبر 35 والإغلاق فوق SMA 50." : "لم يجتمع تعافي RSI عبر 35 مع اتجاه SMA 50." };
    }
    if (strategyId === "breakout") {
      if (index < 20) return { signal: false, reason: "يلزم 20 إغلاقاً سابقاً على الأقل." };
      const previousTop = highestHigh(candles, index - 20, index - 1);
      const priorTop = highestHigh(candles, index - 21, index - 2);
      const crossed = closes[index] > previousTop && closes[index - 1] <= priorTop;
      return { signal: crossed, reason: crossed ? "أغلق السعر فوق أعلى قمة للشموع العشرين السابقة." : "لا يوجد إغلاق اختراق جديد فوق قمة العشرين شمعة." };
    }
    throw new TypeError("الاستراتيجية غير معروفة.");
  }
  function planFor(entry, atr, config) {
    const distance = atr * config.atrMultiple;
    const stopPrice = entry - distance;
    const targetPrice = entry + distance * config.rewardRisk;
    if (!Number.isFinite(distance) || distance <= 0 || stopPrice <= 0 || targetPrice <= entry) {
      throw new RangeError("تعذر تحديد وقف وهدف صالحين من التذبذب الحالي.");
    }
    return { entryPrice: entry, stopPrice, targetPrice, riskDistance: distance };
  }
  function sizing(entry, stop, cash, config, liquidityCap) {
    const riskBudget = Math.max(0, Math.min(config.initialCapital, cash) * config.riskPct);
    const roundTripPerUnit = (entry - stop) + (entry + stop) * config.feeRate + 2 * entry * config.slippageRate;
    if (riskBudget <= 0 || roundTripPerUnit <= 0) return { quantity: 0, notional: 0, riskBudget: 0 };
    const qtyByRisk = riskBudget / roundTripPerUnit;
    const marketCap = Number.isFinite(liquidityCap) ? Math.max(0, liquidityCap) : Infinity;
    const notionalCap = Math.min(config.maxPosition, cash / (1 + config.feeRate), marketCap);
    const quantity = Math.max(0, Math.min(qtyByRisk, notionalCap / entry));
    return { quantity, notional: quantity * entry, riskBudget };
  }
  function analyze(candles, strategyId, settings) {
    validateCandles(candles);
    const config = settingsOf(settings);
    const strategy = STRATEGIES.find((item) => item.id === strategyId);
    if (!strategy) throw new TypeError("الاستراتيجية غير معروفة.");
    if (candles.length < 55) return { ready: false, signal: false, signalLabel: "بيانات غير كافية", reason: "يلزم 55 شمعة مكتملة على الأقل للمؤشرات المطلوبة.", strategy: strategy.name };
    const closes = candles.map((candle) => candle.close);
    const index = candles.length - 1;
    const candle = candles[index];
    const atr = atrAt(candles, 14, index);
    const outcome = strategySignal(candles, strategyId, index, closes);
    let levels;
    try { levels = planFor(candle.close, atr, config); }
    catch (_) { return { ready: false, signal: false, signalLabel: "لا توجد مستويات صالحة", reason: "تعذر حساب مستويات المخاطر من البيانات الحالية.", strategy: strategy.name }; }
    const size = sizing(levels.entryPrice, levels.stopPrice, config.initialCapital, config);
    const estimatedEntryFee = levels.entryPrice * size.quantity * config.feeRate;
    const estimatedExitFee = levels.targetPrice * size.quantity * config.feeRate;
    const estimatedSlippage = size.quantity * (levels.entryPrice + levels.targetPrice) * config.slippageRate;
    return {
      ready: true, signal: outcome.signal, signalLabel: outcome.signal ? "إشارة شراء ورقية" : "انتظار — لا توجد إشارة مؤكدة",
      reason: outcome.reason, strategy: strategy.name, strategyId, price: candle.close,
      rsi: rsiAt(closes, 14, index), atr, sma50: smaAt(closes, 50, index),
      entryPrice: levels.entryPrice, stopPrice: levels.stopPrice, targetPrice: levels.targetPrice,
      rewardRisk: config.rewardRisk, quantity: size.quantity, notional: size.notional,
      riskBudget: size.riskBudget, estimatedFees: estimatedEntryFee + estimatedExitFee,
      estimatedSlippage, candleTime: candle.closeTime
    };
  }
  function createPortfolio(capital) {
    const value = capital === undefined ? DEFAULTS.initialCapital : positive(capital, "رأس المال");
    return { startingCapital: value, cash: value, realizedPnl: 0, position: null, history: [] };
  }
  function clonePortfolio(portfolio) {
    if (!portfolio || !Number.isFinite(portfolio.cash) || !Array.isArray(portfolio.history)) throw new TypeError("المحفظة الورقية غير صالحة.");
    return Object.assign({}, portfolio, { position: portfolio.position ? Object.assign({}, portfolio.position) : null, history: portfolio.history.slice() });
  }
  function openPosition(portfolio, analysis, settings, context) {
    const next = clonePortfolio(portfolio);
    const config = settingsOf(settings);
    if (next.position) throw new Error("يوجد مركز ورقي مفتوح بالفعل.");
    if (!analysis || !analysis.ready) throw new Error("لا يوجد تحليل مكتمل لفتح محاكاة.");
    const marketPrice = positive(context && context.price !== undefined ? context.price : analysis.price, "سعر السوق");
    const stopPrice = positive(analysis.stopPrice, "وقف الخسارة");
    const targetPrice = positive(analysis.targetPrice, "الهدف");
    const entryPrice = marketPrice * (1 + config.slippageRate);
    if (stopPrice >= entryPrice || targetPrice <= entryPrice) throw new RangeError("مستويات الوقف والهدف لا تناسب سعر الدخول.");
    const liquidityLimits = [context && context.liquidityUsd, context && context.availableLiquidityUsd]
      .filter((value) => value !== undefined)
      .map((value) => finite(value, "السيولة المتاحة"));
    if (liquidityLimits.some((value) => value < 0)) throw new RangeError("السيولة المتاحة لا يمكن أن تكون سالبة.");
    const liquidityCap = liquidityLimits.length ? Math.min.apply(null, liquidityLimits) : Infinity;
    const size = sizing(entryPrice, stopPrice, next.cash, config, liquidityCap);
    const quantity = size.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("الرصيد أو ميزانية المخاطرة لا تسمح بمركز ورقي.");
    const notional = quantity * entryPrice;
    const entryFee = notional * config.feeRate;
    if (notional > config.maxPosition + 1e-8 || notional + entryFee > next.cash + 1e-8) throw new Error("تجاوز المركز حدود الرصيد أو الحجم المسموح.");
    next.cash -= notional + entryFee;
    next.position = {
      strategy: analysis.strategy || "غير محددة", symbol: String((context && context.symbol) || "BTCUSDT"),
      quantity, entryPrice, marketEntryPrice: marketPrice, notional, entryFee,
      stopPrice, targetPrice, openedAt: Number((context && context.time) || Date.now()),
      signalIndex: context && Number.isInteger(context.signalIndex) ? context.signalIndex : undefined,
      entryIndex: context && Number.isInteger(context.entryIndex) ? context.entryIndex : undefined
    };
    return { portfolio: next, position: Object.assign({}, next.position) };
  }
  function closePosition(portfolio, marketPrice, settings, context) {
    const next = clonePortfolio(portfolio);
    const config = settingsOf(settings);
    if (!next.position) throw new Error("لا يوجد مركز ورقي مفتوح لإغلاقه.");
    const position = next.position;
    const rawExit = positive(marketPrice, "سعر الخروج");
    const exitPrice = rawExit * (1 - config.slippageRate);
    const exitNotional = position.quantity * exitPrice;
    const exitFee = exitNotional * config.feeRate;
    const grossPnl = position.quantity * (exitPrice - position.entryPrice);
    const fees = position.entryFee + exitFee;
    const trade = {
      symbol: position.symbol, strategy: position.strategy, quantity: position.quantity,
      entryPrice: position.entryPrice, marketEntryPrice: position.marketEntryPrice, exitPrice,
      stopLoss: position.stopPrice, takeProfit: position.targetPrice,
      signalIndex: position.signalIndex, entryIndex: position.entryIndex,
      entryFee: position.entryFee, exitFee,
      fees, grossPnl, netPnl: grossPnl - fees,
      openedAt: position.openedAt, closedAt: Number((context && context.time) || Date.now()),
      reason: String((context && context.reason) || "إغلاق ورقي يدوي"),
      exitReason: String((context && context.exitType) || "manual")
    };
    next.cash += exitNotional - exitFee;
    next.realizedPnl += trade.netPnl;
    next.position = null;
    next.history = next.history.concat(trade);
    return { portfolio: next, trade };
  }
  function backtest(candles, strategyId, settings) {
    validateCandles(candles);
    const config = settingsOf(settings);
    if (!STRATEGIES.some((item) => item.id === strategyId)) throw new TypeError("الاستراتيجية غير معروفة.");
    const startingCapital = config.initialCapital;
    const result = { strategyId, candleCount: candles.length, tradeCount: 0, wins: 0, losses: 0,
      grossPnl: 0, fees: 0, netPnl: 0, endCapital: startingCapital, returnPct: 0,
      maxDrawdown: 0, trades: [], note: "اختبار تاريخي وصفي؛ لا يثبت أداءً مستقبلياً أو ربحية." };
    if (candles.length < 55) return result;
    let portfolio = createPortfolio(startingCapital);
    let peak = startingCapital;
    let maxDrawdown = 0;
    const closes = candles.map((candle) => candle.close);
    for (let i = 50; i < candles.length; i += 1) {
      const candle = candles[i];
      if (portfolio.position) {
        const stopHit = candle.low <= portfolio.position.stopPrice;
        const targetHit = candle.high >= portfolio.position.targetPrice;
        if (stopHit || targetHit) {
          // Conservative bar-only assumption: if both levels touched, stop is assumed first.
          const exitPrice = stopHit ? portfolio.position.stopPrice : portfolio.position.targetPrice;
          const closed = closePosition(portfolio, exitPrice, config, {
            time: candle.closeTime,
            reason: stopHit ? "وقف الخسارة" : "الهدف",
            exitType: stopHit ? "stop" : "target"
          });
          portfolio = closed.portfolio;
          result.trades.push(Object.assign({ exitIndex: i }, closed.trade));
        }
      }
      if (!portfolio.position && i < candles.length - 1) {
        const outcome = strategySignal(candles, strategyId, i, closes);
        if (outcome.signal) {
          const nextCandle = candles[i + 1];
          try {
            const levels = planFor(nextCandle.open, atrAt(candles, 14, i), config);
            const analysis = { ready: true, price: nextCandle.open, strategy: STRATEGIES.find((x) => x.id === strategyId).name,
              stopPrice: levels.stopPrice, targetPrice: levels.targetPrice };
            const opened = openPosition(portfolio, analysis, config, {
              price: nextCandle.open, time: nextCandle.time,
              signalIndex: i, entryIndex: i + 1
            });
            portfolio = opened.portfolio;
            portfolio.position.signalTime = candle.closeTime;
            portfolio.position.entryTime = nextCandle.time;
          } catch (_) { /* Insufficient paper balance is a skipped simulated entry. */ }
        }
      }
      const equity = portfolio.cash + (portfolio.position ? portfolio.position.quantity * candle.close : 0);
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
    if (portfolio.position) {
      const last = candles[candles.length - 1];
      const closed = closePosition(portfolio, last.close, config, { time: last.closeTime, reason: "إغلاق نهاية فترة الاختبار" });
      portfolio = closed.portfolio;
      result.trades.push(Object.assign({ exitIndex: candles.length - 1 }, closed.trade));
    }
    result.tradeCount = result.trades.length;
    result.grossPnl = result.trades.reduce((sum, trade) => sum + trade.grossPnl, 0);
    result.fees = result.trades.reduce((sum, trade) => sum + trade.fees, 0);
    result.netPnl = result.trades.reduce((sum, trade) => sum + trade.netPnl, 0);
    result.wins = result.trades.filter((trade) => trade.netPnl > 0).length;
    result.losses = result.trades.filter((trade) => trade.netPnl <= 0).length;
    result.endCapital = portfolio.cash;
    result.returnPct = ((result.endCapital - startingCapital) / startingCapital) * 100;
    result.maxDrawdown = maxDrawdown;
    return result;
  }

  const api = { DEFAULTS, STRATEGIES, analyze, createPortfolio, openPosition, closePosition, backtest };
  root.PaperEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
