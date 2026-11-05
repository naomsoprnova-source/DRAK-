const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../../app/src/main/assets/paper-engine.js');

test('synthetic candles are deterministic, bounded, and internally consistent', () => {
  const first = Engine.generateCandles({ symbol: 'BTCUSDT', interval: '15m', count: 120 });
  const second = Engine.generateCandles({ symbol: 'BTCUSDT', interval: '15m', count: 120 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 120);
  assert.ok(first.every((candle) => candle.symbol === 'BTCUSDT'));
  assert.ok(first.every((candle) => candle.interval === '15m'));
  for (const candle of first) {
    assert.ok(candle.high >= candle.open && candle.high >= candle.close);
    assert.ok(candle.low <= candle.open && candle.low <= candle.close);
    assert.ok(Number.isFinite(candle.volume) && candle.volume >= 0);
    assert.equal(candle.time % Engine.INTERVALS['15m'], 0);
  }
});

test('only explicitly supported local symbols and intervals are accepted', () => {
  assert.throws(() => Engine.generateCandles({ symbol: 'UNKNOWNUSDT' }), /غير متاح/);
  assert.throws(() => Engine.generateCandles({ symbol: '__proto__' }), /غير متاح/);
  assert.throws(() => Engine.generateCandles({ interval: '1m' }), /غير مدعوم/);
  assert.throws(() => Engine.generateCandles({ interval: 'constructor' }), /غير مدعوم/);
  assert.throws(() => Engine.generateCandles({ count: 2001 }), /خارج النطاق/);
});

test('analysis labels its origin as synthetic and rejects unknown strategies', () => {
  const candles = Engine.generateCandles({ count: 100 });
  const result = Engine.analyze(candles, 'ema');
  assert.equal(result.source, 'synthetic');
  assert.ok(['buy', 'sell', 'wait'].includes(result.action));
  assert.throws(() => Engine.analyze(candles, 'live'), /غير معروفة/);
  assert.equal(Engine.analyze(candles.slice(0, 40), 'ema').action, 'wait');
});

test('paper ledger opens and closes locally while charging explicit virtual costs', () => {
  const base = Engine.createAccount({ startingCapital: 1000, maxTradeUsd: 10 });
  const opened = Engine.openPaperPosition(base, { symbol: 'BTCUSDT', interval: '1h', price: 100, amount: 10, strategy: 'ema', now: 1000 });
  assert.equal(base.position, null, 'opening is immutable');
  assert.ok(opened.cash < base.cash);
  assert.equal(opened.position.symbol, 'BTCUSDT');
  assert.equal(opened.position.interval, '1h');
  assert.ok(opened.position.entryFee > 0);
  assert.throws(() => Engine.openPaperPosition(opened, { symbol: 'BTCUSDT', price: 101, amount: 5 }), /مفتوح بالفعل/);

  const closed = Engine.closePaperPosition(opened, { price: 105, now: 2000 });
  assert.equal(closed.position, null);
  assert.equal(closed.history.length, 1);
  assert.ok(closed.history[0].fees > 0);
  assert.ok(closed.history[0].pnl > 0);
  assert.ok(closed.cash > base.cash);
  assert.equal(closed.history[0].source, 'synthetic');
  assert.equal(closed.history[0].interval, '1h');
});

test('invalid or oversized simulated trades do not mutate the account', () => {
  const account = Engine.createAccount({ startingCapital: 100, maxTradeUsd: 10, maxRiskPct: 0.01 });
  assert.throws(() => Engine.openPaperPosition(account, { symbol: 'BTCUSDT', price: 100, amount: 0 }), /موجب/);
  assert.throws(() => Engine.openPaperPosition(account, { symbol: 'BTCUSDT', price: 100, amount: 10.01 }), /سقف/);
  assert.throws(() => Engine.openPaperPosition(account, { symbol: 'BTCUSDT', price: 100, amount: 0.5 }), /عددًا صحيحًا/);
  assert.throws(() => Engine.openPaperPosition(account, { symbol: 'BTCUSDT', interval: '1m', price: 100, amount: 1 }), /غير مدعوم/);
  assert.throws(() => Engine.openPaperPosition(account, { symbol: 'BTCUSDT', price: Infinity, amount: 1 }), /موجب/);
  assert.equal(account.cash, 100);
  assert.equal(account.position, null);
  assert.throws(() => Engine.createAccount({ startingCapital: NaN }), /بين 100/);
  assert.throws(() => Engine.createAccount({ maxTradeUsd: 1.5 }), /عددًا صحيحًا/);
});

test('70/30 backtest stays explicitly synthetic and validates its inputs', () => {
  const candles = Engine.generateCandles({ symbol: 'ETHUSDT', interval: '1h', count: 180 });
  const result = Engine.runBacktest(candles, 'trend', { startingCapital: 1000, maxTradeUsd: 10 });
  assert.equal(result.source, 'synthetic');
  assert.equal(result.splitPct, 70);
  assert.equal(result.evaluationPct, 30);
  assert.equal(result.sampleCount, 180);
  assert.equal(result.symbol, 'ETHUSDT');
  assert.equal(result.interval, '1h');
  assert.ok(Number.isFinite(result.development.finalCapital));
  assert.ok(Number.isFinite(result.evaluation.finalCapital));
  assert.throws(() => Engine.runBacktest(candles.slice(0, 80), 'trend'), /100/);
  assert.throws(() => Engine.runBacktest(candles, 'unknown'), /غير معروفة/);
  assert.throws(() => Engine.runBacktest(candles, 'trend', { maxTradeUsd: 1.5 }), /إعدادات الاختبار/);
});
