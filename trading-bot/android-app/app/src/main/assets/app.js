(function () {
  'use strict';

  const Engine = window.DrakPaperEngine;
  const STORAGE_KEY = 'drak_paper_local_v2';
  const LEGACY_STORAGE_KEY = 'drak_ui_v1';
  const STRATEGIES = {
    composite: { title: 'مرصد مركّب', description: 'اتجاه صاعد وزخم وحجم مقبول واختراق قمة محلية.' },
    ema: { title: 'تقاطع المتوسطات', description: 'يراقب تقاطع EMA 9 وEMA 21 على شموع اصطناعية.' },
    rsi: { title: 'ارتداد RSI', description: 'يراقب خروج مؤشر زخم تعليمي من منطقة منخفضة.' },
    macd: { title: 'زخم MACD', description: 'يقارن تقاطع MACD مع خط الإشارة واتجاه متوسط السعر.' },
    bollinger: { title: 'نطاق بولينجر', description: 'يراقب عودة السعر إلى نطاق مصطنع حول المتوسط.' },
    breakout: { title: 'اختراق قمة', description: 'يقارن الإغلاق بقمم محلية وحجم اصطناعي.' },
    trend: { title: 'اتباع الاتجاه', description: 'يجمع اتجاه متوسطات وزخمًا تعليميًا.' }
  };
  const numberFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  clearLegacyState();
  let stored = readLocal();
  let settings = stored && stored.settings ? stored.settings : {};
  let account = restoreAccount(stored && stored.account);
  let selectedStrategy = hasOwn(STRATEGIES, settings.strategy) ? settings.strategy : 'composite';
  let symbol = hasOwn(Engine.SYMBOLS, settings.symbol) ? settings.symbol : 'BTCUSDT';
  let interval = hasOwn(Engine.INTERVALS, settings.interval) ? settings.interval : '15m';
  let candles = Engine.generateCandles({ symbol, interval, count: 240 });
  let currentSignal = null;
  let toastTimer = null;
  let pendingConfirmation = null;
  let previousFocus = null;

  function clearLegacyState() {
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); }
    catch (_) { /* Storage may be disabled. */ }
  }

  function hasOwn(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
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
      if (!Number.isFinite(cash) || cash < 0 || cash > clean.startingCapital * 2) return Engine.createAccount();
      clean.cash = cash;
      if (raw.position != null) {
        const position = raw.position;
        if (!position || typeof position !== 'object') return Engine.createAccount();
        const amount = Number(position.amount);
        const quantity = Number(position.quantity);
        const entryPrice = Number(position.entryPrice);
        const entryFee = Number(position.entryFee);
        const stopPrice = Number(position.stopPrice);
        const targetPrice = Number(position.targetPrice);
        const openedAt = Number(position.openedAt);
        const validNumbers = [amount, quantity, entryPrice, entryFee, stopPrice, targetPrice, openedAt].every(Number.isFinite);
        const validPosition = hasOwn(Engine.SYMBOLS, position.symbol) && hasOwn(Engine.INTERVALS, position.interval) && Engine.STRATEGY_IDS.includes(position.strategy)
          && validNumbers && Number.isInteger(amount) && amount >= 1 && amount <= clean.maxTradeUsd
          && quantity > 0 && entryPrice > 0 && entryFee >= 0 && entryFee <= amount * clean.feeRate + 1e-9
          && stopPrice > 0 && stopPrice < entryPrice && targetPrice > entryPrice && openedAt >= 0
          && Math.abs(quantity * entryPrice - amount) <= Math.max(1e-6, amount * 1e-6);
        if (!validPosition) return Engine.createAccount();
        clean.position = { symbol: position.symbol, interval: position.interval, strategy: position.strategy, amount, quantity, entryPrice, entryFee, stopPrice, targetPrice, openedAt };
      }
      clean.history = Array.isArray(raw.history) ? raw.history.filter((item) => {
        if (!item || !hasOwn(Engine.SYMBOLS, item.symbol) || !Engine.STRATEGY_IDS.includes(item.strategy)) return false;
        const values = [item.amount, item.quantity, item.entryPrice, item.exitPrice, item.fees, item.pnl, item.openedAt, item.closedAt].map(Number);
        return values.every(Number.isFinite) && Number(item.amount) >= 1 && Number.isInteger(Number(item.amount)) && Number(item.quantity) > 0
          && Number(item.entryPrice) > 0 && Number(item.exitPrice) > 0 && Number(item.fees) >= 0 && Number(item.openedAt) >= 0 && Number(item.closedAt) >= 0;
      }).slice(0, 100).map((item) => ({
        id: String(item.id || ''), symbol: item.symbol, interval: hasOwn(Engine.INTERVALS, item.interval) ? item.interval : null,
        strategy: item.strategy, amount: Number(item.amount), quantity: Number(item.quantity), entryPrice: Number(item.entryPrice),
        exitPrice: Number(item.exitPrice), fees: Number(item.fees), pnl: Number(item.pnl), openedAt: Number(item.openedAt),
        closedAt: Number(item.closedAt), source: 'synthetic'
      })) : [];
      return clean;
    } catch (_) { return Engine.createAccount(); }
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        account,
        settings: { strategy: selectedStrategy, symbol, interval },
        updatedAt: Date.now()
      }));
    } catch (_) {
      showToast('تعذر حفظ المحاكاة محليًا على هذا الجهاز.');
    }
  }

  function formatMoney(value) { return numberFormat.format(Number(value) || 0); }
  function formatPrice(value) { return priceFormat.format(Number(value) || 0); }
  function signedMoney(value) { const number = Number(value) || 0; return (number >= 0 ? '+' : '−') + formatMoney(Math.abs(number)); }
  function localDate(timestamp) {
    try { return new Intl.DateTimeFormat('ar-YE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
    catch (_) { return new Date(timestamp).toLocaleString(); }
  }
  function all(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }
  function setText(selector, text) { all(selector).forEach((node) => { node.textContent = text; }); }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
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
    if (name === 'overview') requestAnimationFrame(drawChart);
  }

  function setMarket(nextSymbol, nextInterval) {
    if (nextSymbol && hasOwn(Engine.SYMBOLS, nextSymbol)) symbol = nextSymbol;
    if (nextInterval && hasOwn(Engine.INTERVALS, nextInterval)) interval = nextInterval;
    candles = Engine.generateCandles({ symbol, interval, count: 240 });
    const market = document.getElementById('market-select');
    const timeframe = document.getElementById('interval-select');
    if (market) market.value = symbol;
    if (timeframe) timeframe.value = interval;
    currentSignal = Engine.analyze(candles, selectedStrategy);
    saveLocal();
    renderAll();
  }

  function currentPriceFor(targetSymbol, targetInterval) {
    const requestedSymbol = targetSymbol || symbol;
    const requestedInterval = targetInterval || interval;
    if (requestedSymbol === symbol && requestedInterval === interval) return candles[candles.length - 1].close;
    const sample = Engine.generateCandles({ symbol: requestedSymbol, interval: requestedInterval, count: 240 });
    return sample[sample.length - 1].close;
  }

  function drawChart() {
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
    if (series.length < 2) return;
    const minimum = Math.min.apply(null, series);
    const maximum = Math.max.apply(null, series);
    const range = maximum - minimum || 1;
    context.strokeStyle = '#394339';
    context.lineWidth = 1;
    for (let row = 1; row <= 3; row += 1) {
      const y = (height * row) / 4;
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    const points = series.map((value, index) => ({ x: 4 + (index / (series.length - 1)) * (width - 8), y: height - 14 - ((value - minimum) / range) * (height - 30) }));
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.strokeStyle = '#d5f276';
    context.lineWidth = 2.2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();
    const last = points[points.length - 1];
    context.beginPath(); context.arc(last.x, last.y, 4, 0, Math.PI * 2); context.fillStyle = '#f4f4eb'; context.fill();
    context.fillStyle = '#bac4b8';
    context.font = '11px system-ui';
    context.textAlign = 'left';
    context.fillText(formatPrice(maximum), 4, 13);
    context.fillText(formatPrice(minimum), 4, height - 2);
  }

  function signalTagText() {
    if (!currentSignal) return { text: 'انتظار', className: 'warn-tag' };
    if (currentSignal.action === 'buy') return { text: 'شروط شراء تعليمية', className: 'good-tag' };
    if (currentSignal.action === 'sell') return { text: 'شروط خروج تعليمية', className: 'bad-tag' };
    return { text: 'انتظار', className: 'warn-tag' };
  }

  function renderSignal() {
    if (!currentSignal) currentSignal = Engine.analyze(candles, selectedStrategy);
    const tag = signalTagText();
    all('[data-signal-tag]').forEach((node) => {
      node.textContent = tag.text;
      node.className = 'tag ' + tag.className;
    });
    setText('[data-signal-strategy]', STRATEGIES[selectedStrategy].title);
    setText('[data-signal-reason]', currentSignal.reason);
    setText('[data-signal-score]', Number.isFinite(currentSignal.score) ? currentSignal.score + ' / 5' : '—');
    setText('[data-rsi]', Number.isFinite(currentSignal.rsi) ? currentSignal.rsi.toFixed(1) : '—');
    all('[data-strategy]').forEach((button) => {
      const active = button.dataset.strategy === selectedStrategy;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderMarketList() {
    const list = document.querySelector('[data-market-list]');
    if (!list) return;
    list.replaceChildren();
    Object.entries(Engine.SYMBOLS).forEach(([code, info]) => {
      const sample = Engine.generateCandles({ symbol: code, interval, count: 240 });
      const price = sample[sample.length - 1].close;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'market-item';
      button.dataset.marketPick = code;
      const name = document.createElement('span');
      const title = document.createElement('b'); title.textContent = info.label;
      const subtitle = document.createElement('small'); subtitle.textContent = 'عينة محلية فقط';
      name.append(title, subtitle);
      const value = document.createElement('strong'); value.className = 'number-ltr'; value.textContent = formatPrice(price);
      button.append(name, value);
      list.append(button);
    });
  }

  function renderPosition() {
    const position = account.position;
    const openButton = document.getElementById('open-paper-button');
    const closeButton = document.getElementById('close-paper-button');
    const card = document.getElementById('position-card');
    if (!position) {
      openButton.hidden = false;
      closeButton.hidden = true;
      card.hidden = true;
      card.replaceChildren();
      setText('[data-position-state]', 'لا يوجد');
      setText('[data-position-caption]', 'جاهز للتجربة');
      return;
    }
    openButton.hidden = true;
    closeButton.hidden = false;
    card.hidden = false;
    setText('[data-position-state]', 'مفتوح');
    setText('[data-position-caption]', position.symbol + ' · ورقي');
    card.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'مركز ورقي مفتوح';
    const facts = document.createElement('div'); facts.className = 'position-facts';
    const values = [
      ['السوق والفاصل', position.symbol + ' · ' + position.interval], ['الاستراتيجية', hasOwn(STRATEGIES, position.strategy) ? STRATEGIES[position.strategy].title : 'تعليمية'],
      ['قيمة المركز', formatMoney(position.amount) + ' USDT'], ['الدخول الاصطناعي', formatPrice(position.entryPrice)],
      ['وقف تعليمي', formatPrice(position.stopPrice)], ['هدف تعليمي', formatPrice(position.targetPrice)]
    ];
    values.forEach(([label, value]) => {
      const cell = document.createElement('div');
      const small = document.createElement('span'); small.textContent = label;
      const strong = document.createElement('b'); strong.textContent = value;
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
    setText('[data-history-count]', history.length + ' تجربة');
    history.forEach((trade) => {
      const item = document.createElement('article'); item.className = 'history-item';
      const main = document.createElement('div'); main.className = 'history-item-main';
      const title = document.createElement('b'); title.textContent = trade.symbol + ' · ' + (hasOwn(STRATEGIES, trade.strategy) ? STRATEGIES[trade.strategy].title : 'استراتيجية تعليمية');
      const detail = document.createElement('small'); detail.textContent = localDate(trade.closedAt) + (trade.interval ? ' · ' + trade.interval : '') + ' · رسوم افتراضية ' + formatMoney(trade.fees) + ' USDT';
      main.append(title, detail);
      const pnl = document.createElement('strong'); pnl.className = 'history-pnl ' + (trade.pnl >= 0 ? 'positive' : 'negative'); pnl.textContent = signedMoney(trade.pnl) + ' USDT';
      item.append(main, pnl); list.append(item);
    });
  }

  function renderAll() {
    const price = candles[candles.length - 1].close;
    const portfolioPrice = account.position ? currentPriceFor(account.position.symbol, account.position.interval) : price;
    const stats = Engine.portfolio(account, portfolioPrice);
    setText('[data-price]', formatPrice(price));
    setText('[data-cash]', formatMoney(account.cash));
    setText('[data-equity]', formatMoney(stats.equity));
    setText('[data-total-pnl]', signedMoney(stats.totalPnl) + ' USDT');
    setText('[data-trade-count]', String(account.history.length));
    setText('[data-win-rate]', stats.winRate == null ? '—' : stats.winRate.toFixed(0) + '%');
    setText('[data-max-trade]', formatMoney(account.maxTradeUsd));
    setText('[data-fee-rate]', (account.feeRate * 100).toFixed(2) + '%');
    const date = new Intl.DateTimeFormat('ar-YE', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
    setText('[data-date]', 'اليوم · ' + date);
    renderSignal();
    renderPosition();
    renderHistory();
    renderMarketList();
    const capitalInput = document.getElementById('capital-input');
    const maxInput = document.getElementById('max-trade-input');
    const riskInput = document.getElementById('risk-input');
    if (capitalInput && document.activeElement !== capitalInput) capitalInput.value = account.startingCapital;
    if (maxInput && document.activeElement !== maxInput) maxInput.value = account.maxTradeUsd;
    if (riskInput && document.activeElement !== riskInput) riskInput.value = (account.maxRiskPct * 100).toFixed(1);
    if (document.getElementById('screen-overview').classList.contains('is-active')) requestAnimationFrame(drawChart);
  }

  function analyzeCurrent() {
    currentSignal = Engine.analyze(candles, selectedStrategy);
    renderSignal();
    showToast('اكتمل التحليل محليًا؛ لا يوجد تنفيذ تلقائي.');
  }

  function openPaper() {
    const amountInput = document.getElementById('trade-amount');
    try {
      account = Engine.openPaperPosition(account, {
        symbol,
        interval,
        price: candles[candles.length - 1].close,
        amount: amountInput.value,
        strategy: selectedStrategy,
        now: Date.now()
      });
      saveLocal();
      renderAll();
      showToast('تم فتح مركز ورقي محلي فقط.');
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
    const target = previousFocus;
    previousFocus = null;
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
    const closePrice = currentPriceFor(position.symbol, position.interval);
    askConfirmation('إغلاق المركز الورقي؟', 'سيُسجّل الإغلاق محليًا فقط عند السعر الاصطناعي الحالي (' + formatPrice(closePrice) + ') للسوق ' + position.symbol + ' وفاصل ' + position.interval + '. لا يُرسل أي طلب.', 'أغلق ورقيًا', () => {
      try {
        account = Engine.closePaperPosition(account, { price: currentPriceFor(position.symbol, position.interval), now: Date.now() });
        saveLocal(); renderAll(); showToast('أُغلق المركز الورقي وسُجّلت النتيجة المحلية.');
        navigate('history');
      } catch (error) { showToast(error.message || 'تعذر الإغلاق المحلي.'); }
    });
  }

  function renderBacktest(result) {
    const box = document.getElementById('backtest-results');
    box.replaceChildren();
    const titles = [
      ['تطوير 70%', result.development],
      ['تقييم آخر 30%', result.evaluation]
    ];
    titles.forEach(([label, values]) => {
      const card = document.createElement('div'); card.className = 'backtest-stat';
      const title = document.createElement('span'); title.textContent = label + ' · ' + values.trades + ' مراكز';
      const value = document.createElement('b'); value.textContent = signedMoney(values.pnl) + ' USDT';
      const detail = document.createElement('span'); detail.textContent = values.winRate == null ? 'لا توجد صفقات مكتملة' : 'فوز عينة ' + values.winRate.toFixed(0) + '%';
      card.append(title, value, detail); box.append(card);
    });
    const caption = document.createElement('p'); caption.className = 'backtest-caption';
    caption.textContent = 'العينة الاصطناعية بالكامل · ' + result.symbol + ' · ' + result.interval + ' · ' + result.sampleCount + ' شمعة · رسوم 0.10% وانزلاق 0.05% افتراضيان لكل جهة. النتيجة ليست توقعًا أو ضمانًا.';
    box.append(caption);
    box.hidden = false;
  }

  function runBacktest() {
    try {
      const result = Engine.runBacktest(candles, selectedStrategy, { startingCapital: account.startingCapital, maxTradeUsd: account.maxTradeUsd });
      renderBacktest(result);
      showToast('انتهى الاختبار التعليمي الاصطناعي.');
    } catch (error) { showToast(error.message || 'تعذر تشغيل الاختبار.'); }
  }

  function saveSettings() {
    const newCapital = Number(document.getElementById('capital-input').value);
    const newMax = Number(document.getElementById('max-trade-input').value);
    const newRiskPct = Number(document.getElementById('risk-input').value) / 100;
    if (!Number.isFinite(newCapital) || newCapital < 100 || newCapital > 1000000) { showToast('رأس المال الافتراضي يجب أن يكون بين 100 و1,000,000.'); return; }
    if (!Number.isInteger(newMax) || newMax < 1 || newMax > 10) { showToast('سقف المركز الورقي يجب أن يكون عددًا صحيحًا بين 1 و10 USDT.'); return; }
    if (!Number.isFinite(newRiskPct) || newRiskPct < 0.001 || newRiskPct > 0.05) { showToast('حد المخاطرة يجب أن يكون بين 0.1% و5%.'); return; }
    const resetNeeded = newCapital !== account.startingCapital;
    if (resetNeeded && account.position) { showToast('أغلق المركز الورقي قبل تغيير رأس المال.'); return; }
    const apply = () => {
      if (resetNeeded) account = Engine.createAccount({ startingCapital: newCapital, maxTradeUsd: newMax, maxRiskPct: newRiskPct });
      else account = Object.assign({}, account, { maxTradeUsd: newMax, maxRiskPct: newRiskPct });
      saveLocal(); renderAll(); showToast('حُفظت الإعدادات على هذا الجهاز فقط.');
    };
    if (resetNeeded || account.history.length) askConfirmation('تطبيق الإعدادات؟', resetNeeded ? 'سيبدأ حساب افتراضي جديد برأس المال المحدد، وسيُمسح سجل المحاكاة الحالي.' : 'سيُحدّث سقف المركز وحد المخاطرة للمحاكاة فقط.', 'تأكيد محلي', apply);
    else apply();
  }

  function resetSimulation() {
    if (account.position) { showToast('أغلق المركز الورقي أولًا ثم امسح السجل.'); return; }
    askConfirmation('مسح بيانات المحاكاة؟', 'سيُمسح الرصيد الافتراضي والسجل والإعدادات المحلية. لا يؤثر ذلك في أي حساب أو منصة.', 'امسح محليًا', () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* Storage may be disabled. */ }
      account = Engine.createAccount(); selectedStrategy = 'composite'; symbol = 'BTCUSDT'; interval = '15m';
      candles = Engine.generateCandles({ symbol, interval, count: 240 });
      document.getElementById('market-select').value = symbol;
      document.getElementById('interval-select').value = interval;
      saveLocal(); renderAll(); navigate('overview'); showToast('مُسحت بيانات المحاكاة المحلية.');
    });
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }
    const strategy = event.target.closest('[data-strategy]');
    if (strategy) {
      selectedStrategy = strategy.dataset.strategy;
      currentSignal = Engine.analyze(candles, selectedStrategy);
      saveLocal(); renderAll();
      return;
    }
    const marketPick = event.target.closest('[data-market-pick]');
    if (marketPick) { navigate('overview'); setMarket(marketPick.dataset.marketPick, interval); return; }
  });

  document.getElementById('market-select').addEventListener('change', (event) => setMarket(event.target.value, interval));
  document.getElementById('interval-select').addEventListener('change', (event) => setMarket(symbol, event.target.value));
  document.getElementById('analyze-button').addEventListener('click', analyzeCurrent);
  document.getElementById('open-paper-button').addEventListener('click', openPaper);
  document.getElementById('close-paper-button').addEventListener('click', closePaper);
  document.getElementById('backtest-button').addEventListener('click', runBacktest);
  document.getElementById('save-settings-button').addEventListener('click', saveSettings);
  document.getElementById('reset-button').addEventListener('click', resetSimulation);
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
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('resize', () => requestAnimationFrame(drawChart));

  currentSignal = Engine.analyze(candles, selectedStrategy);
  document.getElementById('market-select').value = symbol;
  document.getElementById('interval-select').value = interval;
  renderAll();
  saveLocal();
})();
