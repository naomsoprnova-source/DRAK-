# بناء وتثبيت DRAK 0.3.0

## المتطلبات

Java 17، Gradle 8.9، Android SDK Platform 35 وBuild Tools 35.0.1. الحد الأدنى للتطبيق `minSdk 26` (Android 8.0)، لذلك يتضمن Android 9، ويستخدم `targetSdk 28`. يحتاج التطبيق إلى الإنترنت لقراءة Binance Spot العامة وإذن اهتزاز اختياري؛ لا يحتاج إلى API Key.

سير GitHub Actions الفعلي في `.github/workflows/build-drak-android.yml` عند جذر المستودع. يبني APK عند تغيير تطبيق Android أو تشغيله يدويًا، بصلاحية `contents: read`، ولا يدفع تغييرات للمستودع.

## بناء APK تجريبي

من جذر المستودع:

```bash
cd trading-bot/android-app
gradle clean assembleDebug
```

الملف الناتج:

```text
app/build/outputs/apk/debug/app-debug.apk
```

للتحقق من الأذونات والتوقيع:

```bash
aapt dump permissions app/build/outputs/apk/debug/app-debug.apk
apksigner verify --verbose app/build/outputs/apk/debug/app-debug.apk
```

تثبيت على جهاز متصل ومفعّل عليه تصحيح USB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

يمكن تنزيل APK من [إصدار DRAK 0.3.0](https://github.com/naomsoprnova-source/DRAK-/releases/tag/v0.3.0) أو أثر `DRAK-Android-debug` في GitHub Actions. النسخة debug موقعة بمفتاح تطوير، وليست إصدار متجر موقّعًا بمفتاح نشر دائم؛ قد لا تستطيع تحديث APK مثبت سابقًا إذا كان موقّعًا بمفتاح مختلف.

## فحص الاستخدام

افتح التطبيق واتصل بالإنترنت، وتأكد من حالة Binance ووقت آخر تحديث، ثم بدّل بين BTC/ETH/SOL وبين الفواصل. عند قطع الاتصال ينبغي أن تظهر رسالة تعذر البيانات دون أسعار بديلة. اختبر يدويًا مبلغًا مثل 3.50 USDT، والرسوم والسجل، ثم الباكتيست. راجع [قائمة الاختبار](TEST_CHECKLIST_AR.md) و[تقرير الاختبارات](replica/test-report.md).

بُني APK في بيئة CI/البناء، لكن لا يتوفر جهاز فعلي أو محاكي Android 9 متصل للاختبار والتثبيت الفعلي؛ لذلك لا نصفه بأنه مُجرّب على Android 9.
