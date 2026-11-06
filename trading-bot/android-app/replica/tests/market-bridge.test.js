const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bridgePath = path.join(__dirname, '../../app/src/main/assets/market-bridge.js');
const source = fs.readFileSync(bridgePath, 'utf8');

function loadBridge(native = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    DrakBridge: native,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, { window, Map, Promise, String, Number, Math, JSON, Error }, { filename: bridgePath });
  return { window, timers };
}

test('market bridge calls only the named Android native methods and resolves a public-data reply', async () => {
  let args;
  const { window } = loadBridge({ fetchTickers: (requestId) => { args = [requestId]; } });
  const pending = window.DrakMarketBridge.fetchTickers();
  assert.equal(args.length, 1);
  window.DrakBridgeCallbacks.onResponse(args[0], JSON.stringify({ ok: true, serverTime: 1700000000000, data: [{ symbol: 'BTCUSDT', price: '50000' }] }));
  const reply = await pending;
  assert.equal(reply.ok, true);
  assert.equal(reply.data[0].symbol, 'BTCUSDT');
});

test('historical request arguments preserve symbol, interval, range, limit, and callback ID', async () => {
  let args;
  const { window } = loadBridge({ fetchKlines: (...received) => { args = received; } });
  const pending = window.DrakMarketBridge.fetchKlines({ symbol: 'ETHUSDT', interval: '1h', startTime: 1000, endTime: 9000, limit: 1000 });
  assert.deepEqual(Array.from(args), ['ETHUSDT', '1h', '1000', '9000', '1000', '1']);
  window.DrakBridgeCallbacks.onResponse(args[5], JSON.stringify({ ok: true, symbol: 'ETHUSDT', interval: '1h', data: [] }));
  assert.equal((await pending).interval, '1h');
});

test('network errors preserve safe retry metadata and never become substitute prices', async () => {
  let requestId;
  const { window } = loadBridge({ fetchTickers: (id) => { requestId = id; } });
  const pending = window.DrakMarketBridge.fetchTickers();
  window.DrakBridgeCallbacks.onResponse(requestId, JSON.stringify({ ok: false, error: 'rate limited', httpStatus: 429, retryAfterSeconds: 3 }));
  await assert.rejects(pending, (error) => error.httpStatus === 429 && error.retryAfterSeconds === 3 && /rate limited/.test(error.message));
});

test('request times out, unavailable bridge rejects, and vibration is clamped', async () => {
  let requestId;
  let vibration;
  const { window, timers } = loadBridge({
    fetchTickers: (id) => { requestId = id; },
    vibrate: (milliseconds) => { vibration = milliseconds; }
  });
  const pending = window.DrakMarketBridge.fetchTickers();
  const timer = Array.from(timers.values())[0];
  assert.equal(timer.delay, 30000);
  timer.callback();
  await assert.rejects(pending, /مهلة/);
  window.DrakMarketBridge.vibrate(100000);
  assert.equal(vibration, '1000');
  const unavailable = loadBridge().window.DrakMarketBridge.fetchTickers();
  await assert.rejects(unavailable, /غير متاحة/);
  window.DrakBridgeCallbacks.onResponse(requestId, JSON.stringify({ ok: true, data: [] }));
});

test('the WebView bridge source contains no direct browser network API', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.match(source, /DrakBridgeCallbacks/);
  assert.match(source, /fetchKlines/);
  assert.match(source, /fetchTickers/);
});
