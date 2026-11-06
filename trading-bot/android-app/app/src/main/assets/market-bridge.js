(function (root) {
  'use strict';

  const pending = new Map();
  let nextId = 0;

  function request(method, args) {
    if (!root.DrakBridge || typeof root.DrakBridge[method] !== 'function') {
      return Promise.reject(new Error('واجهة بيانات Android غير متاحة؛ لن تُستخدم أسعار بديلة.'));
    }
    nextId = nextId >= 999999999999999 ? 1 : nextId + 1;
    const id = String(nextId);
    return new Promise((resolve, reject) => {
      const timeout = root.setTimeout(() => {
        pending.delete(id);
        reject(new Error('انتهت مهلة انتظار رد Binance.'));
      }, 30000);
      pending.set(id, { resolve, reject, timeout });
      try {
        root.DrakBridge[method].apply(root.DrakBridge, args.concat(id));
      } catch (_) {
        root.clearTimeout(timeout);
        pending.delete(id);
        reject(new Error('تعذر بدء طلب بيانات Binance.'));
      }
    });
  }

  root.DrakBridgeCallbacks = Object.freeze({
    onResponse(id, payloadText) {
      const key = String(id);
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      root.clearTimeout(entry.timeout);
      let payload;
      try { payload = JSON.parse(String(payloadText)); }
      catch (_) { entry.reject(new Error('استجابة Binance غير مفهومة.')); return; }
      if (!payload || payload.ok !== true) {
        const error = new Error(payload && typeof payload.error === 'string' ? payload.error : 'تعذر جلب بيانات Binance.');
        error.httpStatus = Number(payload && payload.httpStatus) || null;
        error.retryAfterSeconds = Number(payload && payload.retryAfterSeconds) || null;
        entry.reject(error);
        return;
      }
      entry.resolve(payload);
    }
  });

  root.DrakMarketBridge = Object.freeze({
    fetchTickers() { return request('fetchTickers', []); },
    fetchKlines(options) {
      const opts = options || {};
      return request('fetchKlines', [
        String(opts.symbol || ''), String(opts.interval || ''),
        opts.startTime == null ? '' : String(opts.startTime),
        opts.endTime == null ? '' : String(opts.endTime),
        String(opts.limit == null ? 241 : opts.limit)
      ]);
    },
    vibrate(milliseconds) {
      if (root.DrakBridge && typeof root.DrakBridge.vibrate === 'function') {
        try {
          const duration = Math.max(1, Math.min(1000, Math.round(Number(milliseconds) || 0)));
          root.DrakBridge.vibrate(String(duration));
        } catch (_) { /* Optional only. */ }
      }
    }
  });
})(window);
