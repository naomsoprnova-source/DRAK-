(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const chart = $('chart');
  if (!chart) return;

  const INTERVAL_MS = Object.freeze({
    '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000
  });
  const MIN_VISIBLE = 20;
  const MAX_VISIBLE = 1000;
  const MAX_STREAM_HISTORY = 500;
  const SOCKET_HOSTS = ['wss://stream.binance.com:9443', 'wss://stream.binance.com'];
  const state = {
    model: null,
    streamHistory: [],
    liveBar: null,
    liveClosed: false,
    revision: 0,
    cachedRevision: -1,
    cachedData: null,
    visibleCount: 120,
    end: null,
    overlays: {ema9: false, ema21: true, ema50: false, bollinger: true, supertrend: true, volume: true},
    layout: null,
    socket: null,
    reconnectTimer: null,
    generation: 0,
    reconnectAttempt: 0,
    framePending: false,
    pointers: new Map(),
    drag: null,
    pinch: null,
    visibleRangeListener: null
  };

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const priceText = value => Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', {maximumSignificantDigits: 7}).format(value)
    : '—';
  const volumeText = value => Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', {notation: value >= 1e9 ? 'compact' : 'standard', maximumFractionDigits: 2}).format(value)
    : '—';
  const fullTimeText = value => new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(value));
  const axisTimeText = value => new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: 'short'}).format(new Date(value));

  function streamStatus(message, connected = false) {
    const element = $('chart-stream-status');
    if (!element) return;
    element.textContent = message;
    element.className = 'chart-stream-status' + (connected ? ' is-connected' : '');
  }

  function closeSocketOnly() {
    if (state.reconnectTimer !== null) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    const socket = state.socket;
    state.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      try { socket.close(1000, 'Market Observatory pause'); } catch (_) {}
    }
  }

  function stopStream(clearConfig = true) {
    state.generation++;
    state.reconnectAttempt = 0;
    closeSocketOnly();
    if (clearConfig) state.streamConfig = null;
  }

  function streamUrl(config, hostIndex) {
    const host = SOCKET_HOSTS[hostIndex % SOCKET_HOSTS.length];
    return host + '/ws/' + config.symbol.toLowerCase() + '@kline_' + config.interval;
  }

  function scheduleReconnect(token) {
    if (token !== state.generation || !state.streamConfig || navigator.onLine === false) return;
    const attempt = state.reconnectAttempt++;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(attempt, 5)));
    const hostIndex = attempt % SOCKET_HOSTS.length;
    streamStatus('انقطع الاتصال الحي؛ إعادة المحاولة خلال ' + Math.ceil(delay / 1000) + 'ث…');
    state.reconnectTimer = setTimeout(() => connectStream(token, hostIndex), delay);
  }

  function parseLiveBar(kline) {
    if (!kline || typeof kline !== 'object') return null;
    const bar = {
      time: Number(kline.t), open: Number(kline.o), high: Number(kline.h),
      low: Number(kline.l), close: Number(kline.c), volume: Number(kline.v)
    };
    if (!Object.values(bar).every(Number.isFinite) || bar.time < 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0) return null;
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) return null;
    return bar;
  }

  function updateLiveBar(kline) {
    if (!state.model) return;
    const bar = parseLiveBar(kline);
    if (!bar) return;
    const lastBase = state.model.candles[state.model.candles.length - 1];
    const intervalMs = INTERVAL_MS[state.model.interval];
    if (!lastBase || !intervalMs || bar.time < lastBase.time + intervalMs) return;

    if (state.liveBar && bar.time > state.liveBar.time) {
      state.streamHistory.push(state.liveBar);
      if (state.streamHistory.length > MAX_STREAM_HISTORY) state.streamHistory.shift();
    }
    state.liveBar = bar;
    state.liveClosed = Boolean(kline.x);
    state.revision++;
    state.cachedRevision = -1;

    const changePct = bar.open ? ((bar.close / bar.open) - 1) * 100 : 0;
    const livePrice = $('chart-live-price');
    if (livePrice) livePrice.textContent = priceText(bar.close);
    const change = $('chart-live-change');
    if (change) {
      change.textContent = (changePct > 0 ? '+' : '') + changePct.toFixed(2) + '%';
      change.className = 'chart-live-change ' + (changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'neutral');
    }
    if (state.liveClosed) {
      streamStatus('أغلقت الشمعة؛ الإشارة والاختبار لم يتغيرا', true);
    } else {
      streamStatus('متصل · الشمعة الحالية تتحرك', true);
    }
    scheduleRender();
  }

  function connectStream(token, hostIndex = 0) {
    if (token !== state.generation || !state.streamConfig || !state.model) return;
    if (navigator.onLine === false) {
      streamStatus('غير متصل بالإنترنت؛ سيُستأنف البث عند عودة الشبكة.');
      return;
    }
    if (!window.WebSocket) {
      streamStatus('البث الحي غير مدعوم في هذا المتصفح.');
      return;
    }
    const config = state.streamConfig;
    streamStatus(state.reconnectAttempt ? 'جارٍ إعادة الاتصال ببيانات Binance…' : 'جارٍ الاتصال ببيانات Binance…');
    let socket;
    try { socket = new window.WebSocket(streamUrl(config, hostIndex)); }
    catch (_) { scheduleReconnect(token); return; }
    state.socket = socket;
    socket.onopen = () => {
      if (token !== state.generation || state.socket !== socket) { try { socket.close(); } catch (_) {} return; }
      state.reconnectAttempt = 0;
      streamStatus('متصل · بانتظار تحديث الشمعة…', true);
    };
    socket.onmessage = event => {
      if (token !== state.generation || state.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        updateLiveBar(message && message.k);
      } catch (_) {}
    };
    socket.onerror = () => { try { socket.close(); } catch (_) {} };
    socket.onclose = () => {
      if (token !== state.generation || state.socket !== socket) return;
      state.socket = null;
      scheduleReconnect(token);
    };
  }

  function startStream(symbol, interval) {
    stopStream(true);
    if (!window.WebSocket) {
      streamStatus('الرسم جاهز؛ البث الحي غير مدعوم في هذا المتصفح.');
      return;
    }
    state.streamConfig = {symbol, interval};
    state.reconnectAttempt = 0;
    connectStream(state.generation, 0);
  }

  function getPlotData() {
    if (!state.model) return null;
    if (state.cachedRevision === state.revision && state.cachedData) return state.cachedData;
    const bars = state.model.candles.concat(state.streamHistory, state.liveBar ? [state.liveBar] : []);
    const hasStreamingBars = bars.length !== state.model.candles.length;
    const indicators = hasStreamingBars && window.MarketRadarEngine
      ? window.MarketRadarEngine.indicatorsFor(bars)
      : state.model.indicators;
    state.cachedData = {bars, indicators};
    state.cachedRevision = state.revision;
    return state.cachedData;
  }

  function pathFor(series, start, end, xAt, yAt) {
    if (!Array.isArray(series)) return '';
    let path = '', open = false;
    for (let index = start; index < end; index++) {
      const value = series[index];
      if (!Number.isFinite(value)) { open = false; continue; }
      path += (open ? 'L' : 'M') + xAt(index - start).toFixed(2) + ' ' + yAt(value).toFixed(2) + ' ';
      open = true;
    }
    return path.trim();
  }

  function linePath(series, start, end, xAt, yAt, color, width = 1.5, dash = '') {
    const path = pathFor(series, start, end, xAt, yAt);
    if (!path) return '';
    return '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
  }

  function bandPolygon(upper, lower, start, end, xAt, yAt) {
    if (!Array.isArray(upper) || !Array.isArray(lower)) return '';
    const top = [], bottom = [];
    for (let index = start; index < end; index++) {
      if (Number.isFinite(upper[index]) && Number.isFinite(lower[index])) {
        top.push([xAt(index - start), yAt(upper[index])]);
        bottom.push([xAt(index - start), yAt(lower[index])]);
      }
    }
    if (top.length < 2) return '';
    const points = top.concat(bottom.reverse()).map(point => point[0].toFixed(2) + ',' + point[1].toFixed(2)).join(' ');
    return '<polygon points="' + points + '" fill="#4c8b78" fill-opacity=".07" stroke="none"/>';
  }

  function render() {
    const plotData = getPlotData();
    if (!plotData || !plotData.bars.length) return;
    const {bars, indicators} = plotData;
    const total = bars.length;
    const end = state.end === null ? total : clamp(Math.floor(state.end), 1, total);
    const count = clamp(Math.min(Math.floor(state.visibleCount), total, MAX_VISIBLE), 1, MAX_VISIBLE);
    const start = Math.max(0, end - count);
    const visible = bars.slice(start, end);
    const width = Math.max(300, chart.clientWidth || 820);
    const height = Math.max(245, chart.clientHeight || 330);
    const left = 12, right = width - 74, top = 24, timeAxisHeight = 22;
    const volumeHeight = Math.max(42, Math.min(62, height * .19));
    const volumeBottom = height - timeAxisHeight - 3;
    const volumeTop = volumeBottom - volumeHeight;
    const priceBottom = volumeTop - 12;
    const plotWidth = Math.max(100, right - left);
    const priceHeight = Math.max(90, priceBottom - top);
    const priceValues = visible.flatMap(bar => [bar.high, bar.low]);
    const overlayKeys = [];
    if (state.overlays.ema9) overlayKeys.push('fast');
    if (state.overlays.ema21) overlayKeys.push('mid');
    if (state.overlays.ema50) overlayKeys.push('slow');
    if (state.overlays.supertrend) overlayKeys.push('superTrend');
    if (state.overlays.bollinger) overlayKeys.push('bollingerUpper', 'bollingerLower');
    for (const key of overlayKeys) {
      const series = indicators[key];
      if (Array.isArray(series)) for (let index = start; index < end; index++) if (Number.isFinite(series[index])) priceValues.push(series[index]);
    }
    let min = Math.min(...priceValues), max = Math.max(...priceValues);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (!(max > min)) { const gap = Math.max(Math.abs(min) * .01, 1); min -= gap; max += gap; }
    const padding = (max - min) * .06;
    min -= padding; max += padding;
    const step = plotWidth / visible.length;
    const xAt = index => left + (index + .5) * step;
    const yAt = value => top + ((max - value) / (max - min)) * priceHeight;
    const grid = [];
    for (let tick = 0; tick <= 4; tick++) {
      const y = top + tick * priceHeight / 4;
      const value = max - tick * (max - min) / 4;
      grid.push('<line x1="' + left + '" y1="' + y.toFixed(2) + '" x2="' + right + '" y2="' + y.toFixed(2) + '" stroke="#213047" stroke-width="1"/>');
      grid.push('<text x="' + (width - 7) + '" y="' + (y + 4).toFixed(2) + '" text-anchor="end" fill="#91a2b9" font-size="10">' + priceText(value) + '</text>');
    }
    const maxVolume = Math.max(1, ...visible.map(item => item.volume));
    const volumeMarkup = state.overlays.volume ? visible.map((bar, localIndex) => {
      const volumeRatio = Math.max(0, bar.volume) / maxVolume;
      const barHeight = Math.max(.8, volumeRatio * (volumeHeight - 5));
      const color = bar.close >= bar.open ? '#61ddb2' : '#ff7f8f';
      return '<rect x="' + (xAt(localIndex) - Math.max(.45, step * .32)).toFixed(2) + '" y="' + (volumeBottom - barHeight).toFixed(2) + '" width="' + Math.max(.8, step * .64).toFixed(2) + '" height="' + barHeight.toFixed(2) + '" fill="' + color + '" fill-opacity=".48"/>';
    }).join('') : '';
    const candleMarkup = visible.map((bar, localIndex) => {
      const color = bar.close >= bar.open ? '#61ddb2' : '#ff7f8f';
      const candleX = xAt(localIndex);
      const wickWidth = step < 2 ? .8 : 1.1;
      const bodyWidth = Math.max(.8, Math.min(13, step * .66));
      const bodyTop = Math.min(yAt(bar.open), yAt(bar.close));
      const bodyHeight = Math.max(.9, Math.abs(yAt(bar.open) - yAt(bar.close)));
      return '<line x1="' + candleX.toFixed(2) + '" y1="' + yAt(bar.high).toFixed(2) + '" x2="' + candleX.toFixed(2) + '" y2="' + yAt(bar.low).toFixed(2) + '" stroke="' + color + '" stroke-width="' + wickWidth + '"/><rect x="' + (candleX - bodyWidth / 2).toFixed(2) + '" y="' + bodyTop.toFixed(2) + '" width="' + bodyWidth.toFixed(2) + '" height="' + bodyHeight.toFixed(2) + '" fill="' + color + '"' + (state.liveBar && bar.time === state.liveBar.time ? ' stroke="#ffffff" stroke-width=".8"' : '') + '/>';
    }).join('');
    const overlays = [];
    if (state.overlays.bollinger) {
      overlays.push(bandPolygon(indicators.bollingerUpper, indicators.bollingerLower, start, end, xAt, yAt));
      overlays.push(linePath(indicators.bollingerUpper, start, end, xAt, yAt, '#4c8b78', 1, '3 4'));
      overlays.push(linePath(indicators.bollingerLower, start, end, xAt, yAt, '#4c8b78', 1, '3 4'));
    }
    if (state.overlays.ema9) overlays.push(linePath(indicators.fast, start, end, xAt, yAt, '#61ddb2', 1.3));
    if (state.overlays.ema21) overlays.push(linePath(indicators.mid, start, end, xAt, yAt, '#8db8ff', 1.7));
    if (state.overlays.ema50) overlays.push(linePath(indicators.slow, start, end, xAt, yAt, '#c995ff', 1.3));
    if (state.overlays.supertrend) overlays.push(linePath(indicators.superTrend, start, end, xAt, yAt, '#f4c66a', 1.4));
    const timeTicks = [];
    const tickCount = clamp(Math.floor(plotWidth / 105), 2, 6);
    for (let tick = 0; tick < tickCount; tick++) {
      const localIndex = visible.length < 2 ? 0 : Math.round(tick * (visible.length - 1) / (tickCount - 1));
      const label = axisTimeText(visible[localIndex].time, state.model.interval);
      const anchor = tick === 0 ? 'start' : tick === tickCount - 1 ? 'end' : 'middle';
      timeTicks.push('<text class="chart-time-label" x="' + xAt(localIndex).toFixed(2) + '" y="' + (height - 5) + '" text-anchor="' + anchor + '" fill="#91a2b9" font-size="9">' + label + '</text>');
    }
    const latest = visible[visible.length - 1];
    const latestY = clamp(yAt(latest.close), top, priceBottom);
    const currentLabel = state.liveBar && latest.time === state.liveBar.time ? 'حية' : 'إغلاق';
    const svg = '<svg class="market-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" direction="ltr" role="img" aria-label="مخطط تفاعلي لزوج ' + state.model.symbol + ' على إطار ' + state.model.interval + '"><defs><clipPath id="market-price-clip"><rect x="' + left + '" y="' + top + '" width="' + plotWidth + '" height="' + priceHeight + '"/></clipPath><clipPath id="market-volume-clip"><rect x="' + left + '" y="' + volumeTop + '" width="' + plotWidth + '" height="' + volumeHeight + '"/></clipPath></defs><rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#091321" fill-opacity=".55"/>' + grid.join('') + '<line x1="' + left + '" y1="' + volumeTop + '" x2="' + right + '" y2="' + volumeTop + '" stroke="#34445b" stroke-width="1" stroke-dasharray="3 4"/><g clip-path="url(#market-volume-clip)">' + volumeMarkup + '</g><g clip-path="url(#market-price-clip)">' + overlays.join('') + candleMarkup + '<line id="market-live-price-line" x1="' + left + '" y1="' + latestY.toFixed(2) + '" x2="' + right + '" y2="' + latestY.toFixed(2) + '" stroke="' + (latest.close >= latest.open ? '#61ddb2' : '#ff7f8f') + '" stroke-width=".8" stroke-dasharray="4 4" opacity=".75"/></g><rect x="' + (right + 1) + '" y="' + (latestY - 9).toFixed(2) + '" width="70" height="18" rx="4" fill="' + (latest.close >= latest.open ? '#1e5b4a' : '#633342') + '"/><text id="market-live-price-label" x="' + (width - 7) + '" y="' + (latestY + 3).toFixed(2) + '" text-anchor="end" fill="#ffffff" font-size="10" font-weight="700">' + priceText(latest.close) + '</text><text x="' + (left + 2) + '" y="14" fill="#9dafc6" font-size="10">' + state.model.symbol + ' · ' + state.model.interval + ' · ' + currentLabel + '</text><g id="market-crosshair" visibility="hidden" pointer-events="none"><line id="market-crosshair-v" x1="0" y1="' + top + '" x2="0" y2="' + volumeBottom + '" stroke="#b9c8dc" stroke-opacity=".7" stroke-dasharray="3 3"/><line id="market-crosshair-h" x1="' + left + '" y1="0" x2="' + right + '" y2="0" stroke="#b9c8dc" stroke-opacity=".7" stroke-dasharray="3 3"/><rect id="market-crosshair-price-bg" x="' + (right + 1) + '" y="0" width="70" height="18" rx="4" fill="#657d9d"/><text id="market-crosshair-price" x="' + (width - 7) + '" y="0" text-anchor="end" fill="#ffffff" font-size="10" font-weight="700">—</text><rect id="market-crosshair-time-bg" x="0" y="' + (height - 22) + '" width="110" height="18" rx="4" fill="#33465f"/><text id="market-crosshair-time" x="0" y="' + (height - 9) + '" text-anchor="middle" fill="#ffffff" font-size="9">—</text></g>' + timeTicks.join('') + '</svg>';
    chart.innerHTML = svg;
    chart.setAttribute('aria-label', 'مخطط تفاعلي لزوج ' + state.model.symbol + ' على إطار ' + state.model.interval + '؛ ' + visible.length + ' شمعة ظاهرة. اسحب للتحريك واستخدم العجلة أو القرص للتكبير.');
    state.layout = {width, height, left, right, top, priceBottom, volumeBottom, plotWidth, priceHeight, step, start, end, count: visible.length, min, max, bars};
    updateControls(total, visible.length);
    if (typeof state.visibleRangeListener === 'function') {
      try {
        const lastVisible = visible[visible.length - 1];
        state.visibleRangeListener(visible, {symbol: state.model.symbol, interval: state.model.interval,
          startIndex: start, endIndex: end, total, lastIsLive: Boolean(state.liveBar && lastVisible && lastVisible.time === state.liveBar.time)});
      } catch (_) {}
    }
    const visibleLabel = $('chart-visible-count');
    if (visibleLabel) visibleLabel.textContent = visible.length.toLocaleString('en-US') + ' شمعة';
    if (state.lastPointer) updateCrosshair(state.lastPointer);
    else setReadout(latest, state.liveBar && latest.time === state.liveBar.time);
  }

  function setReadout(bar, live = false) {
    const element = $('chart-candle-info');
    if (!element || !bar) return;
    element.textContent = (live ? 'جارية · ' : '') + fullTimeText(bar.time) + '  O ' + priceText(bar.open) + '  H ' + priceText(bar.high) + '  L ' + priceText(bar.low) + '  C ' + priceText(bar.close) + '  V ' + volumeText(bar.volume);
  }

  function setCrosshairAttribute(selector, name, value) {
    const element = chart.querySelector ? chart.querySelector(selector) : null;
    if (element) element.setAttribute(name, String(value));
    return element;
  }

  function updateCrosshair(event) {
    if (!state.layout || !chart.querySelector) return;
    const rect = chart.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) * state.layout.width / rect.width;
    const py = (event.clientY - rect.top) * state.layout.height / rect.height;
    if (px < state.layout.left || px > state.layout.right || py < state.layout.top || py > state.layout.priceBottom) {
      hideCrosshair();
      return;
    }
    const local = clamp(Math.floor((px - state.layout.left) / state.layout.step), 0, state.layout.count - 1);
    const global = state.layout.start + local;
    const bar = state.layout.bars[global];
    if (!bar) return;
    state.lastPointer = {clientX: event.clientX, clientY: event.clientY};
    const crossX = state.layout.left + (local + .5) * state.layout.step;
    const crossY = clamp(py, state.layout.top, state.layout.priceBottom);
    const value = state.layout.max - ((crossY - state.layout.top) / state.layout.priceHeight) * (state.layout.max - state.layout.min);
    const group = chart.querySelector('#market-crosshair');
    if (group) group.setAttribute('visibility', 'visible');
    setCrosshairAttribute('#market-crosshair-v', 'x1', crossX);
    setCrosshairAttribute('#market-crosshair-v', 'x2', crossX);
    setCrosshairAttribute('#market-crosshair-h', 'y1', crossY);
    setCrosshairAttribute('#market-crosshair-h', 'y2', crossY);
    const priceBg = setCrosshairAttribute('#market-crosshair-price-bg', 'y', crossY - 9);
    const priceLabel = chart.querySelector('#market-crosshair-price');
    if (priceLabel) { priceLabel.setAttribute('y', crossY + 3); priceLabel.textContent = priceText(value); }
    const timeBg = chart.querySelector('#market-crosshair-time-bg');
    const timeLabel = chart.querySelector('#market-crosshair-time');
    const timeX = clamp(crossX, state.layout.left + 45, state.layout.right - 45);
    if (timeBg) timeBg.setAttribute('x', timeX - 45);
    if (timeLabel) { timeLabel.setAttribute('x', timeX); timeLabel.textContent = axisTimeText(bar.time, state.model.interval); }
    if (priceBg) priceBg.setAttribute('fill', '#657d9d');
    setReadout(bar, state.liveBar && bar.time === state.liveBar.time);
  }

  function hideCrosshair() {
    const group = chart.querySelector ? chart.querySelector('#market-crosshair') : null;
    if (group) group.setAttribute('visibility', 'hidden');
  }

  function updateControls(total, visible) {
    for (const range of [60, 120, 250, 500]) {
      const button = $('chart-range-' + range);
      if (button) button.setAttribute('aria-pressed', String(visible === Math.min(range, total)));
    }
    const allButton = $('chart-range-all');
    if (allButton) allButton.setAttribute('aria-pressed', String(visible === Math.min(total, MAX_VISIBLE)));
    for (const key of Object.keys(state.overlays)) {
      const button = $('chart-toggle-' + key);
      if (button) button.setAttribute('aria-pressed', String(state.overlays[key]));
    }
  }

  function scheduleRender() {
    if (state.framePending) return;
    state.framePending = true;
    const raf = window.requestAnimationFrame || (callback => setTimeout(callback, 0));
    raf(() => { state.framePending = false; render(); });
  }

  function visibleTotal() { return state.model ? state.model.candles.length + state.streamHistory.length + (state.liveBar ? 1 : 0) : 0; }
  function setRange(count, toLatest = true) {
    if (!state.model) return;
    const total = visibleTotal();
    state.visibleCount = clamp(Math.floor(count), MIN_VISIBLE, Math.min(MAX_VISIBLE, total));
    if (toLatest) state.end = null;
    render();
  }

  function bindControl(id, handler) {
    const element = $(id);
    if (element && element.addEventListener) element.addEventListener('click', handler);
  }
  for (const range of [60, 120, 250, 500]) bindControl('chart-range-' + range, () => setRange(range));
  bindControl('chart-range-all', () => setRange(visibleTotal()));
  bindControl('chart-zoom-in', () => setRange(state.visibleCount * .75, false));
  bindControl('chart-zoom-out', () => setRange(state.visibleCount * 1.35, false));
  bindControl('chart-latest', () => { state.end = null; setRange(120); });
  for (const key of Object.keys(state.overlays)) {
    bindControl('chart-toggle-' + key, () => { state.overlays[key] = !state.overlays[key]; render(); });
  }

  if (chart.addEventListener) {
    chart.addEventListener('wheel', event => {
      if (!state.model) return;
      if (event.preventDefault) event.preventDefault();
      setRange(state.visibleCount * (event.deltaY < 0 ? .82 : 1.22), false);
    }, {passive: false});
    chart.addEventListener('pointerdown', event => {
      if (!state.model || (event.pointerType === 'mouse' && event.button !== 0)) return;
      state.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
      try { chart.setPointerCapture(event.pointerId); } catch (_) {}
      if (state.pointers.size >= 2) {
        const points = [...state.pointers.values()];
        state.pinch = {distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), count: state.visibleCount, end: state.end};
        state.drag = null;
      } else {
        const rect = chart.getBoundingClientRect();
        state.drag = {pointerId: event.pointerId, x: event.clientX, end: state.end === null ? visibleTotal() : state.end, moved: false, plotWidth: Math.max(100, rect.width - 86)};
        updateCrosshair(event);
      }
    });
    chart.addEventListener('pointermove', event => {
      if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
      if (state.pointers.size >= 2 && state.pinch) {
        const points = [...state.pointers.values()];
        const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
        setRange(state.pinch.count * state.pinch.distance / distance, false);
        state.end = state.pinch.end;
        render();
        return;
      }
      if (state.drag && state.drag.pointerId === event.pointerId) {
        const delta = event.clientX - state.drag.x;
        if (Math.abs(delta) > 3) {
          state.drag.moved = true;
          state.end = clamp(state.drag.end - Math.round(delta * state.visibleCount / state.drag.plotWidth), state.visibleCount, visibleTotal());
          render();
        }
      }
      updateCrosshair(event);
    });
    const finishPointer = event => {
      state.pointers.delete(event.pointerId);
      if (state.pointers.size < 2) state.pinch = null;
      if (state.drag && state.drag.pointerId === event.pointerId) state.drag = null;
      if (!state.pointers.size) hideCrosshair();
      try { chart.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    chart.addEventListener('pointerup', finishPointer);
    chart.addEventListener('pointercancel', finishPointer);
    chart.addEventListener('pointerleave', () => { if (!state.drag && !state.pointers.size) hideCrosshair(); });
    chart.addEventListener('keydown', event => {
      if (!state.model) return;
      if (event.key === '+' || event.key === '=') { setRange(state.visibleCount * .75, false); event.preventDefault(); }
      else if (event.key === '-') { setRange(state.visibleCount * 1.35, false); event.preventDefault(); }
      else if (event.key === 'Home') { state.end = null; render(); event.preventDefault(); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const end = state.end === null ? visibleTotal() : state.end;
        state.end = clamp(end + (event.key === 'ArrowLeft' ? -5 : 5), state.visibleCount, visibleTotal());
        render(); event.preventDefault();
      }
    });
  }

  function setData({candles, indicators, symbol, interval}) {
    stopStream(true);
    state.model = {candles, indicators, symbol, interval};
    state.streamHistory = [];
    state.liveBar = null;
    state.liveClosed = false;
    state.revision++;
    state.cachedRevision = -1;
    state.visibleCount = Math.min(120, candles.length);
    state.end = null;
    state.lastPointer = null;
    const last = candles[candles.length - 1];
    if (last) {
      $('chart-live-price').textContent = priceText(last.close);
      $('chart-live-change').textContent = 'آخر إغلاق';
      $('chart-live-change').className = 'chart-live-change neutral';
    }
    streamStatus('جارٍ فتح بث الشمعة الجارية…');
    render();
    startStream(symbol, interval);
  }

  function clear() {
    stopStream(true);
    state.model = null;
    state.streamHistory = [];
    state.liveBar = null;
    state.liveClosed = false;
    state.cachedRevision = -1;
    state.cachedData = null;
    state.layout = null;
    state.end = null;
    state.lastPointer = null;
    const price = $('chart-live-price');
    const change = $('chart-live-change');
    const info = $('chart-candle-info');
    if (price) price.textContent = '—';
    if (change) change.textContent = '—';
    if (info) info.textContent = 'حرّك المؤشر أو المس شمعة لقراءة OHLCV.';
    streamStatus('بانتظار تحليل السوق.');
    chart.innerHTML = '<div class="chart-state chart-empty">لا توجد بيانات مرسومة بعد.<br>ابدأ التحليل لعرض حركة السعر.</div>';
    if (typeof state.visibleRangeListener === 'function') {
      try { state.visibleRangeListener([], {symbol: null, interval: null, startIndex: 0, endIndex: 0, total: 0, lastIsLive: false}); } catch (_) {}
    }
  }

  function setVisibleRangeListener(listener) {
    state.visibleRangeListener = typeof listener === 'function' ? listener : null;
    if (state.visibleRangeListener && state.layout) {
      const {bars, start, end, total} = state.layout;
      const visible = bars.slice(start, end);
      const lastVisible = visible[visible.length - 1];
      state.visibleRangeListener(visible, {symbol: state.model.symbol, interval: state.model.interval,
        startIndex: start, endIndex: end, total, lastIsLive: Boolean(state.liveBar && lastVisible && lastVisible.time === state.liveBar.time)});
    }
  }

  function restartIfReady() {
    if (state.model && state.streamConfig) {
      const config = state.streamConfig;
      stopStream(false);
      state.streamConfig = config;
      connectStream(state.generation, 0);
    }
  }
  if (window.addEventListener) {
    window.addEventListener('resize', scheduleRender);
    window.addEventListener('orientationchange', scheduleRender);
    window.addEventListener('offline', () => { closeSocketOnly(); streamStatus('غير متصل؛ يتوقف البث حتى عودة الإنترنت.'); });
    window.addEventListener('online', restartIfReady);
    window.addEventListener('beforeunload', () => stopStream(true));
  }
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) closeSocketOnly();
      else restartIfReady();
    });
  }

  window.MarketRadarChart = Object.freeze({setData, clear, setVisibleRangeListener});
})();
