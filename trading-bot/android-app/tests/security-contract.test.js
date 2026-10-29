'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const native = fs.readFileSync(path.join(root, 'app/src/main/java/com/drak/marketbot/MainActivity.kt'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app/src/main/assets/index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'app/src/main/assets/demo-engine.js'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'app/src/main/AndroidManifest.xml'), 'utf8');

test('Android market bridge is restricted to unauthenticated public GET endpoints', () => {
  assert.match(native, /requestMethod\s*=\s*"GET"/);
  assert.match(native, /\/api\/v3\/ticker\/24hr/);
  assert.match(native, /\/api\/v3\/klines/);
  assert.doesNotMatch(native, /\/api\/v3\/(?:account|order|exchangeInfo)\b/i);
  assert.doesNotMatch(native, /X-MBX-APIKEY|HmacSHA256|apiSecret|apiKey|signature\s*=/i);
});

test('no exchange credential read/write or connection mode exists in the app UI/native layer', () => {
  assert.doesNotMatch(native, /getSharedPreferences\s*\(|putString\s*\(|SecureStore|Credentials\s*\(/i);
  assert.match(native, /deleteSharedPreferences\("drak_secure"\)/);
  assert.doesNotMatch(html, /\b(?:testnet|live mode|real trading)\b/i);
  assert.doesNotMatch(html, /type\s*=\s*["']password["']|apiKey|apiSecret/i);
});

test('all buy/sell execution is simulated in the local engine with virtual cash', () => {
  assert.match(engine, /INITIAL_CASH\s*=\s*10000/);
  assert.match(engine, /function executeOrder/);
  assert.doesNotMatch(engine, /fetch\s*\(|XMLHttpRequest|\/api\/v3\//i);
  assert.doesNotMatch(html, /buyMarket|sellMarket|placeOrder|POST\s+\/api/i);
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /VIBRATE|READ_CONTACTS|WRITE_EXTERNAL_STORAGE/);
});
