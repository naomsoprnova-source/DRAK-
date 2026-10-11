(() => {
  'use strict';

  const RULES = Object.freeze({
    fast: 9, mid: 21, slow: 50, rsi: 14, atr: 14, adx: 14,
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    volume: 20, stochastic: 14, stochasticSignal: 3, bollinger: 20,
    sarStep: 0.02, sarMax: 0.2, superTrendAtr: 10, superTrendMultiplier: 3,
    stopAtr: 1.5, targetR: 2, minScore: 5, maxScore: 7, adxMin: 18
  });

  function ema(values, period) {
    const result = Array(values.length).fill(null);
    if (!Number.isInteger(period) || period < 1 || values.length < period) return result;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      if (!Number.isFinite(values[i])) return result;
      sum += values[i];
    }
    let previous = sum / period;
    result[period - 1] = previous;
    const alpha = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      if (!Number.isFinite(values[i])) continue;
      previous = values[i] * alpha + previous * (1 - alpha);
      result[i] = previous;
    }
    return result;
  }

  function rsi(values, period = 14) {
    const result = Array(values.length).fill(null);
    if (!Number.isInteger(period) || period < 1 || values.length <= period) return result;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      if (change > 0) gain += change;
      else loss -= change;
    }
    let averageGain = gain / period, averageLoss = loss / period;
    const value = () => averageGain === 0 && averageLoss === 0 ? 50 : averageLoss === 0 ? 100 : averageGain === 0 ? 0 : 100 - 100 / (1 + averageGain / averageLoss);
    result[period] = value();
    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
      result[i] = value();
    }
    return result;
  }

  function trueRanges(candles) {
    return candles.map((bar, i) => i === 0
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - candles[i - 1].close), Math.abs(bar.low - candles[i - 1].close)));
  }

  function atr(candles, period = 14) {
    const result = Array(candles.length).fill(null);
    if (!Number.isInteger(period) || period < 1 || candles.length < period) return result;
    const ranges = trueRanges(candles);
    let previous = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    result[period - 1] = previous;
    for (let i = period; i < candles.length; i++) {
      previous = (previous * (period - 1) + ranges[i]) / period;
      result[i] = previous;
    }
    return result;
  }

  function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fast = ema(values, fastPeriod), slow = ema(values, slowPeriod);
    const line = Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      if (Number.isFinite(fast[i]) && Number.isFinite(slow[i])) line[i] = fast[i] - slow[i];
    }
    const first = line.findIndex(Number.isFinite);
    const compact = first < 0 ? [] : line.slice(first).filter(Number.isFinite);
    const compactSignal = ema(compact, signalPeriod);
    const signal = Array(values.length).fill(null), histogram = Array(values.length).fill(null);
    for (let i = 0; i < compactSignal.length; i++) {
      const index = first + i;
      if (Number.isFinite(compactSignal[i]) && Number.isFinite(line[index])) {
        signal[index] = compactSignal[i];
        histogram[index] = line[index] - compactSignal[i];
      }
    }
    return {line, signal, histogram};
  }

  function volumeSignal(volume, average) {
    const valid = Number.isFinite(volume) && volume >= 0 && Number.isFinite(average) && average >= 0;
    return {
      actual: Number.isFinite(volume) ? volume : null,
      average: Number.isFinite(average) ? average : null,
      ratio: valid && average > 0 ? volume / average : null,
      direction: valid ? (volume > average ? 1 : -1) : 0
    };
  }

  function volumeStats(candles, period = 20) {
    const average = Array(candles.length).fill(null), ratio = Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      const volume = Number(candles[i].volume);
      if (!Number.isFinite(volume) || volume < 0) continue;
      sum += volume;
      if (i >= period) sum -= Number(candles[i - period].volume) || 0;
      if (i >= period - 1) {
        average[i] = sum / period;
        ratio[i] = volumeSignal(volume, average[i]).ratio;
      }
    }
    return {average, ratio};
  }

  function obv(candles) {
    const values = Array(candles.length).fill(null);
    if (!candles.length) return values;
    values[0] = Number(candles[0].volume) || 0;
    for (let i = 1; i < candles.length; i++) {
      const volume = Number(candles[i].volume) || 0;
      values[i] = values[i - 1] + (candles[i].close > candles[i - 1].close ? volume : candles[i].close < candles[i - 1].close ? -volume : 0);
    }
    return values;
  }

  function adx(candles, period = 14) {
    const result = Array(candles.length).fill(null);
    if (!Number.isInteger(period) || period < 2 || candles.length < period * 2) return result;
    const tr = Array(candles.length).fill(0), plus = Array(candles.length).fill(0), minus = Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i], previous = candles[i - 1];
      tr[i] = Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
      const up = current.high - previous.high, down = previous.low - current.low;
      plus[i] = up > down && up > 0 ? up : 0;
      minus[i] = down > up && down > 0 ? down : 0;
    }
    let smoothTr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
    let smoothPlus = plus.slice(1, period + 1).reduce((a, b) => a + b, 0);
    let smoothMinus = minus.slice(1, period + 1).reduce((a, b) => a + b, 0);
    const dxValues = [];
    let previousAdx = null;
    for (let i = period; i < candles.length; i++) {
      if (i > period) {
        smoothTr = smoothTr - smoothTr / period + tr[i];
        smoothPlus = smoothPlus - smoothPlus / period + plus[i];
        smoothMinus = smoothMinus - smoothMinus / period + minus[i];
      }
      if (!(smoothTr > 0)) continue;
      const plusDi = 100 * smoothPlus / smoothTr, minusDi = 100 * smoothMinus / smoothTr;
      const denominator = plusDi + minusDi;
      const dx = denominator > 0 ? 100 * Math.abs(plusDi - minusDi) / denominator : 0;
      if (dxValues.length < period) {
        dxValues.push(dx);
        if (dxValues.length === period) {
          previousAdx = dxValues.reduce((a, b) => a + b, 0) / period;
          result[i] = previousAdx;
        }
      } else {
        previousAdx = (previousAdx * (period - 1) + dx) / period;
        result[i] = previousAdx;
      }
    }
    return result;
  }

  function stochastic(candles, period = 14, signalPeriod = 3) {
    const k = Array(candles.length).fill(null), d = Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i++) {
      const window = candles.slice(i - period + 1, i + 1);
      const highest = Math.max(...window.map(bar => bar.high)), lowest = Math.min(...window.map(bar => bar.low));
      k[i] = highest === lowest ? 50 : 100 * (candles[i].close - lowest) / (highest - lowest);
      if (i >= period + signalPeriod - 2) {
        const sample = k.slice(i - signalPeriod + 1, i + 1);
        if (sample.every(Number.isFinite)) d[i] = sample.reduce((a, b) => a + b, 0) / signalPeriod;
      }
    }
    return {k, d};
  }

  function bollinger(values, period = 20, multiplier = 2) {
    const middle = Array(values.length).fill(null), upper = Array(values.length).fill(null), lower = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1), mean = window.reduce((a, b) => a + b, 0) / period;
      const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
      const deviation = Math.sqrt(variance);
      middle[i] = mean; upper[i] = mean + multiplier * deviation; lower[i] = mean - multiplier * deviation;
    }
    return {middle, upper, lower};
  }

  function parabolicSar(candles, step = 0.02, maxStep = 0.2) {
    const value = Array(candles.length).fill(null), direction = Array(candles.length).fill(null);
    if (candles.length < 2) return {value, direction};
    let uptrend = candles[1].close >= candles[0].close;
    let extreme = uptrend ? Math.max(candles[0].high, candles[1].high) : Math.min(candles[0].low, candles[1].low);
    let acceleration = step;
    value[0] = uptrend ? candles[0].low : candles[0].high;
    direction[0] = uptrend ? 1 : -1;
    for (let i = 1; i < candles.length; i++) {
      let sar = value[i - 1] + acceleration * (extreme - value[i - 1]);
      if (uptrend) {
        sar = Math.min(sar, candles[i - 1].low, i > 1 ? candles[i - 2].low : candles[i - 1].low);
        if (candles[i].low < sar) {
          uptrend = false; sar = extreme; extreme = candles[i].low; acceleration = step;
        } else if (candles[i].high > extreme) {
          extreme = candles[i].high; acceleration = Math.min(maxStep, acceleration + step);
        }
      } else {
        sar = Math.max(sar, candles[i - 1].high, i > 1 ? candles[i - 2].high : candles[i - 1].high);
        if (candles[i].high > sar) {
          uptrend = true; sar = extreme; extreme = candles[i].high; acceleration = step;
        } else if (candles[i].low < extreme) {
          extreme = candles[i].low; acceleration = Math.min(maxStep, acceleration + step);
        }
      }
      value[i] = sar; direction[i] = uptrend ? 1 : -1;
    }
    return {value, direction};
  }

  function superTrend(candles, period = 10, multiplier = 3) {
    const volatility = atr(candles, period);
    const value = Array(candles.length).fill(null), direction = Array(candles.length).fill(null);
    const upper = Array(candles.length).fill(null), lower = Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
      if (!Number.isFinite(volatility[i])) continue;
      const midpoint = (candles[i].high + candles[i].low) / 2;
      const basicUpper = midpoint + multiplier * volatility[i], basicLower = midpoint - multiplier * volatility[i];
      if (i === 0 || !Number.isFinite(upper[i - 1])) {
        upper[i] = basicUpper; lower[i] = basicLower; direction[i] = 1; value[i] = basicLower;
        continue;
      }
      const previousClose = candles[i - 1].close;
      upper[i] = basicUpper < upper[i - 1] || previousClose > upper[i - 1] ? basicUpper : upper[i - 1];
      lower[i] = basicLower > lower[i - 1] || previousClose < lower[i - 1] ? basicLower : lower[i - 1];
      const previousDirection = direction[i - 1] || 1;
      direction[i] = previousDirection === 1 && candles[i].close < lower[i] ? -1
        : previousDirection === -1 && candles[i].close > upper[i] ? 1 : previousDirection;
      value[i] = direction[i] === 1 ? lower[i] : upper[i];
    }
    return {value, direction, upper, lower};
  }

  function indicatorsFor(candles) {
    const closes = candles.map(bar => bar.close);
    const macdValues = macd(closes, RULES.macdFast, RULES.macdSlow, RULES.macdSignal);
    const volumes = volumeStats(candles, RULES.volume);
    const obvValues = obv(candles);
    const obvSlope = obvValues.map((value, i) => i >= 5 && Number.isFinite(value) ? value - obvValues[i - 5] : null);
    const stoch = stochastic(candles, RULES.stochastic, RULES.stochasticSignal);
    const bands = bollinger(closes, RULES.bollinger, 2);
    const sar = parabolicSar(candles, RULES.sarStep, RULES.sarMax);
    const trend = superTrend(candles, RULES.superTrendAtr, RULES.superTrendMultiplier);
    return {
      fast: ema(closes, RULES.fast), mid: ema(closes, RULES.mid), slow: ema(closes, RULES.slow),
      rsi: rsi(closes, RULES.rsi), atr: atr(candles, RULES.atr), adx: adx(candles, RULES.adx),
      macdLine: macdValues.line, macdSignal: macdValues.signal, macdHistogram: macdValues.histogram,
      volumeAverage: volumes.average, volumeRatio: volumes.ratio, obv: obvValues, obvSlope,
      stochasticK: stoch.k, stochasticD: stoch.d,
      bollingerMiddle: bands.middle, bollingerUpper: bands.upper, bollingerLower: bands.lower,
      sar: sar.value, sarDirection: sar.direction,
      superTrend: trend.value, superTrendDirection: trend.direction
    };
  }

  function classify(candles, indicators, index) {
    const bar = candles[index];
    if (!bar) return {direction: 0, score: 0, maxScore: RULES.maxScore, trend: 'غير متاح', emaDirection: 0, independentVotes: [], reasons: ['لا توجد شمعة عند هذا الموضع.']};
    const keys = ['fast', 'mid', 'slow', 'rsi', 'atr', 'adx', 'macdLine', 'macdSignal', 'macdHistogram', 'superTrendDirection', 'obvSlope', 'volumeAverage'];
    if (!keys.every(key => Number.isFinite(indicators[key] && indicators[key][index]))) {
      return {direction: 0, score: 0, maxScore: RULES.maxScore, trend: 'البيانات غير كافية', emaDirection: 0, independentVotes: [], reasons: ['يلزم سجل كافٍ لحساب جميع المؤشرات.']};
    }
    const close = bar.close;
    const bullish = indicators.fast[index] > indicators.mid[index] && indicators.mid[index] > indicators.slow[index] && close > indicators.mid[index];
    const bearish = indicators.fast[index] < indicators.mid[index] && indicators.mid[index] < indicators.slow[index] && close < indicators.mid[index];
    const emaDirection = bullish ? 1 : bearish ? -1 : 0;
    const trend = bullish ? 'صاعد · EMA 9 > 21 > 50' : bearish ? 'هابط · EMA 9 < 21 < 50' : 'مختلط / نطاق عرضي';
    const volume = volumeSignal(bar.volume, indicators.volumeAverage[index]);
    const independentVotes = getIndependentVotes(candles, indicators, index);
    const score = emaDirection * 2 + independentVotes.reduce((sum, item) => sum + item.direction, 0);
    const reasons = [bullish ? 'ترتيب EMA صاعد (+2)' : bearish ? 'ترتيب EMA هابط (−2)' : 'ترتيب EMA غير متوافق (0)'];
    const voteDescriptions = {
      rsi: ['RSI يؤكد الزخم الهابط (−1)', 'RSI محايد/متطرف (0)', 'RSI يؤكد الزخم الصاعد (+1)'],
      macd: ['MACD يؤكد الهبوط (−1)', 'MACD لا يؤكد اتجاهًا (0)', 'MACD يؤكد الصعود (+1)'],
      supertrend: ['SuperTrend هابط (−1)', 'SuperTrend غير متوافق (0)', 'SuperTrend صاعد (+1)'],
      obv: ['OBV يؤكد تدفق البيع (−1)', 'OBV لا يؤكد الاتجاه (0)', 'OBV يؤكد تدفق الشراء (+1)'],
      volume: ['الحجم لا يتجاوز متوسط20 (−1)', 'بيانات الحجم غير متاحة (0)', 'الحجم أعلى من متوسط20 (+1)']
    };
    for (const item of independentVotes) reasons.push(voteDescriptions[item.key][item.direction + 1]);

    const strongTrend = indicators.adx[index] >= RULES.adxMin;
    const direction = strongTrend && bullish && score >= RULES.minScore ? 1 : strongTrend && bearish && score <= -RULES.minScore ? -1 : 0;
    return {direction, score, maxScore: RULES.maxScore, trend, reasons, bullish, bearish, strongTrend, volume,
      emaDirection, independentVotes};
  }

  function getIndependentVotes(candles, indicators, index) {
    const bar = candles[index];
    if (!bar) return [];
    const rsiValue = indicators.rsi && indicators.rsi[index];
    const macdValue = indicators.macdHistogram && indicators.macdHistogram[index];
    const superDirection = indicators.superTrendDirection && indicators.superTrendDirection[index];
    const obvSlope = indicators.obvSlope && indicators.obvSlope[index];
    const volumeAverage = indicators.volumeAverage && indicators.volumeAverage[index];
    const volume = volumeSignal(bar.volume, volumeAverage);
    const vote = (key, label, direction) => ({key, label, direction: Number.isFinite(direction) ? direction : 0});
    return [
      vote('rsi', 'RSI', Number.isFinite(rsiValue) && rsiValue > 50 && rsiValue < 70 ? 1 : Number.isFinite(rsiValue) && rsiValue > 30 && rsiValue < 50 ? -1 : 0),
      vote('macd', 'MACD', Number.isFinite(macdValue) ? Math.sign(macdValue) : 0),
      vote('supertrend', 'SuperTrend', Number.isFinite(superDirection) ? Math.sign(superDirection) : 0),
      vote('obv', 'OBV', Number.isFinite(obvSlope) ? Math.sign(obvSlope) : 0),
      vote('volume', 'الحجم', volume.direction)
    ];
  }

  function classifyStrategy(candles, indicators, index, strategy) {
    if (!['ema-gate', 'independent-votes'].includes(strategy)) throw new RangeError('نمط المقارنة غير مدعوم.');
    const bar = candles[index], votes = getIndependentVotes(candles, indicators, index);
    if (!bar || votes.length !== 5 || !Number.isFinite(indicators.adx && indicators.adx[index])) {
      return {direction: 0, score: 0, maxScore: 5, emaDirection: 0, bullishVotes: 0, bearishVotes: 0, reasons: ['البيانات غير كافية.']};
    }
    const emaBull = indicators.fast[index] > indicators.mid[index] && indicators.mid[index] > indicators.slow[index] && bar.close > indicators.mid[index];
    const emaBear = indicators.fast[index] < indicators.mid[index] && indicators.mid[index] < indicators.slow[index] && bar.close < indicators.mid[index];
    const emaDirection = emaBull ? 1 : emaBear ? -1 : 0;
    const bullishVotes = votes.filter(item => item.direction === 1).length;
    const bearishVotes = votes.filter(item => item.direction === -1).length;
    // Strategy A is explicitly long-only: only bullish EMA plus bullish votes can qualify.
    const alignedVotes = strategy === 'ema-gate'
      ? (emaDirection === 1 ? bullishVotes : 0)
      : (emaDirection === 1 ? bullishVotes : emaDirection === -1 ? bearishVotes : 0);
    const strongTrend = indicators.adx[index] >= RULES.adxMin;
    const direction = strategy === 'ema-gate'
      ? (strongTrend && emaDirection === 1 && alignedVotes >= 3 ? 1 : 0)
      : (strongTrend && emaDirection !== -1 && bullishVotes >= 3 ? 1 : 0);
    return {direction, score: strategy === 'ema-gate' ? emaDirection * alignedVotes : bullishVotes - bearishVotes,
      maxScore: 5, emaDirection, bullishVotes, bearishVotes, alignedVotes, strongTrend, votes,
      reasons: [strategy === 'ema-gate' ? 'بوابة EMA مع ثلاثة أصوات مستقلة متوافقة على الأقل.' : 'ثلاثة أصوات مستقلة متوافقة على الأقل دون بوابة EMA.']};
  }

  function normalizeCandles(raw) {
    if (!Array.isArray(raw)) throw new Error('استجابة مصدر البيانات ليست قائمة شموع صالحة.');
    const rows = raw.map(row => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const [time, open, high, low, close, volume] = row;
      const bar = {time: Number(time), open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume)};
      if (!Object.values(bar).every(Number.isFinite) || bar.time < 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) return null;
      return bar;
    }).filter(Boolean);
    const byTime = new Map(rows.map(bar => [bar.time, bar]));
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  function netPnlPerUnit(entry, exit, direction, feePerSide, slippagePerSide) {
    const entryFill = entry * (1 + direction * slippagePerSide);
    const exitFill = exit * (1 - direction * slippagePerSide);
    return (exitFill - entryFill) * direction - (entryFill + exitFill) * feePerSide;
  }

  function calculatePositionSize({equity, riskPct, entry, direction, stopDistance, feePerSide = 0.001, slippagePerSide = 0.0005, maxNotional = equity}) {
    if (![equity, riskPct, entry, stopDistance, feePerSide, slippagePerSide, maxNotional].every(Number.isFinite) || equity <= 0 || riskPct <= 0 || entry <= 0 || stopDistance <= 0 || ![-1, 1].includes(direction) || feePerSide < 0 || slippagePerSide < 0) return null;
    const riskBudget = equity * riskPct / 100;
    const stop = entry - direction * stopDistance;
    const lossPerUnit = Math.max(0, -netPnlPerUnit(entry, stop, direction, feePerSide, slippagePerSide));
    if (!(lossPerUnit > 0)) return null;
    const maxQuantity = Math.min(equity, maxNotional) / (entry * (1 + feePerSide + slippagePerSide));
    const quantity = Math.min(riskBudget / lossPerUnit, maxQuantity);
    return {quantity, riskBudget, stop, lossPerUnit, expectedStopLoss: quantity * lossPerUnit, notional: quantity * entry, cappedByCapital: quantity >= maxQuantity - Number.EPSILON};
  }

  function decimalPlaces(value) {
    const [coefficient, exponentText] = String(value).toLowerCase().split('e');
    const fractionLength = (coefficient.split('.')[1] || '').length;
    return Math.max(0, fractionLength - Number(exponentText || 0));
  }

  function applyOrderConstraints(sizing, entry, constraints) {
    if (!sizing || !constraints) return sizing;
    const precision = decimalPlaces(constraints.stepSize);
    let steps = Math.floor(sizing.quantity / constraints.stepSize);
    let quantity = Number((steps * constraints.stepSize).toFixed(precision));
    if (quantity > sizing.quantity) {
      steps = Math.max(0, steps - 1);
      quantity = Number((steps * constraints.stepSize).toFixed(precision));
    }
    const notional = quantity * entry;
    if (quantity < constraints.minQty || notional < constraints.minNotional) return null;
    return {...sizing, quantity, notional, expectedStopLoss: quantity * sizing.lossPerUnit};
  }

  function chooseExit(position, bar) {
    const {direction, stop, target} = position;
    if (direction === 1) {
      if (bar.open <= stop) return {price: bar.open, reason: 'gap-stop'};
      if (bar.open >= target) return {price: bar.open, reason: 'gap-target'};
      const stopHit = bar.low <= stop, targetHit = bar.high >= target;
      if (stopHit) return {price: stop, reason: targetHit ? 'same-bar-stop-first' : 'stop'};
      if (targetHit) return {price: target, reason: 'target'};
    } else {
      if (bar.open >= stop) return {price: bar.open, reason: 'gap-stop'};
      if (bar.open <= target) return {price: bar.open, reason: 'gap-target'};
      const stopHit = bar.high >= stop, targetHit = bar.low <= target;
      if (stopHit) return {price: stop, reason: targetHit ? 'same-bar-stop-first' : 'stop'};
      if (targetHit) return {price: target, reason: 'target'};
    }
    return null;
  }

  function validateBacktestOptions(options) {
    const config = {
      capital: options.capital ?? 30, riskPct: options.riskPct ?? 1,
      feePerSide: options.feePerSide ?? 0.001, slippagePerSide: options.slippagePerSide ?? 0.0005,
      startIndex: options.startIndex ?? 0, endIndex: options.endIndex, longOnly: options.longOnly !== false,
      strategy: options.strategy ?? 'combined', orderConstraints: options.orderConstraints ?? null
    };
    if (!Number.isFinite(config.capital) || config.capital <= 0) throw new RangeError('رأس المال يجب أن يكون موجبًا.');
    if (!Number.isFinite(config.riskPct) || config.riskPct <= 0 || config.riskPct > 100) throw new RangeError('نسبة المخاطرة خارج النطاق.');
    if (!Number.isFinite(config.feePerSide) || config.feePerSide < 0 || config.feePerSide > 0.1) throw new RangeError('رسوم الجهة خارج النطاق.');
    if (!Number.isFinite(config.slippagePerSide) || config.slippagePerSide < 0 || config.slippagePerSide > 0.1) throw new RangeError('الانزلاق السعري خارج النطاق.');
    if (!['combined', 'ema-gate', 'independent-votes'].includes(config.strategy)) throw new RangeError('نمط الاستراتيجية غير مدعوم.');
    if (config.orderConstraints !== null && (!config.orderConstraints ||
        ![config.orderConstraints.minQty, config.orderConstraints.stepSize, config.orderConstraints.minNotional].every(Number.isFinite) ||
        config.orderConstraints.minQty <= 0 || config.orderConstraints.stepSize <= 0 || config.orderConstraints.minNotional <= 0)) {
      throw new RangeError('قيود كمية الأمر المسجلة غير صالحة.');
    }
    return config;
  }

  function resolveIndicators(candles, precomputed) {
    if (precomputed === undefined || precomputed === null) return indicatorsFor(candles);
    const required = ['fast', 'mid', 'slow', 'rsi', 'atr', 'adx', 'macdLine', 'macdSignal', 'macdHistogram', 'superTrendDirection', 'obvSlope', 'volumeAverage', 'volumeRatio'];
    if (!precomputed || !required.every(key => Array.isArray(precomputed[key]) && precomputed[key].length === candles.length)) {
      throw new RangeError('طول مصفوفات المؤشرات لا يطابق بيانات الشموع.');
    }
    return precomputed;
  }

  function runBacktest(candles, options = {}, precomputedIndicators) {
    const config = validateBacktestOptions(options), indicators = resolveIndicators(candles, precomputedIndicators);
    const firstUsable = Math.max(RULES.slow - 1, RULES.rsi, RULES.atr - 1, RULES.adx * 2 - 1, RULES.macdSlow + RULES.macdSignal - 2, RULES.volume - 1);
    const start = Math.max(firstUsable, Math.floor(config.startIndex));
    const end = Math.min(candles.length, config.endIndex === undefined ? candles.length : Math.floor(config.endIndex));
    const trades = [];
    let position = null, equity = config.capital, peak = config.capital, maxDrawdown = 0, grossProfit = 0, grossLoss = 0, ignoredShortSignals = 0, rejectedByOrderFilters = 0;
    const trackEquity = marked => {
      if (!Number.isFinite(marked)) return;
      peak = Math.max(peak, marked);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - marked) / peak : (marked < peak ? 1 : 0));
    };
    const closePosition = (exitPrice, reason, index) => {
      const netPnl = position.quantity * netPnlPerUnit(position.entry, exitPrice, position.direction, config.feePerSide, config.slippagePerSide);
      const before = equity;
      equity += netPnl;
      trades.push({direction: position.direction, entry: position.entry, exit: exitPrice, quantity: position.quantity, netPnl, netReturnPct: before > 0 ? netPnl / before * 100 : null, reason, entryIndex: position.entryIndex, exitIndex: index, entryTime: candles[position.entryIndex].time, exitTime: candles[index].time});
      if (netPnl > 0) grossProfit += netPnl; else grossLoss += Math.abs(netPnl);
      trackEquity(equity);
      position = null;
    };

    if (end > start) {
      for (let i = start; i < end; i++) {
        const bar = candles[i];
        if (position) {
          const exit = chooseExit(position, bar);
          const gapExit = exit && ['gap-stop', 'gap-target'].includes(exit.reason);
          const favorablePrice = gapExit ? exit.price : exit && ['target'].includes(exit.reason) ? exit.price : position.direction === 1 ? bar.high : bar.low;
          const adversePrice = exit && ['gap-stop', 'gap-target', 'stop', 'same-bar-stop-first'].includes(exit.reason) ? exit.price : position.direction === 1 ? bar.low : bar.high;
          trackEquity(equity + position.quantity * netPnlPerUnit(position.entry, favorablePrice, position.direction, config.feePerSide, config.slippagePerSide));
          trackEquity(equity + position.quantity * netPnlPerUnit(position.entry, adversePrice, position.direction, config.feePerSide, config.slippagePerSide));
          if (exit) closePosition(exit.price, exit.reason, i);
          else trackEquity(equity + position.quantity * netPnlPerUnit(position.entry, bar.close, position.direction, config.feePerSide, config.slippagePerSide));
        }
        if (!position && i < end - 1) {
          const reading = config.strategy === 'combined' ? classify(candles, indicators, i)
            : classifyStrategy(candles, indicators, i, config.strategy);
          if (reading.direction === -1 && config.longOnly) ignoredShortSignals++;
          if (reading.direction === 1 || (reading.direction === -1 && !config.longOnly)) {
            const direction = reading.direction, entry = candles[i + 1].open, stopDistance = indicators.atr[i] * RULES.stopAtr;
            const rawSizing = calculatePositionSize({equity, riskPct: config.riskPct, entry, direction, stopDistance, feePerSide: config.feePerSide, slippagePerSide: config.slippagePerSide, maxNotional: equity});
            const sized = applyOrderConstraints(rawSizing, entry, config.orderConstraints);
            if (sized && sized.quantity > 0) position = {direction, entry, quantity: sized.quantity, entryIndex: i + 1, stop: entry - direction * stopDistance, target: entry + direction * stopDistance * RULES.targetR};
            else if (rawSizing && config.orderConstraints) rejectedByOrderFilters++;
          }
        }
      }
      if (position) closePosition(candles[end - 1].close, 'end-of-period', end - 1);
    }
    const winningTrades = trades.filter(trade => trade.netPnl > 0), losingTrades = trades.filter(trade => trade.netPnl < 0);
    const wins = winningTrades.length;
    let longestLossStreak = 0, currentLossStreak = 0;
    for (const trade of trades) {
      currentLossStreak = trade.netPnl < 0 ? currentLossStreak + 1 : 0;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    }
    const byUtcHour = Array(24).fill(0), byUtcWeekday = Array(7).fill(0);
    for (const trade of trades) {
      const date = new Date(trade.entryTime);
      byUtcHour[date.getUTCHours()]++;
      byUtcWeekday[date.getUTCDay()]++;
    }
    return {
      trades: trades.length, wins, winRate: trades.length ? wins / trades.length * 100 : 0,
      averageWinUsdt: wins ? winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / wins : null,
      averageLossUsdt: losingTrades.length ? losingTrades.reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0) / losingTrades.length : null,
      longestLossStreak, tradeTimeDistribution: {basis: 'entry-utc', byUtcHour, byUtcWeekday},
      totalReturn: (equity / config.capital - 1) * 100, initialCapital: config.capital, finalEquity: equity,
      maxDrawdown: maxDrawdown * 100, profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss,
      grossProfit, grossLoss, tradeList: trades, openPosition: false, ignoredShortSignals, rejectedByOrderFilters,
      feePerSide: config.feePerSide, slippagePerSide: config.slippagePerSide,
      startIndex: start, endIndex: end, periodBars: Math.max(0, end - start), strategy: config.strategy
    };
  }

  function buyAndHold(candles, {startIndex, endIndex, capital = 30, feePerSide = 0.001, slippagePerSide = 0.0005} = {}) {
    const start = Math.max(0, Math.floor(startIndex)), end = Math.min(candles.length, Math.floor(endIndex));
    if (end - start < 2 || !Number.isFinite(capital) || capital <= 0) return {returnPct: null, netPnl: null, bars: Math.max(0, end - start)};
    const entry = candles[start].open, exit = candles[end - 1].close;
    if (!(entry > 0) || !(exit > 0)) return {returnPct: null, netPnl: null, bars: end - start};
    const quantity = capital / (entry * (1 + feePerSide + slippagePerSide));
    const netPnl = quantity * netPnlPerUnit(entry, exit, 1, feePerSide, slippagePerSide);
    return {returnPct: netPnl / capital * 100, netPnl, entry, exit, quantity, bars: end - start};
  }

  function walkForward(candles, options = {}, precomputedIndicators, registration = {}, intervalMs) {
    // Legacy generic helper; the application research path uses the registered, gated calendar routine below.
    const developmentEnd = Math.floor(candles.length * 0.8);
    const splitIndex = Math.floor(developmentEnd * 0.7), common = {...options};
    const indicators = resolveIndicators(candles, precomputedIndicators);
    const inSample = runBacktest(candles, {...common, startIndex: 0, endIndex: splitIndex}, indicators);
    const outOfSample = runBacktest(candles, {...common, startIndex: splitIndex, endIndex: developmentEnd}, indicators);
    const benchmark = buyAndHold(candles, {startIndex: splitIndex, endIndex: developmentEnd, capital: common.capital ?? 30, feePerSide: common.feePerSide ?? 0.001, slippagePerSide: common.slippagePerSide ?? 0.0005});
    return {splitIndex, developmentEnd, reservedHoldoutStart: developmentEnd, reservedHoldoutBars: candles.length - developmentEnd, inSample, outOfSample, benchmark};
  }

  function parseUtcBoundary(value, label) {
    if (typeof value !== 'string' || !value.endsWith('Z')) throw new RangeError(label + ' must be an explicit UTC timestamp ending in Z.');
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new RangeError(label + ' is not a valid UTC timestamp.');
    return timestamp;
  }

  function lowerBoundCandleOpen(candles, timestamp) {
    let low = 0, high = candles.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (candles[mid].time < timestamp) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function lowerBoundCandleClose(candles, timestamp, intervalMs) {
    let low = 0, high = candles.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (candles[mid].time + intervalMs <= timestamp) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function calendarWindowIndices(candles, window, intervalMs) {
    if (!Array.isArray(candles) || !window) throw new RangeError('بيانات الشموع ونافذة التقويم مطلوبة.');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('مدة إطار الشمعة غير صالحة.');
    const startUtcMs = parseUtcBoundary(window.startUtc, 'window.startUtc');
    const endUtcExclusiveMs = parseUtcBoundary(window.endUtcExclusive, 'window.endUtcExclusive');
    if (endUtcExclusiveMs <= startUtcMs) throw new RangeError('نهاية نافذة التقويم يجب أن تأتي بعد بدايتها.');
    const startIndex = lowerBoundCandleOpen(candles, startUtcMs);
    const endIndex = lowerBoundCandleClose(candles, endUtcExclusiveMs, intervalMs);
    const firstCandle = candles[startIndex], lastCandle = endIndex > startIndex ? candles[endIndex - 1] : null;
    const lastCloseUtcMs = lastCandle ? lastCandle.time + intervalMs : null;
    return {
      startIndex,
      endIndex,
      startUtcMs,
      endUtcExclusiveMs,
      startCovered: Boolean(firstCandle && firstCandle.time >= startUtcMs && firstCandle.time - startUtcMs < intervalMs),
      endCovered: Boolean(lastCandle && lastCloseUtcMs <= endUtcExclusiveMs && endUtcExclusiveMs - lastCloseUtcMs < intervalMs)
    };
  }

  function walkForwardPeriods(candles, options = {}, _precomputedIndicators, registration = {}, intervalMs) {
    const {studyWindow, developmentWindow, walkForwardWindows, finalHoldoutWindow, userSignature} = registration || {};
    if (!userSignature) throw new Error('توقيع المستخدم غير موجود؛ walk-forward متوقف.');
    if (!Array.isArray(candles) || !Array.isArray(walkForwardWindows) || walkForwardWindows.length !== 4 || !studyWindow || !developmentWindow || !finalHoldoutWindow) {
      throw new RangeError('تسجيل نوافذ التقويم غير مكتمل.');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('مدة إطار الشمعة غير صالحة.');

    const studyStartUtcMs = parseUtcBoundary(studyWindow.startUtc, 'studyWindow.startUtc');
    const studyEndUtcExclusiveMs = parseUtcBoundary(studyWindow.endUtcExclusive, 'studyWindow.endUtcExclusive');
    const developmentStartUtcMs = parseUtcBoundary(developmentWindow.startUtc, 'developmentWindow.startUtc');
    const developmentEndUtcExclusiveMs = parseUtcBoundary(developmentWindow.endUtcExclusive, 'developmentWindow.endUtcExclusive');
    const holdoutStartUtcMs = parseUtcBoundary(finalHoldoutWindow.startUtc, 'finalHoldoutWindow.startUtc');
    const holdoutEndUtcExclusiveMs = parseUtcBoundary(finalHoldoutWindow.endUtcExclusive, 'finalHoldoutWindow.endUtcExclusive');
    if (studyStartUtcMs !== developmentStartUtcMs || studyEndUtcExclusiveMs !== holdoutEndUtcExclusiveMs ||
        developmentEndUtcExclusiveMs !== parseUtcBoundary(walkForwardWindows[0].startUtc, 'walkForwardWindows[0].startUtc') ||
        parseUtcBoundary(walkForwardWindows[walkForwardWindows.length - 1].endUtcExclusive, 'walkForwardWindows[last].endUtcExclusive') !== holdoutStartUtcMs) {
      throw new RangeError('حدود التطوير والنوافذ والحجز النهائي غير متصلة وفق التسجيل.');
    }
    let expectedStartUtcMs = developmentEndUtcExclusiveMs;
    for (const [index, window] of walkForwardWindows.entries()) {
      const startUtcMs = parseUtcBoundary(window.startUtc, 'walkForwardWindows[' + index + '].startUtc');
      const endUtcExclusiveMs = parseUtcBoundary(window.endUtcExclusive, 'walkForwardWindows[' + index + '].endUtcExclusive');
      if (startUtcMs !== expectedStartUtcMs || endUtcExclusiveMs <= startUtcMs) throw new RangeError('نوافذ walk-forward غير متصلة أو غير مرتبة.');
      expectedStartUtcMs = endUtcExclusiveMs;
    }
    if (expectedStartUtcMs !== holdoutStartUtcMs) throw new RangeError('يجب أن تنتهي نوافذ walk-forward عند بداية الحجز النهائي.');

    const studyStartIndex = lowerBoundCandleOpen(candles, studyStartUtcMs);
    const beforeHoldoutEndIndex = lowerBoundCandleClose(candles, holdoutStartUtcMs, intervalMs);
    const studyCandles = candles.slice(studyStartIndex, beforeHoldoutEndIndex);
    if (!studyCandles.length) throw new RangeError('لا توجد شموع ضمن الدراسة قبل الحجز النهائي.');

    const developmentRange = calendarWindowIndices(studyCandles, developmentWindow, intervalMs);
    if (developmentRange.endIndex <= developmentRange.startIndex || !developmentRange.startCovered || !developmentRange.endCovered) {
      throw new RangeError('بيانات نافذة التطوير/الإحماء لا تغطي حدود التسجيل كاملة.');
    }
    const folds = [];
    let previousEndIndex = developmentRange.endIndex;
    for (const [index, window] of walkForwardWindows.entries()) {
      const range = calendarWindowIndices(studyCandles, window, intervalMs);
      if (range.startIndex < previousEndIndex || range.endIndex <= range.startIndex || !range.startCovered || !range.endCovered) {
        throw new RangeError('بيانات نافذة walk-forward ' + (index + 1) + ' غير كاملة أو متداخلة.');
      }
      const warmupEndIndex = lowerBoundCandleClose(studyCandles, range.startUtcMs, intervalMs);
      if (warmupEndIndex < developmentRange.endIndex) throw new RangeError('نافذة التطوير المسجلة لا تكفي لتهيئة الفترة ' + (index + 1) + '.');
      if (range.startIndex < warmupEndIndex) throw new RangeError('تداخلت شموع الإحماء مع نافذة الاختبار ' + (index + 1) + '.');
      const warmupCandles = studyCandles.slice(0, warmupEndIndex);
      const foldCandles = warmupCandles.concat(studyCandles.slice(range.startIndex, range.endIndex));
      const startIndex = warmupCandles.length, endIndex = foldCandles.length;
      const foldIndicators = indicatorsFor(foldCandles);
      const result = runBacktest(foldCandles, {...options, startIndex, endIndex}, foldIndicators);
      const benchmark = buyAndHold(foldCandles, {startIndex, endIndex, capital: options.capital ?? 30,
        feePerSide: options.feePerSide ?? 0.001, slippagePerSide: options.slippagePerSide ?? 0.0005});
      folds.push({period: window.period ?? index + 1, startIndex, endIndex, startTime: range.startUtcMs,
        endTime: range.endUtcExclusiveMs, endUtcExclusive: window.endUtcExclusive, result, benchmark});
      previousEndIndex = range.endIndex;
    }
    return {periods: folds.length, developmentWindow, developmentEndIndex: developmentRange.endIndex,
      warmupWindow: developmentWindow, reservedHoldoutWindow: finalHoldoutWindow, folds};
  }

  window.MarketRadarEngine = Object.freeze({
    RULES, ema, rsi, atr, macd, volumeSignal, volumeStats, obv, adx, stochastic, bollinger, parabolicSar, superTrend,
    indicatorsFor, classify, getIndependentVotes, classifyStrategy, normalizeCandles, netPnlPerUnit, calculatePositionSize, chooseExit,
    runBacktest, buyAndHold, walkForward, walkForwardPeriods, calendarWindowIndices
  });
})();
