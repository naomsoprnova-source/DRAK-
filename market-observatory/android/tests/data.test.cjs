'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dataPath = path.resolve(__dirname, '../app/src/main/assets/data.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/klines.json'), 'utf8'));

function loadMarketData() {
  delete global.MarketData;
  delete require.cache[require.resolve(dataPath)];
  require(dataPath);
  assert.ok(global.MarketData, 'data.js should expose global.MarketData');
  return global.MarketData;
}

function rejected(fn) {
  try {
    const result = fn();
    return result === false || result === null || (result && result.valid === false);
  } catch {
    return true;
  }
}

test('الرموز والأطر الزمنية محصورة في القائمة المسموحة', () => {
  const data = loadMarketData();
  assert.deepEqual([...data.SUPPORTED_SYMBOLS].sort(), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  assert.deepEqual([...data.SUPPORTED_INTERVALS].sort(), ['15m', '1d', '1h', '4h']);
  for (const symbol of data.SUPPORTED_SYMBOLS) {
    for (const interval of data.SUPPORTED_INTERVALS) {
      assert.notEqual(data.validateRequest(symbol, interval, 50), false);
      assert.notEqual(data.validateRequest(symbol, interval, 1000), false);
    }
  }
  assert.ok(rejected(() => data.validateRequest('DOGEUSDT', '1h', 100)));
  assert.ok(rejected(() => data.validateRequest('BTCUSDT', '5m', 100)));
  for (const limit of [49, 1001, 0, -1, 50.5, '50.5']) {
    assert.ok(rejected(() => data.validateRequest('BTCUSDT', '1h', limit)), `limit ${limit} should be rejected`);
  }
});

test('parseKlines يستبعد الشمعة المفتوحة ويرتب الشموع المغلقة تصاعدياً', () => {
  const data = loadMarketData();
  assert.equal(fixture.synthetic_test_data_only, true);
  const nowMs = fixture.parse_now_ms;
  const shuffledRows = [...fixture.klines].reverse();
  const candles = data.parseKlines(shuffledRows, nowMs);
  assert.ok(Array.isArray(candles));
  assert.ok(candles.length > 0);
  const openTimes = candles.map((candle) => candle.time ?? candle.openTime);
  assert.deepEqual(openTimes, [...openTimes].sort((a, b) => a - b));
  assert.ok(candles.every((candle) => candle.closeTime < nowMs), 'open/equal-closeTime candles must not be returned');
  assert.ok(!openTimes.includes(fixture.open_candle_open_time));
});

test('parseKlines يرفض صفوف OHLC غير صالحة', () => {
  const data = loadMarketData();
  const badRows = [
    [1700000000000, 10, 8, 9, 9.5, 1, fixture.parse_now_ms - 1], // high below low
    [1700000000000, 10, 11, 9, 12, 1, fixture.parse_now_ms - 1], // close above high
    [1700000000000, 10, 11, 9, 9.5, -1, fixture.parse_now_ms - 1], // negative volume
  ];
  for (const row of badRows) {
    assert.ok(rejected(() => data.parseKlines([row], fixture.parse_now_ms)), 'invalid OHLCV row should be rejected');
  }
});
