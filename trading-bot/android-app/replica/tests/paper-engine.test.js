const test = require('node:test');
const assert = require('node:assert/strict');
require('../../app/src/main/assets/paper-engine.js');
const Engine = globalThis.DrakPaperEngine;

function fixtureCandles({ count = 300, symbol = 'BTCUSDT', interval = '15m', offset = 0 } = {}) {
  const intervalMs = Engine.INTERVALS[interval];
  const end = Math.floor(Date.now() / intervalMs) * intervalMs - intervalMs;
  const first = end - (count - 1) * intervalMs;
  let previous = 100;
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.035 + Math.sin((index + offset) / 5) * 1.1;
    const open = previous;
    const high = Math.max(open, close) * 1.004;
    const low = Math.min(open, close) * 0.996;
    previous = close;
    const openTime = first + index * intervalMs;
    return {
      symbol, interval, openTime, closeTime: openTime + intervalMs - 1, time: openTime,
      open, high, low, close, volume: 1000 + (index % 17) * 13,
      quoteVolume: 100000 + index * 8, tradeCount: 100 + (index % 31), source: Engine.SOURCE
    };
  });
}

function toKline(candle) {
  return [candle.openTime, String(candle.open), String(candle.high), String(candle.low), String(candle.close), String(candle.volume), candle.closeTime, String(candle.quoteVolume), candle.tradeCount, '0', '0', '0'];
}

test('production engine exposes only the supported Binance Spot markets and no generated-price feed', () => {
  assert.deepEqual(Object.keys(Engine.SYMBOLS).sort(), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  assert.equal(Engine.SOURCE, 'binance-spot');
  assert.equal(typeof Engine.generateCandles, 'undefined');
  assert.throws(() => Engine.analyze([], 'composite'), /لا توجد شموع/);
});

test('Binance kline normalization validates OHLCV and ignores an in-progress candle', () => {
  const closed = fixtureCandles({ count: 5, interval: '15m' });
  const intervalMs = Engine.INTERVALS['15m'];
  const openTime = closed[closed.length - 1].openTime + intervalMs;
  const forming = { ...closed[closed.length - 1], openTime, time: openTime, closeTime: openTime + intervalMs - 1 };
  const serverTime = openTime + 1000;
  const result = Engine.normalizeKlines(closed.concat(forming).map(toKline), { symbol: 'BTCUSDT', interval: '15m', serverTime });
  assert.equal(result.length, 5);
  assert.ok(result.every((candle) => candle.closeTime < serverTime));
  assert.ok(result.every((candle) => candle.source === Engine.SOURCE));
  assert.throws(() => Engine.validateCandles(closed, { symbol: 'ETHUSDT', interval: '15m' }), /غير متطابق/);
  assert.throws(() => Engine.normalizeKlines([toKline(closed[0])], { symbol: 'BTCUSDT', interval: '15m', serverTime: 0 }), /وقت Binance/);
  const invalid = toKline(closed[0]); invalid[2] = '1';
  assert.throws(() => Engine.normalizeKlines([invalid], { symbol: 'BTCUSDT', interval: '15m', serverTime }), /OHLCV/);
});

test('candle validation rejects synthetic source, timestamp misalignment, gaps and future closes', () => {
  const bars = fixtureCandles({ count: 5 });
  assert.throws(() => Engine.validateCandles([{ ...bars[0], source: 'synthetic' }]), /مصدر الشموع/);
  assert.throws(() => Engine.validateCandles([{ ...bars[0], openTime: bars[0].openTime + 1 }]), /UTC/);
  assert.throws(() => Engine.validateCandles(bars, { serverTime: bars[bars.length - 1].closeTime }), /لم تُغلق/);
  const gap = bars.map((bar) => ({ ...bar }));
  gap[3].openTime += Engine.INTERVALS['15m']; gap[3].time = gap[3].openTime; gap[3].closeTime = gap[3].openTime + Engine.INTERVALS['15m'] - 1;
  gap[4].openTime += Engine.INTERVALS['15m']; gap[4].time = gap[4].openTime; gap[4].closeTime = gap[4].openTime + Engine.INTERVALS['15m'] - 1;
  assert.throws(() => Engine.runBacktest(gap.concat(fixtureCandles({ count: 195, offset: 4 })), 'composite'), /تطابق|خارج الترتيب/);
});

test('all seven strategies analyze closed Binance candles and reject unknown IDs', () => {
  const bars = fixtureCandles({ count: 240 });
  assert.deepEqual(Engine.STRATEGY_IDS, ['composite', 'ema-cross', 'rsi-rebound', 'macd', 'bollinger', 'breakout', 'trend-follow']);
  for (const strategy of Engine.STRATEGY_IDS) {
    const result = Engine.analyze(bars, strategy);
    assert.equal(result.source, Engine.SOURCE);
    assert.ok(['buy', 'sell', 'wait'].includes(result.action));
    assert.ok(Number.isFinite(result.score));
  }
  assert.throws(() => Engine.analyze(bars, 'unknown'), /غير معروفة/);
  assert.equal(Engine.analyze(bars.slice(0, 10), 'composite').action, 'wait');
});

test('default virtual wallet starts at 11 USDT and a fractional position pays entry and exit costs', () => {
  const base = Engine.createAccount();
  assert.equal(base.startingCapital, 11);
  assert.equal(base.cash, 11);
  assert.equal(base.maxTradeUsd, 10);
  const opened = Engine.openPaperPosition(base, {
    symbol: 'BTCUSDT', interval: '15m', price: 100, amount: '3.50', strategy: 'composite',
    source: Engine.SOURCE, now: 1700000000000
  });
  assert.equal(base.position, null, 'opening remains immutable');
  assert.equal(opened.position.amount, 3.5);
  assert.equal(opened.position.source, Engine.SOURCE);
  assert.ok(opened.cash < base.cash);
  assert.ok(opened.position.entryFee > 0);
  const closed = Engine.closePaperPosition(opened, { price: 105, now: 1700000001000, source: Engine.SOURCE, reason: 'اختبار' });
  assert.equal(closed.position, null);
  assert.equal(closed.history.length, 1);
  assert.ok(closed.history[0].fees > opened.position.entryFee);
  assert.ok(closed.history[0].slippage > 0);
  assert.ok(closed.history[0].pnl > 0);
  assert.equal(closed.history[0].source, Engine.SOURCE);
  assert.equal(closed.history[0].reason, 'اختبار');
  assert.equal(closed.history[0].interval, '15m');
  assert.equal(Engine.portfolio(closed, 105, Engine.SOURCE).realizedPnl, closed.history[0].pnl);
});

test('risk, balance, symbol, source, precision and strategy limits block invalid paper positions', () => {
  const base = Engine.createAccount({ startingCapital: 11, maxTradeUsd: 10, maxRiskPct: 0.01 });
  const common = { symbol: 'BTCUSDT', interval: '15m', price: 100, strategy: 'composite', source: Engine.SOURCE, now: 1700000000000 };
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 10 }), /المخاطرة المقدرة/);
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 3.501 }), /منزلتين/);
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 10.01 }), /سقف/);
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 1, source: 'synthetic' }), /سعر حقيقي/);
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 1, symbol: '__proto__' }), /غير متاح/);
  assert.throws(() => Engine.openPaperPosition(base, { ...common, amount: 1, strategy: 'constructor' }), /غير معروفة/);
  const small = Engine.createAccount({ startingCapital: 1, maxTradeUsd: 1, maxRiskPct: 0.05 });
  assert.throws(() => Engine.openPaperPosition(small, { ...common, amount: 1 }), /الرصيد الافتراضي/);
  assert.equal(base.cash, 11);
  assert.equal(base.position, null);
});

test('70/30 history test reports net metrics and never uses future data for development', () => {
  const bars = fixtureCandles({ count: 300, symbol: 'ETHUSDT', interval: '1h' });
  const options = { startingCapital: 11, maxTradeUsd: 10, maxRiskPct: 0.01 };
  const baseline = Engine.runBacktest(bars, 'trend-follow', options);
  assert.equal(baseline.source, Engine.SOURCE);
  assert.equal(baseline.splitPct, 70);
  assert.equal(baseline.evaluationPct, 30);
  assert.equal(baseline.sampleCount, 300);
  assert.equal(baseline.splitIndex, Math.floor(300 * 0.7));
  assert.equal(baseline.development.fromIndex, 60);
  assert.equal(baseline.development.toIndexExclusive, baseline.splitIndex);
  assert.equal(baseline.evaluation.fromIndex, baseline.splitIndex);
  assert.equal(baseline.evaluation.toIndexExclusive, 300);
  for (const segment of [baseline.development, baseline.evaluation]) {
    assert.ok(Number.isFinite(segment.netPnl));
    assert.ok(Number.isFinite(segment.maxDrawdownPct));
    assert.ok(Number.isFinite(segment.fees));
    assert.ok(Number.isFinite(segment.slippage));
    assert.ok(segment.tradeCount >= 0);
  }
  const changedFuture = bars.map((bar, index) => {
    if (index < baseline.splitIndex) return bar;
    const previous = index ? bars[index - 1].close : bar.open;
    const close = previous * 1.001;
    return { ...bar, open: previous, high: close * 1.003, low: previous * 0.997, close, volume: bar.volume * 5 };
  });
  const baselineIndicators = Engine.makeIndicatorSeries(bars);
  const changedIndicators = Engine.makeIndicatorSeries(changedFuture);
  for (const key of Object.keys(baselineIndicators)) {
    assert.deepEqual(changedIndicators[key].slice(0, baseline.splitIndex), baselineIndicators[key].slice(0, baseline.splitIndex), key + ' must not depend on future candles');
  }
  const changed = Engine.runBacktest(changedFuture, 'trend-follow', options);
  assert.deepEqual(changed.development, baseline.development, 'evaluation candles must not alter development outcomes');
  assert.notDeepEqual(changed.evaluation, baseline.evaluation, 'evaluation metrics should respond to changed evaluation data');
  assert.equal(Engine.compareStrategies(bars, options).length, 7);
  assert.throws(() => Engine.runBacktest(bars.slice(0, 120), 'trend-follow'), /200/);
  assert.throws(() => Engine.runBacktest(bars, 'unknown'), /غير معروفة/);
  const wrongSource = bars.map((bar) => ({ ...bar, source: 'synthetic' }));
  assert.throws(() => Engine.runBacktest(wrongSource, 'trend-follow'), /مصدر الشموع/);
});
