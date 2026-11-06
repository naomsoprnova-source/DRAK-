(function () {
  'use strict';

  const Engine = window.DrakPaperEngine;
  const MarketBridge = window.DrakMarketBridge;
  const STORAGE_KEY = 'drak_paper_local_v3';
  const MARKET_CACHE_KEY = 'drak_market_real_cache_v1';
  const LEGACY_STORAGE_KEYS = ['drak_ui_v1', 'drak_paper_local_v2'];
  const REFRESH_INTERVAL_MS = 60000;
  const QUOTE_FRESH_MS = 120000;
  const STRATEGIES = Object.freeze({
    composite: { title: 'مرصد مركّب', description: 'اتجاه وزخم وحجم واختراق على شموع مغلقة.' },
    'ema-cross': { title: 'تقاطع المتوسطات', description: 'تقاطع EMA9 وEMA21 بعد إغلاق الشمعة.' },
    'rsi-rebound': { title: 'ارتداد RSI', description: 'ارتداد RSI فوق 35 مع تأكيد إغلاق.' },
    macd: { title: 'زخم MACD', description: 'تقاطع MACD مع فلتر EMA50.' },
    bollinger: { title: 'نطاق بولينجر', description: 'عودة الإغلاق إلى نطاق بولينجر.' },
    breakout: { title: 'اختراق قمة', description: 'قمة سابقة وحجم نسبي وإغلاق فوق EMA50.' },
    'trend-follow': { title: 'اتباع الاتجاه', description: 'اتجاه EMA وزخم RSI وMACD.' }
  });
  const numberFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const tickerPrices = Object.create(null);
  const historicalCache = new Map();

  function hasOwn(object, key) { return object != null && Object.prototype.hasOwnProperty.call(object, key); }
  function all(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function setText(selector, text) { all(selector).forEach((node) => { node.textContent = text; }); }
  function formatMoney(value) { return Number.isFinite(Number(value)) ? numberFormat.format(Number(value)) : '—'; }
  function formatPrice(value) { return Number.isFinite(Number(value)) ? priceFormat.format(Number(value)) : '—'; }
  function signedMoney(value) { const number = Number(value); return Number.isFinite(number) ? (number >= 0 ? '+' : '−') + formatMoney(Math.abs(number)) : '—'; }
  function localDate(timestamp) {
    try { return new Intl.DateTimeFormat('ar-YE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
    catch (_) { return new Date(timestamp).toLocaleString(); }
  }
  function delay(milliseconds) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

  let restoreNotice = false;
  clearLegacyState();
  const stored = readLocal();
  const settings = sanitizeSettings(stored && stored.settings);
  let account = restoreAccount(stored && stored.account);
  let selectedStrategy = hasOwn(STRATEGIES, settings.strategy) ? settings.strategy : 'composite';
  let symbol = hasOwn(Engine.SYMBOLS, settings.symbol) ? settings.symbol : 'BTCUSDT';
  let interval = hasOwn(Engine.INTERVALS, settings.interval) ? settings.interval : '15m';
  let candles = [];
  let currentSignal = { action: 'wait', reason: 'يلزم جلب شموع Binance المغلقة قبل التحليل.', score: 0, rsi: null, source: Engine.SOURCE };
  let marketStatus = 'offline';
  let marketError = '';
  let lastUpdatedAt = null;
  let lastCandleServerTime = null;
  let refreshPromise = null;
  let cooldownUntil = 0;
  let toastTimer = null;
  let pendingConfirmation = null;
  let previousFocus = null;
  let audioContext = null;

  restoreMarketCache();

  function clearLegacyState() {
    LEGACY_STORAGE_KEYS.forEach((key) => {
      try {
        if (localStorage.getItem(key) != null) restoreNotice = true;
        localStorage.removeItem(key);
      } catch (_) { /* Storage may be disabled. */ }
    });
  }

  function sanitizeSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      strategy: hasOwn(STRATEGIES, value.strategy) ? value.strategy : 'composite',
      symbol: hasOwn(Engine.SYMBOLS, value.symbol) ? value.symbol : 'BTCUSDT',
      interval: hasOwn(Engine.INTERVALS, value.interval) ? value.interval : '15m',
      soundEnabled: value.soundEnabled === true,
      vibrationEnabled: value.vibrationEnabled === true
    };
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function restoreAccount(raw) {
    if (!raw || typeof raw !== 'object') return Engine.createAccount();
    try {
      const clean = Engine.createAccount({
        startingCapital: raw.startingCapital,
        maxTradeUsd: raw.maxTradeUsd,
        maxRiskPct: raw.maxRiskPct,
        feeRate: raw.feeRate,
        slippageRate: raw.slippageRate,
        stopLossPct: raw.stopLossPct
      });
      const cash = Number(raw.cash);
      if (!Number.isFinite(cash) || cash < 0 || cash > clean.startingCapital * 1.01) return Engine.createAccount();
      clean.cash = cash;
      if (raw.position != null) {
        const position = raw.position;
        if (!position || typeof position !== 'object') return Engine.createAccount();
        const values = [position.amount, position.quantity, position.entryPrice, position.entryFee, position.stopPrice, position.targetPrice, position.openedAt].map(Number);
        const valid = hasOwn(Engine.SYMBOLS, position.symbol) && hasOwn(Engine.INTERVALS, position.interval) &&
          Engine.STRATEGY_IDS.includes(position.strategy) && position.source === Engine.SOURCE && values.every(Number.isFinite) &&
          values[0] >= 0.01 && values[0] <= clean.maxTradeUsd && Math.abs(values[0] * 100 - Math.round(values[0] * 100)) < 1e-7 &&
          values[1] > 0 && values[2] > 0 && values[3] >= 0 && values[3] <= values[0] * clean.feeRate + 1e-9 &&
          values[4] > 0 && values[4] < values[2] && values[5] > values[2] && values[6] > 0 &&
          Math.abs(values[1] * values[2] - values[0]) <= Math.max(1e-6, values[0] * 1e-6);
        if (!valid) return Engine.createAccount();
        clean.position = {
          symbol: position.symbol, interval: position.interval, strategy: position.strategy,
          amount: values[0], quantity: values[1], entryPrice: values[2], entryFee: values[3],
          stopPrice: values[4], targetPrice: values[5], openedAt: values[6], source: Engine.SOURCE
        };
      }
      clean.history = Array.isArray(raw.history) ? raw.history.filter((item) => {
        if (!item || item.source !== Engine.SOURCE || !hasOwn(Engine.SYMBOLS, item.symbol) ||
            !hasOwn(Engine.INTERVALS, item.interval) || !Engine.STRATEGY_IDS.includes(item.strategy)) return false;
        const numbers = [item.amount, item.quantity, item.entryPrice, item.exitPrice, item.fees, item.pnl, item.openedAt, item.closedAt];
        return numbers.map(Number).every(Number.isFinite) && Number(item.amount) >= 0.01 && Number(item.quantity) > 0 &&
          Number(item.entryPrice) > 0 && Number(item.exitPrice) > 0 && Number(item.fees) >= 0 &&
          Number(item.openedAt) > 0 && Number(item.closedAt) > 0;
      }).slice(0, 300).map((item) => ({
        id: String(item.id || ''), symbol: item.symbol, interval: item.interval, strategy: item.strategy,
        amount: Number(item.amount), quantity: Number(item.quantity), entryPrice: Number(item.entryPrice),
        exitPrice: Number(item.exitPrice), fees: Number(item.fees), slippage: Number(item.slippage) || 0,
        pnl: Number(item.pnl), openedAt: Number(item.openedAt), closedAt: Number(item.closedAt),
        source: Engine.SOURCE, reason: String(item.reason || '')
      })) : [];
      return clean;
    } catch (_) { return Engine.createAccount(); }
  }

  function restoreMarketCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || 'null');
      if (!raw || raw.source !== Engine.SOURCE || !hasOwn(Engine.SYMBOLS, raw.symbol) || !hasOwn(Engine.INTERVALS, raw.interval)) return;
      if (raw.symbol !== symbol || raw.interval !== interval) return;
      const serverTime = Number(raw.serverTime);
      const restored = Engine.validateCandles(raw.candles, { symbol: raw.symbol, interval: raw.interval, serverTime });
      if (restored.length > 300) candles = restored.slice(-300);
      else candles = restored;
      const prices = raw.prices && typeof raw.prices === 'object' ? raw.prices : {};
      Object.keys(Engine.SYMBOLS).forEach((key) => {
        const item = prices[key];
        if (!item || item.source !== Engine.SOURCE) return;
        const price = Number(item.price);
        const receivedAt = Number(item.receivedAt);
        if (Number.isFinite(price) && price > 0 && Number.isFinite(receivedAt) && receivedAt > 0) {
          tickerPrices[key] = { price, receivedAt, serverTime: Number(item.serverTime) || serverTime, source: Engine.SOURCE };
        }
      });
      lastCandleServerTime = serverTime;
      lastUpdatedAt = Number(raw.savedAt) || null;
      marketStatus = 'stale';
      if (candles.length) currentSignal = Engine.analyze(candles, selectedStrategy);
    } catch (_) {
      candles = [];
      lastCandleServerTime = null;
      marketStatus = 'offline';
    }
  }

  function saveLocal() {
    try {
      const persistedAccount = Object.assign({}, account, { history: (account.history || []).slice(0, 300) });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        account: persistedAccount,
        settings: { strategy: selectedStrategy, symbol, interval, soundEnabled: settings.soundEnabled, vibrationEnabled: settings.vibrationEnabled },
        updatedAt: Date.now()
      }));
    } catch (_) { showToast('تعذر حفظ بيانات المحاكاة على هذا الجهاز.'); }
    saveMarketCache();
  }

  function saveMarketCache() {
    if (!candles.length) return;
    try {
      localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({
        source: Engine.SOURCE, symbol, interval, serverTime: lastCandleServerTime,
        savedAt: lastUpdatedAt || Date.now(), candles: candles.slice(-300), prices: tickerPrices
      }));
    } catch (_) { /* A full local cache must not affect current market reads. */ }
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = String(message || '');
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function navigate(name) {
    all('[data-screen]').forEach((screen) => {
      const active = screen.dataset.screen === name;
      screen.classList.toggle('is-active', active);
      screen.hidden = !active;
    });
    all('.nav-button[data-nav]').forEach((button) => {
      const active = button.dataset.nav === name;
      button.classList.toggle('is-current', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'overview') requestAnimationFrame(renderChart);
  }

  function latestTicker(targetSymbol) {
    const item = tickerPrices[targetSymbol || symbol];
    return item && item.source === Engine.SOURCE ? item : null;
  }

  function hasFreshTicker(targetSymbol) {
    const item = latestTicker(targetSymbol);
    return !!item && Date.now() - item.receivedAt <= QUOTE_FRESH_MS;
  }

  function marketPrice(targetSymbol) {
    const item = latestTicker(targetSymbol);
    if (item) return item.price;
    if ((targetSymbol || symbol) === symbol && candles.length) return candles[candles.length - 1].close;
    return null;
  }

  function renderConnection() {
    const badge = document.querySelector('[data-connection-badge]');
    const text = document.querySelector('[data-connection-text]');
    const lastUpdate = document.querySelector('[data-last-updated]');
    const refreshButton = document.getElementById('refresh-button');
    const latest = latestTicker(symbol);
    let displayStatus = marketStatus;
    if (displayStatus === 'connected' && (!latest || Date.now() - latest.receivedAt > QUOTE_FRESH_MS)) displayStatus = 'stale';
    const labels = { connecting: 'جار الاتصال', connected: 'متصل ببيانات عامة', partial: 'بيانات جزئية', stale: 'آخر بيانات محفوظة', offline: 'غير متصل' };
    if (badge) {
      badge.className = 'offline-badge state-' + (displayStatus === 'partial' ? 'stale' : displayStatus === 'connecting' ? 'loading' : displayStatus);
      if (text) text.textContent = labels[displayStatus] || labels.offline;
    }
    if (lastUpdate) lastUpdate.textContent = lastUpdatedAt ? 'آخر تحديث ' + localDate(lastUpdatedAt) : 'لم يصل تحديث بعد';
    if (refreshButton) refreshButton.disabled = !!refreshPromise || Date.now() < cooldownUntil;
    const errorBox = document.getElementById('market-error');
    if (errorBox) {
      errorBox.hidden = !marketError;
      errorBox.textContent = marketError;
    }
  }

  function renderChart() {
    const canvas = document.getElementById('price-chart');
    if (!canvas || !canvas.getContext) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    const height = Math.max(1, rect.height || 178);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    context.clearRect(0, 0, width, height);
    const series = candles.slice(-72).map((item) => item.close);
    if (series.length < 2) {
      context.fillStyle = '#bac4b8'; context.font = '12px system-ui'; context.textAlign = 'center';
      context.fillText('بانتظار شموع Binance المغلقة', width / 2, height / 2);
      return;
    }
    const minimum = Math.min.apply(null, series);
    const maximum = Math.max.apply(null, series);
    const range = maximum - minimum || 1;
    context.strokeStyle = '#394339'; context.lineWidth = 1;
    for (let row = 1; row <= 3; row += 1) {
      const y = (height * row) / 4; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    const points = series.map((value, index) => ({ x: 4 + (index / (series.length - 1)) * (width - 8), y: height - 14 - ((value - minimum) / range) * (height - 30) }));
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.strokeStyle = '#52d1ad'; context.lineWidth = 2.2; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke();
    const last = points[points.length - 1];
    context.beginPath(); context.arc(last.x, last.y, 4, 0, Math.PI * 2); context.fillStyle = '#f4f4eb'; context.fill();
    context.fillStyle = '#bac4b8'; context.font = '11px system-ui'; context.textAlign = 'left';
    context.fillText(formatPrice(maximum), 4, 13); context.fillText(formatPrice(minimum), 4, height - 2);
  }

  function signalTagText() {
    if (!currentSignal || currentSignal.action === 'wait') return { text: 'انتظار', className: 'warn-tag' };
    if (currentSignal.action === 'buy') return { text: 'شروط شراء تعليمية', className: 'good-tag' };
    return { text: 'شروط خروج تعليمية', className: 'bad-tag' };
  }

  function renderSignal() {
    if (candles.length && (!currentSignal || currentSignal.source !== Engine.SOURCE)) {
      try { currentSignal = Engine.analyze(candles, selectedStrategy); }
      catch (error) { currentSignal = { action: 'wait', reason: error.message, score: 0, rsi: null, source: Engine.SOURCE }; }
    }
    const signal = currentSignal || { action: 'wait', reason: 'لا توجد بيانات حقيقية محملة.', score: 0, rsi: null };
    const tag = signalTagText();
    all('[data-signal-tag]').forEach((node) => { node.textContent = tag.text; node.className = 'tag ' + tag.className; });
    setText('[data-signal-strategy]', STRATEGIES[selectedStrategy].title);
    setText('[data-signal-reason]', signal.reason || 'لا توجد إشارة واضحة.');
    setText('[data-signal-score]', Number.isFinite(signal.score) ? signal.score + ' / 5' : '—');
    setText('[data-rsi]', Number.isFinite(signal.rsi) ? signal.rsi.toFixed(1) : '—');
    all('[data-strategy]').forEach((button) => {
      const active = button.dataset.strategy === selectedStrategy;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const analyzeButton = document.getElementById('analyze-button');
    if (analyzeButton) analyzeButton.disabled = candles.length < 60;
  }

  function renderMarketList() {
    const list = document.querySelector('[data-market-list]');
    if (!list) return;
    list.replaceChildren();
    Object.entries(Engine.SYMBOLS).forEach(([code, info]) => {
      const quote = latestTicker(code);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'market-item'; button.dataset.marketPick = code;
      const name = document.createElement('span');
      const title = document.createElement('b'); title.textContent = info.name;
      const subtitle = document.createElement('small'); subtitle.textContent = code + ' · Binance Spot';
      name.append(title, subtitle);
      const value = document.createElement('strong'); value.className = 'number-ltr'; value.textContent = quote ? formatPrice(quote.price) : '—';
      button.append(name, value); list.append(button);
    });
  }

  function renderPosition() {
    const position = account.position;
    const openButton = document.getElementById('open-paper-button');
    const closeButton = document.getElementById('close-paper-button');
    const card = document.getElementById('position-card');
    if (!position) {
      openButton.hidden = false; openButton.disabled = !hasFreshTicker(symbol);
      closeButton.hidden = true; card.hidden = true; card.replaceChildren();
      setText('[data-position-state]', 'لا يوجد'); setText('[data-position-caption]', hasFreshTicker(symbol) ? 'سعر حقيقي متاح' : 'بانتظار سعر حقيقي');
      return;
    }
    openButton.hidden = true; closeButton.hidden = false; closeButton.disabled = !hasFreshTicker(position.symbol); card.hidden = false;
    setText('[data-position-state]', 'مفتوح ورقيًا'); setText('[data-position-caption]', position.symbol + ' · بلا أمر حقيقي');
    card.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'مركز ورقي مفتوح · ' + position.symbol;
    const facts = document.createElement('div'); facts.className = 'position-facts';
    const quote = latestTicker(position.symbol);
    let positionPnl = null;
    if (quote) {
      try {
        const positionStats = Engine.portfolio(account, quote.price, Engine.SOURCE);
        positionPnl = positionStats.totalPnl - positionStats.realizedPnl;
      }
      catch (_) { positionPnl = null; }
    }
    const values = [
      ['السوق والفاصل', position.symbol + ' · ' + position.interval],
      ['الاستراتيجية', hasOwn(STRATEGIES, position.strategy) ? STRATEGIES[position.strategy].title : 'استراتيجية'],
      ['قيمة المركز', formatMoney(position.amount) + ' USDT'],
      ['دخول تقديري', formatPrice(position.entryPrice)],
      ['السعر الحقيقي', quote ? formatPrice(quote.price) : 'لا يوجد اتصال'],
      ['الربح/الخسارة الورقي', positionPnl == null ? '—' : signedMoney(positionPnl) + ' USDT'],
      ['وقف ورقي', formatPrice(position.stopPrice)],
      ['هدف ورقي', formatPrice(position.targetPrice)]
    ];
    values.forEach(([label, value]) => {
      const cell = document.createElement('div'); const small = document.createElement('span'); small.textContent = label;
      const strong = document.createElement('b'); strong.textContent = value;
      if (label.includes('الربح') && positionPnl != null) strong.className = positionPnl >= 0 ? 'positive' : 'negative';
      cell.append(small, strong); facts.append(cell);
    });
    card.append(heading, facts);
  }

  function renderHistory() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    list.replaceChildren();
    const history = account.history || [];
    empty.hidden = history.length > 0;
    setText('[data-history-count]', history.length + ' صفقة ورقية');
    history.slice(0, 100).forEach((trade) => {
      const item = document.createElement('article'); item.className = 'history-item';
      const main = document.createElement('div'); main.className = 'history-item-main';
      const title = document.createElement('b'); title.textContent = trade.symbol + ' · ' + (hasOwn(STRATEGIES, trade.strategy) ? STRATEGIES[trade.strategy].title : 'استراتيجية');
      const detail = document.createElement('small');
      detail.textContent = localDate(trade.closedAt) + ' · ' + trade.interval + ' · رسوم ' + formatMoney(trade.fees) + ' · انزلاق تقديري ' + formatMoney(trade.slippage || 0) + ' USDT · سعر حقيقي';
      main.append(title, detail);
      const pnl = document.createElement('strong'); pnl.className = 'history-pnl ' + (trade.pnl >= 0 ? 'positive' : 'negative'); pnl.textContent = signedMoney(trade.pnl) + ' USDT';
      item.append(main, pnl); list.append(item);
    });
  }

  function renderAll() {
    const quote = latestTicker(symbol);
    const chartClose = candles.length ? candles[candles.length - 1].close : null;
    const displayedPrice = quote ? quote.price : chartClose;
    setText('[data-price]', displayedPrice == null ? '—' : formatPrice(displayedPrice));
    const liveLabel = document.querySelector('[data-live-price-label]');
    if (liveLabel) liveLabel.textContent = quote ? 'سعر Binance Spot اللحظي' : chartClose ? 'إغلاق آخر شمعة حقيقية · السعر اللحظي غير متاح' : 'بانتظار بيانات Binance';
    const caption = document.querySelector('[data-candle-caption]');
    if (caption) caption.textContent = candles.length
      ? 'آخر ' + candles.length + ' شمعة مغلقة من Binance Spot · آخر إغلاق ' + localDate(candles[candles.length - 1].closeTime) + ' · لا تُستخدم الشمعة قيد التكوين.'
      : 'لا توجد شموع محملة. اضغط تحديث لجلب بيانات Binance؛ لا توجد أسعار بديلة.';
    let stats = null;
    if (!account.position) stats = Engine.portfolio(account, 1, Engine.SOURCE);
    else if (marketPrice(account.position.symbol) != null) {
      try { stats = Engine.portfolio(account, marketPrice(account.position.symbol), Engine.SOURCE); }
      catch (_) { stats = null; }
    }
    setText('[data-cash]', formatMoney(account.cash));
    setText('[data-equity]', stats ? formatMoney(stats.equity) : '—');
    setText('[data-total-pnl]', stats ? signedMoney(stats.totalPnl) + ' USDT' : '—');
    setText('[data-trade-count]', String(account.history.length));
    const winCount = account.history.filter((trade) => trade.pnl > 0).length;
    setText('[data-win-rate]', account.history.length ? (winCount / account.history.length * 100).toFixed(0) + '%' : '—');
    setText('[data-max-trade]', formatMoney(account.maxTradeUsd));
    setText('[data-fee-rate]', (account.feeRate * 100).toFixed(2) + '%');
    setText('[data-date]', 'اليوم · ' + new Intl.DateTimeFormat('ar-YE', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()));
    const capitalInput = document.getElementById('capital-input');
    const maxInput = document.getElementById('max-trade-input');
    const riskInput = document.getElementById('risk-input');
    const amountInput = document.getElementById('trade-amount');
    if (capitalInput && document.activeElement !== capitalInput) capitalInput.value = account.startingCapital.toFixed(2);
    if (maxInput && document.activeElement !== maxInput) maxInput.value = account.maxTradeUsd.toFixed(2);
    if (riskInput && document.activeElement !== riskInput) riskInput.value = (account.maxRiskPct * 100).toFixed(1);
    if (amountInput) amountInput.max = account.maxTradeUsd.toFixed(2);
    const soundInput = document.getElementById('sound-toggle');
    const vibrationInput = document.getElementById('vibration-toggle');
    if (soundInput) soundInput.checked = settings.soundEnabled;
    if (vibrationInput) vibrationInput.checked = settings.vibrationEnabled;
    renderConnection(); renderSignal(); renderPosition(); renderHistory(); renderMarketList();
    if (document.getElementById('screen-overview').classList.contains('is-active')) requestAnimationFrame(renderChart);
  }

  function normalizeTickers(response, receivedAt) {
    if (!response || response.ok !== true || !Array.isArray(response.data)) throw new Error('استجابة أسعار Binance غير صالحة.');
    const found = Object.create(null);
    response.data.forEach((row) => {
      if (!row || !hasOwn(Engine.SYMBOLS, row.symbol)) return;
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error('سعر Binance غير صالح.');
      found[row.symbol] = { price, receivedAt, serverTime: Number(response.serverTime), source: Engine.SOURCE };
    });
    Object.keys(Engine.SYMBOLS).forEach((key) => { if (!found[key]) throw new Error('لم يصل سعر ' + key + ' من Binance.'); });
    return found;
  }

  function updateAutomaticPaperExit(receivedAt) {
    const position = account.position;
    if (!position) return null;
    const quote = latestTicker(position.symbol);
    if (!quote || quote.receivedAt !== receivedAt) return null;
    let reason = '';
    if (quote.price <= position.stopPrice) reason = 'وقف ورقي';
    else if (quote.price >= position.targetPrice) reason = 'هدف ورقي';
    if (!reason) return null;
    try {
      account = Engine.closePaperPosition(account, { price: quote.price, now: quote.serverTime || receivedAt, source: Engine.SOURCE, reason });
      const trade = account.history[0];
      saveLocal();
      return trade;
    } catch (error) {
      marketError = error.message || 'تعذر إغلاق المركز الورقي تلقائيًا.';
      return null;
    }
  }

  async function refreshMarket(options) {
    const opts = options || {};
    if (refreshPromise) return refreshPromise;
    if (Date.now() < cooldownUntil) {
      if (!opts.quiet) showToast('احترم مهلة Binance قبل طلب بيانات جديدة.');
      return null;
    }
    const requestedSymbol = symbol;
    const requestedInterval = interval;
    marketStatus = 'connecting';
    renderConnection();
    refreshPromise = (async () => {
      const results = await Promise.allSettled([MarketBridge.fetchTickers(), MarketBridge.fetchKlines({ symbol: requestedSymbol, interval: requestedInterval, limit: 241 })]);
      const receivedAt = Date.now();
      let tickerOk = false;
      let candlesOk = false;
      let errors = [];
      if (results[0].status === 'fulfilled') {
        try {
          const prices = normalizeTickers(results[0].value, receivedAt);
          Object.keys(prices).forEach((key) => { tickerPrices[key] = prices[key]; });
          lastUpdatedAt = receivedAt;
          tickerOk = true;
        } catch (error) { errors.push(error.message); }
      } else errors.push(results[0].reason && results[0].reason.message || 'تعذر جلب أسعار Binance.');
      if (results[1].status === 'fulfilled') {
        try {
          const response = results[1].value;
          const freshCandles = Engine.normalizeKlines(response.data, { symbol: requestedSymbol, interval: requestedInterval, serverTime: response.serverTime });
          if (requestedSymbol === symbol && requestedInterval === interval) {
            candles = freshCandles.slice(-300);
            lastCandleServerTime = Number(response.serverTime);
            if (!tickerOk) lastUpdatedAt = receivedAt;
            currentSignal = Engine.analyze(candles, selectedStrategy);
            candlesOk = true;
          }
        } catch (error) { errors.push(error.message); }
      } else errors.push(results[1].reason && results[1].reason.message || 'تعذر جلب شموع Binance.');
      if (results.some((item) => item.status === 'rejected' && item.reason && item.reason.retryAfterSeconds)) {
        const retry = Math.max.apply(null, results.map((item) => item.status === 'rejected' && item.reason ? Number(item.reason.retryAfterSeconds) || 0 : 0));
        cooldownUntil = Date.now() + Math.min(3600, retry) * 1000;
      }
      marketStatus = tickerOk && candlesOk ? 'connected' : tickerOk || candlesOk ? 'partial' : (candles.length || Object.keys(tickerPrices).length ? 'stale' : 'offline');
      marketError = errors.join(' · ');
      const closedTrade = tickerOk ? updateAutomaticPaperExit(receivedAt) : null;
      if (tickerOk || candlesOk) saveLocal();
      renderAll();
      if (closedTrade) {
        notifyPaperClose(closedTrade);
        showToast('أُغلق المركز الورقي عند تحقق ' + (closedTrade.reason || 'شرط الإغلاق') + ' بسعر Binance.');
      } else if (!opts.quiet) {
        if (tickerOk && candlesOk) showToast('تم تحديث أسعار Binance والشموع المغلقة.');
        else showToast(marketError || 'تعذر تحديث بيانات Binance.');
      }
      return { tickerOk, candlesOk, errors };
    })().catch((error) => {
      marketError = error && error.message || 'تعذر الاتصال ببيانات Binance.';
      marketStatus = candles.length || Object.keys(tickerPrices).length ? 'stale' : 'offline';
      renderAll();
      if (!opts.quiet) showToast(marketError);
      return null;
    }).finally(() => {
      refreshPromise = null;
      renderConnection();
      if (requestedSymbol !== symbol || requestedInterval !== interval) refreshMarket({ quiet: true });
    });
    return refreshPromise;
  }

  function setMarket(nextSymbol, nextInterval) {
    if (nextSymbol && hasOwn(Engine.SYMBOLS, nextSymbol)) symbol = nextSymbol;
    if (nextInterval && hasOwn(Engine.INTERVALS, nextInterval)) interval = nextInterval;
    const market = document.getElementById('market-select');
    const timeframe = document.getElementById('interval-select');
    if (market) market.value = symbol;
    if (timeframe) timeframe.value = interval;
    candles = [];
    currentSignal = { action: 'wait', reason: 'جار جلب شموع Binance المغلقة لهذا السوق.', score: 0, rsi: null, source: Engine.SOURCE };
    saveLocal(); renderAll();
    refreshMarket({ quiet: true });
  }

  function analyzeCurrent() {
    if (candles.length < 60) { showToast('لا توجد 60 شمعة Binance مغلقة على الأقل للتحليل.'); return; }
    try {
      currentSignal = Engine.analyze(candles, selectedStrategy);
      renderSignal();
      showToast('اكتمل التحليل من آخر شمعة Binance مغلقة؛ لا يوجد تنفيذ تلقائي.');
    } catch (error) { showToast(error.message || 'تعذر تحليل بيانات السوق.'); }
  }

  function openPaper() {
    const quote = latestTicker(symbol);
    if (!quote || !hasFreshTicker(symbol)) { showToast('لا يوجد سعر Binance حديث؛ حدّث البيانات قبل فتح مركز ورقي.'); return; }
    const amountInput = document.getElementById('trade-amount');
    try {
      account = Engine.openPaperPosition(account, {
        symbol, interval, price: quote.price, amount: amountInput.value,
        strategy: selectedStrategy, source: Engine.SOURCE, now: quote.serverTime || Date.now()
      });
      saveLocal(); renderAll(); showToast('فُتح مركز ورقي محلي بسعر Binance؛ لم يُرسل أي أمر.');
    } catch (error) { showToast(error.message || 'تعذر فتح المركز الورقي.'); }
  }

  function askConfirmation(title, description, label, action) {
    const modal = document.getElementById('confirm-modal');
    previousFocus = document.activeElement;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-description').textContent = description;
    document.getElementById('accept-confirm').textContent = label;
    pendingConfirmation = action;
    modal.hidden = false;
    modal.querySelector('[role="dialog"]').focus();
    document.getElementById('cancel-confirm').focus();
  }

  function cancelConfirmation() {
    document.getElementById('confirm-modal').hidden = true;
    pendingConfirmation = null;
    const target = previousFocus; previousFocus = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus();
  }

  function acceptConfirmation() {
    const action = pendingConfirmation;
    cancelConfirmation();
    if (typeof action === 'function') action();
  }

  function closePaper() {
    if (!account.position) return;
    const position = account.position;
    const quote = latestTicker(position.symbol);
    if (!quote || !hasFreshTicker(position.symbol)) { showToast('لا يوجد سعر Binance حديث لإغلاق المركز الورقي؛ حدّث البيانات أولًا.'); return; }
    askConfirmation('إغلاق المركز الورقي؟', 'سيُسجل الإغلاق محليًا عند سعر Binance Spot الحالي ' + formatPrice(quote.price) + ' لـ' + position.symbol + '. الرسوم والانزلاق تقديريان، ولا يُرسل أي أمر.', 'أغلق ورقيًا', () => {
      try {
        account = Engine.closePaperPosition(account, { price: quote.price, now: quote.serverTime || Date.now(), source: Engine.SOURCE, reason: 'إغلاق يدوي' });
        const trade = account.history[0]; saveLocal(); renderAll(); notifyPaperClose(trade); showToast('أُغلق المركز الورقي وسُجلت النتيجة المحلية.'); navigate('history');
      } catch (error) { showToast(error.message || 'تعذر الإغلاق الورقي.'); }
    });
  }

  function ensureAudio() {
    if (!settings.soundEnabled) return null;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume();
      return audioContext;
    } catch (_) { return null; }
  }

  function playCloseTone(won) {
    const context = ensureAudio();
    if (!context) return;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = won ? 880 : 440;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.23);
    } catch (_) { /* Optional alert only. */ }
  }

  function celebrateWin() {
    const container = document.getElementById('celebration');
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    container.replaceChildren();
    const colors = ['#d5f276', '#52d1ad', '#f0c676', '#8f8cff', '#f28b7c'];
    for (let index = 0; index < 28; index += 1) {
      const piece = document.createElement('i'); piece.className = 'confetti-piece';
      piece.style.left = ((index * 37 + 11) % 100) + '%';
      piece.style.backgroundColor = colors[index % colors.length];
      piece.style.setProperty('--drift', (((index * 23) % 141) - 70) + 'px');
      piece.style.setProperty('--spin', ((index * 97) % 720) + 'deg');
      piece.style.animationDelay = ((index % 8) * 0.035) + 's';
      container.append(piece);
    }
    window.setTimeout(() => container.replaceChildren(), 1900);
  }

  function notifyPaperClose(trade) {
    if (!trade) return;
    if (settings.soundEnabled) playCloseTone(trade.pnl > 0);
    if (settings.vibrationEnabled && MarketBridge) MarketBridge.vibrate(trade.pnl > 0 ? 260 : 140);
    if (trade.pnl > 0) celebrateWin();
  }

  async function fetchHistorical(days) {
    const key = symbol + '|' + interval + '|' + days;
    const cached = historicalCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < 60000) return cached.candles;
    const intervalMs = Engine.INTERVALS[interval];
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    let cursor = startTime;
    const byTime = new Map();
    const maxPages = Math.ceil((days * 24 * 60 * 60 * 1000) / (intervalMs * 999)) + 2;
    const progress = document.getElementById('backtest-progress');
    for (let page = 0; page < maxPages; page += 1) {
      if (progress) progress.textContent = 'جلب تاريخ Binance الحقيقي… صفحة ' + (page + 1) + ' من ' + maxPages;
      const response = await MarketBridge.fetchKlines({ symbol, interval, startTime: cursor, endTime, limit: 1000 });
      if (!Array.isArray(response.data) || !response.data.length) break;
      const normalized = Engine.normalizeKlines(response.data, { symbol, interval, serverTime: response.serverTime });
      normalized.forEach((candle) => {
        if (candle.openTime >= startTime && candle.openTime < endTime) byTime.set(candle.openTime, candle);
      });
      const rawRows = response.data;
      if (!Array.isArray(rawRows) || !rawRows.length) break;
      const lastOpen = Number(rawRows[rawRows.length - 1][0]);
      if (!Number.isFinite(lastOpen) || lastOpen < cursor) throw new Error('تسلسل صفحات Binance التاريخية غير صالح.');
      if (rawRows.length < 1000 || lastOpen + intervalMs >= endTime) break;
      const next = lastOpen + intervalMs;
      if (next <= cursor) throw new Error('توقفت صفحات التاريخ عن التقدم.');
      cursor = next;
      await delay(90);
    }
    const result = Array.from(byTime.values()).sort((a, b) => a.openTime - b.openTime);
    const valid = Engine.validateCandles(result, { symbol, interval });
    if (valid.length < 200) throw new Error('وصل أقل من 200 شمعة مغلقة؛ تعذر تقسيم الاختبار 70/30.');
    historicalCache.set(key, { candles: valid, fetchedAt: Date.now() });
    return valid;
  }

  function metricCard(label, values) {
    const card = document.createElement('div'); card.className = 'backtest-stat';
    const title = document.createElement('span'); title.textContent = label + ' · ' + values.tradeCount + ' صفقة';
    const pnl = document.createElement('b'); pnl.textContent = signedMoney(values.netPnl) + ' USDT صافي';
    const detail = document.createElement('span');
    detail.textContent = 'فوز ' + (values.winRate == null ? '—' : values.winRate.toFixed(1) + '%') + ' · أقصى تراجع ' + values.maxDrawdownPct.toFixed(2) + '%';
    const costs = document.createElement('span'); costs.textContent = 'رسوم ' + formatMoney(values.fees) + ' · انزلاق ' + formatMoney(values.slippage) + ' USDT';
    if (values.netPnl >= 0) pnl.className = 'positive'; else pnl.className = 'negative';
    card.append(title, pnl, detail, costs); return card;
  }

  function renderBacktest(result) {
    const box = document.getElementById('backtest-results');
    const comparison = document.getElementById('strategy-comparison');
    comparison.hidden = true; comparison.replaceChildren();
    box.replaceChildren();
    box.append(metricCard('التطوير 70%', result.development), metricCard('التقييم اللاحق 30%', result.evaluation));
    const caption = document.createElement('p'); caption.className = 'backtest-caption';
    caption.textContent = 'مصدر: Binance Spot الحقيقي · ' + result.symbol + ' · ' + result.interval + ' · ' + result.sampleCount + ' شمعة · أول 70% تطوير وآخر 30% تقييم بلا خلط زمني. رسوم ' + (result.assumptions.feeRate * 100).toFixed(2) + '% وانزلاق ' + (result.assumptions.slippageRate * 100).toFixed(2) + '% مقدّران لكل جهة. لا توجد ضمانات للربح.';
    box.append(caption); box.hidden = false;
  }

  function renderComparison(results) {
    const box = document.getElementById('strategy-comparison');
    const resultCards = document.getElementById('backtest-results');
    resultCards.hidden = true; resultCards.replaceChildren(); box.replaceChildren();
    const table = document.createElement('table'); table.className = 'comparison-table';
    const thead = document.createElement('thead'); const header = document.createElement('tr');
    ['الاستراتيجية', 'صافي التقييم USDT', 'فوز', 'أقصى تراجع', 'صفقات'].forEach((label) => { const th = document.createElement('th'); th.textContent = label; header.append(th); });
    thead.append(header); table.append(thead);
    const tbody = document.createElement('tbody');
    results.forEach((item) => {
      const row = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = STRATEGIES[item.strategy].title;
      const pnl = document.createElement('td'); pnl.textContent = signedMoney(item.evaluation.netPnl); pnl.className = 'number-ltr ' + (item.evaluation.netPnl >= 0 ? 'positive' : 'negative');
      const win = document.createElement('td'); win.textContent = item.evaluation.winRate == null ? '—' : item.evaluation.winRate.toFixed(1) + '%';
      const dd = document.createElement('td'); dd.textContent = item.evaluation.maxDrawdownPct.toFixed(2) + '%';
      const trades = document.createElement('td'); trades.textContent = String(item.evaluation.tradeCount);
      row.append(name, pnl, win, dd, trades); tbody.append(row);
    });
    table.append(tbody); box.append(table);
    const caption = document.createElement('p'); caption.className = 'comparison-caption';
    caption.textContent = 'مقارنة تاريخية من بيانات Binance Spot · ' + (results[0] ? results[0].sampleCount : 0) + ' شمعة · آخر 30% تقييم زمني. كل استراتيجية ثابتة؛ لا تُضبط المعلمات على عينة التقييم. هذه النتائج ليست توقعًا أو ضمانًا.';
    box.append(caption); box.hidden = false;
  }

  async function runBacktest(compareAll) {
    const backtestButton = document.getElementById('backtest-button');
    const compareButton = document.getElementById('compare-strategies-button');
    const progress = document.getElementById('backtest-progress');
    const days = Number(document.getElementById('backtest-days').value);
    backtestButton.disabled = true; compareButton.disabled = true;
    try {
      const bars = await fetchHistorical(days);
      if (progress) progress.textContent = 'حُملت ' + bars.length + ' شمعة مغلقة؛ جار حساب المؤشرات والرسوم والتراجع…';
      await delay(20);
      const options = { startingCapital: account.startingCapital, maxTradeUsd: account.maxTradeUsd, maxRiskPct: account.maxRiskPct, feeRate: account.feeRate, slippageRate: account.slippageRate, stopLossPct: account.stopLossPct };
      if (compareAll) renderComparison(Engine.compareStrategies(bars, options));
      else renderBacktest(Engine.runBacktest(bars, selectedStrategy, options));
      if (progress) progress.textContent = 'اكتمل الاختبار التاريخي. الأرقام وصفية للماضي ولا تضمن ربحًا مستقبلًا.';
      showToast(compareAll ? 'اكتملت مقارنة الاستراتيجيات السبع على بيانات Binance.' : 'اكتمل الاختبار التاريخي لبيانات Binance.');
    } catch (error) {
      if (progress) progress.textContent = 'لم يكتمل الاختبار: ' + (error.message || 'تعذر جلب بيانات Binance.');
      showToast(error.message || 'تعذر الاختبار؛ لم تُستخدم بيانات اصطناعية.');
    } finally {
      backtestButton.disabled = false; compareButton.disabled = false;
    }
  }

  function saveSettings() {
    const newCapital = Number(document.getElementById('capital-input').value);
    const newMax = Number(document.getElementById('max-trade-input').value);
    const newRiskPct = Number(document.getElementById('risk-input').value) / 100;
    if (!Number.isFinite(newCapital) || newCapital < 1 || newCapital > 1000000) { showToast('رأس المال يجب أن يكون بين 1 و1,000,000 USDT.'); return; }
    if (!Number.isFinite(newMax) || newMax < 0.01 || newMax > newCapital) { showToast('سقف المركز يجب أن يكون بين 0.01 ورأس المال المحدد.'); return; }
    if (!Number.isFinite(newRiskPct) || newRiskPct < 0.001 || newRiskPct > 0.05) { showToast('حد المخاطرة يجب أن يكون بين 0.1% و5%.'); return; }
    if (account.position && newMax < account.position.amount) { showToast('ارفع سقف المركز فوق قيمة المركز المفتوح أو أغلقه أولًا.'); return; }
    const resetNeeded = newCapital !== account.startingCapital;
    if (resetNeeded && account.position) { showToast('أغلق المركز الورقي قبل تغيير رأس المال.'); return; }
    const apply = () => {
      if (resetNeeded) account = Engine.createAccount({ startingCapital: newCapital, maxTradeUsd: newMax, maxRiskPct: newRiskPct });
      else account = Object.assign({}, account, { maxTradeUsd: newMax, maxRiskPct: newRiskPct });
      saveLocal(); renderAll(); showToast('حُفظت الإعدادات على هذا الجهاز فقط.');
    };
    if (resetNeeded || account.history.length) askConfirmation('تطبيق إعدادات المحفظة؟', resetNeeded ? 'سيبدأ حساب ورقي جديد برأس المال المحدد وسيُمسح السجل الحالي.' : 'سيُحدّث سقف المركز وحد المخاطرة التقديري.' , 'تأكيد محلي', apply);
    else apply();
  }

  function resetSimulation() {
    if (account.position) { showToast('أغلق المركز الورقي أولًا ثم امسح السجل.'); return; }
    askConfirmation('مسح بيانات المحاكاة؟', 'سيُمسح الرصيد الورقي والسجل والإعدادات المحلية. لا يتأثر حساب أو منصة تداول.', 'امسح محليًا', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* Storage may be disabled. */ }
      account = Engine.createAccount(); selectedStrategy = 'composite'; symbol = 'BTCUSDT'; interval = '15m';
      candles = []; lastCandleServerTime = null;
      currentSignal = { action: 'wait', reason: 'يلزم جلب شموع Binance المغلقة.', score: 0, rsi: null, source: Engine.SOURCE };
      document.getElementById('market-select').value = symbol; document.getElementById('interval-select').value = interval;
      saveLocal(); renderAll(); navigate('overview'); refreshMarket({ quiet: true }); showToast('مُسحت بيانات المحاكاة المحلية؛ بيانات السوق محفوظة كمصدر حقيقي فقط.');
    });
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }
    const strategy = event.target.closest('[data-strategy]');
    if (strategy) {
      if (!hasOwn(STRATEGIES, strategy.dataset.strategy)) return;
      selectedStrategy = strategy.dataset.strategy;
      currentSignal = candles.length ? Engine.analyze(candles, selectedStrategy) : { action: 'wait', reason: 'يلزم جلب شموع Binance المغلقة.', score: 0, rsi: null, source: Engine.SOURCE };
      saveLocal(); renderAll(); return;
    }
    const marketPick = event.target.closest('[data-market-pick]');
    if (marketPick) { navigate('overview'); setMarket(marketPick.dataset.marketPick, interval); }
  });

  document.getElementById('market-select').addEventListener('change', (event) => setMarket(event.target.value, interval));
  document.getElementById('interval-select').addEventListener('change', (event) => setMarket(symbol, event.target.value));
  document.getElementById('refresh-button').addEventListener('click', () => refreshMarket({ quiet: false }));
  document.getElementById('analyze-button').addEventListener('click', analyzeCurrent);
  document.getElementById('open-paper-button').addEventListener('click', openPaper);
  document.getElementById('close-paper-button').addEventListener('click', closePaper);
  document.getElementById('backtest-button').addEventListener('click', () => runBacktest(false));
  document.getElementById('compare-strategies-button').addEventListener('click', () => runBacktest(true));
  document.getElementById('save-settings-button').addEventListener('click', saveSettings);
  document.getElementById('reset-button').addEventListener('click', resetSimulation);
  document.getElementById('sound-toggle').addEventListener('change', (event) => {
    settings.soundEnabled = event.target.checked;
    if (settings.soundEnabled) ensureAudio();
    saveLocal(); showToast(settings.soundEnabled ? 'تم تفعيل الصوت اختياريًا.' : 'تم إيقاف الصوت.');
  });
  document.getElementById('vibration-toggle').addEventListener('change', (event) => {
    settings.vibrationEnabled = event.target.checked;
    saveLocal(); showToast(settings.vibrationEnabled ? 'تم تفعيل الاهتزاز الاختياري.' : 'تم إيقاف الاهتزاز.');
  });
  document.getElementById('cancel-confirm').addEventListener('click', cancelConfirmation);
  document.getElementById('accept-confirm').addEventListener('click', acceptConfirmation);
  document.getElementById('confirm-modal').addEventListener('click', (event) => { if (event.target.id === 'confirm-modal') cancelConfirmation(); });
  document.addEventListener('keydown', (event) => {
    const modal = document.getElementById('confirm-modal');
    if (modal.hidden) return;
    if (event.key === 'Escape') { cancelConfirmation(); return; }
    if (event.key !== 'Tab') return;
    const focusable = all('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', modal);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(renderChart));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshMarket({ quiet: true });
  });
  window.setInterval(() => {
    if (!document.hidden) refreshMarket({ quiet: true });
  }, REFRESH_INTERVAL_MS);

  document.getElementById('market-select').value = symbol;
  document.getElementById('interval-select').value = interval;
  renderAll();
  saveLocal();
  if (restoreNotice) showToast('أُزيل سجل 0.2.0 المصطنع حتى لا يختلط ببيانات Binance الحقيقية.');
  refreshMarket({ quiet: true });

  window.DrakApp = Object.freeze({
    refresh: () => refreshMarket({ quiet: false }),
    getState: () => ({ source: Engine.SOURCE, symbol, interval, candles: candles.length, marketStatus, hasPosition: !!account.position, balance: account.cash }),
    destroy: () => { if (audioContext) { try { audioContext.close(); } catch (_) { /* Optional. */ } } }
  });
})();
