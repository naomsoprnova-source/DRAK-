import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const baseUrl = process.env.MARKET_RADAR_URL || 'http://127.0.0.1:18767/';
const screenshotPath = process.env.MARKET_RADAR_SCREENSHOT || path.resolve('market-radar-preview.png');
const skipScreenshot = process.env.MARKET_RADAR_SKIP_SCREENSHOT === '1';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'market-radar-chrome-'));
const chrome = spawn(process.env.CHROMIUM || '/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', '--remote-allow-origins=*', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${profile}`, 'about:blank'
], {stdio: 'ignore'});

let socket;
try {
  const activePortFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(activePortFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(activePortFile)) throw new Error('Chromium remote debugging did not start.');

  const port = Number(fs.readFileSync(activePortFile, 'utf8').split('\n')[0]);
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('Chromium did not expose a page target.');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const browserErrors = [];
  const marketResponses = [];
  const marketRequests = [];
  const websocketUrls = [];
  const websocketErrors = [];
  let websocketFrameCount = 0;
  let nextId = 1;
  socket.addEventListener('open', () => {});
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text || 'JavaScript exception');
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) browserErrors.push(message.params.entry.text);
    if (message.method === 'Network.responseReceived') {
      const {url} = message.params.response;
      if (url.includes('/api/v3/klines') || url.includes('/api/v3/exchangeInfo')) marketResponses.push({url, status: message.params.response.status});
    }
    if (message.method === 'Network.requestWillBeSent') {
      const {url} = message.params.request;
      if (url.includes('/api/v3/klines') || url.includes('/api/v3/exchangeInfo')) marketRequests.push(url);
    }
    if (message.method === 'Network.webSocketCreated') websocketUrls.push(message.params.url);
    if (message.method === 'Network.webSocketFrameReceived') websocketFrameCount++;
    if (message.method === 'Network.webSocketFrameError') websocketErrors.push(message.params.errorMessage);
  });
  await new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result.value;
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await cdp('Page.navigate', {url: baseUrl});

  const loadDeadline = Date.now() + 15000;
  while (Date.now() < loadDeadline) {
    const ready = await evaluate("document.readyState === 'complete' && !!document.getElementById('analyze')");
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!await evaluate("!!document.getElementById('analyze')")) throw new Error('The application document did not load.');

  const catalogDeadline = Date.now() + 40000;
  let symbolListStatus = '';
  while (Date.now() < catalogDeadline) {
    symbolListStatus = await evaluate("document.getElementById('symbol-list-status').textContent");
    if (!symbolListStatus.includes('جار تحديث')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await evaluate("document.getElementById('analyze').click(); true");
  const analysisDeadline = Date.now() + 60000;
  let finalState;
  while (Date.now() < analysisDeadline) {
    finalState = await evaluate("({status:document.getElementById('status').textContent, price:document.getElementById('price').textContent, bars:(document.getElementById('chart').querySelectorAll('rect').length), csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content || ''})");
    if (finalState.status.includes('اكتمل التحليل') || finalState.status.includes('تعذر')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  let liveStatus = '';
  const streamDeadline = Date.now() + 20000;
  while (Date.now() < streamDeadline) {
    liveStatus = await evaluate("document.getElementById('chart-stream-status').textContent");
    if (liveStatus.includes('متصل')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const frameDeadline = Date.now() + 10000;
  while (websocketFrameCount === 0 && Date.now() < frameDeadline) await new Promise(resolve => setTimeout(resolve, 250));
  const liveChartState = await evaluate("({status:document.getElementById('chart-stream-status').textContent, price:document.getElementById('chart-live-price').textContent, visible:document.getElementById('chart-visible-count').textContent, hasCrosshair:!!document.querySelector('#chart #market-crosshair')})");
  if (!liveStatus.includes('متصل') || websocketFrameCount === 0) throw new Error('Live Binance WebSocket did not deliver a chart update: ' + JSON.stringify({liveStatus, websocketUrls, websocketFrameCount, websocketErrors}));

  const viewportChecks = [];
  for (const width of [320, 390, 768, 1024, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', {width, height: 844, deviceScaleFactor: 1, mobile: width <= 768});
    await new Promise(resolve => setTimeout(resolve, 80));
    viewportChecks.push(await evaluate(`({requestedWidth:${width},width:innerWidth, documentWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth, shellWidth:document.querySelector('.shell').clientWidth, chartWidth:document.getElementById('chart').clientWidth, hasSvg:!!document.querySelector('#chart svg'), overflow:[...document.querySelectorAll('body *')].map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width&&(x.r.right>innerWidth+1||x.r.left< -1)).slice(0,8).map(x=>({tag:x.e.tagName,id:x.e.id,className:typeof x.e.className==='string'?x.e.className:'svg',left:Math.round(x.r.left),right:Math.round(x.r.right)}))})`));
  }
  await cdp('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate("document.getElementById('chart-range-60').click(); true");
  const range60 = await evaluate("document.getElementById('chart-visible-count').textContent");
  await evaluate("document.getElementById('chart-zoom-in').click(); true");
  const zoomedRange = await evaluate("document.getElementById('chart-visible-count').textContent");
  await evaluate("const el=document.getElementById('chart'); const r=el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+r.width*.52,clientY:r.top+r.height*.38,pointerId:41,pointerType:'mouse'})); true");
  const crosshairReadout = await evaluate("({visibility:document.querySelector('#chart #market-crosshair').getAttribute('visibility'), readout:document.getElementById('chart-candle-info').textContent})");
  const timeAxisTicks = await evaluate("[...document.querySelectorAll('#chart .chart-time-label')].map(el=>{const r=el.getBBox();return {left:r.x,right:r.x+r.width,text:el.textContent}})");
  const overlayChips = await evaluate("(()=>{const c=document.querySelector('.chart-overlay-tools').getBoundingClientRect();return [...document.querySelectorAll('.chart-overlay-tools .chart-chip')].map(el=>{const r=el.getBoundingClientRect();return{id:el.id,left:Math.round(r.left),right:Math.round(r.right),containerLeft:Math.round(c.left),containerRight:Math.round(c.right)}})})()");
  const timeAxisOverlap = timeAxisTicks.some((tick, index) => index > 0 && tick.left < timeAxisTicks[index - 1].right - 1);
  const clippedOverlayChips = overlayChips.filter(chip => chip.left < chip.containerLeft - 1 || chip.right > chip.containerRight + 1);
  if (timeAxisOverlap || clippedOverlayChips.length) throw new Error('Mobile chart labels or indicator controls overlap/clip: ' + JSON.stringify({timeAxisTicks, overlayChips, timeAxisOverlap, clippedOverlayChips}));
  await evaluate("document.getElementById('chart-latest').click(); document.getElementById('chart').dispatchEvent(new PointerEvent('pointerleave',{bubbles:true,pointerId:41,pointerType:'mouse'})); true");
  if (range60 !== '60 شمعة' || !zoomedRange.includes('شمعة') || crosshairReadout.visibility !== 'visible' || !crosshairReadout.readout.includes('O ')) throw new Error('Interactive chart controls or crosshair did not respond: ' + JSON.stringify({range60, zoomedRange, crosshairReadout}));
  await evaluate("const y=document.getElementById('chart-title').getBoundingClientRect().top+window.scrollY-48; window.scrollTo({top:y,behavior:'instant'}); true");
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!skipScreenshot) {
    const screenshot = await cdp('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false});
    fs.mkdirSync(path.dirname(screenshotPath), {recursive: true});
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate("document.getElementById('symbol').value='QUSDT'; document.getElementById('analyze').click(); true");
  const qusdtDeadline = Date.now() + 8000;
  let qusdtStatus = '';
  while (Date.now() < qusdtDeadline) {
    qusdtStatus = await evaluate("document.getElementById('status').textContent");
    if (qusdtStatus.includes('لا يوجد زوج Binance Spot نشط باسم QUSDT') || qusdtStatus.includes('الزوج QUSDT غير مدرج')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const symbolSuggestionCount = await evaluate("document.getElementById('symbol-options').options.length");

  const summary = {
    url: baseUrl,
    status: finalState?.status || 'لم تظهر حالة نهائية',
    price: finalState?.price || '—',
    chartBarsAndVolumeRects: finalState?.bars || 0,
    symbolListStatus,
    symbolSuggestionCount,
    qusdtStatus,
    qusdtRequests: marketRequests.filter(url => url.includes('symbol=QUSDT')),
    csp: finalState?.csp || '',
    marketResponses,
    viewportChecks,
    liveChartState,
    websocketUrls,
    websocketFrameCount,
    websocketErrors,
    chartInteractions: {range60, zoomedRange, crosshairReadout, timeAxisTicks, overlayChips},
    browserErrors,
    screenshot: skipScreenshot ? null : screenshotPath
  };
  fs.writeFileSync(path.join(path.dirname(screenshotPath), 'browser-smoke-results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (viewportChecks.some(view => view.width !== view.requestedWidth || view.documentWidth > view.width || view.bodyWidth > view.width)) process.exitCode = 1;
  if (browserErrors.length) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  chrome.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 250));
  fs.rmSync(profile, {recursive: true, force: true});
}
