(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SETTINGS_KEY = "drak.paper.settings.v030";
  const PORTFOLIO_KEY = "drak.paper.portfolio.v030";
  let requestSerial = 0;
  const pending = new Map();
  const baseSettings = Object.assign({}, PaperEngine.DEFAULTS, { soundEnabled: false, celebrationsEnabled: false });

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { showToast("تعذر حفظ البيانات محلياً؛ تحقق من مساحة التخزين."); return false; }
  }
  function readSettings() {
    const stored = loadJson(SETTINGS_KEY) || {};
    const value = Object.assign({}, baseSettings, stored);
    try {
      value.initialCapital = Number(value.initialCapital);
      value.maxPosition = Math.min(Number(value.maxPosition), value.initialCapital);
      value.feeRate = Number(value.feeRate);
      value.slippageRate = Number(value.slippageRate);
      value.riskPct = Number(value.riskPct);
      PaperEngine.analyze([], "ema_cross", value);
    } catch (_) {
      value.initialCapital = baseSettings.initialCapital;
      value.maxPosition = baseSettings.maxPosition;
      value.feeRate = baseSettings.feeRate;
      value.slippageRate = baseSettings.slippageRate;
      value.riskPct = baseSettings.riskPct;
    }
    value.soundEnabled = stored.soundEnabled === true;
    value.celebrationsEnabled = stored.celebrationsEnabled === true;
    return value;
  }
  const state = {
    page: "dashboard", symbol: "BTCUSDT", interval: "4h", strategy: "ema_cross", settings: readSettings(),
    portfolio: null, candles: [], candleSymbol: "", candleInterval: "", dataSource: "", analysis: null, backtest: null
  };
  function readPortfolio() {
    const value = loadJson(PORTFOLIO_KEY);
    if (value && Number.isFinite(value.cash) && Number.isFinite(value.startingCapital) && Array.isArray(value.history)) return value;
    return PaperEngine.createPortfolio(state.settings.initialCapital);
  }
  state.portfolio = readPortfolio();

  function fmt(value, digits) {
    if (!Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: Number.isInteger(digits) ? digits : 4 }).format(Number(value));
  }
  function money(value) { return Number.isFinite(Number(value)) ? fmt(value, 2) + " USDT" : "—"; }
  function price(value) {
    if (!Number.isFinite(Number(value))) return "—";
    const amount = Number(value);
    return fmt(amount, 8) + " USDT";
  }
  function timeText(value) {
    if (!Number.isFinite(Number(value))) return "—";
    try { return new Date(Number(value)).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }); }
    catch (_) { return new Date(Number(value)).toISOString(); }
  }
  function savePortfolio() { saveJson(PORTFOLIO_KEY, state.portfolio); }
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  function playOptionalSound() {
    if (!state.settings.soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = new AudioContextClass();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 640;
      gain.gain.setValueAtTime(0.035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(); oscillator.stop(audio.currentTime + 0.18);
      oscillator.onended = () => audio.close();
    } catch (_) { /* Audio is optional and never affects paper accounting. */ }
  }
  function celebrateOptional() {
    if (!state.settings.celebrationsEnabled) return;
    const layer = $("celebration-layer");
    layer.replaceChildren();
    for (let i = 0; i < 20; i += 1) {
      const piece = document.createElement("span");
      piece.className = "confetti";
      piece.style.left = Math.round(Math.random() * 100) + "%";
      piece.style.setProperty("--x", (Math.round(Math.random() * 120) - 60) + "px");
      piece.style.animationDelay = (Math.random() * 0.35) + "s";
      layer.appendChild(piece);
    }
    setTimeout(() => layer.replaceChildren(), 2200);
  }

  window.nativeResult = function (callbackId, serialized) {
    const item = pending.get(callbackId);
    if (!item) return;
    clearTimeout(item.timeout);
    pending.delete(callbackId);
    try { item.resolve(JSON.parse(serialized)); }
    catch (_) { item.reject(new Error("تعذر قراءة رد بيانات السوق.")); }
  };

  function requestKlines(symbol, interval, limit) {
    const request = MarketData.validateRequest(symbol, interval, limit);
    if (!window.DRAK || typeof window.DRAK.getKlines !== "function") {
      return Promise.reject(new Error("افتح التطبيق على Android للحصول على بيانات Binance العامة."));
    }
    const callbackId = "market_" + (++requestSerial) + "_" + Date.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(callbackId);
        reject(new Error("انتهت مهلة انتظار Binance. حاول مرة أخرى."));
      }, 22000);
      pending.set(callbackId, { resolve, reject, timeout });
      try { window.DRAK.getKlines(request.symbol, request.interval, request.limit, callbackId); }
      catch (error) {
        clearTimeout(timeout);
        pending.delete(callbackId);
        reject(new Error(error.message || "تعذر طلب بيانات السوق."));
      }
    });
  }

  function selectedMarket() {
    return {
      symbol: $("symbol").value,
      interval: $("interval").value,
      strategy: $("strategy").value
    };
  }
  function updateMarketLabels() {
    const selected = selectedMarket();
    state.symbol = selected.symbol;
    state.interval = selected.interval;
    state.strategy = selected.strategy;
    $("market-pair-label").textContent = selected.symbol.slice(0, -4) + " / USDT";
  }
  function analysisFor(candles, strategy) {
    try { return PaperEngine.analyze(candles, strategy, state.settings); }
    catch (error) { return { ready: false, signal: false, signalLabel: "تعذر التحليل", reason: error.message || "تعذر حساب التحليل." }; }
  }
  function drawChart(candles) {
    const svg = $("price-chart");
    svg.replaceChildren();
    const ns = "http://www.w3.org/2000/svg";
    const grid = document.createElementNS(ns, "path");
    grid.setAttribute("d", "M0 25 H360 M0 50 H360 M0 75 H360");
    grid.setAttribute("class", "chart-grid");
    svg.appendChild(grid);
    if (!candles.length) {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "180"); text.setAttribute("y", "55"); text.setAttribute("text-anchor", "middle"); text.setAttribute("class", "chart-placeholder");
      text.textContent = "اجلب بيانات السوق لعرض الرسم";
      svg.appendChild(text);
      return;
    }
    const sample = candles.slice(-60);
    const values = sample.map((candle) => candle.close);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const spread = Math.max(max - min, Math.abs(max) * 0.001, 0.00000001);
    const points = values.map((value, index) => {
      const x = 4 + index * (352 / Math.max(values.length - 1, 1));
      const y = 88 - ((value - min) / spread) * 76;
      return [x, y];
    });
    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = '<linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#49d9ae"/><stop offset="100%" stop-color="#49d9ae" stop-opacity="0"/></linearGradient>';
    svg.appendChild(defs);
    const line = document.createElementNS(ns, "path");
    const d = points.map((point, index) => (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1)).join(" ");
    const area = document.createElementNS(ns, "path");
    area.setAttribute("d", d + " L " + points[points.length - 1][0].toFixed(1) + " 100 L " + points[0][0].toFixed(1) + " 100 Z");
    area.setAttribute("class", "chart-fill");
    svg.appendChild(area);
    line.setAttribute("d", d); line.setAttribute("class", "chart-line"); svg.appendChild(line);
  }
  function maybeCloseAtLevels(candles, symbol) {
    const position = state.portfolio.position;
    if (!position || position.symbol !== symbol || !candles.length) return;
    const last = candles[candles.length - 1];
    if (last.closeTime <= position.openedAt) return;
    const stopHit = last.low <= position.stopPrice;
    const targetHit = last.high >= position.targetPrice;
    if (!stopHit && !targetHit) return;
    const settled = PaperEngine.closePosition(state.portfolio, stopHit ? position.stopPrice : position.targetPrice,
      state.settings, { time: last.closeTime, reason: stopHit ? "وقف افتراضي" : "هدف افتراضي" });
    state.portfolio = settled.portfolio;
    savePortfolio();
    showToast("أُغلقت المحاكاة عند " + (stopHit ? "الوقف الافتراضي" : "الهدف الافتراضي") + " — لا يوجد أمر حقيقي.");
    playOptionalSound(); celebrateOptional();
  }

  async function loadMarket(limit, sourceButton) {
    const selected = selectedMarket();
    const button = sourceButton || $("load-market");
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "جارٍ جلب الشموع المغلقة…";
    $("market-status").textContent = "اتصال قراءة فقط ببيانات السوق العامة…";
    if (sourceButton === $("run-backtest")) $("backtest-status").textContent = "جارٍ جلب بيانات Binance Spot…";
    try {
      const response = await requestKlines(selected.symbol, selected.interval, limit);
      if (!response || response.ok !== true || !Array.isArray(response.candles)) throw new Error(response && response.error ? response.error : "رد بيانات السوق غير متوقع.");
      const rows = response.candles.map((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.closeTime]);
      const candles = MarketData.parseKlines(rows, Date.now());
      if (candles.length < 50) throw new Error("لم تصل 50 شمعة مكتملة؛ لا يمكن تحليل هذا الإطار حالياً.");
      if (selected.symbol !== $("symbol").value || selected.interval !== $("interval").value) throw new Error("تغير الزوج أثناء الجلب؛ أعد الطلب للاختيار الحالي.");
      state.candles = candles;
      state.candleSymbol = selected.symbol;
      state.candleInterval = selected.interval;
      state.dataSource = response.dataSource || "Binance Spot API";
      state.backtest = null;
      state.analysis = analysisFor(candles, selected.strategy);
      maybeCloseAtLevels(candles, selected.symbol);
      renderAll();
      const last = candles[candles.length - 1];
      const change = ((last.close - candles[Math.max(0, candles.length - 2)].close) / candles[Math.max(0, candles.length - 2)].close) * 100;
      $("market-status").textContent = "بيانات فعلية من Binance · " + candles.length + " شمعة مكتملة";
      $("last-updated").textContent = "آخر إغلاق " + timeText(last.closeTime);
      $("market-price").textContent = price(last.close);
      $("price-change").textContent = (change >= 0 ? "+" : "") + fmt(change) + "% · آخر شمعة";
      $("price-change").className = "change-pill " + (change >= 0 ? "positive" : "negative");
      drawChart(candles);
      if (sourceButton === $("run-backtest")) {
        state.backtest = PaperEngine.backtest(candles, selected.strategy, state.settings);
        renderBacktest(state.backtest, selected.strategy, candles.length);
      }
    } catch (error) {
      $("market-status").textContent = error.message || "تعذر تحميل بيانات السوق.";
      if (sourceButton === $("run-backtest")) $("backtest-status").textContent = "تعذر تشغيل الاختبار: " + (error.message || "مشكلة في الاتصال أو البيانات.");
      showToast(error.message || "تعذر تحميل بيانات السوق.");
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function renderAnalysis() {
    const strategy = PaperEngine.STRATEGIES.find((item) => item.id === state.strategy);
    $("analysis-strategy-name").textContent = strategy ? strategy.name : "الاستراتيجية";
    $("strategy-explain").textContent = strategy ? strategy.description : "—";
    $("position-limit").textContent = money(state.settings.maxPosition);
    const result = state.analysis;
    if (!result || !result.ready || state.candleSymbol !== state.symbol || state.candleInterval !== state.interval) {
      $("signal-label").textContent = result && result.signalLabel ? result.signalLabel : "اجلب البيانات أولاً";
      $("signal-reason").textContent = result && result.reason ? result.reason : "التحليل متاح بعد جلب 55 شمعة مكتملة على الأقل.";
      $("entry-level").textContent = $("target-level").textContent = $("stop-level").textContent = "—";
      $("rsi-value").textContent = $("atr-value").textContent = $("quantity-value").textContent = "—";
      $("fee-estimate").textContent = $("slippage-estimate").textContent = "—";
      $("signal-panel").classList.add("wait");
      return;
    }
    $("signal-label").textContent = result.signalLabel;
    $("signal-reason").textContent = result.reason;
    $("entry-level").textContent = price(result.entryPrice);
    $("target-level").textContent = price(result.targetPrice);
    $("stop-level").textContent = price(result.stopPrice);
    $("target-note").textContent = "عائد/مخاطرة " + fmt(result.rewardRisk, 1) + ":1";
    $("rsi-value").textContent = fmt(result.rsi, 2);
    $("atr-value").textContent = price(result.atr);
    $("quantity-value").textContent = fmt(result.quantity) + " وحدة";
    $("fee-estimate").textContent = money(result.estimatedFees);
    $("slippage-estimate").textContent = money(result.estimatedSlippage);
    $("signal-panel").classList.toggle("wait", !result.signal);
  }
  function renderPortfolio() {
    $("cash-value").textContent = money(state.portfolio.cash);
    $("simulation-cash").textContent = money(state.portfolio.cash);
    $("pnl-value").textContent = money(state.portfolio.realizedPnl);
    $("pnl-value").className = state.portfolio.realizedPnl < 0 ? "negative" : "positive";
    $("trade-count").textContent = String(state.portfolio.history.length);
    const position = state.portfolio.position;
    const card = $("open-position-card");
    card.replaceChildren();
    if (!position) {
      card.className = "position-empty";
      card.textContent = "لا يوجد مركز ورقي مفتوح.";
      $("paper-close").disabled = true;
    } else {
      card.className = "position-card";
      const title = document.createElement("strong");
      title.textContent = "مركز ورقي مفتوح · " + position.symbol;
      card.appendChild(title);
      const grid = document.createElement("div"); grid.className = "position-info";
      const rows = [["الكمية", fmt(position.quantity)], ["دخول مع الانزلاق", price(position.entryPrice)], ["الوقف النظري", price(position.stopPrice)], ["الهدف النظري", price(position.targetPrice)], ["رسوم الدخول", money(position.entryFee)], ["المركز", money(position.notional)]];
      rows.forEach(([label, value]) => { const wrapper = document.createElement("div"); const span = document.createElement("span"); span.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; wrapper.append(span, strong); grid.appendChild(wrapper); });
      card.appendChild(grid);
      $("paper-close").disabled = state.candleSymbol !== position.symbol || !state.candles.length;
    }
    $("paper-open").disabled = Boolean(position) || !state.analysis || !state.analysis.ready || state.candleSymbol !== state.symbol;
    $("clear-history").disabled = state.portfolio.history.length === 0;
    renderHistory();
  }
  function renderHistory() {
    const container = $("history-list");
    container.replaceChildren();
    const history = state.portfolio.history.slice().reverse();
    if (!history.length) {
      const empty = document.createElement("div"); empty.className = "panel empty-result"; empty.textContent = "لا توجد صفقات ورقية مسجلة."; container.appendChild(empty); return;
    }
    history.forEach((trade) => {
      const card = document.createElement("article"); card.className = "history-card";
      const head = document.createElement("div"); head.className = "history-head";
      const title = document.createElement("strong"); title.textContent = trade.symbol + " · " + trade.strategy;
      const pnl = document.createElement("strong"); pnl.className = "pnl " + (trade.netPnl >= 0 ? "positive" : "negative"); pnl.textContent = money(trade.netPnl);
      head.append(title, pnl);
      const details = document.createElement("div"); details.className = "history-details";
      ["دخول " + price(trade.entryPrice), "خروج " + price(trade.exitPrice), "كمية " + fmt(trade.quantity), "رسوم " + money(trade.fees), trade.reason || "إغلاق ورقي", timeText(trade.closedAt)].forEach((text) => { const span = document.createElement("span"); span.textContent = text; details.appendChild(span); });
      card.append(head, details); container.appendChild(card);
    });
  }
  function renderBacktest(result, strategyId, candleCount) {
    const container = $("backtest-status"); container.replaceChildren();
    const strategy = PaperEngine.STRATEGIES.find((item) => item.id === strategyId);
    const card = document.createElement("div"); card.className = "result-card";
    const heading = document.createElement("div"); heading.className = "result-heading";
    const title = document.createElement("h3"); title.textContent = strategy ? strategy.name : "الاستراتيجية";
    const tag = document.createElement("span"); tag.className = "data-badge"; tag.textContent = "بيانات Binance · " + candleCount + " شمعة";
    heading.append(title, tag); card.appendChild(heading);
    const stats = document.createElement("div"); stats.className = "result-stats";
    const values = [["عدد الصفقات المغلقة", String(result.tradeCount)], ["صافي النتيجة", money(result.netPnl)], ["إجمالي الرسوم", money(result.fees)], ["إجمالي قبل الرسوم", money(result.grossPnl)], ["رأس المال النهائي", money(result.endCapital)], ["التراجع الأقصى", fmt(result.maxDrawdown * 100, 2) + "%"]];
    values.forEach(([label, value]) => { const stat = document.createElement("div"); stat.className = "result-stat"; const name = document.createElement("span"); name.textContent = label; const amount = document.createElement("strong"); amount.textContent = value; stat.append(name, amount); stats.appendChild(stat); });
    card.appendChild(stats);
    const note = document.createElement("p"); note.className = "small-note"; note.textContent = result.note + " النتائج لا تعني أن الاستراتيجية مربحة."; card.appendChild(note);
    container.appendChild(card);
  }
  function renderAll() {
    updateMarketLabels();
    if (state.candles.length && state.candleSymbol === state.symbol && state.candleInterval === state.interval) {
      state.analysis = analysisFor(state.candles, state.strategy);
      const last = state.candles[state.candles.length - 1];
      $("market-price").textContent = price(last.close);
      $("market-pair-label").textContent = state.symbol.slice(0, -4) + " / USDT";
      drawChart(state.candles);
      $("paper-close").disabled = !state.portfolio.position || state.portfolio.position.symbol !== state.symbol;
    } else if (state.candleSymbol !== state.symbol || state.candleInterval !== state.interval) {
      state.analysis = null;
      state.candles = [];
      state.backtest = null;
      $("market-price").textContent = "—";
      $("market-status").textContent = "تغير الاختيار؛ اجلب شموعاً مكتملة جديدة.";
      $("last-updated").textContent = "—";
      $("price-change").textContent = "بانتظار البيانات";
      $("price-change").className = "change-pill";
      drawChart([]);
    }
    renderAnalysis();
    renderPortfolio();
  }
  function showPage(page) {
    state.page = page;
    document.querySelectorAll(".page").forEach((section) => {
      const active = section.id === "page-" + page;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
      const active = item.dataset.page === page;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }

  $("load-market").addEventListener("click", () => loadMarket(300, $("load-market")));
  $("run-backtest").addEventListener("click", () => loadMarket(Number($("backtest-limit").value), $("run-backtest")));
  ["symbol", "interval", "strategy"].forEach((id) => $(id).addEventListener("change", () => { updateMarketLabels(); renderAll(); }));
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showPage(item.dataset.page)));
  document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => showPage(item.dataset.go)));
  $("paper-open").addEventListener("click", () => {
    try {
      if (!state.analysis || !state.analysis.ready || !state.candles.length) throw new Error("اجلب البيانات المكتملة قبل بدء المحاكاة.");
      const latest = state.candles[state.candles.length - 1];
      const opened = PaperEngine.openPosition(state.portfolio, state.analysis, state.settings,
        { symbol: state.symbol, price: latest.close, time: latest.closeTime });
      state.portfolio = opened.portfolio;
      savePortfolio(); renderPortfolio(); showToast("تم فتح مركز ورقي محلي — لم يُرسل أي أمر إلى Binance.");
      playOptionalSound();
    } catch (error) { showToast(error.message || "تعذر فتح محاكاة ورقية."); }
  });
  $("paper-close").addEventListener("click", () => {
    try {
      const latest = state.candles[state.candles.length - 1];
      if (!latest || !state.portfolio.position || state.portfolio.position.symbol !== state.symbol) throw new Error("اجلب بيانات الزوج المفتوح أولاً لإغلاق المحاكاة.");
      const closed = PaperEngine.closePosition(state.portfolio, latest.close, state.settings,
        { time: latest.closeTime, reason: "إغلاق ورقي يدوي" });
      state.portfolio = closed.portfolio; savePortfolio(); renderPortfolio();
      showToast("أُغلقت المحاكاة محلياً بصافي " + money(closed.trade.netPnl) + ". لا يوجد تنفيذ حقيقي.");
      playOptionalSound(); celebrateOptional();
    } catch (error) { showToast(error.message || "تعذر إغلاق المحاكاة الورقية."); }
  });
  $("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const capital = Number($("setting-capital").value);
    const maxPosition = Number($("setting-max-position").value);
    const feePct = Number($("setting-fee").value);
    const slippagePct = Number($("setting-slippage").value);
    if (!Number.isFinite(capital) || capital < 1 || capital > 1000000 || !Number.isFinite(maxPosition) || maxPosition <= 0 || maxPosition > capital) {
      showToast("تحقق من رأس المال وحد المركز؛ يجب ألا يتجاوز المركز رأس المال."); return;
    }
    if (![feePct, slippagePct].every((value) => Number.isFinite(value) && value >= 0 && value <= 2)) {
      showToast("الرسوم والانزلاق يجب أن يكونا بين 0 و2 بالمئة لكل جهة."); return;
    }
    state.settings = Object.assign({}, state.settings, {
      initialCapital: capital, maxPosition, feeRate: feePct / 100, slippageRate: slippagePct / 100,
      soundEnabled: $("setting-sound").checked, celebrationsEnabled: $("setting-celebrations").checked
    });
    saveJson(SETTINGS_KEY, state.settings);
    if (!state.portfolio.position && state.portfolio.history.length === 0) state.portfolio = PaperEngine.createPortfolio(capital);
    savePortfolio(); renderAll();
    showToast("حُفظت الإعدادات على هذا الجهاز.");
  });
  $("reset-paper").addEventListener("click", () => {
    if (state.portfolio.position) { showToast("أغلق المركز الورقي أولاً قبل إعادة ضبط المحفظة."); return; }
    if (!window.confirm("سيتم حذف سجل المحاكاة وإعادة الرصيد الافتراضي. هل تريد المتابعة؟")) return;
    state.portfolio = PaperEngine.createPortfolio(state.settings.initialCapital);
    state.backtest = null; savePortfolio(); renderAll();
    showToast("أُعيد ضبط المحفظة الورقية محلياً.");
  });
  $("clear-history").addEventListener("click", () => {
    if (state.portfolio.position) { showToast("أغلق المركز الورقي قبل مسح السجل."); return; }
    if (!window.confirm("سيتم حذف سجل الصفقات الورقية من هذا الجهاز. هل تريد المتابعة؟")) return;
    state.portfolio.history = []; state.portfolio.realizedPnl = 0; state.portfolio.startingCapital = state.portfolio.cash;
    savePortfolio(); renderPortfolio(); showToast("مُسح السجل المحلي.");
  });

  function populateSettings() {
    $("setting-capital").value = state.settings.initialCapital;
    $("setting-max-position").value = state.settings.maxPosition;
    $("setting-fee").value = (state.settings.feeRate * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    $("setting-slippage").value = (state.settings.slippageRate * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    $("setting-sound").checked = state.settings.soundEnabled;
    $("setting-celebrations").checked = state.settings.celebrationsEnabled;
  }
  $("setting-capital").addEventListener("input", () => {
    const capital = Number($("setting-capital").value);
    if (Number.isFinite(capital)) $("setting-max-position").max = String(capital);
  });
  populateSettings();
  updateMarketLabels();
  state.analysis = null;
  renderAll();
})();
