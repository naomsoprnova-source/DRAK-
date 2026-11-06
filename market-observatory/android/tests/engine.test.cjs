'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enginePath = path.resolve(__dirname, '../app/src/main/assets/engine.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/klines.json'), 'utf8'));

function loadEngine() {
  delete global.PaperEngine;
  delete require.cache[require.resolve(enginePath)];
  require(enginePath);
  assert.ok(global.PaperEngine, 'engine.js should expose global.PaperEngine');
  return global.PaperEngine;
}

function valuesDeep(value, wantedKeys, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    if (wantedKeys.has(key) && typeof child === 'number' && Number.isFinite(child)) found.push(child);
    found.push(...valuesDeep(child, wantedKeys, seen));
  }
  return found;
}

function getPortfolio(result, original) {
  if (result && result.portfolio) return result.portfolio;
  if (result && typeof result === 'object' && ['cash', 'balance', 'availableCash', 'position', 'openPosition', 'activePosition', 'trades'].some((key) => key in result)) return result;
  return original;
}

function getOpenPosition(portfolio) {
  return portfolio.position || portfolio.openPosition || portfolio.activePosition || null;
}

function rejectedWithoutMutation(fn, portfolio) {
  const before = JSON.stringify(portfolio);
  let result;
  try { result = fn(); } catch { return true; }
  return result === false || result === null || (result && (result.ok === false || result.success === false)) || JSON.stringify(portfolio) === before;
}

function analysisAt(price, stop = price * 0.9, target = price * 1.2) {
  return {
    ready: true, signal: true, strategy: 'synthetic test signal', price,
    entryPrice: price, stopPrice: stop, targetPrice: target,
  };
}

function settingsFor(engine) {
  return {
    ...engine.DEFAULTS,
    initialCapital: 11,
    startingCapital: 11,
    maxPositionUsd: 5,
    maxPosition: 5,
    feeRate: 0.001,
    fee: 0.001,
    slippageRate: 0.0005,
    slippage: 0.0005,
  };
}

test('الإعدادات الافتراضية ورأس المال تحدد حدود المحفظة الورقية', () => {
  const engine = loadEngine();
  const defaults = engine.DEFAULTS;
  assert.ok(defaults && typeof defaults === 'object');
  const numericDefaults = Object.values(defaults).filter((value) => typeof value === 'number');
  for (const expected of [11, 5, 0.001, 0.0005]) {
    assert.ok(numericDefaults.some((actual) => Math.abs(actual - expected) < 1e-12), `DEFAULTS should include ${expected}`);
  }
  const portfolio = engine.createPortfolio(11);
  assert.ok(portfolio && typeof portfolio === 'object');
  const cash = portfolio.cash ?? portfolio.balance ?? portfolio.availableCash;
  assert.equal(cash, 11, 'portfolio starts with the requested 11 USDT');
  assert.equal(getOpenPosition(portfolio), null, 'portfolio starts without an open position');
  assert.equal(engine.createPortfolio().cash, 11, 'omitted capital should use the 11 USDT default');
});

test('الإدخال يراعي سقف السيولة، والرسوم والانزلاق، ويستخدم كمية عشرية', () => {
  const engine = loadEngine();
  const settings = settingsFor(engine);
  const portfolio = engine.createPortfolio(11);
  const result = engine.openPosition(portfolio, analysisAt(100, 99.9, 120), settings, {
    price: 100,
    liquidityUsd: 0.5,
    availableLiquidityUsd: 0.5,
  });
  const state = getPortfolio(result, portfolio);
  const position = getOpenPosition(state);
  assert.ok(position, 'a valid paper entry should create one position');
  const quantity = position.quantity ?? position.qty ?? position.baseQuantity;
  assert.ok(Number.isFinite(quantity) && quantity > 0);
  assert.notEqual(quantity, Math.trunc(quantity), 'asset quantity must retain decimal precision');
  const notional = position.notionalUsd ?? position.valueUsd ?? position.positionUsd ?? position.notional ?? position.costUsd;
  assert.ok(Number.isFinite(notional) && notional <= 0.5 + 1e-8, 'entry size should not exceed the binding 0.5 USDT liquidity limit');
  const executionPrice = position.entryPrice ?? position.fillPrice ?? position.executionPrice;
  if (typeof executionPrice === 'number') assert.ok(executionPrice > 100, 'buy execution includes adverse slippage');
  const fees = valuesDeep(state, new Set(['entryFee', 'fees', 'fee', 'feesPaid']));
  assert.ok(fees.some((fee) => fee > 0), 'entry fees should be recorded');

  const uncappedPortfolio = engine.createPortfolio(11);
  const uncappedResult = engine.openPosition(uncappedPortfolio, analysisAt(100, 99.9, 120), settings, { price: 100 });
  const uncappedPosition = getOpenPosition(getPortfolio(uncappedResult, uncappedPortfolio));
  assert.ok(uncappedPosition);
  const uncappedNotional = uncappedPosition.notionalUsd ?? uncappedPosition.valueUsd ?? uncappedPosition.positionUsd ?? uncappedPosition.notional ?? uncappedPosition.costUsd;
  assert.ok(Number.isFinite(uncappedNotional) && uncappedNotional <= 5 + 1e-8, 'entry size should not exceed the binding 5 USDT cap');
});

test('يرفض مركزاً ثانياً ورصيداً أو سعراً أو وقفاً غير صالح', () => {
  const engine = loadEngine();
  const settings = settingsFor(engine);
  const portfolio = engine.openPosition(engine.createPortfolio(11), analysisAt(100), settings, { price: 100 }).portfolio;
  const current = JSON.stringify(portfolio);
  assert.ok(rejectedWithoutMutation(() => engine.openPosition(portfolio, analysisAt(100), settings, { price: 100 }), portfolio));
  assert.equal(JSON.stringify(portfolio), current, 'rejected second entry must not mutate the position');

  for (const badCapital of [0, -1, NaN, Infinity]) {
    assert.throws(() => engine.createPortfolio(badCapital), `invalid capital ${badCapital} should be rejected`);
  }
  for (const badPrice of [0, -5, NaN, Infinity]) {
    const empty = engine.createPortfolio(11);
    assert.ok(rejectedWithoutMutation(() => engine.openPosition(empty, analysisAt(badPrice), settings, { price: badPrice }), empty));
  }
  const invalidStopPortfolio = engine.createPortfolio(11);
  assert.ok(rejectedWithoutMutation(
    () => engine.openPosition(invalidStopPortfolio, analysisAt(100, 101, 120), settings, { price: 100 }),
    invalidStopPortfolio,
  ), 'a long position with a stop at/above entry should be rejected');
});

test('الإغلاق يسجل رسوم الخروج وصافي الربح/الخسارة المحقق', () => {
  const engine = loadEngine();
  const settings = settingsFor(engine);
  const portfolio = engine.openPosition(engine.createPortfolio(11), analysisAt(100), settings, { price: 100 }).portfolio;
  const beforeClose = JSON.stringify(portfolio);
  const closeResult = engine.closePosition(portfolio, 110, settings, { marketPrice: 110 });
  const state = getPortfolio(closeResult, portfolio);
  assert.equal(getOpenPosition(state), null, 'closed position should no longer be active');
  const closeObject = closeResult && typeof closeResult === 'object' ? closeResult : state;
  const netValues = valuesDeep(closeObject, new Set(['netPnl', 'realizedPnl', 'pnlNet']));
  assert.ok(netValues.length > 0, 'close should expose realized net PnL');
  const feeValues = valuesDeep(closeObject, new Set(['exitFee', 'fees', 'fee', 'feesPaid']));
  assert.ok(feeValues.some((fee) => fee > 0), 'close should account for exit fees');
  assert.notEqual(JSON.stringify(state), beforeClose, 'closing should update the portfolio/history');
  for (const badPrice of [0, -1, NaN, Infinity]) {
    const fresh = engine.openPosition(engine.createPortfolio(11), analysisAt(100), settings, { price: 100 }).portfolio;
    assert.ok(rejectedWithoutMutation(() => engine.closePosition(fresh, badPrice, settings), fresh));
  }
});

test('الاختبار التاريخي يعيد البنية المطلوبة ويطابق تنفيذ الدخول افتتاح الشمعة التالية', () => {
  const engine = loadEngine();
  assert.equal(fixture.synthetic_test_data_only, true, 'backtest fixture must be explicitly synthetic');
  const candles = fixture.candles;
  const frozen = Object.freeze(candles.map((candle) => Object.freeze({ ...candle })));
  const result = engine.backtest(frozen, 'breakout', settingsFor(engine));
  assert.ok(result && typeof result === 'object');
  assert.ok(Number.isInteger(result.tradeCount) && result.tradeCount >= 0);
  assert.ok(Number.isFinite(result.netPnl));
  assert.ok(Number.isFinite(result.fees) && result.fees >= 0);
  assert.equal(frozen.length, candles.length, 'backtest should use the supplied historical series only');

  const trades = result.trades || result.closedTrades || [];
  for (const trade of trades) {
    const signalIndex = trade.signalIndex ?? trade.signalCandleIndex;
    const entryIndex = trade.entryIndex ?? trade.entryCandleIndex;
    const entryPrice = trade.entryPrice ?? trade.entryExecutionPrice;
    if (Number.isInteger(signalIndex) && Number.isInteger(entryIndex)) {
      assert.equal(entryIndex, signalIndex + 1, 'signal candle must not also be the execution candle');
      const rawOpen = candles[entryIndex].open;
      const recordedMarketPrice = trade.marketEntryPrice;
      if (Number.isFinite(recordedMarketPrice)) assert.equal(recordedMarketPrice, rawOpen, 'market reference price is the next candle open');
      if (Number.isFinite(entryPrice)) assert.ok(entryPrice >= rawOpen, 'buy execution includes adverse slippage from the next candle open');
    }
    const exitIndex = trade.exitIndex ?? trade.exitCandleIndex;
    const stop = trade.stopLoss ?? trade.stop;
    const target = trade.takeProfit ?? trade.target;
    const exitReason = String(trade.exitReason ?? trade.reason ?? '').toLowerCase();
    if (Number.isInteger(exitIndex) && Number.isFinite(stop) && Number.isFinite(target)) {
      const exitCandle = candles[exitIndex];
      if (exitCandle && exitCandle.low <= stop && exitCandle.high >= target) {
        assert.match(exitReason, /stop/, 'when stop and target touch the same candle, stop wins');
      }
    }
  }
});

test('اختبار الوقف والهدف على الشمعة نفسها محافظ وينفذ عند افتتاح الشمعة التالية', () => {
  const engine = loadEngine();
  const candles = Array.from({ length: 63 }, (_, index) => ({
    time: 1700000000000 + index * 60000,
    closeTime: 1700000059999 + index * 60000,
    open: 100, high: 101, low: 99, close: 100, volume: 10,
  }));
  candles[60] = { ...candles[60], open: 100, high: 104, low: 99, close: 102 };
  candles[61] = { ...candles[61], open: 103, high: 115, low: 90, close: 103 };
  const result = engine.backtest(candles, 'breakout', settingsFor(engine));
  assert.equal(result.tradeCount, 1);
  const trade = result.trades[0];
  assert.equal(trade.signalIndex, 60);
  assert.equal(trade.entryIndex, 61);
  assert.equal(trade.marketEntryPrice, candles[61].open);
  assert.ok(trade.entryPrice > candles[61].open, 'simulated fill includes buy-side slippage');
  assert.equal(trade.exitIndex, 61);
  assert.ok(candles[61].low <= trade.stopLoss && candles[61].high >= trade.takeProfit);
  assert.equal(trade.exitReason, 'stop', 'when both levels touch, the conservative stop assumption wins');
  assert.ok(trade.fees > 0 && Number.isFinite(trade.netPnl));
});
