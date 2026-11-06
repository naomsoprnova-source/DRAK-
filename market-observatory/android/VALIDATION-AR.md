# تقرير التحقق — DRAK Paper 0.3.0

تاريخ البناء: 6 نوفمبر 2026. المسار: `market-observatory/android/` على فرع `feature/market-observatory-android-paper-0.3.0`.

## نتيجة البناء والتحقق من APK

نفّذ الأمر `./gradlew --no-daemon --console=plain assembleDebug` باستخدام Gradle 8.9 وAndroid SDK Platform 35. يحتوي الخرج على ملف debug APK بحجم 44,633 بايت. كشف `aapt dump badging` أن الحزمة `com.ans.marketobservatory`، والإصدار `0.3.0`، و`minSdkVersion 23` و`targetSdkVersion 35`. اسم التطبيق المضمّن: «مرصد العملات DRAK Paper 0.3.0».

تحقق `apksigner verify --verbose --print-certs` من توقيعي v1 وv2 (الموقّع الافتراضي Android Debug). بصمة شهادة التوقيع SHA-256: `54312f3d257685635681299b8778e4da2f2146ea07471a597628e5143a91f2e1`.

بصمة ملف APK SHA-256: `457eb730df9f16c74bfa8db79c01ca174caea06f452f909af2b1f8ad2ca4140b`. توجد البصمة في `release-assets/SHA256SUMS`، ويُرفق كل من APK وملف البصمة بإصدار GitHub.

## الاختبارات

مرّ `node --test tests/*.test.cjs` بعدد 11 اختباراً، دون فشل. تغطي الاختبارات قائمة الرموز والأطر والشموع المغلقة والتحقق من OHLCV والكمية العشرية وسقف السيولة والرسوم والانزلاق والمراكز غير الصالحة والإغلاق وصافي النتيجة وتنفيذ الاختبار عند الشمعة التالية وتفضيل الوقف عند ملامسة الوقف والهدف في الشمعة نفسها وحدود شبكة Android.

تم فحص نحو `data.js` و`engine.js` و`app.js`، كما لم يظهر في مصدر الإنتاج سوى إذن Android للإنترنت وطلب HTTPS ثابت لواجهة Binance العامة `/api/v3/klines`؛ لا واجهة أو صلاحية أو مسار لأوامر التداول الخاصة. ملفات fixtures في `tests/fixtures/` بيانات اصطناعية للاختبار فقط، ولا تدخل إلى الواجهة أو الاختبار التاريخي.

## تحقق اتصال السوق

أُجري طلب قراءة عام محدود إلى Binance Spot `GET /api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5`: أعاد HTTP 200 خمس شموع، وأُبقيت أربع فقط بعد استبعاد الشمعة غير المكتملة. لا يتطلب الطلب تسجيل دخول أو مفتاح API. كان هذا اختبار اتصال عام من بيئة البناء؛ لا يثبت اختبار واجهة التطبيق على جهاز Android.

## تثبيت وتشغيل التطبيق

لم يظهر جهاز Android فعلي في `adb devices`، و`/dev/kvm` غير متاح. ثُبّت Android Emulator وصورة Android 35 (Google APIs، x86_64)، وأُنشئ AVD مع `-accel off`. تعرّف ADB على المحاكي، لكن `sys.boot_completed` لم يصبح `1` خلال 360 ثانية؛ انتهت المحاولة قبل أمر `adb install` ولم تُلتقط شاشة للتطبيق. لا توجد أدلة على تثبيت الحزمة أو تشغيلها داخل Android، لذا يظل اختبار التشغيل الفعلي غير متحقق. أثبتت أدوات الحزمة والتوقيع سلامة ملف APK فقط، وليس نجاح تشغيله على جهاز.
