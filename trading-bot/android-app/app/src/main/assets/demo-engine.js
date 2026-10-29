(function (root, factory) {
  const engine = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  if (root) root.DemoEngine = engine;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const INITIAL_CASH = 10000;
  const FEE_RATE = 0.001;
  const ASSETS = [
    { symbol: 'BTCUSDT', ticker: 'BTC', name: 'Bitcoin', icon: '₿', color: '#f7931a' },
    { symbol: 'ETHUSDT', ticker: 'ETH', name: 'Ethereum', icon: '◆', color: '#9ba8ff' },
    { symbol: 'SOLUSDT', ticker: 'SOL', name: 'Solana', icon: '◎', color: '#b58cff' },
    { symbol: 'BNBUSDT', ticker: 'BNB', name: 'BNB', icon: '◆', color: '#f3ba2f' },
    { symbol: 'XRPUSDT', ticker: 'XRP', name: 'XRP', icon: '✕', color: '#6f86aa' },
    { symbol: 'ADAUSDT', ticker: 'ADA', name: 'Cardano', icon: '●', color: '#4d82ff' },
    { symbol: 'DOGEUSDT', ticker: 'DOGE', name: 'Dogecoin', icon: 'Ð', color: '#c6a84b' },
    { symbol: 'AVAXUSDT', ticker: 'AVAX', name: 'Avalanche', icon: '▲', color: '#ef5260' },
    { symbol: 'LINKUSDT', ticker: 'LINK', name: 'Chainlink', icon: '⬡', color: '#4b72d8' },
    { symbol: 'LTCUSDT', ticker: 'LTC', name: 'Litecoin', icon: 'Ł', color: '#9da7b7' }
  ];

  const STRATEGIES = [
    { id: 'composite', title: 'مرصد مركّب', icon: '✦', group: 'متعددة المؤشرات', desc: 'يجمع اتجاه السعر والزخم وRSI والاختراق؛ يحتاج بيانات كافية وقد يعطي إشارات متأخرة.' },
    { id: 'buy_hold', title: 'الشراء والاحتفاظ', icon: '◉', group: 'طويل الأجل', desc: 'استراتيجية مرجعية للشراء والاحتفاظ؛ لا تصدر إشارة بيع آلية.' },
    { id: 'dca', title: 'الشراء الدوري DCA', icon: '↗', group: 'تجميع تدريجي', desc: 'محاكاة شراء دوري/على الانخفاض؛ هنا تعرض إشارة تعليمية عند تراجع الإغلاق الأخير.' },
    { id: 'grid', title: 'الشبكة Grid', icon: '▦', group: 'متذبذب', desc: 'يراقب نطاقًا حول متوسط متحرك ويعرض شراء قرب الطرف الأدنى وبيع قرب الطرف الأعلى.' },
    { id: 'sma_cross', title: 'تقاطع SMA', icon: '⌁', group: 'اتجاه', desc: 'يقارن المتوسطين البسيطين لفترتين قصيرتين وطويلتين.' },
    { id: 'ema_cross', title: 'تقاطع EMA', icon: '〰', group: 'اتجاه', desc: 'يتابع تقاطع المتوسط الأسي القصير مع المتوسط الأسي الطويل.' },
    { id: 'rsi', title: 'ارتداد RSI', icon: '〽', group: 'زخم', desc: 'يراقب الخروج من مناطق التشبع البيعي أو الشرائي بمؤشر RSI.' },
    { id: 'macd', title: 'تقاطع MACD', icon: 'ϟ', group: 'زخم', desc: 'يستخدم تقاطع MACD وخط الإشارة لتقدير تغير الزخم.' },
    { id: 'bollinger', title: 'نطاقات بولينجر', icon: '◎', group: 'تذبذب', desc: 'يبحث عن تمدد السعر خارج نطاق انحراف معياري وعودته باتجاه المتوسط.' },
    { id: 'breakout', title: 'اختراق القمة', icon: '⇧', group: 'اختراق', desc: 'يراقب كسر أعلى/أدنى القمم والقيعان القريبة.' },
    { id: 'trend', title: 'اتباع الاتجاه', icon: '⤴', group: 'اتجاه', desc: 'يقارن EMA 20 وEMA 50 مع اتجاه الإغلاقات الأخيرة.' },
    { id: 'momentum', title: 'الزخم السعري', icon: '⚡', group: 'زخم', desc: 'يقيس تغير السعر عبر فترة قصيرة مع عتبة بسيطة.' },
    { id: 'mean_reversion', title: 'العودة للمتوسط', icon: '↔', group: 'ارتداد', desc: 'يرصد ابتعاد السعر إحصائيًا عن متوسط 20 شمعة.' },
    { id: 'stochastic', title: 'المذبذب Stochastic', icon: '◌', group: 'زخم', desc: 'يقارن إغلاق السعر بنطاقه الأخير ويراقب مناطق التشبع.' },
    { id: 'vwap', title: 'السعر مقابل VWAP', icon: '≈', group: 'حجم', desc: 'يقارن الإغلاق بمتوسط السعر المرجح بالحجم في العينة المتاحة.' },
    { id: 'ichimoku', title: 'إيشيموكو مبسّط', icon: '雲', group: 'اتجاه', desc: 'يقارن خط التحويل بخط الأساس لتقدير الاتجاه.' },
    { id: 'fibonacci', title: 'ارتداد فيبوناتشي', icon: 'φ', group: 'مستويات', desc: 'يفحص قرب السعر من مستوى ارتداد 61.8% ضمن العينة الأخيرة.' },
    { id: 'atr_breakout', title: 'اختراق ATR', icon: '⌃', group: 'تقلب', desc: 'يستخدم متوسط المدى الحقيقي لتقدير اختراق يتجاوز الضوضاء المعتادة.' },
    { id: 'volume_breakout', title: 'اختراق بالحجم', icon: '▥', group: 'حجم', desc: 'يبحث عن حركة سعرية مصحوبة بحجم أعلى من متوسط العينة.' },
    { id: 'donchian', title: 'قناة دونشيان', icon: '▤', group: 'اختراق', desc: 'يراقب كسر نطاق أعلى وأدنى الأسعار في نافذة متحركة.' },
    { id: 'obv_momentum', title: 'زخم OBV', icon: '∿', group: 'حجم', desc: 'يستخدم اتجاهًا مبسطًا للحجم التراكمي لتأكيد الحركة السعرية.' },
    { id: 'keltner', title: 'قناة كيلتنر', icon: '⌑', group: 'تقلب', desc: 'يقارن السعر بقناة حول EMA باستخدام متوسط المدى الحقيقي.' }
  ];

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const candleData = candles => (candles || []).map(row => {
    if (Array.isArray(row)) return { high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
    return { high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) };
  }).filter(c => Number.isFinite(c.close) && c.close > 0 && Number.isFinite(c.high) && Number.isFinite(c.low));
  const sma = (values, period) => values.length < period ? null : avg(values.slice(-period));
  function ema(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let value = avg(values.slice(0, period));
    for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
    return value;
  }
  function rsi(values, period) {
    if (values.length < period + 1) return null;
    let gain = 0, loss = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      if (diff > 0) gain += diff; else loss -= diff;
    }
    if (loss === 0) return 100;
    const rs = (gain / period) / (loss / period);
    return 100 - 100 / (1 + rs);
  }
  function macd(values) {
    const line = ema(values.slice(-35), 12) - ema(values.slice(-35), 26);
    const line2 = ema(values.slice(0, -1).slice(-35), 12) - ema(values.slice(0, -1).slice(-35), 26);
    return { line, previous: line2 };
  }
  function bands(values, period = 20, factor = 2) {
    if (values.length < period) return null;
    const window = values.slice(-period), middle = avg(window);
    const deviation = Math.sqrt(avg(window.map(v => (v - middle) ** 2)));
    return { middle, upper: middle + factor * deviation, lower: middle - factor * deviation, deviation };
  }
  function atr(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const ranges = [];
    for (let i = candles.length - period; i < candles.length; i++) {
      const previous = candles[i - 1].close;
      ranges.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - previous), Math.abs(candles[i].low - previous)));
    }
    return avg(ranges);
  }
  function makeSignal(action, reason, score = 50) {
    return { action, reason, score: clamp(Math.round(score), 0, 100) };
  }
  function calculateSignal(id, rawCandles) {
    const candles = candleData(rawCandles), closes = candles.map(c => c.close), last = closes[closes.length - 1];
    const hold = reason => makeSignal('HOLD', reason || 'البيانات الحالية لا تعطي إشارة واضحة.', 50);
    if (!STRATEGIES.some(s => s.id === id)) return hold('الاستراتيجية غير معروفة.');
    if (candles.length < 30) return hold('نحتاج إلى 30 شمعة صالحة على الأقل قبل التحليل.');
    const prior = closes[closes.length - 2];
    const signal = (condition, action, reason, score = 65) => condition ? makeSignal(action, reason, score) : null;
    switch (id) {
      case 'buy_hold': return hold('نهج الاحتفاظ لا يصدر إشارة بيع؛ راجع قرارك بنفسك.');
      case 'dca': return signal(last < prior, 'BUY', 'الإغلاق الأخير أقل من السابق؛ إشارة تجميع تعليمية وليست أمرًا آليًا.', 57) || hold('لا يوجد تراجع في الإغلاق الأخير؛ لا إشارة DCA الآن.');
      case 'grid': {
        const b = bands(closes, 20, 0.7); if (!b) return hold();
        return signal(last < b.lower, 'BUY', 'السعر قرب الحد الأدنى للشبكة حول المتوسط.', 61) || signal(last > b.upper, 'SELL', 'السعر قرب الحد الأعلى للشبكة حول المتوسط.', 61) || hold('السعر داخل نطاق الشبكة؛ انتظار.');
      }
      case 'sma_cross': {
        const shortNow = sma(closes, 10), longNow = sma(closes, 30), shortPrev = sma(closes.slice(0, -1), 10), longPrev = sma(closes.slice(0, -1), 30);
        return signal(shortPrev <= longPrev && shortNow > longNow, 'BUY', 'تقاطع SMA القصير إلى أعلى SMA الطويل.', 70) || signal(shortPrev >= longPrev && shortNow < longNow, 'SELL', 'تقاطع SMA القصير إلى أسفل SMA الطويل.', 70) || hold('لا يوجد تقاطع جديد للمتوسطات البسيطة.');
      }
      case 'ema_cross': {
        const shortNow = ema(closes, 9), longNow = ema(closes, 21), shortPrev = ema(closes.slice(0, -1), 9), longPrev = ema(closes.slice(0, -1), 21);
        return signal(shortPrev <= longPrev && shortNow > longNow, 'BUY', 'تقاطع EMA 9 صعودًا فوق EMA 21.', 70) || signal(shortPrev >= longPrev && shortNow < longNow, 'SELL', 'تقاطع EMA 9 هبوطًا تحت EMA 21.', 70) || hold('لا يوجد تقاطع جديد للمتوسطات الأسية.');
      }
      case 'rsi': {
        const value = rsi(closes, 14), before = rsi(closes.slice(0, -1), 14);
        return signal(before < 30 && value >= 30, 'BUY', 'RSI خرج صعودًا من التشبع البيعي.', 68) || signal(before > 70 && value <= 70, 'SELL', 'RSI خرج هبوطًا من التشبع الشرائي.', 68) || hold('RSI لا يؤكد حاليًا خروجًا من منطقة التشبع.');
      }
      case 'macd': {
        const m = macd(closes);
        return signal(m.previous <= 0 && m.line > 0, 'BUY', 'تحول MACD إلى أعلى خط الصفر في العينة.', 65) || signal(m.previous >= 0 && m.line < 0, 'SELL', 'تحول MACD إلى أسفل خط الصفر في العينة.', 65) || hold('لا يوجد تغير واضح في اتجاه MACD.');
      }
      case 'bollinger': {
        const b = bands(closes); if (!b) return hold();
        return signal(prior < b.lower && last >= b.lower, 'BUY', 'الإغلاق عاد إلى داخل نطاق بولينجر السفلي.', 66) || signal(prior > b.upper && last <= b.upper, 'SELL', 'الإغلاق عاد إلى داخل نطاق بولينجر العلوي.', 66) || hold('لا توجد عودة مؤكدة داخل نطاق بولينجر.');
      }
      case 'breakout':
      case 'donchian': {
        const n = id === 'donchian' ? 20 : 20, window = candles.slice(-n - 1, -1);
        const high = Math.max(...window.map(c => c.high)), low = Math.min(...window.map(c => c.low));
        return signal(last > high, 'BUY', 'إغلاق أعلى قمة النطاق السابق.', 69) || signal(last < low, 'SELL', 'إغلاق أسفل قاع النطاق السابق.', 69) || hold('لم يحدث كسر لنطاق القمم والقيعان.');
      }
      case 'trend': {
        const short = ema(closes, 20), long = ema(closes, 50);
        if (short === null || long === null) return hold('نحتاج إلى 50 شمعة على الأقل لفلتر الاتجاه.');
        return signal(short > long && last > short, 'BUY', 'EMA 20 أعلى EMA 50 والسعر فوق المتوسط القصير.', 67) || signal(short < long && last < short, 'SELL', 'EMA 20 أدنى EMA 50 والسعر تحت المتوسط القصير.', 67) || hold('الاتجاه غير متوافق بما يكفي.');
      }
      case 'momentum': {
        const base = closes[closes.length - 13], pct = (last - base) / base * 100;
        return signal(pct > 2, 'BUY', `زخم 12 شمعة موجب (${pct.toFixed(2)}%).`, 62) || signal(pct < -2, 'SELL', `زخم 12 شمعة سالب (${pct.toFixed(2)}%).`, 62) || hold('الزخم ضمن نطاق محايد.');
      }
      case 'mean_reversion': {
        const b = bands(closes, 20, 2); if (!b || b.deviation === 0) return hold();
        const z = (last - b.middle) / b.deviation;
        return signal(z < -2, 'BUY', 'السعر أدنى من المتوسط بأكثر من انحرافين معياريين.', 64) || signal(z > 2, 'SELL', 'السعر أعلى من المتوسط بأكثر من انحرافين معياريين.', 64) || hold('السعر قريب نسبيًا من متوسط العينة.');
      }
      case 'stochastic': {
        const window = candles.slice(-14), high = Math.max(...window.map(c => c.high)), low = Math.min(...window.map(c => c.low));
        const k = high === low ? 50 : (last - low) / (high - low) * 100;
        const priorWindow = candles.slice(-15, -1), ph = Math.max(...priorWindow.map(c => c.high)), pl = Math.min(...priorWindow.map(c => c.low));
        const pk = ph === pl ? 50 : (prior - pl) / (ph - pl) * 100;
        return signal(pk < 20 && k >= 20, 'BUY', 'Stochastic خرج صعودًا من منطقة التشبع البيعي.', 65) || signal(pk > 80 && k <= 80, 'SELL', 'Stochastic خرج هبوطًا من منطقة التشبع الشرائي.', 65) || hold('Stochastic لا يعطي تقاطع خروج واضحًا.');
      }
      case 'vwap': {
        const w = candles.slice(-20), volume = w.reduce((s, c) => s + c.volume, 0); if (!volume) return hold('بيانات الحجم غير متاحة لحساب VWAP.');
        const value = w.reduce((s, c) => s + ((c.high + c.low + c.close) / 3) * c.volume, 0) / volume;
        return signal(prior <= value && last > value, 'BUY', 'الإغلاق عبر VWAP إلى أعلى.', 63) || signal(prior >= value && last < value, 'SELL', 'الإغلاق عبر VWAP إلى أسفل.', 63) || hold('السعر لم يعبر VWAP في الشمعة الأخيرة.');
      }
      case 'ichimoku': {
        const mid = (n, list) => { const w = list.slice(-n); return (Math.max(...w.map(c => c.high)) + Math.min(...w.map(c => c.low))) / 2; };
        const tenkan = mid(9, candles), kijun = mid(26, candles), prevTenkan = mid(9, candles.slice(0, -1)), prevKijun = mid(26, candles.slice(0, -1));
        return signal(prevTenkan <= prevKijun && tenkan > kijun, 'BUY', 'خط التحويل عبر خط الأساس إلى أعلى.', 62) || signal(prevTenkan >= prevKijun && tenkan < kijun, 'SELL', 'خط التحويل عبر خط الأساس إلى أسفل.', 62) || hold('لا يوجد تقاطع جديد بين خطي إيشيموكو المبسطين.');
      }
      case 'fibonacci': {
        const w = candles.slice(-50), high = Math.max(...w.map(c => c.high)), low = Math.min(...w.map(c => c.low)), level = high - (high - low) * 0.618;
        const tolerance = (high - low) * 0.025;
        return signal(last >= level && last - level < tolerance && last >= prior, 'BUY', 'السعر قريب من مستوى ارتداد 61.8% مع تحسن الإغلاق.', 58) || signal(last <= level && level - last < tolerance && last < prior, 'SELL', 'السعر قريب من مستوى 61.8% مع ضعف الإغلاق.', 58) || hold('لا يوجد اقتراب واضح من مستوى 61.8%.');
      }
      case 'atr_breakout': {
        const value = atr(candles); if (value === null) return hold();
        return signal(last - prior > value * 1.5, 'BUY', 'صعود الشمعة تجاوز 1.5× ATR.', 66) || signal(prior - last > value * 1.5, 'SELL', 'هبوط الشمعة تجاوز 1.5× ATR.', 66) || hold('حركة الشمعة ضمن نطاق ATR المعتاد.');
      }
      case 'volume_breakout': {
        const vAvg = avg(candles.slice(-21, -1).map(c => c.volume)), priorHigh = Math.max(...candles.slice(-21, -1).map(c => c.high)), priorLow = Math.min(...candles.slice(-21, -1).map(c => c.low));
        if (!vAvg) return hold('بيانات الحجم غير متاحة.');
        return signal(candles[candles.length - 1].volume > vAvg * 1.8 && last > priorHigh, 'BUY', 'اختراق سعري مع حجم أعلى من المتوسط.', 70) || signal(candles[candles.length - 1].volume > vAvg * 1.8 && last < priorLow, 'SELL', 'كسر سعري مع حجم أعلى من المتوسط.', 70) || hold('لا يوجد اختراق مصحوب بحجم مرتفع.');
      }
      case 'obv_momentum': {
        const obv = [0];
        for (let i = 1; i < candles.length; i++) obv.push(obv[i - 1] + (closes[i] > closes[i - 1] ? candles[i].volume : closes[i] < closes[i - 1] ? -candles[i].volume : 0));
        const current = obv[obv.length - 1], past = obv[Math.max(0, obv.length - 11)];
        return signal(current > past && last > prior, 'BUY', 'الحجم التراكمي المبسط والسعر يتجهان صعودًا.', 60) || signal(current < past && last < prior, 'SELL', 'الحجم التراكمي المبسط والسعر يتجهان هبوطًا.', 60) || hold('لا يوجد تأكيد متزامن من OBV المبسط والسعر.');
      }
      case 'keltner': {
        const middle = ema(closes, 20), range = atr(candles); if (middle === null || range === null) return hold();
        return signal(last > middle + 1.5 * range, 'BUY', 'الإغلاق فوق الحد العلوي التقديري لقناة كيلتنر.', 61) || signal(last < middle - 1.5 * range, 'SELL', 'الإغلاق تحت الحد السفلي التقديري لقناة كيلتنر.', 61) || hold('السعر داخل قناة كيلتنر التقديرية.');
      }
      case 'composite': {
        const ids = ['ema_cross', 'rsi', 'macd', 'trend', 'breakout'];
        const signals = ids.map(key => calculateSignal(key, candles));
        const buys = signals.filter(s => s.action === 'BUY').length, sells = signals.filter(s => s.action === 'SELL').length;
        if (buys >= 3) return makeSignal('BUY', `توافق ${buys} من ${ids.length} فلاتر تعليمية.`, 70 + buys * 3);
        if (sells >= 3) return makeSignal('SELL', `توافق ${sells} من ${ids.length} فلاتر تعليمية.`, 70 + sells * 3);
        return hold('لا يوجد توافق كافٍ بين مؤشرات الاستراتيجية المركبة.');
      }
      default: return hold();
    }
  }

  function createState() {
    return { cash: INITIAL_CASH, initialCash: INITIAL_CASH, positions: {}, transactions: [], selectedStrategy: 'composite', watchlist: ASSETS.map(a => a.symbol), createdAt: Date.now() };
  }
  function sanitizeState(value) {
    if (!value || typeof value !== 'object' || !Number.isFinite(Number(value.cash)) || Number(value.cash) < 0) return createState();
    const base = createState();
    base.cash = Number(value.cash);
    base.initialCash = Number.isFinite(Number(value.initialCash)) && Number(value.initialCash) > 0 ? Number(value.initialCash) : INITIAL_CASH;
    base.positions = {};
    if (value.positions && typeof value.positions === 'object') {
      for (const [symbol, position] of Object.entries(value.positions)) {
        const qty = Number(position && position.qty), cost = Number(position && position.cost);
        if (ASSETS.some(asset => asset.symbol === symbol) && Number.isFinite(qty) && qty > 0 && Number.isFinite(cost) && cost >= 0) base.positions[symbol] = { qty, cost };
      }
    }
    base.transactions = Array.isArray(value.transactions) ? value.transactions.slice(0, 300) : [];
    base.selectedStrategy = STRATEGIES.some(s => s.id === value.selectedStrategy) ? value.selectedStrategy : 'composite';
    base.watchlist = Array.isArray(value.watchlist) ? value.watchlist.filter(s => ASSETS.some(a => a.symbol === s)) : base.watchlist;
    base.createdAt = Number(value.createdAt) || Date.now();
    return base;
  }
  function portfolio(state, prices) {
    let holdingsValue = 0, costBasis = 0;
    const holdings = Object.entries(state.positions || {}).map(([symbol, p]) => {
      const qty = Number(p.qty) || 0, cost = Number(p.cost) || 0;
      const quote = prices[symbol], price = Number(typeof quote === 'object' ? quote.price : quote) || 0;
      const value = qty * price, pnl = value - cost;
      holdingsValue += value; costBasis += cost;
      return { symbol, qty, cost, price, value, pnl, avgPrice: qty ? cost / qty : 0 };
    }).filter(p => p.qty > 1e-12).sort((a, b) => b.value - a.value);
    const total = Number(state.cash) + holdingsValue;
    return { cash: Number(state.cash), holdingsValue, total, totalPnl: total - Number(state.initialCash || INITIAL_CASH), costBasis, holdings };
  }
  function executeOrder(state, order) {
    const side = String(order.side || '').toUpperCase(), symbol = String(order.symbol || '').toUpperCase();
    const amount = Number(order.amount), price = Number(order.price);
    if (!['BUY', 'SELL'].includes(side)) throw new Error('اتجاه الصفقة غير صالح.');
    if (!ASSETS.some(asset => asset.symbol === symbol)) throw new Error('الأصل غير مدعوم في المحاكاة التجريبية.');
    if (!Number.isFinite(amount) || amount < 1) throw new Error('أقل قيمة للصفقة التجريبية هي 1 USDT.');
    if (!Number.isFinite(price) || price <= 0) throw new Error('سعر السوق غير متاح.');
    const fee = amount * FEE_RATE, qty = amount / price;
    let realizedPnl = 0;
    if (side === 'BUY') {
      if (amount + fee > Number(state.cash) + 1e-8) throw new Error('الرصيد الافتراضي المتاح لا يكفي لهذه الصفقة.');
      const position = state.positions[symbol] || { qty: 0, cost: 0 };
      state.cash -= amount + fee;
      position.qty += qty;
      position.cost += amount + fee;
      state.positions[symbol] = position;
    } else {
      const position = state.positions[symbol];
      if (!position || qty > position.qty + 1e-10) throw new Error('الكمية أكبر من حيازتك الافتراضية المتاحة.');
      const costSold = position.cost * (qty / position.qty);
      realizedPnl = amount - fee - costSold;
      state.cash += amount - fee;
      position.qty -= qty;
      position.cost -= costSold;
      if (position.qty <= 1e-10) delete state.positions[symbol];
    }
    const tx = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, side, symbol, amount, qty, price, fee, realizedPnl, timestamp: Number(order.timestamp) || Date.now() };
    state.transactions.unshift(tx);
    state.transactions = state.transactions.slice(0, 300);
    state.cash = Math.max(0, state.cash);
    return tx;
  }

  return { INITIAL_CASH, FEE_RATE, ASSETS, STRATEGIES, createState, sanitizeState, portfolio, executeOrder, calculateSignal };
});
