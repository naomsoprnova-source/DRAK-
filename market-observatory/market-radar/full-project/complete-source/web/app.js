    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const INTERVALS = Object.freeze({'1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000});
      if (!window.MarketRadarEngine) throw new Error('محرك التحليل غير متاح.');
      const {RULES, indicatorsFor, classify, runBacktest, buyAndHold, normalizeCandles, calculatePositionSize, walkForwardPeriods, calendarWindowIndices} = window.MarketRadarEngine;
      const SCAN_INTERVALS = Object.freeze(['15m', '1h', '4h', '1d', '1w']);
      const BINANCE_MAX_KLINE_LIMIT = 1000;
      const MIN_PRIMARY_CANDLES = 100;
      const MIN_SCAN_CANDLES = 100;
      const MIN_WEEKLY_SCAN_CANDLES = 50;
      const STRATEGY_TESTING_ENABLED = true;
      // Research runs only after successful local artifact verification and explicit user action; historical fetching has its own independent gate.
      const REGISTERED_RESEARCH_PROTOCOL = Object.freeze({
        protocolId: 'market-radar-stage1-binance-spot-btcusdt-30m-v1',
        status: 'stage1-recorded-awaiting-user-signature',
        userSignature: {name: 'أنس', signedAtUtc: '2026-10-10T11:38:20Z'},
        timezone: 'UTC',
        market: Object.freeze({exchange: 'Binance', marketType: 'Spot', symbol: 'BTCUSDT', interval: '30m'}),
        exchangeFilterSnapshot: Object.freeze({
          symbolStatus: 'TRADING',
          lotSize: Object.freeze({minQty: '0.00001000', stepSize: '0.00001000'}),
          notional: Object.freeze({minNotional: '5 USDT'}),
          snapshotTimeUtc: '2026-10-10T10:57:47.163Z',
          mutableSnapshot: true
        }),
        settings: Object.freeze({
          initialCapitalUsdt: 30,
          riskPct: 1,
          positionSizingBasis: 'current-equity-compounded',
          feePerSidePct: 0.1,
          slippagePerSidePct: 0.05,
          slippageStressPerSidePct: 0.1,
          slippageStressUse: 'descriptive-only-not-primary-test',
          indicators: Object.freeze({
            ema: Object.freeze([9, 21, 50]),
            rsi: 14,
            adx: Object.freeze({period: 14, minimum: 18, role: 'strength-filter-not-vote'}),
            macd: Object.freeze({fast: 12, slow: 26, signal: 9}),
            atr: 14,
            volumeAverage: 20,
            superTrend: Object.freeze({atrPeriod: 10, multiplier: 3}),
            obvSlopeBars: 5
          }),
          votes: Object.freeze({
            names: Object.freeze(['RSI', 'MACD', 'SuperTrend', 'OBV', 'volume']),
            rsi: 'bullish when 50 < RSI < 70; bearish when 30 < RSI < 50; otherwise neutral',
            macd: 'MACD histogram sign',
            superTrend: 'SuperTrend direction',
            obv: 'five-bar OBV slope sign',
            volume: 'bullish only when volume > average20; otherwise bearish; neutral only when unavailable/invalid'
          }),
          strategies: Object.freeze({
            A: Object.freeze({entry: 'bullish EMA alignment and at least 3 of 5 bullish votes', adxMinimum: 18, longOnly: true}),
            B: Object.freeze({entry: 'bullish or mixed EMA alignment and at least 3 of 5 bullish votes; bearish EMA excluded', adxMinimum: 18, longOnly: true}),
            longOnlyBarrier: true
          }),
          stopAtr: 1.5,
          targetR: 2,
          backtestOrderSizing: Object.freeze({
            quantityRounding: 'floor-to-stepSize-before-open',
            rejectBelowMinQty: true,
            rejectBelowMinNotional: true,
            filterSource: 'registered-exchangeFilterSnapshot-only'
          })
        }),
        walkForward: Object.freeze({periods: 4, boundaries: 'registered UTC calendar windows; no warmupFraction'}),
        seedRecord: Object.freeze({
          recordId: 'market-radar-stage1-seed-v1',
          seed: 'mr-stage1-seed-20261010-v1',
          registeredAtUtc: '2026-10-10T11:04:38Z'
        }),
        secondaryValidationSample: Object.freeze({
          count: 100,
          source: 'Binance Vision',
          sourceUrl: 'https://data-api.binance.vision/api/v3/klines'
        }),
        acceptanceCriteria: Object.freeze({
          totalTradesMinimum: 100,
          tradesPerWindowMinimum: 15,
          profitFactorMinimum: 1.3,
          positiveReturnRequired: true,
          outperformBuyAndHoldWindowsMinimum: 3,
          walkForwardWindows: 4,
          maxDrawdownPct: 20,
          stressSlippageUse: 'descriptive-only-not-acceptance'
        }),
        candleDataRecord: Object.freeze({
          status: 'pending-authorized-fetch',
          downloadedAtUtc: null,
          candleCount: null,
          sha256: null
        }),
        finalHoldoutAccess: 'closed-not-fetched-not-read-not-used',
        studyWindow: Object.freeze({startUtc: '2024-11-15T00:00:00Z', endUtcExclusive: '2026-09-28T12:00:00Z'}),
        developmentWindow: Object.freeze({startUtc: '2024-11-15T00:00:00Z', endUtcExclusive: '2025-05-15T00:00:00Z'}),
        walkForwardWindows: Object.freeze([
          Object.freeze({period: 1, startUtc: '2025-05-15T00:00:00Z', endUtcExclusive: '2025-08-15T00:00:00Z'}),
          Object.freeze({period: 2, startUtc: '2025-08-15T00:00:00Z', endUtcExclusive: '2025-11-15T00:00:00Z'}),
          Object.freeze({period: 3, startUtc: '2025-11-15T00:00:00Z', endUtcExclusive: '2026-02-15T00:00:00Z'}),
          Object.freeze({period: 4, startUtc: '2026-02-15T00:00:00Z', endUtcExclusive: '2026-05-15T00:00:00Z'})
        ]),
        finalHoldoutWindow: Object.freeze({startUtc: '2026-05-15T00:00:00Z', endUtcExclusive: '2026-09-28T12:00:00Z'})
      });

      // Historical acquisition is independently gated from strategy-test and signature state.
      const HISTORICAL_FETCH_ENABLED = false;
      const HISTORICAL_FETCH_INTERVAL = '30m';
      const HISTORICAL_FETCH_INTERVAL_MS = 30 * 60 * 1000;
      const HISTORICAL_FETCH_RANGE = Object.freeze({
        startUtc: Date.parse('2024-11-15T00:00:00Z'),
        endUtcExclusive: Date.parse('2026-05-15T00:00:00Z')
      });
      const HISTORICAL_FETCH_PAGE_LIMIT = 1000;
      const HISTORICAL_FETCH_MAX_ATTEMPTS = 3;
      const HISTORICAL_SECONDARY_SAMPLE_COUNT = 100;
      const HISTORICAL_PRIMARY_SOURCE = 'https://api.binance.com/api/v3/klines';
      const HISTORICAL_SECONDARY_SOURCE = 'https://data-api.binance.vision/api/v3/klines';
      const HISTORICAL_DATABASE_NAME = 'market-radar-stage1-history-v1';
      const HISTORICAL_DATABASE_VERSION = 1;
      const HISTORICAL_DATASET_ID = 'mr-stage1-btcusdt-30m-dev-wf-20241115-20260515-v1';
      const APPROVED_HISTORICAL_ARTIFACT = Object.freeze({
        runId: '8da5eb38-60d2-4601-b220-409181227dc0',
        datasetId: HISTORICAL_DATASET_ID,
        sha256: 'd2fae9662896dedeb4d50f935c822e61f6046636dc8b6c52e1f114be191645cd',
        rowCount: 26208,
        startUtc: Date.parse('2024-11-15T00:00:00Z'),
        endUtcExclusive: Date.parse('2026-05-15T00:00:00Z')
      });
      const HISTORICAL_JSONL_CONTENT_TYPE = 'application/x-ndjson;charset=utf-8';
      const HISTORICAL_OHLCV_FIELDS = Object.freeze(['open', 'high', 'low', 'close', 'volume']);

      function validateHistoricalFetchGate() {
        if (!HISTORICAL_FETCH_ENABLED) {
          throw new Error('مسار الجلب التاريخي مغلق؛ يلزم إذن جلب مستقل قبل تفعيله.');
        }
        const registration = REGISTERED_RESEARCH_PROTOCOL;
        const expectedStart = '2024-11-15T00:00:00Z';
        const expectedEnd = '2026-05-15T00:00:00Z';
        const expectedWindows = [
          ['2025-05-15T00:00:00Z', '2025-08-15T00:00:00Z'],
          ['2025-08-15T00:00:00Z', '2025-11-15T00:00:00Z'],
          ['2025-11-15T00:00:00Z', '2026-02-15T00:00:00Z'],
          ['2026-02-15T00:00:00Z', '2026-05-15T00:00:00Z']
        ];
        const actualWindows = registration.walkForwardWindows || [];
        const windowsMatch = actualWindows.length === expectedWindows.length && expectedWindows.every((window, index) =>
          actualWindows[index].period === index + 1 && actualWindows[index].startUtc === window[0] &&
          actualWindows[index].endUtcExclusive === window[1]);
        if (registration.protocolId !== 'market-radar-stage1-binance-spot-btcusdt-30m-v1' ||
            registration.market.exchange !== 'Binance' || registration.market.marketType !== 'Spot' ||
            registration.market.symbol !== 'BTCUSDT' || registration.market.interval !== HISTORICAL_FETCH_INTERVAL ||
            registration.developmentWindow.startUtc !== expectedStart ||
            registration.developmentWindow.endUtcExclusive !== '2025-05-15T00:00:00Z' ||
            !windowsMatch || registration.finalHoldoutWindow.startUtc !== expectedEnd ||
            registration.finalHoldoutWindow.endUtcExclusive !== '2026-09-28T12:00:00Z' ||
            registration.seedRecord.recordId !== 'market-radar-stage1-seed-v1' ||
            registration.seedRecord.seed !== 'mr-stage1-seed-20261010-v1' ||
            registration.secondaryValidationSample.count !== HISTORICAL_SECONDARY_SAMPLE_COUNT ||
            registration.secondaryValidationSample.source !== 'Binance Vision') {
          throw new Error('تعريف التسجيل لا يطابق النطاق والبذرة والعينة المثبتة؛ لم يبدأ الجلب.');
        }
        if (HISTORICAL_FETCH_RANGE.startUtc % HISTORICAL_FETCH_INTERVAL_MS !== 0 ||
            HISTORICAL_FETCH_RANGE.endUtcExclusive % HISTORICAL_FETCH_INTERVAL_MS !== 0 ||
            HISTORICAL_FETCH_RANGE.endUtcExclusive !== Date.parse('2026-05-15T00:00:00Z')) {
          throw new Error('حدود الجلب التاريخي غير متوافقة مع 30m أو تتجاوز حد التطوير المسجل.');
        }
      }

      function assertHistoricalEndTime(endTime) {
        if (!Number.isSafeInteger(endTime) ||
            endTime < HISTORICAL_FETCH_RANGE.startUtc - 1 ||
            endTime > HISTORICAL_FETCH_RANGE.endUtcExclusive - 1) {
          throw new RangeError('endTime خارج النطاق المسموح؛ الحجز النهائي غير قابل للوصول من هذا المسار.');
        }
      }

      function buildHistoricalKlinesUrl(base, symbol, interval, limit, endTime) {
        assertHistoricalEndTime(endTime);
        if (symbol !== 'BTCUSDT' || interval !== HISTORICAL_FETCH_INTERVAL ||
            !Number.isInteger(limit) || limit < 1 || limit > HISTORICAL_FETCH_PAGE_LIMIT) {
          throw new RangeError('طلب تاريخي خارج BTCUSDT Spot 30m أو حد Binance البالغ 1,000.');
        }
        const url = new URL(base);
        // Reverse pagination sends endTime only; no startTime query parameter.
        url.search = new URLSearchParams({symbol, interval, limit: String(limit), endTime: String(endTime)}).toString();
        return url.toString();
      }

      function openHistoricalDatabase() {
        return new Promise((resolve, reject) => {
          if (!globalThis.indexedDB) {
            reject(new Error('IndexedDB غير متاح؛ لم يُرسل أي طلب شبكة.'));
            return;
          }
          const request = indexedDB.open(HISTORICAL_DATABASE_NAME, HISTORICAL_DATABASE_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('runState')) db.createObjectStore('runState', {keyPath: 'runId'});
            if (!db.objectStoreNames.contains('manifestEvents')) db.createObjectStore('manifestEvents', {keyPath: ['runId', 'seq']});
            if (!db.objectStoreNames.contains('stagedCandles')) db.createObjectStore('stagedCandles', {keyPath: ['runId', 'time']});
            if (!db.objectStoreNames.contains('finalArtifacts')) db.createObjectStore('finalArtifacts', {keyPath: 'runId'});
          };
          request.onerror = () => reject(request.error || new Error('تعذر فتح مخزن البيانات التاريخية.'));
          request.onsuccess = () => resolve(request.result);
        });
      }

      async function openExistingHistoricalDatabase() {
        if (!globalThis.indexedDB) throw new Error('IndexedDB غير متاح؛ لم يُرسل أي طلب شبكة.');
        if (typeof indexedDB.databases === 'function') {
          const databases = await indexedDB.databases();
          const existing = databases.find(database => database.name === HISTORICAL_DATABASE_NAME);
          if (!existing || existing.version !== HISTORICAL_DATABASE_VERSION) {
            throw new Error('قاعدة بيانات التشغيل المعتمدة غير موجودة بالإصدار المسجل؛ لم تُنشأ قاعدة بديلة.');
          }
        }
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(HISTORICAL_DATABASE_NAME, HISTORICAL_DATABASE_VERSION);
          let upgradePrevented = false;
          request.onupgradeneeded = () => {
            upgradePrevented = true;
            request.transaction.abort();
          };
          request.onerror = () => reject(request.error || new Error('تعذر فتح قاعدة البيانات الموجودة للقراءة فقط.'));
          request.onsuccess = () => {
            const db = request.result;
            if (upgradePrevented || !db.objectStoreNames.contains('finalArtifacts')) {
              db.close();
              reject(new Error('مخزن finalArtifacts غير موجود في قاعدة البيانات المسجلة؛ لم تُنشأ بنية بديلة.'));
              return;
            }
            resolve(db);
          };
        });
      }

      function createHistoricalRunId() {
        if (crypto.randomUUID) return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
      }

      function createHistoricalRun(db, runId, pageCap) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['runState', 'manifestEvents'], 'readwrite');
          const stateStore = tx.objectStore('runState');
          const manifestStore = tx.objectStore('manifestEvents');
          const range = {
            symbol: 'BTCUSDT', interval: HISTORICAL_FETCH_INTERVAL,
            startUtc: HISTORICAL_FETCH_RANGE.startUtc,
            endUtcExclusive: HISTORICAL_FETCH_RANGE.endUtcExclusive
          };
          stateStore.add({runId, status: 'staging', range, nextManifestSeq: 1, createdAtUtc: new Date().toISOString()});
          manifestStore.add({
            runId, seq: 0, eventType: 'run_registered', writtenAtUtc: new Date().toISOString(),
            protocolId: REGISTERED_RESEARCH_PROTOCOL.protocolId,
            seedRecordId: REGISTERED_RESEARCH_PROTOCOL.seedRecord.recordId,
            seed: REGISTERED_RESEARCH_PROTOCOL.seedRecord.seed,
            seedRegisteredAtUtc: REGISTERED_RESEARCH_PROTOCOL.seedRecord.registeredAtUtc,
            range, primarySource: HISTORICAL_PRIMARY_SOURCE, secondarySource: HISTORICAL_SECONDARY_SOURCE,
            pageLimit: HISTORICAL_FETCH_PAGE_LIMIT, pageCap,
            pagination: 'reverse; endTime-only; no startTime parameter',
            holdoutBoundaryExclusiveUtc: HISTORICAL_FETCH_RANGE.endUtcExclusive,
            gapPolicy: 'stop on gaps; never synthesize or fill candles'
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('تعذر تسجيل بدء المسار قبل الطلب الأول.'));
          tx.onabort = () => reject(tx.error || new Error('أُلغيت معاملة تسجيل المسار.'));
        });
      }

      function appendHistoricalManifestEvent(db, runId, eventType, payload = {}) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['runState', 'manifestEvents'], 'readwrite');
          const stateStore = tx.objectStore('runState');
          const manifestStore = tx.objectStore('manifestEvents');
          let appended = null;
          const request = stateStore.get(runId);
          request.onsuccess = () => {
            const state = request.result;
            if (!state) { tx.abort(); return; }
            const seq = state.nextManifestSeq;
            appended = {...payload, runId, seq, eventType, writtenAtUtc: new Date().toISOString()};
            manifestStore.add(appended); // Manifest rows are append-only.
            state.nextManifestSeq = seq + 1;
            stateStore.put(state);
          };
          tx.oncomplete = () => resolve(appended);
          tx.onerror = () => reject(tx.error || new Error('تعذر إضافة حدث إلى manifest.'));
          tx.onabort = () => reject(tx.error || new Error('أُلغيت إضافة حدث manifest.'));
        });
      }

      function updateHistoricalRunState(db, runId, updates) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['runState'], 'readwrite');
          const store = tx.objectStore('runState');
          const request = store.get(runId);
          request.onsuccess = () => {
            if (!request.result) { tx.abort(); return; }
            store.put({...request.result, ...updates, updatedAtUtc: new Date().toISOString()});
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('تعذر تحديث حالة المسار.'));
          tx.onabort = () => reject(tx.error || new Error('أُلغيت معاملة تحديث المسار.'));
        });
      }

      function stageHistoricalPageAtomically(db, runId, bars) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['stagedCandles'], 'readwrite');
          const store = tx.objectStore('stagedCandles');
          let added = 0, identicalDuplicates = 0, conflict = null;
          for (const bar of bars) {
            const request = store.get([runId, bar.time]);
            request.onsuccess = () => {
              if (conflict) return;
              const existing = request.result;
              if (!existing) { store.add({runId, ...bar}); added++; }
              else if (historicalBarsEqual(existing, bar)) identicalDuplicates++;
              else {
                conflict = {time: bar.time, existing: historicalOhlcv(existing), incoming: historicalOhlcv(bar)};
                tx.abort();
              }
            };
          }
          tx.oncomplete = () => resolve({added, identicalDuplicates});
          tx.onabort = () => {
            if (conflict) {
              const error = new Error('تعارض شمعتين لهما openTime واحد؛ أُوقف المسار دون استبدال البيانات.');
              error.duplicateConflict = conflict;
              reject(error);
            } else reject(tx.error || new Error('أُلغيت كتابة صفحة الشموع المرحلية.'));
          };
          tx.onerror = () => reject(tx.error || new Error('فشلت كتابة صفحة الشموع المرحلية.'));
        });
      }

      function readHistoricalStagedBars(db, runId) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['stagedCandles'], 'readonly');
          const range = IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
          const request = tx.objectStore('stagedCandles').getAll(range);
          request.onsuccess = () => resolve(request.result.map(({runId: _runId, ...bar}) => bar).sort((a, b) => a.time - b.time));
          request.onerror = () => reject(request.error || new Error('تعذرت قراءة الشموع المرحلية.'));
        });
      }

      function readHistoricalManifest(db, runId) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['manifestEvents'], 'readonly');
          const range = IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
          const request = tx.objectStore('manifestEvents').getAll(range);
          request.onsuccess = () => resolve(request.result.sort((a, b) => a.seq - b.seq));
          request.onerror = () => reject(request.error || new Error('تعذرت قراءة manifest.'));
        });
      }

      function historicalBarsEqual(left, right) {
        return left.time === right.time && HISTORICAL_OHLCV_FIELDS.every(field => left[field] === right[field]);
      }

      function historicalOhlcv(bar) {
        return {open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume};
      }

      function normalizeHistoricalKlines(payload, maximumRows) {
        if (!Array.isArray(payload) || payload.length > maximumRows) throw new TypeError('صيغة أو عدد صفوف Kline غير صالح.');
        const bars = [];
        for (const row of payload) {
          if (!Array.isArray(row) || row.length < 6) throw new TypeError('صف Kline غير مكتمل.');
          const time = Number(row[0]);
          const values = row.slice(1, 6);
          if (!Number.isSafeInteger(time) || time < 0 || time % HISTORICAL_FETCH_INTERVAL_MS !== 0 ||
              values.some(value => typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))) {
            throw new TypeError('وقت فتح الشمعة أو قيم OHLCV غير صالحة أو غير متوافقة مع 30m.');
          }
          const numbers = values.map(Number);
          const [open, high, low, close, volume] = numbers;
          if (!numbers.every(Number.isFinite) || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
              high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
            throw new TypeError('قيم OHLCV غير متسقة عند openTime ' + time + '.');
          }
          bars.push({time, open: values[0], high: values[1], low: values[2], close: values[3], volume: values[4]});
        }
        bars.sort((a, b) => a.time - b.time);
        return bars;
      }

      function deduplicateHistoricalPage(bars) {
        const byTime = new Map();
        let identicalDuplicates = 0;
        for (const bar of bars) {
          const previous = byTime.get(bar.time);
          if (!previous) { byTime.set(bar.time, bar); continue; }
          if (!historicalBarsEqual(previous, bar)) {
            const error = new Error('تعارض تكرار openTime داخل صفحة Binance.');
            error.duplicateConflict = {time: bar.time, first: historicalOhlcv(previous), second: historicalOhlcv(bar)};
            throw error;
          }
          identicalDuplicates++;
        }
        return {bars: [...byTime.values()].sort((a, b) => a.time - b.time), identicalDuplicates};
      }

      function findHistoricalGap(sortedBars, expectedFirstTime = null, expectedEndExclusive = null) {
        if (expectedFirstTime !== null && sortedBars.length && sortedBars[0].time !== expectedFirstTime) {
          return {expectedOpenTime: expectedFirstTime, actualOpenTime: sortedBars[0].time};
        }
        for (let index = 1; index < sortedBars.length; index++) {
          const expectedOpenTime = sortedBars[index - 1].time + HISTORICAL_FETCH_INTERVAL_MS;
          if (sortedBars[index].time !== expectedOpenTime) {
            return {expectedOpenTime, actualOpenTime: sortedBars[index].time};
          }
        }
        if (expectedEndExclusive !== null) {
          const expectedLastTime = expectedEndExclusive - HISTORICAL_FETCH_INTERVAL_MS;
          const actualLastTime = sortedBars.length ? sortedBars[sortedBars.length - 1].time : null;
          if (actualLastTime !== expectedLastTime) return {expectedOpenTime: expectedLastTime, actualOpenTime: actualLastTime};
        }
        return null;
      }

      function historicalCoverageSummary(sortedBars) {
        const gap = findHistoricalGap(sortedBars, HISTORICAL_FETCH_RANGE.startUtc,
          HISTORICAL_FETCH_RANGE.endUtcExclusive);
        const expectedCandleCount = (HISTORICAL_FETCH_RANGE.endUtcExclusive - HISTORICAL_FETCH_RANGE.startUtc) /
          HISTORICAL_FETCH_INTERVAL_MS;
        return {
          startUtc: HISTORICAL_FETCH_RANGE.startUtc,
          endUtcExclusive: HISTORICAL_FETCH_RANGE.endUtcExclusive,
          expectedCandleCount,
          actualCandleCount: sortedBars.length,
          firstOpenTime: sortedBars.length ? sortedBars[0].time : null,
          lastOpenTime: sortedBars.length ? sortedBars[sortedBars.length - 1].time : null,
          gap
        };
      }

      async function sha256HistoricalHex(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      }

      function parseHashedHistoricalResponse(rawBytes) {
        // Callers persist the SHA-256 manifest event before reaching this parser.
        return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(rawBytes));
      }

      function historicalRetryDelayMs(header) {
        if (header === null || header === undefined || header === '') return 60000;
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000 + 1000;
        const retryAt = Date.parse(header);
        return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) + 1000 : 60000;
      }

      function waitHistoricalRetry(milliseconds, signal) {
        if (signal && signal.aborted) return Promise.reject(signal.reason || new Error('أُلغي الجلب.'));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(done, milliseconds);
          function done() {
            if (signal) signal.removeEventListener('abort', aborted);
            resolve();
          }
          function aborted() {
            clearTimeout(timer);
            signal.removeEventListener('abort', aborted);
            reject(signal.reason || new Error('أُلغي الجلب.'));
          }
          if (signal) signal.addEventListener('abort', aborted, {once: true});
        });
      }

      async function fetchHistoricalResponse({url, db, runId, signal, stage, pageNumber = null, sampleOpenTime = null}) {
        for (let attempt = 1; attempt <= HISTORICAL_FETCH_MAX_ATTEMPTS; attempt++) {
          if (signal && signal.aborted) throw (signal.reason || new Error('أُلغي الجلب.'));
          const controller = new AbortController();
          const abortFromCaller = () => controller.abort(signal.reason || new Error('أُلغي الجلب.'));
          if (signal) {
            if (signal.aborted) abortFromCaller();
            else signal.addEventListener('abort', abortFromCaller, {once: true});
          }
          const timer = setTimeout(() => controller.abort(new Error('انتهت مهلة طلب Kline التاريخي.')), 15000);
          let response;
          try {
            try {
              response = await fetch(url, {
                method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
                referrerPolicy: 'no-referrer', headers: {Accept: 'application/json'}, signal: controller.signal
              });
            } catch (error) {
              await appendHistoricalManifestEvent(db, runId, 'request_network_error', {
                source: stage === 'secondary-sample' ? HISTORICAL_SECONDARY_SOURCE : HISTORICAL_PRIMARY_SOURCE,
                stage, pageNumber, sampleOpenTime, attempt,
                error: {name: String(error && error.name || 'Error'), message: String(error && error.message || error).slice(0, 300)}
              });
              throw error;
            }
            const rawBytes = new Uint8Array(await response.arrayBuffer());
            const responseSha256 = await sha256HistoricalHex(rawBytes);
            await appendHistoricalManifestEvent(db, runId, 'raw_response', {
              source: stage === 'secondary-sample' ? HISTORICAL_SECONDARY_SOURCE : HISTORICAL_PRIMARY_SOURCE,
              stage, pageNumber, sampleOpenTime, attempt, httpStatus: response.status,
              rawByteLength: rawBytes.byteLength, responseSha256
            });
            if (response.status === 429) {
              if (attempt === HISTORICAL_FETCH_MAX_ATTEMPTS) {
                throw new Error('استمر HTTP 429 بعد ثلاث محاولات لهذه الصفحة/العينة.');
              }
              const retryAfter = response.headers.get('Retry-After');
              const waitMs = historicalRetryDelayMs(retryAfter);
              await appendHistoricalManifestEvent(db, runId, 'retry_after_429', {
                stage, pageNumber, sampleOpenTime, attempt, retryAfter: retryAfter || null,
                waitMs, nextAttempt: attempt + 1
              });
              await waitHistoricalRetry(waitMs, signal);
              continue;
            }
            return {status: response.status, rawBytes, sha256: responseSha256};
          } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abortFromCaller);
          }
        }
        throw new Error('انتهت محاولات طلب Kline التاريخي دون استجابة.');
      }

      function selectSeededHistoricalSamples(sortedBars, seed, count) {
        if (sortedBars.length < count) throw new Error('عدد الشموع أقل من 100؛ لا يمكن تنفيذ عينة تحقق ثابتة العدد.');
        let state = 2166136261;
        for (let index = 0; index < seed.length; index++) {
          state ^= seed.charCodeAt(index);
          state = Math.imul(state, 16777619) >>> 0;
        }
        if (state === 0) state = 0x9e3779b9;
        const random = () => {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          return (state >>> 0) / 0x100000000;
        };
        const indexes = Array.from({length: sortedBars.length}, (_, index) => index);
        for (let index = indexes.length - 1; index > 0; index--) {
          const swapIndex = Math.floor(random() * (index + 1));
          [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
        }
        return indexes.slice(0, count).sort((a, b) => a - b).map(index => sortedBars[index]);
      }

      function serializeHistoricalJsonl(sortedBars) {
        // Fixed property order, compact JSON, UTF-8, LF separators, no final LF.
        return sortedBars.map(bar => JSON.stringify({
          time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume
        })).join('\n');
      }

      function commitHistoricalArtifactAtomically(db, runId, metadata, summary) {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(['runState', 'manifestEvents', 'finalArtifacts'], 'readwrite');
          const stateStore = tx.objectStore('runState');
          const manifestStore = tx.objectStore('manifestEvents');
          const finalStore = tx.objectStore('finalArtifacts');
          let state = null, ready = false;
          const request = stateStore.get(runId);
          request.onsuccess = () => {
            state = request.result || null;
            ready = true;
            if (!ready || !state) { tx.abort(); return; }
            const seq = state.nextManifestSeq;
            const commitEvent = {
              runId, seq, eventType: 'run_committed', writtenAtUtc: new Date().toISOString(),
              ...summary, artifactSha256: metadata.sha256, artifactByteLength: metadata.byteLength,
              artifactRowCount: metadata.rowCount
            };
            finalStore.add({...metadata, committedAtUtc: new Date().toISOString()});
            manifestStore.add(commitEvent);
            state.status = 'committed'; state.nextManifestSeq = seq + 1;
            state.terminationReason = summary.terminationReason;
            stateStore.put(state);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('فشلت معاملة اعتماد الملف الموحد.'));
          tx.onabort = () => reject(tx.error || new Error('أُلغيت معاملة اعتماد الملف الموحد.'));
        });
      }

      async function stopHistoricalRun(db, runId, reason, details) {
        await appendHistoricalManifestEvent(db, runId, 'run_stopped', {
          terminationReason: reason, partial: true, details,
          gapPolicy: 'No candles were synthesized or filled; staged data remains uncommitted.'
        });
        await updateHistoricalRunState(db, runId, {status: 'partial', terminationReason: reason});
      }

      async function fetchRegisteredHistoricalCandles({signal} = {}) {
        // This guard is first: with the source constant false, no DB is opened
        // and no HTTP request or storage mutation can occur.
        validateHistoricalFetchGate();
        if (!globalThis.crypto || !crypto.subtle || !crypto.getRandomValues) {
          throw new Error('Web Crypto غير متاح؛ لم يبدأ المسار ولم يُرسل طلب شبكة.');
        }
        const rangeMs = HISTORICAL_FETCH_RANGE.endUtcExclusive - HISTORICAL_FETCH_RANGE.startUtc;
        const pageCap = Math.ceil(rangeMs / (HISTORICAL_FETCH_PAGE_LIMIT * HISTORICAL_FETCH_INTERVAL_MS)) + 5;
        const db = await openHistoricalDatabase();
        const runId = APPROVED_HISTORICAL_ARTIFACT.runId;
        let runCreated = false, pageCount = 0, stopReason = null;
        const initialEndTime = HISTORICAL_FETCH_RANGE.endUtcExclusive - 1;
        let cursorEndTime = initialEndTime;
        let newerPageOldestOpenTime = null;
        try {
          await createHistoricalRun(db, runId, pageCap);
          runCreated = true;
          for (let pageNumber = 1; pageNumber <= pageCap; pageNumber++) {
            pageCount = pageNumber;
            if (signal && signal.aborted) throw (signal.reason || new Error('أُلغي الجلب.'));
            assertHistoricalEndTime(cursorEndTime);
            const requestUrl = buildHistoricalKlinesUrl(
              HISTORICAL_PRIMARY_SOURCE, 'BTCUSDT', HISTORICAL_FETCH_INTERVAL,
              HISTORICAL_FETCH_PAGE_LIMIT, cursorEndTime
            );
            await appendHistoricalManifestEvent(db, runId, 'page_request', {
              source: HISTORICAL_PRIMARY_SOURCE, pageNumber,
              rangeStartUtc: HISTORICAL_FETCH_RANGE.startUtc,
              rangeEndUtcExclusive: HISTORICAL_FETCH_RANGE.endUtcExclusive,
              request: {symbol: 'BTCUSDT', interval: HISTORICAL_FETCH_INTERVAL,
                limit: HISTORICAL_FETCH_PAGE_LIMIT, endTime: cursorEndTime},
              startTimeSent: false, maxAttempts: HISTORICAL_FETCH_MAX_ATTEMPTS
            });
            const responseRecord = await fetchHistoricalResponse({
              url: requestUrl, db, runId, signal, stage: 'primary-page', pageNumber
            });
            if (responseRecord.status < 200 || responseRecord.status >= 300) {
              throw new Error('أعاد Binance HTTP ' + responseRecord.status + ' في الصفحة ' + pageNumber + '.');
            }
            // The raw SHA-256 and its timestamped manifest event are persisted
            // inside fetchHistoricalResponse before parsing begins here.
            const payload = parseHashedHistoricalResponse(responseRecord.rawBytes);
            const receivedBars = normalizeHistoricalKlines(payload, HISTORICAL_FETCH_PAGE_LIMIT);
            if (receivedBars.some(bar => bar.time > cursorEndTime)) {
              throw new Error('أعاد Binance openTime بعد endTime؛ أُوقف المسار.');
            }
            const inRangeBars = receivedBars.filter(bar =>
              bar.time >= HISTORICAL_FETCH_RANGE.startUtc && bar.time < HISTORICAL_FETCH_RANGE.endUtcExclusive
            );
            let deduped;
            try {
              deduped = deduplicateHistoricalPage(inRangeBars);
            } catch (error) {
              if (error && error.duplicateConflict) {
                await appendHistoricalManifestEvent(db, runId, 'duplicate_conflict', {
                  pageNumber, ...error.duplicateConflict
                });
              }
              throw error;
            }
            const pageGap = findHistoricalGap(deduped.bars);
            if (pageGap) {
              await appendHistoricalManifestEvent(db, runId, 'gap_detected', {pageNumber, ...pageGap});
              stopReason = 'gap-detected';
              break;
            }
            if (newerPageOldestOpenTime !== null && deduped.bars.length) {
              const olderPageNewest = deduped.bars[deduped.bars.length - 1].time;
              const expectedOlderPageNewest = newerPageOldestOpenTime - HISTORICAL_FETCH_INTERVAL_MS;
              if (olderPageNewest !== expectedOlderPageNewest && olderPageNewest !== newerPageOldestOpenTime) {
                await appendHistoricalManifestEvent(db, runId, 'gap_detected', {
                  pageNumber, expectedOpenTime: expectedOlderPageNewest, actualOpenTime: olderPageNewest,
                  reason: 'reverse-page-boundary-discontinuity'
                });
                stopReason = 'gap-detected';
                break;
              }
            }
            let staged;
            try {
              staged = await stageHistoricalPageAtomically(db, runId, deduped.bars);
            } catch (error) {
              if (error && error.duplicateConflict) {
                await appendHistoricalManifestEvent(db, runId, 'duplicate_conflict', {
                  pageNumber, ...error.duplicateConflict
                });
              }
              throw error;
            }
            const oldestOpenTime = receivedBars.length ? receivedBars[0].time : null;
            const newestOpenTime = receivedBars.length ? receivedBars[receivedBars.length - 1].time : null;
            await appendHistoricalManifestEvent(db, runId, 'page_processed', {
              source: HISTORICAL_PRIMARY_SOURCE, pageNumber,
              request: {endTime: cursorEndTime, limit: HISTORICAL_FETCH_PAGE_LIMIT},
              rowsReceived: receivedBars.length, rowsWithinRange: inRangeBars.length,
              uniqueRowsWithinRange: deduped.bars.length, rowsAddedToStaging: staged.added,
              identicalDuplicates: deduped.identicalDuplicates + staged.identicalDuplicates,
              oldestOpenTime, newestOpenTime, responseSha256: responseRecord.sha256
            });
            if (deduped.bars.length) newerPageOldestOpenTime = deduped.bars[0].time;

            const reachedStart = oldestOpenTime !== null && oldestOpenTime <= HISTORICAL_FETCH_RANGE.startUtc;
            const shortPage = receivedBars.length < HISTORICAL_FETCH_PAGE_LIMIT;
            if (reachedStart || shortPage) {
              stopReason = reachedStart ? 'reached-start' : 'short-page';
              break;
            }
            if (pageNumber === pageCap) {
              stopReason = 'page-cap';
              break;
            }
            if (oldestOpenTime === null || oldestOpenTime <= 0) {
              throw new Error('تعذر تحريك مؤشر التصفح العكسي إلى الخلف.');
            }
            const nextEndTime = oldestOpenTime - 1;
            if (nextEndTime >= cursorEndTime) throw new Error('مؤشر endTime لم يتحرك إلى الخلف.');
            cursorEndTime = nextEndTime;
          }

          await appendHistoricalManifestEvent(db, runId, 'primary_stop', {
            stopReason: stopReason || 'page-cap', pageCount,
            finalRequestEndTime: cursorEndTime,
            rangeStartUtc: HISTORICAL_FETCH_RANGE.startUtc,
            rangeEndUtcExclusive: HISTORICAL_FETCH_RANGE.endUtcExclusive
          });
          if (!stopReason) stopReason = 'page-cap';
          if (stopReason === 'gap-detected' || stopReason === 'page-cap') {
            await stopHistoricalRun(db, runId, stopReason, {pageCount, cursorEndTime});
            return {status: 'partial', runId, stopReason, pageCount};
          }

          const stagedBars = await readHistoricalStagedBars(db, runId);
          const coverage = historicalCoverageSummary(stagedBars);
          if (coverage.gap || coverage.actualCandleCount !== coverage.expectedCandleCount) {
            await appendHistoricalManifestEvent(db, runId, 'gap_detected', {
              reason: 'requested-range-coverage-incomplete', coverage
            });
            await stopHistoricalRun(db, runId, 'gap-detected', {pageCount, coverage, primaryStopReason: stopReason});
            return {status: 'partial', runId, stopReason: 'gap-detected', pageCount, coverage};
          }

          const seed = REGISTERED_RESEARCH_PROTOCOL.seedRecord.seed;
          const samples = selectSeededHistoricalSamples(stagedBars, seed, HISTORICAL_SECONDARY_SAMPLE_COUNT);
          await appendHistoricalManifestEvent(db, runId, 'secondary_sample_plan', {
            source: HISTORICAL_SECONDARY_SOURCE, interval: HISTORICAL_FETCH_INTERVAL,
            requestedSampleCount: HISTORICAL_SECONDARY_SAMPLE_COUNT,
            selectedSampleCount: samples.length, sampleOpenTimes: samples.map(bar => bar.time),
            seedRecordId: REGISTERED_RESEARCH_PROTOCOL.seedRecord.recordId, seed,
            selection: 'seeded Fisher-Yates sample without replacement'
          });
          for (const sample of samples) {
            if (signal && signal.aborted) throw (signal.reason || new Error('أُلغي الجلب.'));
            const sampleUrl = buildHistoricalKlinesUrl(
              HISTORICAL_SECONDARY_SOURCE, 'BTCUSDT', HISTORICAL_FETCH_INTERVAL, 1, sample.time
            );
            await appendHistoricalManifestEvent(db, runId, 'secondary_sample_request', {
              source: HISTORICAL_SECONDARY_SOURCE, sampleOpenTime: sample.time,
              request: {symbol: 'BTCUSDT', interval: HISTORICAL_FETCH_INTERVAL, limit: 1, endTime: sample.time},
              startTimeSent: false
            });
            const secondaryResponse = await fetchHistoricalResponse({
              url: sampleUrl, db, runId, signal, stage: 'secondary-sample', sampleOpenTime: sample.time
            });
            if (secondaryResponse.status < 200 || secondaryResponse.status >= 300) {
              throw new Error('أعاد Binance Vision HTTP ' + secondaryResponse.status + ' لعينة ' + sample.time + '.');
            }
            const secondaryPayload = parseHashedHistoricalResponse(secondaryResponse.rawBytes);
            const secondaryBars = normalizeHistoricalKlines(secondaryPayload, 1);
            const matched = secondaryBars.find(bar => bar.time === sample.time);
            if (!matched || HISTORICAL_OHLCV_FIELDS.some(field => matched[field] !== sample[field])) {
              await appendHistoricalManifestEvent(db, runId, 'secondary_verification_mismatch', {
                sampleOpenTime: sample.time,
                primary: historicalOhlcv(sample),
                secondary: matched ? historicalOhlcv(matched) : null,
                responseSha256: secondaryResponse.sha256
              });
              throw new Error('فشل تطابق OHLCV في عينة Binance Vision عند ' + sample.time + '.');
            }
            await appendHistoricalManifestEvent(db, runId, 'secondary_verification_match', {
              source: HISTORICAL_SECONDARY_SOURCE, sampleOpenTime: sample.time,
              comparedFields: HISTORICAL_OHLCV_FIELDS, responseSha256: secondaryResponse.sha256, match: true
            });
          }

          const jsonl = serializeHistoricalJsonl(stagedBars);
          const bytes = new TextEncoder().encode(jsonl);
          const artifactSha256 = await sha256HistoricalHex(bytes);
          const metadata = {
            datasetId: HISTORICAL_DATASET_ID, runId,
            fileName: 'BTCUSDT_30m_20241115T000000Z_20260515T000000Z.jsonl',
            contentType: HISTORICAL_JSONL_CONTENT_TYPE, jsonl,
            byteLength: bytes.byteLength, sha256: artifactSha256, rowCount: stagedBars.length
          };
          const summary = {
            protocolId: REGISTERED_RESEARCH_PROTOCOL.protocolId,
            range: {symbol: 'BTCUSDT', interval: HISTORICAL_FETCH_INTERVAL,
              startUtc: HISTORICAL_FETCH_RANGE.startUtc, endUtcExclusive: HISTORICAL_FETCH_RANGE.endUtcExclusive},
            terminationReason: stopReason, pageCount, coverage,
            secondarySource: HISTORICAL_SECONDARY_SOURCE,
            secondaryVerifiedSamples: samples.length,
            seedRecordId: REGISTERED_RESEARCH_PROTOCOL.seedRecord.recordId
          };
          const researchCandles = normalizeCandles(stagedBars.map(bar =>
            [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]
          ));
          if (researchCandles.length !== stagedBars.length) {
            throw new Error('فشل تحويل الملف المعتمد إلى شموع المحرك؛ لم يُشغّل أي بحث.');
          }
          await commitHistoricalArtifactAtomically(db, runId, metadata, summary);
          const settings = REGISTERED_RESEARCH_PROTOCOL.settings;
          pendingResearch = {
            candles: researchCandles, indicators: null,
            options: {
              capital: settings.initialCapitalUsdt, riskPct: settings.riskPct,
              feePerSide: settings.feePerSidePct / 100,
              slippagePerSide: settings.slippagePerSidePct / 100,
              longOnly: true
            },
            symbol: 'BTCUSDT', interval: HISTORICAL_FETCH_INTERVAL,
            source: 'registered-historical-artifact', datasetId: HISTORICAL_DATASET_ID,
            sha256: artifactSha256
          };
          return {
            status: 'committed', runId, stopReason, pageCount,
            candleCount: stagedBars.length, sha256: artifactSha256,
            secondaryVerifiedSamples: samples.length
          };
        } catch (error) {
          stopReason = stopReason || (error && error.duplicateConflict ? 'duplicate-conflict' : 'error');
          if (!runCreated) throw error;
          try {
            await stopHistoricalRun(db, runId, stopReason, {
              pageCount, cursorEndTime,
              error: {name: String(error && error.name || 'Error'), message: String(error && error.message || error).slice(0, 500)}
            });
          } catch (_) { /* Keep original failure; prior manifest rows remain append-only. */ }
          return {status: 'partial', runId, stopReason, pageCount,
            error: {name: String(error && error.name || 'Error'), message: String(error && error.message || error).slice(0, 500)}};
        } finally {
          db.close();
        }
      }

      async function exportHistoricalRunData(runId) {
        const db = await openHistoricalDatabase();
        try {
          if (!runId) throw new Error('يلزم معرّف التشغيل لقراءة الملف التاريخي المعتمد.');
          const tx = db.transaction(['finalArtifacts'], 'readonly');
          const artifact = await new Promise((resolve, reject) => {
            const request = tx.objectStore('finalArtifacts').get(runId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('تعذرت قراءة الملف التاريخي.'));
          });
          if (!artifact || (runId && artifact.runId !== runId)) throw new Error('لا يوجد ملف تاريخي معتمد لهذا المسار.');
          downloadHistoricalBlob(new Blob([artifact.jsonl], {type: artifact.contentType}), artifact.fileName);
          return {rowCount: artifact.rowCount, sha256: artifact.sha256};
        } finally { db.close(); }
      }

      async function exportHistoricalRunManifest(runId) {
        const db = await openHistoricalDatabase();
        try {
          const events = await readHistoricalManifest(db, runId);
          if (!events.length) throw new Error('لا يوجد manifest لهذا المسار.');
          const jsonl = events.map(event => JSON.stringify(event)).join('\n');
          downloadHistoricalBlob(new Blob([jsonl], {type: HISTORICAL_JSONL_CONTENT_TYPE}), runId + '.manifest.jsonl');
          return {rowCount: events.length};
        } finally { db.close(); }
      }

      function downloadHistoricalBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
        anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      let pendingResearch = null;

      function isApprovedHistoricalResearchLoaded() {
        return Boolean(pendingResearch &&
          pendingResearch.source === 'registered-historical-artifact' &&
          pendingResearch.datasetId === APPROVED_HISTORICAL_ARTIFACT.datasetId &&
          pendingResearch.sha256 === APPROVED_HISTORICAL_ARTIFACT.sha256 &&
          pendingResearch.candles && pendingResearch.candles.length === APPROVED_HISTORICAL_ARTIFACT.rowCount);
      }

      function syncResearchButton() {
        const button = $('run-research');
        if (!button) return;
        const approvedLoaded = isApprovedHistoricalResearchLoaded();
        const settingsMatch = approvedLoaded && researchSettingMismatches(REGISTERED_RESEARCH_PROTOCOL, pendingResearch).length === 0;
        button.disabled = !STRATEGY_TESTING_ENABLED || !settingsMatch;
        button.setAttribute('aria-disabled', String(button.disabled));
      }

      async function loadApprovedHistoricalArtifact() {
        if (!globalThis.crypto || !crypto.subtle || typeof TextEncoder !== 'function') {
          throw new Error('Web Crypto أو UTF-8 encoder غير متاح؛ لم يُحمّل الملف ولم يتغير pendingResearch.');
        }
        const expected = APPROVED_HISTORICAL_ARTIFACT;
        const db = await openExistingHistoricalDatabase();
        let artifactRecords;
        try {
          const tx = db.transaction(['finalArtifacts'], 'readonly');
          artifactRecords = await new Promise((resolve, reject) => {
            const request = tx.objectStore('finalArtifacts').getAll();
            let result = [];
            request.onsuccess = () => { result = Array.isArray(request.result) ? request.result : []; };
            request.onerror = () => reject(request.error || new Error('تعذرت قراءة artifact المعتمد من IndexedDB.'));
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('فشلت معاملة قراءة artifact.'));
            tx.onabort = () => reject(tx.error || new Error('أُلغيت معاملة قراءة artifact.'));
          });
        } finally {
          db.close();
        }

        const matchingArtifacts = artifactRecords.filter(artifact => artifact &&
          artifact.datasetId === expected.datasetId && artifact.sha256 === expected.sha256 &&
          artifact.rowCount === expected.rowCount);
        if (matchingArtifacts.length === 0) {
          throw new Error('رفض الملف: لا يوجد سجل يطابق datasetId وSHA-256 وعدد الصفوف المعتمدة؛ لم يتغير pendingResearch.');
        }
        let artifact = matchingArtifacts[0];
        if (matchingArtifacts.length > 1) {
          const byteLength = artifact.byteLength;
          if (matchingArtifacts.some(candidate => candidate.byteLength !== byteLength)) {
            throw new Error('رفض الملف: وُجد أكثر من سجل مطابق ببصمة مختلفة؛ لم يتغير pendingResearch.');
          }
          let latestCommittedAt = Date.parse(artifact.committedAtUtc);
          if (!Number.isFinite(latestCommittedAt)) {
            throw new Error('رفض الملف: تعذر تحديد أحدث سجل مطابق؛ لم يتغير pendingResearch.');
          }
          for (const candidate of matchingArtifacts.slice(1)) {
            const candidateCommittedAt = Date.parse(candidate.committedAtUtc);
            if (!Number.isFinite(candidateCommittedAt)) {
              throw new Error('رفض الملف: تعذر تحديد أحدث سجل مطابق؛ لم يتغير pendingResearch.');
            }
            if (candidateCommittedAt > latestCommittedAt) {
              artifact = candidate;
              latestCommittedAt = candidateCommittedAt;
            }
          }
        }
        if (artifact.rowCount !== expected.rowCount || typeof artifact.jsonl !== 'string') {
          throw new Error('رفض الملف: عدد الصفوف أو محتوى JSONL لا يطابق التسجيل؛ لم يتغير pendingResearch.');
        }
        if (artifact.sha256 !== expected.sha256) {
          throw new Error('رفض الملف: بصمة metadata لا تطابق البصمة المعتمدة؛ لم يتغير pendingResearch.');
        }

        const bytes = new TextEncoder().encode(artifact.jsonl);
        if (artifact.byteLength !== bytes.byteLength) {
          throw new Error('رفض الملف: طول UTF-8 لا يطابق metadata؛ لم يتغير pendingResearch.');
        }
        const actualSha256 = await sha256HistoricalHex(bytes);
        if (actualSha256 !== expected.sha256 || actualSha256 !== artifact.sha256) {
          throw new Error('رفض الملف: SHA-256 المحسوب لا يطابق البصمة المتوقعة وmetadata؛ لم يتغير pendingResearch.');
        }

        const lines = artifact.jsonl.split('\n');
        if (lines.length !== expected.rowCount || lines.some(line => line.length === 0)) {
          throw new Error('رفض الملف: عدد أسطر JSONL لا يطابق rowCount؛ لم يتغير pendingResearch.');
        }
        const rawRows = lines.map(line => {
          const row = JSON.parse(line);
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new TypeError('رفض الملف: صف JSONL ليس سجل OHLCV.');
          }
          return [row.time, row.open, row.high, row.low, row.close, row.volume];
        });
        const bars = normalizeHistoricalKlines(rawRows, expected.rowCount);
        const expectedCount = (expected.endUtcExclusive - expected.startUtc) / HISTORICAL_FETCH_INTERVAL_MS;
        if (expectedCount !== expected.rowCount || bars.length !== expected.rowCount) {
          throw new Error('رفض الملف: التغطية وعدد الشموع لا يطابقان النطاق المسجل؛ لم يتغير pendingResearch.');
        }
        for (let index = 0; index < bars.length; index++) {
          const expectedOpenTime = expected.startUtc + index * HISTORICAL_FETCH_INTERVAL_MS;
          if (bars[index].time !== expectedOpenTime) {
            throw new Error('رفض الملف: يوجد نقص أو تكرار أو انقطاع في تباعد 30m عند الصف ' + (index + 1) + '؛ لم يتغير pendingResearch.');
          }
        }

        const candles = normalizeCandles(bars.map(bar =>
          [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]
        ));
        if (candles.length !== expected.rowCount) {
          throw new Error('رفض الملف: تطبيع الشموع أسقط صفوفًا؛ لم يتغير pendingResearch.');
        }
        const registration = REGISTERED_RESEARCH_PROTOCOL;
        const settings = registration.settings;
        const preparedResearch = {
          candles, indicators: null,
          options: {
            capital: settings.initialCapitalUsdt, riskPct: settings.riskPct,
            feePerSide: settings.feePerSidePct / 100,
            slippagePerSide: settings.slippagePerSidePct / 100,
            longOnly: true
          },
          symbol: registration.market.symbol, interval: registration.market.interval,
          source: 'registered-historical-artifact', datasetId: expected.datasetId,
          sha256: actualSha256
        };
        pendingResearch = preparedResearch;
        $('symbol').value = registration.market.symbol;
        $('interval').value = registration.market.interval;
        $('capital').value = String(settings.initialCapitalUsdt);
        $('risk').value = String(settings.riskPct);
        $('fee').value = String(settings.feePerSidePct);
        $('slippage').value = String(settings.slippagePerSidePct);
        syncResearchButton();
        return {
          status: 'loaded', datasetId: expected.datasetId,
          rowCount: expected.rowCount, sha256: actualSha256
        };
      }

      function lastClosedEndTime(interval, now = Date.now()) {
        const duration = INTERVALS[interval];
        if (!duration) throw new Error('اختر إطارًا زمنيًا مدعومًا.');
        const anchor = interval === '1w' ? Date.UTC(1970, 0, 5) : 0;
        return Math.floor((now - anchor) / duration) * duration + anchor - 1;
      }

      let listedUsdtSymbols = null;
      async function loadUsdtSymbolCatalog() {
        const query = '?permissions=SPOT&symbolStatus=TRADING&showPermissionSets=false';
        const origins = ['https://data-api.binance.vision/api/v3/exchangeInfo', 'https://api.binance.com/api/v3/exchangeInfo'];
        const errors = [];
        for (const base of origins) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetch(base + query, {method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: {Accept: 'application/json'}, signal: controller.signal});
            if (response.status === 429 || response.status === 418) {
              errors.push('تجاوز مصدر البيانات حد الطلب؛ حاول تحديث القائمة لاحقًا.');
              break;
            }
            if (!response.ok) {
              errors.push('استجابة HTTP ' + response.status);
              if (response.status >= 400 && response.status < 500 && response.status !== 408) break;
              continue;
            }
            const data = await response.json();
            if (!data || !Array.isArray(data.symbols)) throw new Error('صيغة قائمة الأزواج غير صالحة.');
            const symbols = [...new Set(data.symbols
              .filter(item => item && item.status === 'TRADING' && item.quoteAsset === 'USDT' && item.isSpotTradingAllowed !== false && /^[A-Z0-9]{5,20}$/.test(item.symbol))
              .map(item => item.symbol))].sort();
            if (!symbols.length) throw new Error('لم تُرجع Binance أزواج USDT نشطة.');
            const options = symbols.map(symbol => {
              const option = document.createElement('option');
              option.value = symbol;
              return option;
            });
            $('symbol-options').replaceChildren(...options);
            listedUsdtSymbols = new Set(symbols);
            $('symbol-list-status').textContent = 'قائمة محدثة: ' + symbols.length.toLocaleString('en-US') + ' زوج USDT نشط على Binance.';
            return;
          } catch (error) {
            errors.push(error && error.name === 'AbortError' ? 'انتهت مهلة تحميل القائمة.' : 'تعذر الاتصال بمصدر القائمة.');
          } finally {
            clearTimeout(timer);
          }
        }
        listedUsdtSymbols = null;
        $('symbol-list-status').textContent = 'تعذر تحديث القائمة الآن؛ يمكنك كتابة زوج USDT صالح يدويًا. ' + errors.join(' ');
      }

      async function getKlines(symbol, interval, limit) {
        if (!Number.isInteger(limit) || limit < 1 || limit > BINANCE_MAX_KLINE_LIMIT) throw new RangeError('حد طلب الشموع خارج النطاق.');
        const apiLimit = Math.min(BINANCE_MAX_KLINE_LIMIT, limit + 1);
        const query = new URLSearchParams({symbol, interval, limit: String(apiLimit), endTime: String(lastClosedEndTime(interval))}).toString();
        const origins = ['https://data-api.binance.vision/api/v3/klines?', 'https://api.binance.com/api/v3/klines?'];
        const errors = [];
        for (const base of origins) {
          const host = base.split('/')[2] || 'مصدر البيانات';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetch(base + query, {method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: {Accept: 'application/json'}, signal: controller.signal});
            if (response.status === 429 || response.status === 418) {
              errors.push(host + ': HTTP ' + response.status + ' (حد الطلب؛ أوقفنا المحاولة البديلة الفورية).');
              break;
            }
            if (response.status === 400) {
              const detail = await response.json().catch(() => null);
              if (detail && (detail.code === -1121 || /invalid symbol/i.test(String(detail.msg || detail.message || '')))) {
                const invalidSymbol = new Error('الزوج ' + symbol + ' غير مدرج كزوج Binance Spot نشط مقوّم بـUSDT. ابحث عنه في القائمة أو تحقق من رمز التداول.');
                invalidSymbol.permanent = true;
                throw invalidSymbol;
              }
            }
            if (!response.ok) {
              errors.push(host + ': HTTP ' + response.status);
              if (response.status >= 400 && response.status < 500 && response.status !== 408) break;
              continue;
            }
            let body;
            try { body = await response.json(); }
            catch (_) { errors.push(host + ': استجابة غير مقروءة (HTTP ' + response.status + ').'); continue; }
            if (!Array.isArray(body)) { errors.push(host + ': صيغة استجابة غير صالحة (HTTP ' + response.status + ').'); continue; }
            if (!body.length) { errors.push(host + ': استجابة فارغة (HTTP ' + response.status + ').'); continue; }
            const bars = normalizeCandles(body);
            if (!bars.length) { errors.push(host + ': لا توجد شموع صالحة في الاستجابة (HTTP ' + response.status + ').'); continue; }
            return bars;
          } catch (error) {
            if (error && error.permanent) throw error;
            const message = error && error.name === 'AbortError' ? 'مهلة الاتصال (10 ثوانٍ).' : error && error.name === 'TypeError' ? 'فشل fetch (الشبكة أو CORS).' : (error && error.message) || 'خطأ غير معروف.';
            errors.push(host + ': ' + message);
          } finally { clearTimeout(timer); }
        }
        throw new Error(errors.length ? errors.join(' / ') : 'لم يُرجع أي مصدر بيانات شموعًا.');
      }

      async function get24HourTicker(symbol) {
        const query = new URLSearchParams({symbol}).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
          const response = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?' + query, {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
            headers: {Accept: 'application/json'}, signal: controller.signal
          });
          if (response.status === 429 || response.status === 418) throw new Error('حدّ Binance طلب إحصاءات 24 ساعة؛ بقي تحليل الشموع متاحًا.');
          if (!response.ok) throw new Error('تعذر جلب إحصاءات 24 ساعة (HTTP ' + response.status + ').');
          const data = await response.json();
          if (!data || Array.isArray(data) || data.symbol !== symbol) throw new Error('استجابة 24 ساعة غير صالحة.');
          const ticker = {
            openPrice: Number(data.openPrice), lastPrice: Number(data.lastPrice), highPrice: Number(data.highPrice), lowPrice: Number(data.lowPrice),
            volume: Number(data.volume), quoteVolume: Number(data.quoteVolume),
            priceChangePercent: Number(data.priceChangePercent), closeTime: Number(data.closeTime)
          };
          if (!(ticker.openPrice > 0) || !(ticker.lastPrice > 0) || !(ticker.highPrice >= ticker.lowPrice) || !(ticker.lowPrice > 0) ||
              !Number.isFinite(ticker.volume) || ticker.volume < 0 || !Number.isFinite(ticker.quoteVolume) || ticker.quoteVolume < 0 ||
              !Number.isFinite(ticker.priceChangePercent) || !Number.isSafeInteger(ticker.closeTime)) {
            throw new Error('قيم إحصاءات 24 ساعة غير مكتملة أو غير صالحة.');
          }
          return ticker;
        } catch (error) {
          if (error && error.name === 'AbortError') throw new Error('انتهت مهلة إحصاءات 24 ساعة؛ سيُستخدم آخر إغلاق بدلًا منها.');
          throw error;
        } finally { clearTimeout(timer); }
      }

      async function scanTimeframes(symbol, selectedInterval, selectedCandles, selectedIndicators) {
        return Promise.all(SCAN_INTERVALS.map(async interval => {
          try {
            const isSelectedFrame = interval === selectedInterval;
            const source = isSelectedFrame ? selectedCandles : await getKlines(symbol, interval, 120);
            const closedBars = source.filter(bar => bar.time + INTERVALS[interval] <= Date.now());
            const candles = isSelectedFrame ? closedBars : closedBars.slice(-120);
            const minimumCandles = interval === '1w' ? MIN_WEEKLY_SCAN_CANDLES : MIN_SCAN_CANDLES;
            if (candles.length < minimumCandles) throw new Error('شموع مكتملة غير كافية لفحص ' + interval + ' (توفّر ' + candles.length + '؛ يلزم ' + minimumCandles + ' على الأقل).');
            const indicators = isSelectedFrame ? selectedIndicators : indicatorsFor(candles), index = candles.length - 1;
            return {interval, reading: classify(candles, indicators, index), adx: indicators.adx[index], time: candles[index].time};
          } catch (error) {
            return {interval, error: error && error.message ? error.message : 'تعذر الجلب.'};
          }
        }));
      }

      function renderTimeframes(results) {
        for (const item of results) {
          const value = $('tf-' + item.interval + '-signal'), score = $('tf-' + item.interval + '-score'), strength = $('tf-' + item.interval + '-strength');
          if (!value || !score || !strength) continue;
          if (item.error) {
            value.textContent = 'غير متاح'; value.className = 'tf-value neutral'; score.textContent = 'سبب الفشل: ' + item.error; score.title = item.error;
            strength.textContent = 'مرشح قوة: غير متاح'; strength.title = item.error;
            continue;
          }
          const reading = item.reading;
          value.textContent = reading.direction === 1 ? 'شراء محتمل' : reading.direction === -1 ? 'بيع محتمل' : 'انتظار';
          value.className = 'tf-value ' + (reading.direction === 1 ? 'up' : reading.direction === -1 ? 'down' : 'neutral');
          score.textContent = 'الدرجة الحية (EMA + 5 أصوات): ' + reading.score + '/' + reading.maxScore;
          strength.textContent = 'مرشح قوة · ADX ' + fmt(item.adx, 1) + ' / ' + RULES.adxMin + ' · ' + (reading.strongTrend ? 'مستوفى' : 'غير مستوفى');
        }
      }

      function renderTimeframesPending() {
        for (const interval of SCAN_INTERVALS) {
          const value = $('tf-' + interval + '-signal'), score = $('tf-' + interval + '-score'), strength = $('tf-' + interval + '-strength');
          if (!value || !score || !strength) continue;
          value.textContent = 'جارٍ الفحص';
          value.className = 'tf-value neutral';
          score.textContent = 'جارٍ جلب الشموع المغلقة…';
          strength.textContent = 'مرشح قوة: جارٍ الفحص…';
        }
      }

      function fmt(value, digits = 4) {
        if (value === Infinity) return '∞';
        if (!Number.isFinite(value)) return '—';
        return new Intl.NumberFormat('en-US', {maximumFractionDigits: digits}).format(value);
      }

      function timeLabel(timestamp) {
        return new Intl.DateTimeFormat('en-GB', {year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date(timestamp));
      }

      function timeLabelUtc(timestamp) {
        return new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date(timestamp)) + ' UTC';
      }

      function renderChart(candles, indicators, symbol, interval) {
        if (!window.MarketRadarChart) throw new Error('وحدة المخطط التفاعلي غير متاحة.');
        window.MarketRadarChart.setData({candles, indicators, symbol, interval});
      }

      function renderIndicatorTiles(indicators, index, candle) {
        const obvSlope = indicators.obvSlope[index], obvLabel = obvSlope > 0 ? 'تدفق OBV صاعد' : obvSlope < 0 ? 'تدفق OBV هابط' : 'تدفق OBV محايد';
        $('obv-state').textContent = obvLabel;
        $('obv-state').className = obvSlope > 0 ? 'up' : obvSlope < 0 ? 'down' : 'neutral';
        $('obv-detail').textContent = 'OBV · تغير 5 شمعات: ' + fmt(obvSlope, 2);
        $('stochastic').textContent = fmt(indicators.stochasticK[index], 1) + ' / ' + fmt(indicators.stochasticD[index], 1);
        const k = indicators.stochasticK[index];
        $('stochastic-detail').textContent = 'Stochastic %K / %D · ' + (k >= 80 ? 'منطقة مرتفعة' : k <= 20 ? 'منطقة منخفضة' : 'منطقة وسطية');
        $('bollinger').textContent = fmt(indicators.bollingerLower[index], 4) + ' / ' + fmt(indicators.bollingerMiddle[index], 4) + ' / ' + fmt(indicators.bollingerUpper[index], 4);
        $('bollinger-detail').textContent = 'Bollinger 20,2σ · ' + (candle.close > indicators.bollingerUpper[index] ? 'فوق النطاق' : candle.close < indicators.bollingerLower[index] ? 'دون النطاق' : 'داخل النطاق');
        $('sar').textContent = fmt(indicators.sar[index], 6);
        $('sar-detail').textContent = 'Parabolic SAR · ' + (indicators.sarDirection[index] === 1 ? 'اتجاه صاعد' : 'اتجاه هابط');
        $('supertrend').textContent = fmt(indicators.superTrend[index], 6);
        $('supertrend').className = indicators.superTrendDirection[index] === 1 ? 'up' : 'down';
        $('supertrend-detail').textContent = 'SuperTrend · ' + (indicators.superTrendDirection[index] === 1 ? 'اتجاه صاعد' : 'اتجاه هابط');
        $('adx').textContent = fmt(indicators.adx[index], 2) + ' · ' + (indicators.adx[index] >= RULES.adxMin ? 'اتجاه قوي' : 'اتجاه ضعيف');
        $('adx-detail').textContent = 'مرشح قوة · ADX Wilder 14 · بوابة ≥ ' + RULES.adxMin;
      }

      function renderAnalysisSummary(data) {
        const {symbol, interval, candle, indicators, index, reading, market24h, stop, targets, size, risk, riskPct} = data;
        const direction = reading.direction;
        const currentPrice = market24h ? market24h.lastPrice : candle.close;
        const referencePrice = candle.close;
        const riskDistance = direction && Number.isFinite(stop) ? Math.abs(referencePrice - stop) : null;
        const targetPrices = Array.isArray(targets) ? targets : [];
        const targetRows = direction && referencePrice > 0 && riskDistance > 0 ? targetPrices.map((price, i) => ({
          r: i + 1,
          price,
          directionalMovePct: direction * (price / referencePrice - 1) * 100,
          rewardRiskRatio: Math.abs(price - referencePrice) / riskDistance
        })) : [];
        const validPlan = Boolean(direction && referencePrice > 0 && riskDistance > 0 && stop > 0 && targetRows.length === 3 &&
          targetRows.every(row => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.directionalMovePct) && Number.isFinite(row.rewardRiskRatio)));

        $('summary-card').classList.toggle('long', direction === 1);
        $('summary-card').classList.toggle('short', direction === -1);
        const directionLabel = direction === 1 ? 'اتجاه صاعد' : direction === -1 ? 'اتجاه هابط' : 'انتظار';
        $('summary-signal').textContent = directionLabel;
        $('summary-signal').className = 'snapshot-badge ' + (direction === 1 ? 'long' : direction === -1 ? 'short' : 'neutral');
        $('summary-meta').textContent = symbol + ' · ' + interval + ' · قراءة المؤشرات من إغلاق ' + timeLabelUtc(candle.time);
        $('summary-price').textContent = fmt(currentPrice, 8);
        $('summary-price-time').textContent = market24h
          ? 'Binance 24h ticker · ' + timeLabelUtc(market24h.closeTime)
          : '24h غير متاح · المعروض هو آخر إغلاق ' + timeLabelUtc(candle.time);
        $('summary-open').textContent = market24h ? fmt(market24h.openPrice, 8) + ' USDT' : 'غير متاح';
        $('summary-close').textContent = market24h ? 'إغلاق 24h: ' + fmt(market24h.lastPrice, 8) + ' USDT' : 'إغلاق آخر شمعة: ' + fmt(candle.close, 8) + ' USDT';
        $('summary-change').textContent = market24h
          ? (market24h.priceChangePercent > 0 ? '+' : '') + fmt(market24h.priceChangePercent, 2) + '%'
          : 'غير متاح';
        $('summary-change').className = market24h
          ? 'snapshot-value ' + (market24h.priceChangePercent > 0 ? 'positive' : market24h.priceChangePercent < 0 ? 'negative' : '')
          : 'snapshot-value';
        $('summary-high').textContent = market24h ? fmt(market24h.highPrice, 8) : '—';
        $('summary-low').textContent = market24h ? fmt(market24h.lowPrice, 8) : '—';
        const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
        $('summary-volume').textContent = market24h ? fmt(market24h.volume, 4) + ' ' + baseAsset : 'غير متاح';
        $('summary-quote-volume').textContent = market24h ? 'الحجم المقابل: ' + fmt(market24h.quoteVolume, 2) + ' USDT' : 'حجم 24 ساعة غير متاح';
        $('summary-position-size').textContent = size ? fmt(size.quantity, 8) + ' وحدة' : 'غير متاح';
        $('summary-position-detail').textContent = size
          ? fmt(size.notional, 4) + ' USDT اسمي · مخاطرة ' + fmt(risk, 4) + ' USDT (' + fmt(riskPct, 2) + '%)'
          : direction === -1 ? 'لا يُحسب مركز بيع على المكشوف.' : 'لا توجد إشارة شراء مؤهلة لحجم تقديري.';
        $('summary-reference-price').textContent = fmt(referencePrice, 8) + ' USDT';
        $('summary-stop').textContent = validPlan ? fmt(stop, 8) + ' USDT' : '—';

        const body = $('summary-targets');
        if (validPlan) {
          const rows = targetRows.map(target => {
            const row = document.createElement('tr');
            const label = document.createElement('th'); label.scope = 'row'; label.textContent = 'TP' + target.r;
            const price = document.createElement('td'); price.textContent = fmt(target.price, 8);
            const move = document.createElement('td'); move.textContent = (target.directionalMovePct >= 0 ? '+' : '') + fmt(target.directionalMovePct, 2) + '%';
            const ratio = document.createElement('td'); ratio.textContent = '1 : ' + fmt(target.rewardRiskRatio, 2);
            row.append(label, price, move, ratio);
            return row;
          });
          body.replaceChildren(...rows);
        } else {
          const row = document.createElement('tr'), cell = document.createElement('td');
          cell.colSpan = 4;
          cell.textContent = direction === 0 ? 'لا تظهر أهداف اتجاهية لأن القراءة الحالية «انتظار».' : 'تعذر التحقق من الوقف والأهداف المرجعية الحالية.';
          row.appendChild(cell); body.replaceChildren(row);
        }

        const reasons = Array.isArray(reading.reasons) ? reading.reasons.slice(0, 3).join('؛ ') : '';
        $('summary-rationale').textContent = direction === 0
          ? 'القراءة انتظار (' + reading.score + '/' + reading.maxScore + ')؛ لا تعرض البطاقة أهدافًا اتجاهية. ' + (reasons || 'لا تتوفر أسباب إضافية.')
          : directionLabel + ' · الدرجة ' + reading.score + '/' + reading.maxScore + ' · ADX ' + fmt(indicators.adx[index], 1) + ' (حد القوة ' + RULES.adxMin + '). ' + (reasons || 'توافق المؤشرات المحسوب من الشمعة المغلقة.');
        $('summary-note').textContent = 'المستويات المعروضة مرجعية تعليمية محسوبة من إغلاق آخر شمعة مغلقة. لا تمثل أوامر تداول، ولا تُنفَّذ آليًا. وقف 1.5 ATR وهدف 2R هما الإعدادان الوحيدان المسجّلان للاختبار التاريخي؛ ما بعدهما عرضٌ فني فقط.';

        return {
          direction,
          referencePrice,
          stop: validPlan ? stop : null,
          targets: validPlan ? targetRows : [],
          priceSource: 'آخر شمعة مغلقة',
          referenceTime: candle.time,
          validPlan
        };
      }

      function renderStrategyRow(prefix, result) {
        const rejected = fmt(result.rejectedByOrderFilters || 0, 0);
        const values = {
          trades: fmt(result.trades, 0) + ' · إشارات مرفوضة بقيود الكمية: ' + rejected, win: result.trades ? fmt(result.winRate, 1) + '%' : '—',
          return: (result.totalReturn >= 0 ? '+' : '') + fmt(result.totalReturn, 2) + '%',
          'avg-win': result.averageWinUsdt === null ? '—' : fmt(result.averageWinUsdt, 4),
          'avg-loss': result.averageLossUsdt === null ? '—' : fmt(result.averageLossUsdt, 4),
          streak: fmt(result.longestLossStreak, 0), pf: result.trades ? fmt(result.profitFactor, 2) : '—'
        };
        for (const [key, value] of Object.entries(values)) $(prefix + '-' + key).textContent = value;
      }

      function renderBenchmark(result) {
        const returnCell = $('ab-benchmark-return'), detailCell = $('ab-benchmark-detail');
        if (!result || !Number.isFinite(result.returnPct)) {
          returnCell.textContent = '—'; detailCell.textContent = 'المرجع الرسمي ينتظر تشغيل البحث يدويًا بعد تحميل الـartifact المعتمد والتحقق منه محليًا.'; return;
        }
        returnCell.textContent = (result.returnPct >= 0 ? '+' : '') + fmt(result.returnPct, 2) + '%';
        detailCell.textContent = (result.netPnl >= 0 ? '+' : '') + fmt(result.netPnl, 4) + ' USDT صافيًا؛ نفس فترة التطوير والرسوم والانزلاق.';
      }

      function renderVisibleBenchmark(bars, metadata = {}) {
        visibleBenchmarkBars = Array.isArray(bars) ? bars.slice() : [];
        visibleBenchmarkMeta = metadata || {};
        const value = $('visible-benchmark-return'), detail = $('visible-benchmark-detail');
        if (visibleBenchmarkBars.length < 2) {
          value.textContent = '—'; value.className = '';
          detail.textContent = visibleBenchmarkBars.length ? 'يلزم شمعتان ظاهرتان على الأقل.' : 'يتبع نطاق التكبير والتحريك في الرسم.';
          return;
        }
        const capital = Number($('capital').value), feePct = Number($('fee').value), slippagePct = Number($('slippage').value);
        if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(feePct) || feePct < 0 || !Number.isFinite(slippagePct) || slippagePct < 0) {
          value.textContent = '—'; value.className = ''; detail.textContent = 'تحقق من رأس المال والرسوم والانزلاق لإظهار المرجع.'; return;
        }
        const first = visibleBenchmarkBars[0], last = visibleBenchmarkBars[visibleBenchmarkBars.length - 1];
        const entry = first.open, exit = last.close, feePerSide = feePct / 100, slippagePerSide = slippagePct / 100;
        if (!(entry > 0) || !(exit > 0)) {
          value.textContent = '—'; value.className = ''; detail.textContent = 'أسعار الشموع المرئية غير صالحة للحساب.'; return;
        }
        const entryFill = entry * (1 + slippagePerSide), exitFill = exit * (1 - slippagePerSide);
        const quantity = capital / (entry * (1 + feePerSide + slippagePerSide));
        const netPnl = quantity * ((exitFill - entryFill) - (entryFill + exitFill) * feePerSide);
        const returnPct = netPnl / capital * 100;
        value.textContent = (returnPct >= 0 ? '+' : '') + fmt(returnPct, 2) + '%';
        value.className = returnPct >= 0 ? 'positive' : 'negative';
        detail.textContent = visibleBenchmarkBars.length + ' شمعة ظاهرة · ' + (visibleBenchmarkMeta.symbol || '') + ' ' + (visibleBenchmarkMeta.interval || '') + ' · فتح الأولى ' + fmt(entry, 8) + ' → إغلاق الأخيرة ' + fmt(exit, 8) + ' · الصافي ' + (netPnl >= 0 ? '+' : '') + fmt(netPnl, 4) + ' USDT · رسوم ' + fmt(feePct, 3) + '% وانزلاق ' + fmt(slippagePct, 3) + '% لكل جهة' + (visibleBenchmarkMeta.lastIsLive ? ' · تتضمن شمعة جارية' : '') + ' · عرض فقط، وليس Backtest أو Walk-forward.';
      }

      function renderTradeTimes(prefix, distribution) {
        const hours = $('time-' + prefix + '-hours'), weekdays = $('time-' + prefix + '-weekdays');
        hours.replaceChildren(); weekdays.replaceChildren();
        const hourCounts = distribution && distribution.byUtcHour || Array(24).fill(0);
        const weekdayCounts = distribution && distribution.byUtcWeekday || Array(7).fill(0);
        const maxHour = Math.max(1, ...hourCounts), weekdayNames = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
        hourCounts.forEach((count, hour) => {
          const bin = document.createElement('span'), bar = document.createElement('i'), label = document.createElement('small');
          bin.className = 'hour-bin'; bin.title = String(hour).padStart(2, '0') + ':00 UTC · ' + count + ' صفقة';
          const level = count === 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(count / maxHour * 5)));
          bar.className = 'hour-bar level-' + level;
          label.textContent = String(hour).padStart(2, '0'); bin.append(bar, label); hours.appendChild(bin);
        });
        weekdayCounts.forEach((count, day) => {
          const item = document.createElement('span');
          item.className = 'weekday-bin'; item.textContent = weekdayNames[day] + ' ' + count;
          weekdays.appendChild(item);
        });
      }

      function renderWalkForward(emaFolds, voteFolds) {
        const body = $('wf-results'); body.replaceChildren();
        emaFolds.forEach((emaFold, index) => {
          const voteFold = voteFolds[index], row = document.createElement('tr');
          const emaRejected = fmt(emaFold.result.rejectedByOrderFilters || 0, 0);
          const voteRejected = fmt(voteFold.result.rejectedByOrderFilters || 0, 0);
          const cells = [
            'الفترة ' + emaFold.period,
            '[' + timeLabelUtc(emaFold.startTime) + '، ' + timeLabelUtc(emaFold.endTime) + ')',
            fmt(emaFold.result.trades, 0) + ' / ' + (emaFold.result.totalReturn >= 0 ? '+' : '') + fmt(emaFold.result.totalReturn, 2) + '% · مرفوضة: ' + emaRejected,
            fmt(voteFold.result.trades, 0) + ' / ' + (voteFold.result.totalReturn >= 0 ? '+' : '') + fmt(voteFold.result.totalReturn, 2) + '% · مرفوضة: ' + voteRejected,
            emaFold.benchmark && Number.isFinite(emaFold.benchmark.returnPct) ? (emaFold.benchmark.returnPct >= 0 ? '+' : '') + fmt(emaFold.benchmark.returnPct, 2) + '%' : '—'
          ];
          cells.forEach((text, index) => { const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell); });
          body.appendChild(row);
        });
      }

      function registeredBacktestOrderConstraints(registration) {
        const snapshot = registration.exchangeFilterSnapshot;
        return Object.freeze({
          minQty: Number(snapshot.lotSize.minQty),
          stepSize: Number(snapshot.lotSize.stepSize),
          minNotional: Number.parseFloat(snapshot.notional.minNotional)
        });
      }

      function researchSettingMismatches(registration, research) {
        const market = registration.market || {};
        const settings = registration.settings || {};
        const options = research && research.options;
        const live = {
          symbol: $('symbol').value.trim().toUpperCase(),
          interval: $('interval').value,
          capital: Number($('capital').value),
          riskPct: Number($('risk').value),
          feePerSidePct: Number($('fee').value),
          slippagePerSidePct: Number($('slippage').value)
        };
        const numberMatches = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-12;
        const mismatches = [];
        const addMismatch = (label, matches) => { if (!matches && !mismatches.includes(label)) mismatches.push(label); };

        addMismatch('الرمز', live.symbol === market.symbol && research && research.symbol === market.symbol);
        addMismatch('الإطار', live.interval === market.interval && research && research.interval === market.interval);
        addMismatch('رأس المال', numberMatches(live.capital, settings.initialCapitalUsdt) && options && numberMatches(options.capital, settings.initialCapitalUsdt));
        addMismatch('المخاطرة', numberMatches(live.riskPct, settings.riskPct) && options && numberMatches(options.riskPct, settings.riskPct));
        addMismatch('الرسوم', numberMatches(live.feePerSidePct, settings.feePerSidePct) && options && numberMatches(options.feePerSide, settings.feePerSidePct / 100));
        addMismatch('الانزلاق', numberMatches(live.slippagePerSidePct, settings.slippagePerSidePct) && options && numberMatches(options.slippagePerSide, settings.slippagePerSidePct / 100));
        return mismatches;
      }

      function runResearch() {
        const registration = REGISTERED_RESEARCH_PROTOCOL;
        if (!registration.userSignature) {
          renderBenchmark(null);
          $('research-status').textContent = 'لا يوجد توقيع مسجل؛ أُوقف البحث دون حساب نتائج.';
          return;
        }
        if (!isApprovedHistoricalResearchLoaded()) {
          renderBenchmark(null);
          $('research-status').textContent = 'لا يتاح البحث إلا بعد نجاح التحميل المحلي والتحقق من الـartifact المعتمد؛ لم تُحسب نتائج.';
          syncResearchButton();
          return;
        }
        const mismatches = researchSettingMismatches(registration, pendingResearch);
        if (mismatches.length) {
          renderBenchmark(null);
          $('research-status').textContent = 'مرفوض: إعدادات البحث لا تطابق التسجيل (' + mismatches.join('، ') + ')؛ لم تُحسب نتائج.';
          return;
        }
        if (!STRATEGY_TESTING_ENABLED) return;
        const orderConstraints = registeredBacktestOrderConstraints(registration);
        const {candles, options, interval} = pendingResearch;
        const intervalMs = INTERVALS[interval];
        const developmentRange = calendarWindowIndices(candles, registration.developmentWindow, intervalMs);
        if (!developmentRange.startCovered || !developmentRange.endCovered) {
          renderBenchmark(null);
          $('research-status').textContent = 'بيانات نافذة التطوير المسجلة لا تغطي الحدين كاملين؛ لم تُحسب نتائج ولم يُفتح الحجز النهائي.';
          return;
        }
        const developmentCandles = candles.slice(developmentRange.startIndex, developmentRange.endIndex);
        if (!developmentCandles.length) {
          renderBenchmark(null);
          $('research-status').textContent = 'بيانات نافذة التطوير المسجلة غير متاحة كاملة؛ لم تُحسب نتائج ولم يُفتح الحجز النهائي.';
          return;
        }
        const developmentIndicators = indicatorsFor(developmentCandles);
        const developmentEnd = developmentCandles.length;
        const emaOptions = {...options, startIndex: 0, endIndex: developmentEnd, longOnly: true, strategy: 'ema-gate', orderConstraints};
        const voteOptions = {...options, startIndex: 0, endIndex: developmentEnd, longOnly: true, strategy: 'independent-votes', orderConstraints};
        const emaResult = runBacktest(developmentCandles, emaOptions, developmentIndicators);
        const voteResult = runBacktest(developmentCandles, voteOptions, developmentIndicators);
        const benchmarkStart = Math.max(RULES.slow - 1, RULES.rsi, RULES.atr - 1, RULES.adx * 2 - 1, RULES.macdSlow + RULES.macdSignal - 2, RULES.volume - 1);
        const benchmark = buyAndHold(developmentCandles, {startIndex: benchmarkStart, endIndex: developmentEnd, capital: options.capital,
          feePerSide: options.feePerSide, slippagePerSide: options.slippagePerSide});
        const emaWalk = walkForwardPeriods(candles, {...options, strategy: 'ema-gate', orderConstraints}, undefined, registration, intervalMs);
        const voteWalk = walkForwardPeriods(candles, {...options, strategy: 'independent-votes', orderConstraints}, undefined, registration, intervalMs);
        renderStrategyRow('ab-ema', emaResult); renderStrategyRow('ab-vote', voteResult); renderBenchmark(benchmark);
        renderTradeTimes('ema', emaResult.tradeTimeDistribution); renderTradeTimes('vote', voteResult.tradeTimeDistribution);
        renderWalkForward(emaWalk.folds, voteWalk.folds);
        $('research-status').textContent = 'اكتملت المقارنة على نافذة التطوير المسجلة ونوافذ التقويم الأربع؛ الحجز النهائي المحدد بالتسجيل بقي مغلقًا.';
      }

      function makeReport(data) {
        const {symbol, interval, candle, indicators, index, reading, scanResults, risk, size, stop, targets, feePct, slippagePct, market24h, summaryPlan} = data;
        const direction = reading.direction === 1 ? 'شراء محتمل' : reading.direction === -1 ? 'بيع محتمل' : 'انتظار';
        const votes = reading.independentVotes || [];
        const bullishVotes = votes.filter(item => item.direction === 1).length;
        const bearishVotes = votes.filter(item => item.direction === -1).length;
        const emaDirection = reading.emaDirection === 1 ? 'صاعد' : reading.emaDirection === -1 ? 'هابط' : 'محايد';
        const voteSummary = votes.map(item => item.label + ':' + (item.direction === 1 ? 'صعود' : item.direction === -1 ? 'هبوط' : 'محايد')).join('، ');
        const volume = reading.volume || {actual: candle.volume, average: indicators.volumeAverage[index], ratio: indicators.volumeRatio[index]};
        const volumeVote = votes.find(item => item.key === 'volume');
        const timeframeSummary = scanResults.map(item => item.interval + ': ' + (item.error ? 'غير متاح — ' + item.error : (item.reading.direction === 1 ? 'شراء' : item.reading.direction === -1 ? 'بيع' : 'انتظار') + ' · الدرجة الحية ' + item.reading.score + '/' + item.reading.maxScore + ' · مرشح قوة ADX ' + fmt(item.adx, 1) + ' (' + (item.reading.strongTrend ? 'مستوفى' : 'غير مستوفى') + ')')).join(' | ');
        const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
        const market24hSummary = market24h
          ? 'فتح/إغلاق ' + fmt(market24h.openPrice, 8) + '/' + fmt(market24h.lastPrice, 8) + ' USDT · أعلى/أدنى ' + fmt(market24h.highPrice, 8) + '/' + fmt(market24h.lowPrice, 8) + ' · التغير ' + (market24h.priceChangePercent > 0 ? '+' : '') + fmt(market24h.priceChangePercent, 2) + '% · الحجم ' + fmt(market24h.volume, 4) + ' ' + baseAsset + ' (' + fmt(market24h.quoteVolume, 2) + ' USDT) · وقت اللقطة ' + timeLabelUtc(market24h.closeTime)
          : 'إحصاءات Binance المتحركة لـ24 ساعة غير متاحة؛ السعر المرجعي يعود إلى آخر إغلاق.';
        const summaryLevels = summaryPlan && summaryPlan.validPlan
          ? 'السعر المرجعي (آخر إغلاق) ' + fmt(summaryPlan.referencePrice, 8) + ' · الوقف القائم ' + fmt(summaryPlan.stop, 8) + ' · ' + summaryPlan.targets.map(target => 'TP' + target.r + ' ' + fmt(target.price, 8) + ' (' + fmt(target.directionalMovePct, 2) + '% إجمالي؛ 1:' + fmt(target.rewardRiskRatio, 2) + ')').join(' / ')
          : 'لا توجد أهداف اتجاهية صالحة؛ القراءة انتظار أو لا تتوفر مستويات مرجعية صالحة.';
        return [
          'مرصد العملات — تقرير تحليل خوارزمي تعليمي',
          'الزوج: ' + symbol + ' | الإطار الأساسي: ' + interval + ' | وقت الشمعة المكتملة: ' + timeLabel(candle.time),
          'الإغلاق: ' + fmt(candle.close, 8) + ' | الاتجاه: ' + reading.trend,
          'الإشارة: ' + direction + ' | توافق الخوارزميات: ' + reading.score + '/' + reading.maxScore + ' (درجة توافق وليست احتمال ربح)',
          'تفكيك منفصل: اتجاه EMA = ' + emaDirection + ' | الأصوات المستقلة: ' + bullishVotes + '/5 صعود، ' + bearishVotes + '/5 هبوط (' + voteSummary + ')',
          'أسباب الإشارة: ' + reading.reasons.join('؛ '),
          'مرشح القوة (ليس صوتًا): ADX ' + fmt(indicators.adx[index], 2) + ' ' + (reading.strongTrend ? '≥' : '<') + ' ' + RULES.adxMin + ' (' + (reading.strongTrend ? 'مستوفى' : 'غير مستوفى') + ').',
          'المؤشرات: RSI ' + fmt(indicators.rsi[index], 2) + ' | MACD line/signal/hist ' + fmt(indicators.macdLine[index], 6) + '/' + fmt(indicators.macdSignal[index], 6) + '/' + fmt(indicators.macdHistogram[index], 6) + ' | ATR ' + fmt(indicators.atr[index], 8) + ' | ADX ' + fmt(indicators.adx[index], 2),
          'OBV slope 5: ' + fmt(indicators.obvSlope[index], 2) + ' | Stochastic K/D: ' + fmt(indicators.stochasticK[index], 2) + '/' + fmt(indicators.stochasticD[index], 2) + ' | Bollinger lower/middle/upper: ' + fmt(indicators.bollingerLower[index], 8) + '/' + fmt(indicators.bollingerMiddle[index], 8) + '/' + fmt(indicators.bollingerUpper[index], 8),
          'Parabolic SAR: ' + fmt(indicators.sar[index], 8) + ' | SuperTrend: ' + fmt(indicators.superTrend[index], 8) + ' (' + (indicators.superTrendDirection[index] === 1 ? 'صاعد' : 'هابط') + ')',
          'الحجم — الفعلي: ' + fmt(volume.actual, 2) + ' | متوسط20: ' + fmt(volume.average, 2) + ' | النسبة: ' + fmt(volume.ratio, 2) + '× | الصوت: ' + (volumeVote ? (volumeVote.direction > 0 ? '+1' : volumeVote.direction < 0 ? '−1' : '0') : 'غير متاح') + '؛ +1 فقط إذا كان الحجم > متوسط20، وإلا −1؛ والصوت 0 للبيانات غير الصالحة/غير المتاحة فقط.',
          'وقف مرجعي: ' + (stop === null ? 'غير متاح' : fmt(stop, 8)) + ' | الأهداف المرجعية 1R/2R/3R: ' + (targets ? targets.map(x => fmt(x, 8)).join(' / ') : 'غير متاحة'),
          'لقطة البطاقة · 24 ساعة: ' + market24hSummary,
          'مستويات البطاقة التعليمية من السعر المرجعي وATR الشمعة المغلقة: ' + summaryLevels + '؛ الحركة إجمالية قبل الرسوم والانزلاق وليست عائدًا صافيًا أو أمر تداول. وقف 1.5 ATR وهدف 2R هما الإعدادان الوحيدان المسجّلان للاختبار التاريخي؛ ما بعدهما عرضٌ فني فقط.',
          'ميزانية المخاطرة: ' + fmt(risk, 4) + ' USDT | حجم الشراء التقديري: ' + (size ? fmt(size.quantity, 8) + ' وحدة (' + fmt(size.notional, 4) + ' USDT اسمي)' : 'غير محسوب؛ البيع لا يدخل اختبار السوق الفوري'),
          'خسارة الوقف التقديرية بعد التكلفة: ' + (size ? fmt(size.expectedStopLoss, 4) + ' USDT' : 'غير متاحة؛ الفجوات قد ترفع الخسارة الفعلية'),
          'التكاليف المفترضة: رسوم ' + fmt(feePct, 3) + '% لكل جهة + انزلاق ' + fmt(slippagePct, 3) + '% لكل جهة؛ الانزلاق افتراض لا قياس للفارق أو السيولة.',
          'اختبار A/B وwalk-forward متعدد الفترات: لم تُحسب نتائجهما في هذه المعاينة؛ يتطلب تشغيل البحث يدويًا بعد نجاح التحقق المحلي من الـartifact المعتمد.',
          'الحجز النهائي نصف المفتوح [2026-05-15T00:00:00Z, 2026-09-28T12:00:00Z)؛ لم يُفتح أو يُقرأ أو يُستخدم.',
          'فحص متعدد الأطر للزوج: ' + timeframeSummary,
          'شرط الإشارة الحية فقط: اتجاه EMA صريح و|الدرجة الحية EMA (±2) + خمسة أصوات مستقلة| ≥ 5/7، مع اجتياز مرشح قوة ADX ≥ 18. الدرجة ليست احتمال ربح.',
          'عتبتا المقارنة منفصلتان عن الإشارة الحية: A: بوابة EMA صاعدة فقط + 3/5 أصوات صاعدة. B: 3/5 أصوات صاعدة، يقبل EMA الصاعد أو المختلط ويستبعد EMA الهابط. كلاهما شراء فوري فقط وlongOnly حاجز ثانٍ؛ لا يغيّر ذلك العرض الحي المتماثل الاتجاه. عند حياد الصوتين الآخرين، A مع EMA +2 وثلاثة أصوات صاعدة = 5/7؛ B مع EMA محايد = 3/7 أو 5/7 إذا عزز EMA الصاعد الدرجة. لم تُشغّل المقارنة.',
          'المنهج: القراءة الحالية تعليمية فقط؛ لا تنفيذ صفقات. صوت الحجم +1 فقط إذا كان الحجم الفعلي أعلى من متوسط20؛ يساويه أو يقل عنه = −1، و0 للبيانات غير الصالحة/غير المتاحة. النسبة للعرض ولا تغيّر قاعدة الصوت. جميع الحسابات محلية ولا تُحفظ بقاعدة بيانات.',
          'تحذير: المؤشرات لا تتنبأ بالسوق ولا تثبت الربحية ولا تمثل نصيحة مالية أو تنفيذًا آليًا.'
        ].join('\n');
      }

      function setStatus(message, kind = '') {
        const el = $('status');
        el.textContent = message;
        el.className = 'status' + (kind ? ' ' + kind : '');
      }

      function clearAnalysisSummary() {
        $('summary-card').classList.remove('long', 'short');
        $('summary-signal').textContent = 'بانتظار التحليل';
        $('summary-signal').className = 'snapshot-badge neutral';
        $('summary-meta').textContent = 'اختر زوجًا وشغّل التحليل لعرض البطاقة.';
        $('summary-price').textContent = '—'; $('summary-price-time').textContent = 'بانتظار البيانات';
        $('summary-open').textContent = '—'; $('summary-close').textContent = 'إغلاق 24h: —';
        $('summary-change').textContent = '—'; $('summary-change').className = 'snapshot-value';
        $('summary-high').textContent = '—'; $('summary-low').textContent = '—';
        $('summary-volume').textContent = '—'; $('summary-quote-volume').textContent = 'الحجم المقابل: — USDT';
        $('summary-position-size').textContent = '—'; $('summary-position-detail').textContent = 'من إعداد المخاطرة الحالي؛ تقديري فقط.';
        $('summary-reference-price').textContent = '—'; $('summary-stop').textContent = '—';
        $('summary-rationale').textContent = 'ستظهر خلاصة مبنية على نتيجة المحرك بعد اكتمال التحليل.';
        $('summary-note').textContent = 'المستويات المعروضة مرجعية تعليمية محسوبة من إغلاق آخر شمعة مغلقة. لا تمثل أوامر تداول، ولا تُنفَّذ آليًا. وقف 1.5 ATR وهدف 2R هما الإعدادان الوحيدان المسجّلان للاختبار التاريخي؛ ما بعدهما عرضٌ فني فقط.';
        const row = document.createElement('tr'), cell = document.createElement('td');
        cell.colSpan = 4; cell.textContent = 'لا توجد نتيجة بعد.'; row.appendChild(cell);
        $('summary-targets').replaceChildren(row);
      }

      function clearResults() {
        pendingResearch = null;
        syncResearchButton();
        clearAnalysisSummary();
        ['price','price-time','trend','ema-values','rsi','atr','macd','macd-note','volume-ratio','volume-note','stop','targets','quantity','quantity-note','risk-budget','signal-ema-state','signal-ema-note','signal-vote-count','signal-vote-note','signal-strength-state','signal-strength-note','obv-state','obv-detail','stochastic','stochastic-detail','bollinger','bollinger-detail','sar','sar-detail','supertrend','supertrend-detail','adx','adx-detail'].forEach(id => $(id).textContent = '—');
        $('rsi').className = 'metric-value'; $('rsi-note').textContent = 'تنعيم Wilder';
        $('signal-strength-state').className = '';
        for (const prefix of ['ema', 'vote']) {
          for (const key of ['trades', 'win', 'return', 'avg-win', 'avg-loss', 'streak', 'pf']) $('ab-' + prefix + '-' + key).textContent = '—';
          $('time-' + prefix + '-hours').textContent = 'لا توجد نتائج';
          $('time-' + prefix + '-weekdays').replaceChildren();
        }
        $('ab-benchmark-return').textContent = '—'; $('ab-benchmark-detail').textContent = 'ينتظر المرجع الرسمي تشغيل البحث بعد تحميل الـartifact المعتمد محليًا.';
        $('wf-results').innerHTML = '<tr><td colspan="5">لا توجد نتائج بحث بعد.</td></tr>';
        $('research-status').textContent = 'يلزم تحميل الـartifact المعتمد محليًا قبل إتاحة البحث؛ الحجز النهائي [2026-05-15T00:00:00Z, 2026-09-28T12:00:00Z) مغلق وغير مستخدم.';
        for (const interval of SCAN_INTERVALS) { $('tf-' + interval + '-signal').textContent = 'جارٍ الفحص'; $('tf-' + interval + '-score').textContent = '—'; $('tf-' + interval + '-strength').textContent = 'مرشح قوة: —'; }
        $('signal').textContent = 'جارٍ التحليل…';
        $('signal-detail').textContent = 'يتم التحقق من البيانات وحساب المؤشرات.';
        $('signal-symbol').textContent = 'جارٍ التحميل';
        $('signal-card').classList.remove('long', 'short');
        $('signal-icon').textContent = '…';
        $('chart-subtitle').textContent = 'جارٍ تحميل الشموع المكتملة.';
        $('signal-ema-state').textContent = '—'; $('signal-vote-count').textContent = '—';
        if (window.MarketRadarChart) window.MarketRadarChart.clear();
        else $('chart').innerHTML = '<div class="chart-state">جارٍ تحميل بيانات السوق…</div>';
        $('report').textContent = 'جارٍ إنشاء التقرير…';
        $('copy').disabled = true;
        $('copy-status').textContent = 'لا يتصل التقرير بأي نموذج أو حساب خارجي.';
      }

      async function analyze() {
        const button = $('analyze');
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        clearResults();
        setStatus('جارٍ جلب بيانات السوق العامة؛ اختبارات الاستراتيجية متوقفة…', 'loading');
        try {
          const symbol = $('symbol').value.trim().toUpperCase();
          const interval = $('interval').value;
          const requested = Number($('limit').value);
          const capital = Number($('capital').value);
          const riskPct = Number($('risk').value);
          const feePct = Number($('fee').value);
          const slippagePct = Number($('slippage').value);
          if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error('اكتب رمز زوج صحيحًا مثل BTCUSDT (أحرف وأرقام فقط).');
          if (!INTERVALS[interval]) throw new Error('اختر إطارًا زمنيًا مدعومًا.');
          if (listedUsdtSymbols && !listedUsdtSymbols.has(symbol)) throw new Error('لا يوجد زوج Binance Spot نشط باسم ' + symbol + ' مقوّم بـUSDT. ابحث عنه أو اختر زوجًا ظاهرًا في اقتراحات الحقل.');
          if (!Number.isInteger(requested) || requested < 100 || requested > 1000) throw new Error('عدد الشموع يجب أن يكون عددًا صحيحًا بين 100 و1,000.');
          if (!Number.isFinite(capital) || capital < 1 || capital > 100000000) throw new Error('رأس المال يجب أن يكون بين 1 و100,000,000 USDT.');
          if (!Number.isFinite(riskPct) || riskPct < 0.1 || riskPct > 2) throw new Error('المخاطرة لكل صفقة يجب أن تكون بين 0.1% و2%.');
          if (!Number.isFinite(feePct) || feePct < 0 || feePct > 1) throw new Error('رسوم كل جهة يجب أن تكون بين 0% و1%.');
          if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct > 1) throw new Error('الانزلاق لكل جهة يجب أن يكون بين 0% و1%.');
          if (navigator.onLine === false) throw new Error('لا يوجد اتصال بالإنترنت. تعمل واجهة التطبيق، لكن جلب بيانات السوق يحتاج الاتصال.');
          const allCandles = await getKlines(symbol, interval, requested);
          const closeBefore = Date.now();
          const candles = allCandles.filter(bar => bar.time + INTERVALS[interval] <= closeBefore).slice(-requested);
          if (candles.length < MIN_PRIMARY_CANDLES) throw new Error('لا تتوفر 100 شمعة مغلقة على الأقل للإطار الأساسي لحساب المؤشرات بثبات. جرّب إطارًا آخر.');
          const indicators = indicatorsFor(candles);
          const scanPromise = scanTimeframes(symbol, interval, candles, indicators);
          const market24hPromise = get24HourTicker(symbol).catch(() => null);
          const index = candles.length - 1;
          const candle = candles[index];
          const reading = classify(candles, indicators, index);
          const direction = reading.direction;
          const currentPrice = candle.close;
          const currentAtr = indicators.atr[index];
          if (!Number.isFinite(currentAtr) || currentAtr <= 0) throw new Error('تعذر حساب ATR من الشموع الحالية.');
          const stopDistance = currentAtr * RULES.stopAtr;
          const stop = direction ? currentPrice - direction * stopDistance : null;
          const targets = direction ? [1, 2, 3].map(r => currentPrice + direction * stopDistance * r) : null;
          const risk = capital * riskPct / 100;
          const feePerSide = feePct / 100, slippagePerSide = slippagePct / 100;
          const size = direction === 1 && symbol.endsWith('USDT') ? calculatePositionSize({equity: capital, riskPct, entry: currentPrice, direction: 1, stopDistance, feePerSide, slippagePerSide, maxNotional: capital}) : null;
          const testOptions = {capital, riskPct, feePerSide, slippagePerSide, longOnly: true};
          pendingResearch = {candles, indicators, options: testOptions, symbol, interval};
          syncResearchButton();

          $('signal-card').classList.toggle('long', direction === 1);
          $('signal-card').classList.toggle('short', direction === -1);
          $('signal-icon').textContent = direction === 1 ? '↗' : direction === -1 ? '↘' : '·';
          $('signal').textContent = direction === 1 ? 'شراء محتمل' : direction === -1 ? 'بيع محتمل' : 'انتظار';
          $('signal-detail').textContent = 'الدرجة الحية EMA + خمسة أصوات: ' + reading.score + '/' + reading.maxScore + ' · شرط الإشارة: اتجاه EMA و |الدرجة| ≥ ' + RULES.minScore + '/' + RULES.maxScore;
          $('signal-symbol').textContent = symbol + ' · ' + interval;
          const votes = reading.independentVotes || [];
          const bullishVotes = votes.filter(item => item.direction === 1).length;
          const bearishVotes = votes.filter(item => item.direction === -1).length;
          $('signal-ema-state').textContent = reading.emaDirection === 1 ? 'صاعد' : reading.emaDirection === -1 ? 'هابط' : votes.length === 5 ? 'مختلط / محايد' : 'غير متاح';
          $('signal-ema-state').className = reading.emaDirection === 1 ? 'up' : reading.emaDirection === -1 ? 'down' : 'neutral';
          $('signal-ema-note').textContent = 'EMA 9 / 21 / 50 · لا تُحسب ضمن الأصوات الخمسة';
          $('signal-vote-count').textContent = '↑ ' + bullishVotes + '/5 · ↓ ' + bearishVotes + '/5';
          $('signal-vote-note').textContent = votes.length ? votes.map(item => item.label + ' ' + (item.direction === 1 ? '↑' : item.direction === -1 ? '↓' : '·')).join('  ·  ') : 'الأصوات المستقلة غير مكتملة';
          $('signal-strength-state').textContent = 'ADX ' + fmt(indicators.adx[index], 1) + ' / ' + RULES.adxMin + ' · ' + (reading.strongTrend ? 'مستوفى' : 'غير مستوفى');
          $('signal-strength-state').className = reading.strongTrend ? 'up' : 'neutral';
          $('signal-strength-note').textContent = 'مرشح عبور فقط؛ دون العتبة تصبح الإشارة انتظارًا، وليس صوتًا.';
          $('signal-foot').textContent = 'الدرجة = EMA (±2) + خمسة أصوات مستقلة؛ ADX≥18 مرشح قوة لا صوت. ' + (direction === -1 ? 'هذه إشارة اتجاه بيعي فقط؛ لا تعني إمكانية البيع على المكشوف في السوق الفوري.' : 'الدرجة ليست احتمال ربح؛ لا ينفّذ التطبيق صفقات.');

          $('price').textContent = fmt(currentPrice, 8);
          $('price-time').textContent = 'إغلاق ' + timeLabel(candle.time);
          $('trend').textContent = reading.trend;
          $('ema-values').textContent = '9: ' + fmt(indicators.fast[index], 4) + ' · 21: ' + fmt(indicators.mid[index], 4) + ' · 50: ' + fmt(indicators.slow[index], 4);
          $('rsi').textContent = fmt(indicators.rsi[index], 2);
          const rsiNearOverbought = indicators.rsi[index] >= 65 && indicators.rsi[index] < 70;
          $('rsi').className = 'metric-value' + (rsiNearOverbought ? ' near-limit' : '');
          $('rsi-note').textContent = rsiNearOverbought ? 'قريب من التشبع الشرائي (70) · تنبيه بصري فقط' : 'تنعيم Wilder';
          $('atr').textContent = fmt(currentAtr, 8);
          $('macd').textContent = fmt(indicators.macdLine[index], 6) + ' / ' + fmt(indicators.macdSignal[index], 6);
          $('macd-note').textContent = 'Histogram ' + fmt(indicators.macdHistogram[index], 6);
          const volume = reading.volume || {actual: candle.volume, average: indicators.volumeAverage[index], ratio: indicators.volumeRatio[index], direction: 0};
          $('volume-ratio').textContent = (Number.isFinite(volume.ratio) ? fmt(volume.ratio, 2) + '×' : 'النسبة غير متاحة') + ' · صوت ' + (volume.direction > 0 ? '+1' : volume.direction < 0 ? '−1' : '0');
          $('volume-ratio').className = 'metric-value' + (volume.direction > 0 ? ' positive' : volume.direction < 0 ? ' negative' : '');
          $('volume-note').textContent = 'الحجم الفعلي: ' + fmt(volume.actual, 2) + ' · متوسط20: ' + fmt(volume.average, 2) + ' · +1 إذا كان الحجم > المتوسط، وإلا −1.';
          $('stop').textContent = stop === null ? 'لا يوجد؛ انتظار' : fmt(stop, 8);
          $('targets').textContent = targets ? targets.map(x => fmt(x, 8)).join(' / ') : 'لا توجد إشارة';
          $('quantity').textContent = direction === -1 ? 'إشارة بيع؛ لا مركز فوري' : !direction ? 'لا توجد إشارة شراء' : size === null ? 'غير محسوب' : fmt(size.quantity, 8) + ' وحدة';
          $('quantity-note').textContent = size ? 'اسمي ' + fmt(size.notional, 3) + ' USDT · خسارة الوقف مع التكلفة ' + fmt(size.expectedStopLoss, 4) + ' USDT قبل أثر الفجوات.' : 'شراء فوري فقط؛ لا يُقدّر حجمًا للبيع على المكشوف.';
          $('risk-budget').textContent = fmt(risk, 4) + ' USDT';
          renderIndicatorTiles(indicators, index, candle);
          renderChart(candles, indicators, symbol, interval);
          $('chart-subtitle').textContent = 'بيانات تاريخية مغلقة مع شمعة جارية للرسم فقط · ' + symbol + ' · ' + interval;
          renderTimeframesPending();
          $('report').textContent = 'اكتمل تحليل الإطار الأساسي؛ جارٍ فحص الأطر الزمنية الأخرى…';
          setStatus('اكتمل الإطار الأساسي (' + candles.length + ' شمعة مغلقة)؛ جارٍ فحص الأطر الزمنية الأخرى…', 'loading');
          await new Promise(resolve => setTimeout(resolve, 0));
          const scanResults = await scanPromise;
          renderTimeframes(scanResults);
          setStatus('اكتمل فحص الأطر الزمنية؛ جار تحديث بطاقة إحصاءات 24 ساعة…', 'loading');
          const market24h = await market24hPromise;
          const summaryPlan = renderAnalysisSummary({symbol, interval, candle, indicators, index, reading, market24h, stop, targets, size, risk, riskPct});
          $('report').textContent = makeReport({symbol, interval, candle, indicators, index, reading, scanResults, risk, size, stop, targets, feePct, slippagePct, market24h, summaryPlan});
          $('copy').disabled = false;
          const countNote = candles.length < requested ? ' (من ' + requested + ' مطلوبة)' : '';
          setStatus('اكتمل التحليل: ' + candles.length + ' شمعة مغلقة' + countNote + ' للإطار المختار وفحص ' + scanResults.length + ' أطر زمنية. آخر إغلاق: ' + timeLabel(candle.time) + '.', 'success');
        } catch (error) {
          clearResults();
          $('signal').textContent = 'تعذر إكمال التحليل';
          $('signal-detail').textContent = 'راجع الإعدادات أو اتصال الشبكة وحاول مجددًا.';
          $('signal-symbol').textContent = 'لا توجد نتائج';
          $('signal-icon').textContent = '!';
          $('chart').innerHTML = '<div class="chart-state chart-error">تعذر رسم البيانات.<br>راجع رسالة الحالة وحاول مجددًا.</div>';
          $('report').textContent = 'لا يوجد تقرير صالح؛ لم تُعرض نتائج سابقة.';
          setStatus(error && error.message ? error.message : 'حدث خطأ غير متوقع أثناء التحليل.', 'error');
        } finally {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      }

      $('analyze').addEventListener('click', analyze);
      const historicalFetchButton = $('fetch-historical');
      const historicalFetchStatus = $('historical-fetch-status');
      let approvedArtifactLoadInProgress = false;
      historicalFetchButton.disabled = !HISTORICAL_FETCH_ENABLED;
      historicalFetchButton.setAttribute('aria-disabled', String(!HISTORICAL_FETCH_ENABLED));
      historicalFetchButton.addEventListener('click', async () => {
        if (!HISTORICAL_FETCH_ENABLED) {
          historicalFetchStatus.textContent = 'الجلب التاريخي مغلق ويتطلب إذن جلب مستقلًا؛ لم يُفتح مخزن البيانات ولم يُرسل أي طلب.';
          return;
        }
        historicalFetchButton.disabled = true;
        historicalFetchButton.setAttribute('aria-busy', 'true');
        historicalFetchStatus.textContent = 'جارٍ الجلب التاريخي المسجل…';
        try {
          const result = await fetchRegisteredHistoricalCandles();
          historicalFetchStatus.textContent = result.status === 'committed'
            ? 'اكتمل الجلب المسجل: ' + result.candleCount + ' شمعة؛ بصمة الملف SHA-256: ' + result.sha256 + '.'
            : 'توقف الجلب بحالة ' + result.status + ' (' + result.stopReason + ').';
        } catch (error) {
          historicalFetchStatus.textContent = error && error.message ? error.message : 'تعذر بدء الجلب التاريخي.';
        } finally {
          historicalFetchButton.disabled = !HISTORICAL_FETCH_ENABLED;
          historicalFetchButton.setAttribute('aria-disabled', String(historicalFetchButton.disabled));
          historicalFetchButton.removeAttribute('aria-busy');
        }
      });
      async function loadApprovedArtifactIntoResearch() {
        if (approvedArtifactLoadInProgress) return;
        approvedArtifactLoadInProgress = true;
        const button = $('load-approved-artifact');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        $('research-status').textContent = 'جارٍ التحقق محليًا من الـartifact المعتمد في IndexedDB؛ لن يبدأ البحث تلقائيًا…';
        try {
          const result = await window.MarketRadar.loadApprovedHistoricalArtifact();
          syncResearchButton();
          $('research-status').textContent = 'تم تحميل الـartifact المعتمد والتحقق منه محليًا: ' + result.rowCount + ' شمعة؛ SHA-256: ' + result.sha256 + '. اضغط «تشغيل البحث» لبدء الحساب؛ الحجز النهائي مغلق.';
        } catch (error) {
          syncResearchButton();
          const message = error && error.message ? error.message : 'تعذر تحميل الـartifact المعتمد محليًا.';
          $('research-status').textContent = message + (isApprovedHistoricalResearchLoaded()
            ? ' بقيت البيانات المعتمدة التي حُمّلت سابقًا جاهزة للبحث.'
            : ' سيظل البحث معطلًا حتى ينجح التحميل المحلي.');
        } finally {
          approvedArtifactLoadInProgress = false;
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      }
      syncResearchButton();
      $('load-approved-artifact').addEventListener('click', () => { void loadApprovedArtifactIntoResearch(); });
      $('run-research').addEventListener('click', runResearch);
      for (const id of ['symbol', 'interval', 'capital', 'risk', 'fee', 'slippage']) {
        $(id).addEventListener('input', syncResearchButton);
        $(id).addEventListener('change', syncResearchButton);
      }
      if (window.MarketRadarChart && typeof window.MarketRadarChart.setVisibleRangeListener === 'function') {
        window.MarketRadarChart.setVisibleRangeListener(renderVisibleBenchmark);
      }
      for (const id of ['capital', 'fee', 'slippage']) {
        $(id).addEventListener('input', () => renderVisibleBenchmark(visibleBenchmarkBars, visibleBenchmarkMeta));
      }
      $('copy').addEventListener('click', async () => {
        const text = $('report').textContent;
        if (!text || text.startsWith('لا يوجد تقرير')) return;
        try {
          await navigator.clipboard.writeText(text);
          $('copy-status').textContent = 'تم نسخ التقرير إلى الحافظة.';
        } catch (_) {
          const area = document.createElement('textarea');
          area.value = text;
          area.className = 'copy-buffer';
          area.setAttribute('readonly', '');
          document.body.appendChild(area); area.select();
          const copied = document.execCommand('copy');
          area.remove();
          $('copy-status').textContent = copied ? 'تم نسخ التقرير إلى الحافظة.' : 'تعذر النسخ التلقائي؛ حدّد نص التقرير وانسخه يدويًا.';
        }
      });
      $('symbol').addEventListener('keydown', event => { if (event.key === 'Enter') analyze(); });

      const installButton = $('install-app');
      const installDialog = $('install-dialog');
      const isNativeAndroidApp = Boolean(window.AndroidAppBridge && typeof window.AndroidAppBridge.isNativeAndroidApp === 'function' && window.AndroidAppBridge.isNativeAndroidApp());
      let deferredInstallPrompt = null;
      const isStandalone = () => Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
      const markInstalled = () => {
        installButton.disabled = true;
        $('install-full').textContent = 'التطبيق مثبت';
        $('install-short').textContent = 'مثبت';
        installButton.setAttribute('aria-label', 'مرصد العملات مثبت على جهازك');
      };
      const showInstallHelp = () => {
        if (typeof installDialog.showModal === 'function') installDialog.showModal();
        else setStatus('على Android، افتح قائمة Chrome ⋮ ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');
      };

      if (isNativeAndroidApp) installButton.hidden = true;
      if (isStandalone()) markInstalled();
      window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
      });
      window.addEventListener('appinstalled', markInstalled);
      installButton.addEventListener('click', async () => {
        if (isStandalone()) { markInstalled(); return; }
        if (!deferredInstallPrompt) { showInstallHelp(); return; }
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installButton.disabled = true;
        try {
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          setStatus(choice.outcome === 'accepted' ? 'تمت إضافة مرصد العملات إلى جهازك.' : 'لم يتم التثبيت؛ يمكنك المحاولة لاحقًا.');
        } catch (_) { showInstallHelp(); }
        finally { installButton.disabled = false; }
      });
      $('close-install').addEventListener('click', () => installDialog.close());
      installDialog.addEventListener('click', event => { if (event.target === installDialog) installDialog.close(); });

      if (!isNativeAndroidApp && 'serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('./sw.js', {scope: './'}).catch(() => {});
      }
      window.addEventListener('offline', () => setStatus('أنت دون اتصال؛ تعمل الواجهة المخزنة، لكن جلب بيانات السوق يحتاج الإنترنت.', 'error'));
      window.addEventListener('online', () => setStatus('عاد الاتصال. يمكنك جلب أحدث بيانات السوق.'));

      loadUsdtSymbolCatalog();
      window.MarketRadar = Object.freeze({...window.MarketRadarEngine, rules: RULES,
        fetchRegisteredHistoricalCandles, exportHistoricalRunData, exportHistoricalRunManifest,
        loadApprovedHistoricalArtifact});
      void loadApprovedArtifactIntoResearch();
    })();
