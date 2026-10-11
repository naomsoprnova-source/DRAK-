import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineSource = fs.readFileSync(path.join(root, 'web/engine.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const chartSource = fs.readFileSync(path.join(root, 'web/chart.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const activitySource = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/ans/marketobservatory/MainActivity.java'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'web/sw.js'), 'utf8');
const androidBuildSource = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const engineWindow = {};
vm.runInNewContext(engineSource, {window: engineWindow}, {timeout: 5000});
const core = engineWindow.MarketRadarEngine;
assert(core, 'algorithm engine is exposed');

const seeded = core.ema([1, 2, 3, 4, 5], 3);
assert.equal(seeded[0], null);
assert.equal(seeded[2], 2);
assert.equal(seeded[4], 4);
assert(core.ema([1, 2], 3).every(value => value === null));

const rising = Array.from({length: 20}, (_, i) => 10 + i);
const falling = Array.from({length: 20}, (_, i) => 30 - i);
const flat = Array(20).fill(8);
assert.equal(core.rsi(rising, 14)[14], 100);
assert.equal(core.rsi(falling, 14)[14], 0);
assert.equal(core.rsi(flat, 14)[14], 50);

const flatBars = Array.from({length: 50}, (_, i) => ({time: i, open: 100, high: 101, low: 99, close: 100, volume: 10}));
assert.equal(core.atr(flatBars, 14)[13], 2);
assert.equal(core.atr(flatBars, 14)[14], 2);
assert.equal(core.stochastic(flatBars, 14, 3).k[49], 50);
assert.equal(core.stochastic(flatBars, 14, 3).d[49], 50);
assert.equal(core.bollinger(Array(25).fill(10), 20, 2).upper[24], 10);
assert.equal(core.bollinger(Array(25).fill(10), 20, 2).lower[24], 10);
assert.equal(core.volumeStats(flatBars, 20).ratio[25], 1);
assert.equal(core.volumeSignal(135, 100).direction, 1, 'volume above MA20 casts the shared +1 vote');
assert.equal(core.volumeSignal(135, 100).ratio, 1.35, 'the displayed ratio comes from the same volume rule helper');
assert.equal(core.volumeSignal(100, 100).direction, -1, 'equal volume is -1 because the rule is strictly greater-than');
assert.equal(core.volumeSignal(90, 100).direction, -1, 'volume at or below MA20 casts -1 without candle-direction exceptions');
assert.equal(core.volumeSignal(null, 100).direction, 0, 'unavailable inputs do not fabricate a vote');
assert.equal(core.obv(flatBars)[20], 10);
assert(core.adx(flatBars, 14).slice(0, 27).every(value => value === null));
assert.equal(core.adx(flatBars, 14)[27], 0);
assert.equal(core.parabolicSar(flatBars).direction.at(-1), 1);
assert.equal(core.superTrend(flatBars, 10, 3).direction.at(-1), 1);

const collisionLong = core.chooseExit({direction: 1, stop: 95, target: 110}, {open: 100, high: 111, low: 94, close: 105});
assert.equal(collisionLong.reason, 'same-bar-stop-first');
assert.equal(collisionLong.price, 95);
assert.equal(core.chooseExit({direction: 1, stop: 95, target: 110}, {open: 92, high: 96, low: 90, close: 93}).price, 92);
assert.equal(core.chooseExit({direction: 1, stop: 95, target: 110}, {open: 112, high: 114, low: 111, close: 113}).price, 112);

const bullishIndicators = {
  fast: [3, 3], mid: [2, 2], slow: [1, 1], rsi: [60, 60], atr: [1, 1], adx: [24, 24],
  macdLine: [2, 2], macdSignal: [1, 1], macdHistogram: [1, 1], superTrendDirection: [1, 1],
  obvSlope: [10, 10], volumeAverage: [100, 100], volumeRatio: [1.2, 1.2]
};
const bullishReading = core.classify([{close: 2, volume: 90}, {close: 3, volume: 120}], bullishIndicators, 1);
assert.equal(bullishReading.direction, 1);
assert.equal(bullishReading.score, 7);
assert.equal(bullishReading.maxScore, 7);
assert.equal(core.classify([{close: 2, volume: 90}, {close: 3, volume: 120}], {...bullishIndicators, adx: [24, 17.9]}, 1).direction, 0, 'weak ADX blocks entry even when votes align');
assert.equal(bullishReading.score, 2 + bullishReading.independentVotes.reduce((sum, item) => sum + item.direction, 0), 'score uses the exact independent votes shown in the report');
const bearishVolumeReading = core.classify([{close: 4, volume: 100}, {close: 3, volume: 90}], bullishIndicators, 1);
assert.equal(bearishVolumeReading.independentVotes.find(item => item.key === 'volume').direction, -1, 'volume vote follows the exact volume-versus-MA20 rule, not candle direction');
assert.equal(bearishVolumeReading.volume.actual, 90);
assert.equal(bearishVolumeReading.volume.average, 100);
assert.equal(bearishVolumeReading.score, 5, 'a volume-below-average vote reduces the bullish score from seven to five');
const bearishReading = core.classify([{close: 2, volume: 100}, {close: 1, volume: 90}], {
  fast: [1, 1], mid: [2, 2], slow: [3, 3], rsi: [40, 40], atr: [1, 1], adx: [25, 25],
  macdLine: [-2, -2], macdSignal: [-1, -1], macdHistogram: [-1, -1], superTrendDirection: [-1, -1],
  obvSlope: [-10, -10], volumeAverage: [100, 100], volumeRatio: [1.2, 1.2]
}, 1);
assert.equal(bearishReading.direction, -1);

const sizing = core.calculatePositionSize({equity: 30, riskPct: 1, entry: 100, direction: 1, stopDistance: 2, feePerSide: 0.001, slippagePerSide: 0.0005, maxNotional: 30});
assert(sizing && sizing.quantity > 0);
assert(sizing.notional <= 30);
assert(sizing.expectedStopLoss <= 0.3 + 1e-10, 'stop risk including fees/slippage stays within risk budget before gaps');
assert(core.netPnlPerUnit(100, 110, 1, 0.001, 0.0005) < 10, 'fees and slippage reduce gross trade P&L');

const normalized = core.normalizeCandles([
  [2000, '10', '12', '9', '11', '5'],
  [1000, '8', '10', '7', '9', '4'],
  [2000, '10', '12', '9', '11', '5'],
  [3000, '10', '9', '8', '10', '1'],
  [4000, '10', '12', '9', '11', '-1']
]);
assert.equal(normalized.length, 2);
assert.equal(normalized[0].time, 1000);

function marketFixture(count = 520) {
  const now = Date.now(), intervalMs = 4 * 60 * 60 * 1000;
  const currentBoundary = Math.floor(now / intervalMs) * intervalMs;
  let close = 100;
  const rows = [];
  for (let i = 0; i < count; i++) {
    const drift = 0.00035 + 0.0016 * Math.sin(i / 25) + 0.0007 * Math.sin(i * 0.57);
    close *= 1 + drift;
    const open = i ? rows[i - 1][4] * (1 + 0.0003 * Math.sin(i * 0.91)) : close;
    const high = Math.max(open, close) * (1 + 0.002 + 0.0003 * Math.abs(Math.sin(i)));
    const low = Math.min(open, close) * (1 - 0.002 - 0.0002 * Math.abs(Math.cos(i)));
    const volume = 900 + 180 * (1 + Math.sin(i * 0.37)) + (i % 31 < 5 ? 350 : 0);
    const time = currentBoundary - (count - i) * intervalMs;
    rows.push([time, String(open), String(high), String(low), String(close), String(volume), time + intervalMs - 1]);
  }
  return rows;
}
const synthetic = marketFixture();
const candles = core.normalizeCandles(synthetic);
const indicators = core.indicatorsFor(candles);
const last = candles.length - 1;
for (const key of ['adx','macdHistogram','stochasticK','bollingerUpper','sar','superTrend','obvSlope','volumeRatio']) assert(Number.isFinite(indicators[key][last]), key + ' is finite after warm-up');
const actualReading = core.classify(candles, indicators, last);
assert(actualReading.score >= -7 && actualReading.score <= 7);
const options = {capital: 30, riskPct: 1, feePerSide: 0.001, slippagePerSide: 0.0005, longOnly: true};
const backtest = core.runBacktest(candles, options);
assert(Number.isFinite(backtest.totalReturn));
assert(Number.isFinite(backtest.maxDrawdown) && backtest.maxDrawdown >= 0);
assert.equal(backtest.initialCapital, 30);
assert.equal(backtest.openPosition, false, 'any position is closed/marked at the end of its test window');
assert.equal(backtest.finalEquity, 30 + backtest.tradeList.reduce((sum, trade) => sum + trade.netPnl, 0));
const grossWins = backtest.tradeList.filter(trade => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
const grossLosses = backtest.tradeList.filter(trade => trade.netPnl < 0).reduce((sum, trade) => sum - trade.netPnl, 0);
if (grossLosses > 0) assert(Math.abs(backtest.profitFactor - grossWins / grossLosses) < 1e-10, 'profit factor is based on equity-sized USDT P&L after costs');
if (backtest.tradeList.length > 1) assert.notEqual(backtest.tradeList[0].quantity, backtest.tradeList[1].quantity, 'risk-sized trade units respond to the changed equity/market');
const validation = core.walkForward(candles, options);
assert.equal(validation.splitIndex, Math.floor(candles.length * 0.7));
assert(validation.inSample.endIndex <= validation.outOfSample.startIndex);
assert(Number.isFinite(validation.outOfSample.totalReturn));
assert(validation.benchmark.returnPct === null || Number.isFinite(validation.benchmark.returnPct));
const cachedBacktest = core.runBacktest(candles, options, indicators);
const cachedValidation = core.walkForward(candles, options, indicators);
assert.equal(JSON.stringify(cachedBacktest), JSON.stringify(backtest), 'precomputed indicators preserve backtest outputs');
assert.equal(JSON.stringify(cachedValidation), JSON.stringify(validation), 'precomputed indicators preserve walk-forward outputs');
assert.throws(() => core.runBacktest(candles, options, core.indicatorsFor(candles.slice(0, -1))), /طول|مؤشر|بيانات/);

assert.match(html, /http-equiv="Content-Security-Policy"/i, 'page defines a restrictive CSP');
assert.match(html, /script-src 'self'; style-src 'self'/, 'scripts and styles are restricted to same-origin files');
assert.match(html, /connect-src[^\"]*wss:\/\/stream\.binance\.com/, 'CSP allows only the fixed public Binance WebSocket origins');
assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/i, 'CSP does not enable inline code or eval');
assert.match(html, /\.\/app\.css/);
assert.match(html, /\.\/app\.js/);
assert.match(html, /\.\/chart\.js/);
assert(html.includes('A: بوابة + 3/5') && html.includes('B: 3/5 بدون بوابة'), 'A/B thresholds are labeled separately from the live signal score');
assert(html.includes('A مع EMA ±2 وثلاثة أصوات موافقة = |5/7|') && html.includes('B مع EMA محايد = 3/7، أو 5/7'), 'A/B total-score relationships are qualified by the EMA and neutral-vote state');
assert(html.includes('Buy &amp; Hold الحالي · الشموع المرئية فقط'), 'current Buy & Hold is labeled as a visible-window display reference');
const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
const engineTags = scriptTags.filter(tag => /\bsrc=["']\.\/engine\.js["']/i.test(tag));
const chartTags = scriptTags.filter(tag => /\bsrc=["']\.\/chart\.js["']/i.test(tag));
const appTags = scriptTags.filter(tag => /\bsrc=["']\.\/app\.js["']/i.test(tag));
assert.equal(engineTags.length, 1, 'engine.js is included exactly once');
assert.equal(chartTags.length, 1, 'chart.js is included exactly once');
assert.equal(appTags.length, 1, 'app.js is included exactly once');
assert.match(chartSource, /direction="ltr"/, 'numeric chart axes use left-to-right SVG text direction inside the RTL app');
assert(/\bdefer\b/i.test(engineTags[0]) && /\bdefer\b/i.test(chartTags[0]) && /\bdefer\b/i.test(appTags[0]), 'engine, chart, and app scripts defer execution until HTML parsing finishes');
assert(html.indexOf(engineTags[0]) < html.indexOf(chartTags[0]) && html.indexOf(chartTags[0]) < html.indexOf(appTags[0]), 'engine loads before chart and chart before app');
assert.doesNotMatch(html, /<style\b/i, 'styles are externalized for a strict CSP');
assert.doesNotMatch(html, /<script\s*>/i, 'application script is externalized for a strict CSP');
assert.doesNotMatch(html, /\sstyle=/i, 'inline style attributes are absent');
assert(activitySource.includes('settings.setAllowContentAccess(false)'), 'WebView blocks content URI access');
assert(activitySource.includes('settings.setAllowFileAccessFromFileURLs(false)'), 'WebView blocks file URL cross-origin access');
assert(activitySource.includes('isPackagedAppUrl(uri)'), 'top-level navigation is restricted to the packaged document');
assert(serviceWorkerSource.includes("'./app.js'") && serviceWorkerSource.includes("'./chart.js'") && serviceWorkerSource.includes("'./app.css'"), 'PWA precaches the app and interactive chart modules');
assert(serviceWorkerSource.includes('market-radar-shell-v12'), 'PWA invalidates the previous shell cache after adding the analysis summary card');
assert(androidBuildSource.includes("include 'index.html', 'app.js', 'app.css', 'engine.js', 'chart.js'"), 'APK packages the interactive chart module');

// UI integration: load the pure engine and app module in a credential-free mock browser.
const listeners = {}, windowListeners = {}, elements = new Map();
let requestCount = 0, catalogRequestCount = 0;
const catalogFixture = {symbols: [
  {symbol: 'BTCUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: true},
  {symbol: 'ETHUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: true},
  {symbol: 'BNBUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: true},
  {symbol: 'SOLUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: true},
  {symbol: 'BTCUSDC', status: 'TRADING', quoteAsset: 'USDC', isSpotTradingAllowed: true},
  {symbol: 'OLDUSDT', status: 'BREAK', quoteAsset: 'USDT', isSpotTradingAllowed: true},
  {symbol: 'NOTSPOTUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: false}
]};
let mockFetch = async url => {
  if (url.includes('/exchangeInfo?')) {
    catalogRequestCount++;
    assert(url.includes('permissions=SPOT') && url.includes('symbolStatus=TRADING'), 'catalog is scoped to current active spot markets');
    return {ok: true, status: 200, json: async () => catalogFixture};
  }
  throw new Error('unexpected market request before fixture setup');
};
const requests = [];
let uiIndicatorCalls = 0, uiCachedBacktestCalls = 0, uiCachedWalkForwardCalls = 0;
const navigator = {clipboard: {writeText: async () => {}}, onLine: true};
function fakeElement(id) {
  return {
    id, textContent: '', innerHTML: '', className: '', disabled: false, value: '', hidden: false, children: [], attributes: {},
    classList: {add(){}, remove(){}, toggle(){}},
    addEventListener(name, fn) { (listeners[id] ||= {})[name] = fn; },
    getBoundingClientRect() { return id === 'chart' ? {left: 0, top: 0, width: 600, height: 340} : {left: 0, top: 0, width: 0, height: 0}; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; }, select(){}, append(...children){this.children.push(...children);}, appendChild(child){this.children.push(child);}, replaceChildren(...children){this.children = children;}, showModal(){this.modalOpen = true;}, close(){this.modalOpen = false;}, style: {}
  };
}
const document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); },
  createElement: fakeElement
};
const uiEngine = {
  ...core,
  indicatorsFor(bars) { uiIndicatorCalls++; return core.indicatorsFor(bars); },
  runBacktest(bars, opts, cached) { if (cached) uiCachedBacktestCalls++; return core.runBacktest(bars, opts, cached); },
  walkForward(bars, opts, cached) { if (cached) uiCachedWalkForwardCalls++; return core.walkForward(bars, opts, cached); }
};
const webSocketInstances = [];
class FakeWebSocket {
  constructor(url) { this.url = url; webSocketInstances.push(this); }
  close() { this.closed = true; }
}
const window = {MarketRadarEngine: uiEngine, WebSocket: FakeWebSocket, isSecureContext: false, addEventListener(name, fn) { windowListeners[name] = fn; }};
const context = {document, window, Intl, Math, Number, Array, Object, Date, Map, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: (...args) => mockFetch(...args), navigator, console};
vm.runInNewContext(chartSource, context, {timeout: 5000});
assert(window.MarketRadarChart, 'interactive chart module is initialized before the app');
vm.runInNewContext(appSource, context, {timeout: 5000});
assert(window.MarketRadar, 'public test API uses the shared engine');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(catalogRequestCount, 1, 'symbol catalog is fetched once during app startup');
assert.equal(elements.get('symbol-options').children.map(option => option.value).join(','), 'BNBUSDT,BTCUSDT,ETHUSDT,SOLUSDT', 'catalog excludes non-USDT, halted, and non-spot markets');
assert(elements.get('symbol-list-status').textContent.includes('4 زوج USDT نشط'));
for (const [id, value] of Object.entries({symbol: 'BTCUSDT', interval: '4h', limit: '500', capital: '30', risk: '1', fee: '0.1', slippage: '0.05'})) document.getElementById(id).value = value;
mockFetch = async (url, request) => {
  requestCount++;
  requests.push({url, request});
  assert(url.startsWith('https://data-api.binance.vision/'));
  assert.equal(request.credentials, 'omit');
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/ticker/24hr')) {
    return {ok: true, status: 200, json: async () => ({symbol: 'BTCUSDT', openPrice: '120', lastPrice: '123.45', highPrice: '130', lowPrice: '110', volume: '321.5', quoteVolume: '39600', priceChangePercent: '2.50', closeTime: Date.now()})};
  }
  const limit = Number(parsed.searchParams.get('limit'));
  assert(Number(limit) <= 1000, 'Binance request stays within its API limit');
  assert(Number.isFinite(Number(parsed.searchParams.get('endTime'))), 'request is bounded to completed-candle time');
  return {ok: true, status: 200, json: async () => synthetic.slice(-limit)};
};
await listeners.analyze.click();
assert.equal(requestCount, 6, 'main chart, four alternate timeframes, and one 24h ticker request use public data without credentials');
assert.equal(Number(new URL(requests[0].url).searchParams.get('limit')), 501, 'one extra bar is requested to replace a possibly open candle');
assert.equal(elements.get('status').textContent.includes('اكتمل التحليل: 500 شمعة'), true, 'analysis honors the requested maximum, not the API response length');
assert.equal(elements.get('summary-price').textContent, new Intl.NumberFormat('en-US', {maximumFractionDigits: 8}).format(123.45), 'summary card displays the Binance 24h ticker last price');
assert.equal(elements.get('summary-change').textContent, '+2.50%', 'summary card displays the rolling 24h percentage change');
assert.equal(elements.get('summary-open').textContent, new Intl.NumberFormat('en-US', {maximumFractionDigits: 8}).format(120) + ' USDT', 'summary card displays the 24h open price');
assert(elements.get('summary-close').textContent.includes(new Intl.NumberFormat('en-US', {maximumFractionDigits: 8}).format(123.45)), 'summary card displays the 24h close/last price');
assert.equal(elements.get('summary-high').textContent, new Intl.NumberFormat('en-US', {maximumFractionDigits: 8}).format(130), 'summary card displays the 24h high');
assert.equal(elements.get('summary-low').textContent, new Intl.NumberFormat('en-US', {maximumFractionDigits: 8}).format(110), 'summary card displays the 24h low');
assert(elements.get('summary-volume').textContent.includes('321.5 BTC'), 'summary card displays base-asset 24h volume');
assert(elements.get('summary-quote-volume').textContent.includes('39,600 USDT'), 'summary card displays quote-asset 24h volume');
assert(elements.get('summary-note').textContent.includes('لا تمثل أوامر تداول'), 'summary card keeps the educational, non-execution disclosure');
assert.equal(uiIndicatorCalls, 5, 'indicators are computed once per distinct timeframe');
assert.equal(uiCachedBacktestCalls, 0, 'ordinary market analysis does not run a backtest');
assert.equal(uiCachedWalkForwardCalls, 0, 'ordinary market analysis does not run walk-forward');
assert(elements.get('chart').innerHTML.includes('market-chart-svg'), 'interactive candlestick SVG is rendered');
assert(elements.get('chart').innerHTML.includes('<rect'), 'chart contains candle bodies and volume bars');
assert(elements.get('chart').innerHTML.includes('market-crosshair'), 'chart includes a pointer crosshair and price/time readouts');
assert.equal(elements.get('chart-visible-count').textContent, '120 شمعة', 'chart opens on a readable 120-candle window');
assert.notEqual(elements.get('visible-benchmark-return').textContent, '—', 'visible-window Buy & Hold is calculated without running a backtest');
assert(elements.get('visible-benchmark-detail').textContent.includes('120 شمعة ظاهرة'));
assert.equal(webSocketInstances.length, 1, 'chart opens one public live stream for the selected pair and interval');
assert.equal(webSocketInstances[0].url, 'wss://stream.binance.com:9443/ws/btcusdt@kline_4h');
const closedCandleSignal = elements.get('signal').textContent;
webSocketInstances[0].onopen();
const liveOpen = candles.at(-1).close, liveClose = liveOpen * 1.001;
webSocketInstances[0].onmessage({data: JSON.stringify({k: {t: candles.at(-1).time + 4 * 60 * 60 * 1000, o: String(liveOpen), h: String(liveClose * 1.0002), l: String(liveOpen * .9998), c: String(liveClose), v: '12345', x: false}})});
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(elements.get('chart-live-price').textContent, new Intl.NumberFormat('en-US', {maximumSignificantDigits: 7}).format(liveClose), 'live candle updates the chart price');
assert(elements.get('chart-stream-status').textContent.includes('الشمعة الحالية تتحرك'), 'chart labels its forming candle as live');
assert(elements.get('chart').innerHTML.includes('حية'), 'forming Binance candle is rendered separately as a live bar');
assert.equal(elements.get('signal').textContent, closedCandleSignal, 'live price does not silently replace the closed-candle signal');
await listeners['chart-range-60'].click();
assert.equal(elements.get('chart-visible-count').textContent, '60 شمعة', 'range control changes visible candle count');
assert(elements.get('visible-benchmark-detail').textContent.includes('60 شمعة ظاهرة'), 'visible-window benchmark follows chart range changes');
await listeners['chart-zoom-in'].click();
assert.equal(elements.get('chart-visible-count').textContent, '45 شمعة', 'zoom control narrows the chart window');
assert(elements.get('visible-benchmark-detail').textContent.includes('45 شمعة ظاهرة'), 'visible-window benchmark follows chart zoom');
await listeners['chart-latest'].click();
assert.equal(elements.get('chart-visible-count').textContent, '120 شمعة', 'latest control returns to the live edge');
const beforePan = elements.get('chart').innerHTML;
listeners.chart.pointerdown({pointerId: 9, clientX: 200, clientY: 100, pointerType: 'mouse', button: 0});
listeners.chart.pointermove({pointerId: 9, clientX: 280, clientY: 100, pointerType: 'mouse'});
listeners.chart.pointerup({pointerId: 9});
assert.notEqual(elements.get('chart').innerHTML, beforePan, 'dragging pans the visible candle window');
assert.equal(elements.get('chart-visible-count').textContent, '120 شمعة', 'panning preserves the selected zoom level');
await listeners['chart-latest'].click();
await listeners['chart-toggle-ema9'].click();
assert.equal(elements.get('chart-toggle-ema9').attributes['aria-pressed'], 'true', 'indicator chips can be toggled accessibly');
assert(elements.get('report').textContent.includes('اختبار A/B وwalk-forward متعدد الفترات: متوقفان'));
assert(elements.get('report').textContent.includes('مرشح القوة (ليس صوتًا): ADX'));
assert(elements.get('report').textContent.includes('15m:'));
assert(elements.get('tf-1w-signal').textContent !== 'بانتظار البيانات');
assert(elements.get('tf-1w-strength').textContent.includes('مرشح قوة'));
assert(elements.get('stochastic').textContent !== '—');
assert(elements.get('status').textContent.includes('اكتمل التحليل'));

const beforeInvalid = requestCount;
document.getElementById('symbol').value = 'INVALID SYMBOL';
await listeners.analyze.click();
assert.equal(requestCount, beforeInvalid, 'invalid symbol rejected before network');
assert(elements.get('report').textContent.includes('لا يوجد تقرير صالح'), 'failed analysis clears stale report');
assert.equal(elements.get('copy').disabled, true);

const beforeUnknownPair = requestCount;
document.getElementById('symbol').value = 'QUSDT';
await listeners.analyze.click();
assert.equal(requestCount, beforeUnknownPair, 'unlisted QUSDT is rejected before a market-data request');
assert(elements.get('status').textContent.includes('لا يوجد زوج Binance Spot نشط باسم QUSDT'), 'unknown pair receives an actionable Arabic explanation');
assert.equal(elements.get('copy').disabled, true);

document.getElementById('symbol').value = 'ETHUSDT';
requestCount = 0;
mockFetch = async () => {
  requestCount++;
  return {ok: false, status: 400, json: async () => ({code: -1121, msg: 'Invalid symbol.'})};
};
await listeners.analyze.click();
assert.equal(requestCount, 1, 'invalid-symbol response does not retry against a second host');
assert(elements.get('status').textContent.includes('الزوج ETHUSDT غير مدرج كزوج Binance Spot نشط مقوّم بـUSDT'));
assert.equal(elements.get('copy').disabled, true);

requestCount = 0;
mockFetch = async () => {
  requestCount++;
  return {ok: false, status: 429, json: async () => ({msg: 'rate limited'})};
};
await listeners.analyze.click();
assert.equal(requestCount, 1, 'rate limiting does not trigger an immediate retry on a second hostname');
assert(elements.get('status').textContent.includes('حد الطلب'), 'rate limit produces a clear wait-and-retry message');
assert.equal(elements.get('copy').disabled, true);

requestCount = 0;
requests.length = 0;
const intervalMs = 4 * 60 * 60 * 1000;
const currentBoundary = Math.floor(Date.now() / intervalMs) * intervalMs;
const unfinished = [currentBoundary, '9999', '10001', '9000', '9999', '1', currentBoundary + intervalMs - 1];
mockFetch = async (url, request) => {
  requestCount++;
  requests.push({url, request});
  assert.equal(request.credentials, 'omit');
  if (requestCount === 1) throw new TypeError('network failure');
  return {ok: true, status: 200, json: async () => [...synthetic.slice(-Number(new URL(url).searchParams.get('limit'))), unfinished]};
};
await listeners.analyze.click();
assert.equal(requestCount, 7, 'primary request retries once on alternate host; four scanner requests and one optional 24h ticker request complete');
assert.equal(new URL(requests[1].url).hostname, 'api.binance.com', 'network failure falls back once to the alternate official host');
assert(elements.get('status').textContent.includes('اكتمل التحليل: 500 شمعة'));
assert(!elements.get('price').textContent.includes('9,999'), 'unfinished candle excluded from displayed price');

document.getElementById('limit').value = '1000';
requestCount = 0;
requests.length = 0;
mockFetch = async (url, request) => {
  requestCount++;
  requests.push({url, request});
  const limit = Number(new URL(url).searchParams.get('limit'));
  return {ok: true, status: 200, json: async () => synthetic.slice(-limit)};
};
await listeners.analyze.click();
assert.equal(Number(new URL(requests[0].url).searchParams.get('limit')), 1000, 'maximum input does not exceed Binance maximum to compensate for an open candle');
assert(elements.get('status').textContent.includes('520 شمعة'), 'shorter historical responses are reported accurately');
document.getElementById('limit').value = '500';

requestCount = 0;
let releaseScanners;
const scannerGate = new Promise(resolve => { releaseScanners = resolve; });
mockFetch = async url => {
  requestCount++;
  const limit = Number(new URL(url).searchParams.get('limit'));
  const response = {ok: true, status: 200, json: async () => synthetic.slice(-limit)};
  if (requestCount === 1) return response;
  await scannerGate;
  return response;
};
const pendingAnalysis = listeners.analyze.click();
await new Promise(resolve => setTimeout(resolve, 25));
assert(elements.get('chart').innerHTML.includes('<svg'), 'primary chart is visible while alternate timeframe requests are pending');
assert(elements.get('status').textContent.includes('اكتمل الإطار الأساسي'), 'progress state identifies completed primary analysis');
assert(elements.get('report').textContent.includes('جارٍ فحص الأطر الزمنية'), 'report clearly indicates that the full scan is pending');
releaseScanners();
await pendingAnalysis;
assert(elements.get('status').textContent.includes('اكتمل التحليل'), 'final state appears when alternate scans finish');

navigator.onLine = false;
const beforeOffline = requestCount;
await listeners.analyze.click();
assert.equal(requestCount, beforeOffline, 'offline path sends no market requests');
assert(elements.get('status').textContent.includes('لا يوجد اتصال بالإنترنت'));
navigator.onLine = true;

let promptPrevented = false, promptCalls = 0;
windowListeners.beforeinstallprompt({preventDefault(){promptPrevented = true;}, prompt: async () => {promptCalls++;}, userChoice: Promise.resolve({outcome: 'accepted'})});
await listeners['install-app'].click();
assert(promptPrevented);
assert.equal(promptCalls, 1);
assert(elements.get('status').textContent.includes('تمت إضافة مرصد العملات'));

console.log(JSON.stringify({
  status: 'passed',
  indicatorCoverage: ['SMA-seeded EMA', 'Wilder RSI/ATR/ADX', 'MACD', 'volume average', 'OBV', 'Stochastic', 'Bollinger', 'Parabolic SAR', 'SuperTrend'],
  algorithmCoverage: ['EMA plus five shared independent votes and ADX strength gate', 'risk sizing includes per-side fees/slippage', 'gap exits and same-candle stop-first', 'equity-based profit factor and marked drawdown', '70/30 chronological holdout and cost-adjusted buy-and-hold'],
  uiCoverage: ['deferred engine.js → chart.js → app.js load order', 'live Binance Spot USDT catalog filtering', 'QUSDT preflight rejection and Binance -1121 handling', 'multi-timeframe scan', 'primary result rendered before secondary scans finish', 'interactive candlestick/volume SVG with price/time axes and crosshair', 'mocked live Binance kline stream updates only the chart, not the closed-candle signal', 'range, zoom, drag-to-pan, latest-edge, and indicator toggle controls', 'report generation', 'credential-free fetch', 'bounded candle count', 'completed-candle cutoff and top-up request', 'rate-limit-safe retry behavior', 'fallback on network failure', 'no stale results', 'offline state', 'Android install prompt', 'strict CSP resources', 'bounded WebView navigation'],
  backtest: {trades: backtest.trades, winRatePct: Number(backtest.winRate.toFixed(2)), returnPct: Number(backtest.totalReturn.toFixed(2)), maxDrawdownPct: Number(backtest.maxDrawdown.toFixed(2)), profitFactor: Number.isFinite(backtest.profitFactor) ? Number(backtest.profitFactor.toFixed(2)) : 'Infinity'},
  finalSignal: {direction: actualReading.direction, score: actualReading.score, maxScore: actualReading.maxScore}
}, null, 2));
