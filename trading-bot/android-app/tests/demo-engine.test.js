'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../app/src/main/assets/demo-engine.js');

test('starts with a local virtual balance and no holdings', () => {
  const state = engine.createState();
  assert.equal(state.cash, 10000);
  assert.deepEqual(state.positions, {});
  assert.equal(engine.portfolio(state, {}).total, 10000);
});

test('simulates a buy and marks the holding to market without changing cash remotely', () => {
  const state = engine.createState();
  const tx = engine.executeOrder(state, { side: 'BUY', symbol: 'BTCUSDT', amount: 100, price: 50000, timestamp: 123 });
  assert.equal(tx.qty, 0.002);
  assert.equal(tx.fee, 0.1);
  assert.equal(state.cash, 9899.9);
  assert.equal(engine.portfolio(state, { BTCUSDT: 55000 }).total, 10009.9);
  assert.equal(state.transactions.length, 1);
});

test('simulates a partial sale and computes realized profit after fees', () => {
  const state = engine.createState();
  engine.executeOrder(state, { side: 'BUY', symbol: 'ETHUSDT', amount: 200, price: 2000 });
  const sale = engine.executeOrder(state, { side: 'SELL', symbol: 'ETHUSDT', amount: 120, price: 2400 });
  assert.equal(sale.qty, 0.05);
  assert.equal(sale.realizedPnl, 19.78);
  assert.equal(Object.keys(state.positions).length, 1);
});

test('rejects real-world-invalid demo actions such as overspending or selling absent holdings', () => {
  const state = engine.createState();
  assert.throws(() => engine.executeOrder(state, { side: 'BUY', symbol: 'BTCUSDT', amount: 20000, price: 50000 }), /لا يكفي/);
  assert.throws(() => engine.executeOrder(state, { side: 'SELL', symbol: 'BTCUSDT', amount: 10, price: 50000 }), /حيازتك/);
  assert.equal(state.transactions.length, 0);
});

test('normalizes untrusted local state and limits watchlist assets', () => {
  const safe = engine.sanitizeState({ cash: 100, positions: {}, transactions: [], watchlist: ['BTCUSDT', 'UNKNOWNUSDT'] });
  assert.deepEqual(safe.watchlist, ['BTCUSDT']);
  assert.equal(engine.sanitizeState({ cash: -1 }).cash, 10000);
});

test('order review on a normalized copy cannot mutate the saved portfolio', () => {
  const state = engine.createState();
  const preview = engine.sanitizeState(state);
  engine.executeOrder(preview, { side: 'BUY', symbol: 'BTCUSDT', amount: 25, price: 50000 });
  assert.deepEqual(state.positions, {});
  assert.equal(state.cash, 10000);
});

test('every catalog strategy returns a bounded educational signal for valid candles', () => {
  const candles = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + i * 0.35 + Math.sin(i / 4) * 2;
    return { high: close + 1.2, low: close - 1.1, close, volume: 1000 + (i % 9) * 75 };
  });
  for (const strategy of engine.STRATEGIES) {
    const signal = engine.calculateSignal(strategy.id, candles);
    assert.ok(['BUY', 'SELL', 'HOLD'].includes(signal.action), strategy.id);
    assert.ok(Number.isFinite(signal.score) && signal.score >= 0 && signal.score <= 100, strategy.id);
    assert.ok(signal.reason.length > 0, strategy.id);
  }
});

test('keeps the strategy catalog broad and explicit', () => {
  const ids = engine.STRATEGIES.map(item => item.id);
  for (const id of ['buy_hold', 'dca', 'grid', 'rsi', 'macd', 'bollinger', 'breakout', 'stochastic', 'vwap', 'ichimoku', 'fibonacci', 'atr_breakout', 'volume_breakout', 'donchian', 'obv_momentum', 'keltner']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.ok(ids.length >= 20);
});
