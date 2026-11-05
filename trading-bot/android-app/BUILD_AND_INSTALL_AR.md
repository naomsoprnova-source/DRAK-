# بناء وتثبيت DRAK ورقي

## المتطلبات

Java 17 أو أحدث متوافق مع Gradle 8.9، وAndroid SDK Platform 35 وBuild Tools 35.0.1. سير GitHub Actions الفعلي موجود في `.github/workflows/build-drak-android.yml` عند جذر المستودع، ويعمل عند تغيير `trading-bot/android-app/**` أو يدويًا. صلاحياته قراءة فقط ولا يدفع ملفات إلى المستودع.

## بناء APK تجريبي

من جذر المستودع:

```bash
cd trading-bot/android-app
gradle assembleDebug
```

الناتج:

```text
app/build/outputs/apk/debug/app-debug.apk
```

للتثبيت عبر جهاز Android متصل ومفعّل عليه تصحيح USB:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

يمكن كذلك تنزيل أثر `DRAK-Android-debug` من تشغيل GitHub Actions بعد نجاحه. الأثر تجريبي ومؤقت؛ لا توجد نسخة release موقعة بمفتاح نشر دائم.

## اختبار سريع بعد التثبيت

افتح التطبيق وتأكد من ظهور «محاكاة محلية»، وأن السعر موسوم بأنه اصطناعي. بدّل الرمز والفاصل، حلّل استراتيجية، افتح مركزًا ورقيًا ثم أغلقه، وافتح السجل. راجع [قائمة الاختبار](TEST_CHECKLIST_AR.md). لا توجد خطوة لربط حساب أو إدخال مفتاح.
