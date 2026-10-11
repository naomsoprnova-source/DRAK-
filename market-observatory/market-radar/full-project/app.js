(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmt = (value, digits = 4) => Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "غير متاح";

  function clearResults() {
    ["price", "trend", "rsi", "change", "stop", "riskCash", "qty", "notional"].forEach((id) => { $(id).textContent = "—"; });
    $("change").className = "metric";
    $("summary").textContent = "لم تُعرض نتيجة بعد.";
    $("indicators").replaceChildren();
  }

  function addRow(name, value, reading) {
    const tr = document.createElement("tr");
    [name, value, reading].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      tr.appendChild(cell);
    });
    $("indicators").appendChild(tr);
  }

  async function run() {
    const button = $("run");
    button.disabled = true;
    clearResults();
    $("status").textContent = "جارٍ جلب بيانات السوق…";

    let timeoutId;
    try {
      const symbol = $("symbol").value.trim().toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("اكتب رمز زوج صحيحًا مثل BTCUSDT.");

      const interval = $("interval").value;
      const limitValue = Number($("limit").value);
      if (!Number.isInteger(limitValue) || limitValue < 100 || limitValue > 500) {
        throw new Error("عدد الشموع يجب أن يكون عددًا صحيحًا بين 100 و500.");
      }
      const capital = Number($("capital").value);
      const riskPct = Number($("risk").value);
      const feePct = Number($("fee").value);
      if (!Number.isFinite(capital) || capital <= 0) throw new Error("أدخل رأس مال أكبر من صفر.");
      if (!Number.isFinite(riskPct) || riskPct < 0.1 || riskPct > 5) throw new Error("المخاطرة يجب أن تكون بين 0.1% و5%.");
      if (!Number.isFinite(feePct) || feePct < 0 || feePct > 2) throw new Error("الرسوم يجب أن تكون بين 0% و2% لكل جهة.");

      const url = "https://api.binance.com/api/v3/klines?symbol=" + encodeURIComponent(symbol) +
        "&interval=" + encodeURIComponent(interval) + "&limit=" + limitValue;
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      } catch (error) {
        if (error && error.name === "AbortError") throw new Error("انتهت مهلة الاتصال بعد 15 ثانية. حاول مرة أخرى.");
        throw new Error("تعذر الاتصال ببيانات Binance. تحقق من الإنترنت أو جرّب متصفحًا آخر.");
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 429) throw new Error("طلبات كثيرة إلى Binance؛ انتظر قليلًا ثم أعد المحاولة.");
        throw new Error("تعذر جلب البيانات (HTTP " + response.status + "). تحقق من الزوج أو الاتصال.");
      }
      let raw;
      try { raw = await response.json(); }
      catch (_) { throw new Error("ردّ الخادم ليس بيانات JSON صالحة."); }
      if (!Array.isArray(raw)) throw new Error("رفضت Binance الطلب: " + (raw && raw.msg ? raw.msg : "استجابة غير متوقعة."));

      const now = Date.now();
      const candles = raw.filter((k) => Array.isArray(k) && k.length >= 7).map((k) => ({
        time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
        close: Number(k[4]), volume: Number(k[5]), closeTime: Number(k[6])
      })).filter((c) => Number.isFinite(c.closeTime) && c.closeTime < now);
      if (candles.length < 50) throw new Error("لم تصل 50 شمعة مغلقة وصالحة. تحقق من الزوج والإطار الزمني.");

      const result = MarketEngine.analyze(candles);
      $("price").textContent = fmt(result.price, 8) + " USDT";
      $("trend").textContent = result.trend;
      $("rsi").textContent = fmt(result.rsi, 2);
      $("change").textContent = fmt(result.change, 3) + "%";
      $("change").className = "metric " + (result.change >= 0 ? "good" : "bad");
      $("summary").textContent = "القراءة الآلية: " + result.signal + ". هذه إشارة وصفية وليست توقعًا مضمونًا.";

      addRow("المتوسط البسيط 20", fmt(result.sma20, 8), result.price > result.sma20 ? "السعر فوقه" : "السعر تحته أو يساويه");
      addRow("المتوسط البسيط 50", fmt(result.sma50, 8), result.price > result.sma50 ? "السعر فوقه" : "السعر تحته أو يساويه");
      addRow("المتوسط الأسي 20", fmt(result.ema20, 8), result.price > result.ema20 ? "السعر فوقه" : "السعر تحته أو يساويه");
      addRow("RSI 14", fmt(result.rsi, 2), result.rsi >= 70 ? "تشبّع شرائي محتمل" : result.rsi <= 30 ? "تشبّع بيعي محتمل" : "المنطقة الوسطى");
      addRow("ATR 14", fmt(result.atr, 8), "مقياس للتذبذب لا لاتجاه السعر");

      // Long-only estimate: reserve risk budget, account for approximate entry/stop fees and cap by capital.
      const riskCash = capital * (riskPct / 100);
      const feeRate = feePct / 100;
      const stopPrice = result.price - result.stopDistance;
      const lossPerUnit = result.stopDistance + feeRate * (result.price + stopPrice);
      let quantity = NaN;
      if (stopPrice > 0 && lossPerUnit > 0 && result.stopDistance > 0) {
        const riskLimitedQty = riskCash / lossPerUnit;
        const capitalLimitedQty = capital / (result.price * (1 + feeRate));
        quantity = Math.min(riskLimitedQty, capitalLimitedQty);
      }
      $("stop").textContent = stopPrice > 0 ? fmt(stopPrice, 8) + " USDT" : "غير متاح؛ التذبذب أعلى من السعر";
      $("riskCash").textContent = fmt(riskCash, 4) + " USDT";
      $("qty").textContent = fmt(quantity, 8);
      $("notional").textContent = Number.isFinite(quantity) ? fmt(quantity * result.price, 4) + " USDT" : "غير متاح";
      $("status").textContent = "نجح الجلب: " + candles.length + " شمعة مغلقة. آخر إغلاق: " +
        new Date(candles[candles.length - 1].closeTime).toLocaleString();
    } catch (error) {
      $("status").textContent = error && error.message ? error.message : "حدث خطأ غير متوقع.";
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      button.disabled = false;
    }
  }

  $("run").addEventListener("click", run);
})();
