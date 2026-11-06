# مرصد العملات DRAK Paper 0.3.0 Implementation Plan

> **For agentic workers:** تنفيذ Native داخل هذا الفرع، خطوة بخطوة مع اختبار كل وحدة قبل دمجها في APK.

**Goal:** إضافة تطبيق Android عربي مستقل للتداول الورقي فقط، مبني على شموع Binance Spot المكتملة.

**Architecture:** Android WebView يعرض موارد محلية RTL. الجسر Java لا يقبل إلا GET ثابتاً إلى Binance klines مع allow-lists للرموز والأطر، بينما الحساب والمحاكاة محلية في محرك JS مستقل عن واجهة المستخدم وقابل للاختبار عبر Node.

**Tech Stack:** Android Gradle Plugin 8.7.3، Gradle 8.9، Java 17، compileSdk 35، HTML/CSS/JS محلي، Node `node:test`.

**Spec:** `market-observatory/android/SPEC.md`

## Global Constraints
- `applicationId=com.ans.marketobservatory`, `minSdk=23`, `versionName=0.3.0`.
- Binance public spot market-data GET فقط: BTCUSDT/ETHUSDT/SOLUSDT؛ لا API keys أو endpoints أوامر أو اتصالات تداول.
- رأس مال 11 USDT وحد مركز 5 USDT افتراضياً؛ رسوم وانزلاق في المحاكاة والاختبار.
- واجهة عربية RTL؛ بيانات الاختبار المصطنعة تبقى تحت tests فقط.

## Review Focus
1. شمعة API الحالية المفتوحة أو closeTime مساوية للآن — اختبار أنها لا تدخل التحليل.
2. أزواج أو فواصل زمنية أو JSON غير صالحة — اختبار رفضها قبل إنشاء الطلب.
3. نقص التاريخ عن حد المؤشرات أو إشارة قرب أول شمعة — اختبار إرجاع حالة غير متاحة دون NaN/خطأ واجهة.
4. رأس مال أقل من الحد أو رسوم/انزلاق غير منطقية أو مركز ثانٍ — اختبار عدم تجاوز السيولة والسقف.
5. شمعة تاريخية تلمس الوقف والهدف في الفترة نفسها — اختبار التنفيذ المحافظ (الوقف أولاً) مع احتساب جميع الرسوم.

---

### Task 1: إنشاء مشروع Android معزول وجسر بيانات عام

**Files:**
- Create: `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties`, Gradle wrapper files.
- Create: `app/src/main/AndroidManifest.xml`, `app/src/main/java/com/ans/marketobservatory/MainActivity.java`.
- Create: `README-AR.md`.

**Interfaces:**
- JavaScript → `DRAK.getKlines(symbol, interval, limit, callbackId)`؛ allow-list فقط؛ GET ثابت؛ الرد يحوي شموعاً مغلقة بعد التحقق.
- لا يستقبل الجسر URL أو طريقة HTTP أو أي بيانات اعتماد.

- [ ] اجلب من Android SDK المناسب أو تحقق من توافره، ثم جهز wrapper Gradle 8.9 وAGP 8.7.3 بدون إضافات تشغيلية غير لازمة.
- [ ] نفذ WebView بعزل التنقلات، الإنترنت للقراءة العامة، تخزين واجهة محلي، وإزالة الجسر عند التدمير.
- [ ] اختبر مراجعة كود الجسر ساكناً بأن المسار/host/method ثابتة ولا توجد حقول مفاتيح أو أوامر تداول.

### Task 2: محلل السوق والمحرك الورقي واختباراتهما

**Files:**
- Create: `app/src/main/assets/data.js`, `app/src/main/assets/engine.js`.
- Create: `tests/data.test.cjs`, `tests/engine.test.cjs`, `tests/security-boundary.test.cjs`, `tests/fixtures/klines.json`.

**Interfaces:**
- `MarketData.parseKlines(rows, nowMs) -> Candle[]`؛ ترتيب زمني؛ تستبعد المفتوحة وترفض البيانات غير الصالحة.
- `PaperEngine.analyze(candles, strategy) -> Analysis`؛ `PaperEngine.openPosition(...)` و`closePosition(...)` محليتان؛ `runBacktest({candles,strategy,settings}) -> BacktestResult`.
- الاستراتيجيات: تقاطع EMA، تعافي RSI أعلى 35 مع اتجاه SMA50، اختراق أعلى 20 شمعة؛ تنفيذ الاختبار عند افتتاح الشمعة التالية، والوقف قبل الهدف عند التعارض.

- [ ] اكتب اختبارات البيانات والحالات الحدية أولاً وشغّلها لتثبت الفشل قبل التنفيذ.
- [ ] نفذ التحقق والفلترة ومؤشرات المحرك والاستراتيجيات وحجم المركز والرسوم والانزلاق.
- [ ] أضف اختبارات للمحاكاة/التاريخ وفصل fixtures عن موارد المنتج، ثم شغّل `node --test tests/*.test.cjs`.

### Task 3: بناء واجهة عربية RTL وتجربة الاستخدام

**Files:**
- Create: `app/src/main/assets/index.html`, `styles.css`, `app.js`.
- Create/update: `app/src/main/res/values/strings.xml`, `styles.xml`, موارد الأيقونة.

**Interfaces:**
- التطبيق يعرض لوحة، تحليل، محاكاة/اختبار تاريخي، سجل محلي، إعدادات.
- إعدادات: capital/maxPosition/fee/slippage/sound/celebrations؛ القيم الافتراضية 11/5/0.1%/0.05%/false/false.
- يعمل التحليل والاختبار بعد طلب المستخدم لشموع Binance المكتملة، ولا ينفذ الجلب تلقائياً.

- [ ] أنشئ shell واجهة responsive للجوال بعناصر HTML دلالية وعربية كاملة واتجاه RTL.
- [ ] اربط bridge callbacks والمحرك المحلي مع رسائل خطأ عربية واضحة، وسجّل فقط تداولات محاكاة في localStorage.
- [ ] اختبر تدفقات تحميل السوق، عرض التحليل، شراء/إغلاق ورقي، نتائج backtest، السجل، والإعدادات دون اتصال أي تداول.

### Task 4: تحقق APK والتسليم

**Files:**
- Create: `CHANGELOG-AR.md`, `SHA256SUMS` (بعد اكتمال APK)، تقرير تحقق للإصدار.

**Interfaces:**
- Artifact: `app/build/outputs/apk/debug/app-debug.apk` مع package id وminSdk مطابقين للمواصفات.
- Git branch: `feature/market-observatory-android-paper-0.3.0`; GitHub Release tag `v0.3.0` باسم `DRAK Paper 0.3.0`.

- [ ] شغّل كل اختبارات Node و`./gradlew --no-daemon assembleDebug`.
- [ ] افحص APK عبر `aapt`, `apksigner`, `sha256sum`، وحاول التثبيت/التشغيل فقط إذا توفّر ADB/محاكي فعلي.
- [ ] راجع diff والأسرار، أنشئ commits واضحة، ادفع الفرع، وأنشئ الإصدار مع APK وملف البصمة إن توفرت صلاحية GitHub.
