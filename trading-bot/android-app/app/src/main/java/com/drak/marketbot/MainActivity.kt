package com.drak.marketbot

import android.app.Activity
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var secureStore: SecureStore
    private val io: ExecutorService = Executors.newFixedThreadPool(3)
    @Volatile private var tradingArmed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(8, 12, 24)
        window.navigationBarColor = android.graphics.Color.rgb(8, 12, 24)
        secureStore = SecureStore(this)
        webView = WebView(this)
        webView.setBackgroundColor(android.graphics.Color.rgb(8, 12, 24))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = false
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = false
        webView.settings.allowFileAccessFromFileURLs = false
        webView.settings.allowUniversalAccessFromFileURLs = false
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                return uri.toString() != "file:///android_asset/index.html"
            }
        }
        webView.addJavascriptInterface(NativeBridge(), "DRAK")
        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onDestroy() {
        tradingArmed = false
        io.shutdownNow()
        webView.removeJavascriptInterface("DRAK")
        webView.destroy()
        super.onDestroy()
    }

    private fun reply(callbackId: String, result: JSONObject) {
        if (!callbackId.matches(Regex("[A-Za-z0-9_-]{1,60}"))) return
        val payload = JSONObject.quote(result.toString())
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                webView.evaluateJavascript("window.nativeResult(${JSONObject.quote(callbackId)},$payload);", null)
            }
        }
    }

    private fun async(callbackId: String, action: () -> JSONObject) {
        io.execute {
            val result = try { action() } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", cleanError(e.message ?: "تعذر تنفيذ الطلب"))
            }
            reply(callbackId, result)
        }
    }

    private fun cleanError(message: String): String = message
        .replace(Regex("[\\r\\n\\t]+"), " ")
        .take(240)

    private fun currentClient(): BinanceApi {
        val creds = secureStore.read() ?: throw IllegalStateException("اربط حسابك أولاً من الإعدادات")
        return BinanceApi(creds.key, creds.secret, creds.mode)
    }

    inner class NativeBridge {
        @JavascriptInterface fun getStatus(callbackId: String) = async(callbackId) {
            val creds = secureStore.read()
            JSONObject().put("ok", true)
                .put("connected", creds != null)
                .put("mode", creds?.mode ?: "testnet")
                .put("armed", tradingArmed)
                .put("keyHint", creds?.key?.let { if (it.length > 7) it.take(3) + "••••" + it.takeLast(4) else "••••" } ?: "")
        }

        @JavascriptInterface fun connect(apiKey: String, apiSecret: String, mode: String, callbackId: String) {
            async(callbackId) {
                if (apiKey.trim().length < 8 || apiSecret.trim().length < 8) throw IllegalArgumentException("تحقق من مفتاح API والمفتاح السري")
                val selectedMode = mode.lowercase(Locale.ROOT)
                if (selectedMode != "testnet" && selectedMode != "live") throw IllegalArgumentException("وضع الاتصال غير صحيح")
                val client = BinanceApi(apiKey.trim(), apiSecret.trim(), selectedMode)
                val account = client.account()
                if (!account.optBoolean("canTrade", false)) throw IllegalStateException("المفتاح متصل، لكن التداول غير مفعّل عليه")
                secureStore.save(Credentials(apiKey.trim(), apiSecret.trim(), selectedMode))
                tradingArmed = false
                JSONObject().put("ok", true).put("mode", selectedMode).put("message", if (selectedMode == "testnet") "اتصال تجريبي ناجح" else "اتصال مباشر ناجح؛ التداول لم يُفعّل بعد")
            }
        }

        @JavascriptInterface fun disconnect(callbackId: String) {
            async(callbackId) {
                tradingArmed = false
                secureStore.clear()
                JSONObject().put("ok", true).put("message", "تم فصل الاتصال وحذف بيانات المفتاح المحفوظة")
            }
        }

        @JavascriptInterface fun armTrading(confirmation: String, callbackId: String) {
            async(callbackId) {
                val creds = secureStore.read() ?: throw IllegalStateException("اربط حسابك أولاً")
                if (creds.mode == "live" && confirmation != "تداول حقيقي") {
                    throw IllegalStateException("للتداول الحقيقي اكتب العبارة: تداول حقيقي")
                }
                val account = BinanceApi(creds.key, creds.secret, creds.mode).account()
                if (!account.optBoolean("canTrade", false)) throw IllegalStateException("التداول غير مفعّل على هذا المفتاح")
                tradingArmed = true
                JSONObject().put("ok", true).put("armed", true).put("mode", creds.mode)
                    .put("message", if (creds.mode == "live") "تم تفعيل التداول الحقيقي بعد التأكيد" else "المحاكاة عبر شبكة الاختبار جاهزة")
            }
        }

        @JavascriptInterface fun disarmTrading(callbackId: String) {
            tradingArmed = false
            async(callbackId) { JSONObject().put("ok", true).put("armed", false).put("message", "تم إيقاف التداول") }
        }

        @JavascriptInterface fun getPrice(symbol: String, callbackId: String) = async(callbackId) {
            val clean = validateSymbol(symbol)
            val price = BinanceApi.publicPrice(clean)
            JSONObject().put("ok", true).put("symbol", clean).put("price", price)
        }

        @JavascriptInterface fun getKlines(symbol: String, interval: String, limit: Int, callbackId: String) = async(callbackId) {
            val clean = validateSymbol(symbol)
            val allowedIntervals = setOf("1m", "5m", "15m", "30m", "1h", "4h", "1d")
            if (interval !in allowedIntervals) throw IllegalArgumentException("الإطار الزمني غير مدعوم")
            val safeLimit = limit.coerceIn(60, 500)
            val rows = BinanceApi.publicKlines(clean, interval, safeLimit)
            JSONObject().put("ok", true).put("symbol", clean).put("interval", interval).put("klines", rows)
        }

        @JavascriptInterface fun getAccount(callbackId: String) = async(callbackId) {
            val account = currentClient().account()
            val src = account.optJSONArray("balances") ?: JSONArray()
            val balances = JSONArray()
            var usdt = 0.0
            for (i in 0 until src.length()) {
                val asset = src.optJSONObject(i) ?: continue
                val free = asset.optString("free", "0").toDoubleOrNull() ?: 0.0
                val locked = asset.optString("locked", "0").toDoubleOrNull() ?: 0.0
                if (free > 0.00000001 || locked > 0.00000001) {
                    balances.put(JSONObject().put("asset", asset.optString("asset"))
                        .put("free", free).put("locked", locked))
                }
                if (asset.optString("asset") == "USDT") usdt = free + locked
            }
            JSONObject().put("ok", true).put("usdt", usdt).put("balances", balances)
                .put("canTrade", account.optBoolean("canTrade", false))
        }

        @JavascriptInterface fun buyMarket(symbol: String, quoteAmount: Double, callbackId: String) = async(callbackId) {
            ensureArmed()
            if (!quoteAmount.isFinite() || quoteAmount < 5.0 || quoteAmount > 10.0) {
                throw IllegalArgumentException("قيمة أمر الشراء بين 5 و10 USDT في هذه النسخة")
            }
            val clean = validateSymbol(symbol)
            val order = currentClient().marketBuy(clean, BigDecimal.valueOf(quoteAmount).setScale(2, RoundingMode.DOWN).toPlainString())
            JSONObject().put("ok", true).put("order", order).put("message", "تم إرسال أمر الشراء إلى المنصة")
        }

        @JavascriptInterface fun sellMarket(symbol: String, quantity: Double, callbackId: String) = async(callbackId) {
            ensureArmed()
            if (!quantity.isFinite() || quantity <= 0.0) throw IllegalArgumentException("كمية البيع غير صحيحة")
            val clean = validateSymbol(symbol)
            val order = currentClient().marketSell(clean, BigDecimal.valueOf(quantity).toPlainString())
            JSONObject().put("ok", true).put("order", order).put("message", "تم إرسال أمر البيع إلى المنصة")
        }

        @JavascriptInterface fun keepScreenOn(enabled: Boolean) {
            runOnUiThread {
                if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        private fun ensureArmed() {
            if (!tradingArmed) throw IllegalStateException("التداول غير مفعّل. فعّله من واجهة التطبيق أولاً")
        }
    }

    private fun validateSymbol(value: String): String {
        val symbol = value.trim().uppercase(Locale.ROOT)
        if (!symbol.matches(Regex("[A-Z0-9]{5,20}"))) throw IllegalArgumentException("رمز العملة غير صحيح")
        return symbol
    }
}

private data class Credentials(val key: String, val secret: String, val mode: String)

/** Encrypts API credentials with an AES key held by Android Keystore. */
private class SecureStore(activity: Activity) {
    private val prefs = activity.getSharedPreferences("drak_secure", Activity.MODE_PRIVATE)
    private val alias = "drak_api_credentials_v1"

    @Synchronized fun save(creds: Credentials) {
        val json = JSONObject().put("key", creds.key).put("secret", creds.secret).put("mode", creds.mode).toString()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(json.toByteArray(StandardCharsets.UTF_8))
        val packed = ByteArrayOutputStream().use { out -> out.write(cipher.iv); out.write(encrypted); out.toByteArray() }
        prefs.edit().putString("payload", Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
    }

    @Synchronized fun read(): Credentials? {
        val encoded = prefs.getString("payload", null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            if (packed.size <= 12) return null
            val iv = packed.copyOfRange(0, 12)
            val body = packed.copyOfRange(12, packed.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            val json = JSONObject(String(cipher.doFinal(body), StandardCharsets.UTF_8))
            Credentials(json.getString("key"), json.getString("secret"), json.getString("mode"))
        } catch (_: Exception) { null }
    }

    @Synchronized fun clear() {
        prefs.edit().remove("payload").apply()
        try {
            val ks = KeyStore.getInstance("AndroidKeyStore")
            ks.load(null)
            if (ks.containsAlias(alias)) ks.deleteEntry(alias)
        } catch (_: Exception) { }
    }

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore")
        ks.load(null)
        val existing = ks.getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }
}

private class BinanceApi(private val apiKey: String, private val apiSecret: String, private val mode: String) {
    private val tradingBase = if (mode == "testnet") "https://testnet.binance.vision" else "https://api.binance.com"
    private val marketBase = "https://api.binance.com"

    fun account(): JSONObject = request("GET", "/api/v3/account", linkedMapOf("recvWindow" to "5000"), signed = true, base = tradingBase) as JSONObject

    fun marketBuy(symbol: String, quoteAmount: String): JSONObject = request("POST", "/api/v3/order", linkedMapOf(
        "symbol" to symbol, "side" to "BUY", "type" to "MARKET", "quoteOrderQty" to quoteAmount, "newOrderRespType" to "FULL", "recvWindow" to "5000"
    ), signed = true, base = tradingBase) as JSONObject

    fun marketSell(symbol: String, rawQuantity: String): JSONObject {
        val step = lotStep(symbol)
        val quantity = BigDecimal(rawQuantity).divide(step, 0, RoundingMode.DOWN).multiply(step).stripTrailingZeros()
        if (quantity <= BigDecimal.ZERO) throw IllegalArgumentException("الكمية أقل من الحد المسموح للبيع")
        return request("POST", "/api/v3/order", linkedMapOf(
            "symbol" to symbol, "side" to "SELL", "type" to "MARKET", "quantity" to quantity.toPlainString(), "newOrderRespType" to "FULL", "recvWindow" to "5000"
        ), signed = true, base = tradingBase) as JSONObject
    }

    private fun lotStep(symbol: String): BigDecimal {
        val info = request("GET", "/api/v3/exchangeInfo", linkedMapOf("symbol" to symbol), false, marketBase) as JSONObject
        val entry = info.optJSONArray("symbols")?.optJSONObject(0) ?: throw IllegalStateException("تعذر قراءة قواعد الزوج")
        val filters = entry.optJSONArray("filters") ?: throw IllegalStateException("قواعد الزوج غير متاحة")
        for (i in 0 until filters.length()) {
            val filter = filters.optJSONObject(i) ?: continue
            if (filter.optString("filterType") == "LOT_SIZE") return BigDecimal(filter.getString("stepSize"))
        }
        throw IllegalStateException("لم نعثر على حجم الكمية المسموح لهذا الزوج")
    }

    companion object {
        fun publicPrice(symbol: String): Double {
            val result = requestStatic("GET", "/api/v3/ticker/price", linkedMapOf("symbol" to symbol), "https://api.binance.com") as JSONObject
            return result.getString("price").toDouble()
        }

        fun publicKlines(symbol: String, interval: String, limit: Int): JSONArray =
            requestStatic("GET", "/api/v3/klines", linkedMapOf("symbol" to symbol, "interval" to interval, "limit" to limit.toString()), "https://api.binance.com") as JSONArray

        private fun requestStatic(method: String, path: String, params: LinkedHashMap<String, String>, base: String): Any =
            httpRequest(method, path, params, null, null, false, base)
    }

    private fun request(method: String, path: String, params: LinkedHashMap<String, String>, signed: Boolean, base: String): Any =
        httpRequest(method, path, params, apiKey, apiSecret, signed, base)
}

private fun httpRequest(
    method: String,
    path: String,
    rawParams: LinkedHashMap<String, String>,
    apiKey: String?,
    apiSecret: String?,
    signed: Boolean,
    base: String
): Any {
    val params = LinkedHashMap(rawParams)
    if (signed) {
        params["timestamp"] = System.currentTimeMillis().toString()
        if (params["recvWindow"] == null) params["recvWindow"] = "5000"
    }
    fun queryString(values: Map<String, String>): String = values.entries.joinToString("&") {
        URLEncoder.encode(it.key, "UTF-8") + "=" + URLEncoder.encode(it.value, "UTF-8")
    }
    var query = queryString(params)
    if (signed) {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec((apiSecret ?: throw IllegalStateException("المفتاح السري غير موجود")).toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        val signature = mac.doFinal(query.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
        query += "&signature=$signature"
    }
    val url = URL(base + path + if (query.isNotEmpty()) "?$query" else "")
    val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 12_000
        readTimeout = 12_000
        setRequestProperty("Accept", "application/json")
        if (!apiKey.isNullOrBlank()) setRequestProperty("X-MBX-APIKEY", apiKey)
        if (method == "POST") doOutput = false
    }
    try {
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.use { input -> BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).readText() } ?: "{}"
        if (code !in 200..299) {
            var message = "خطأ من المنصة (HTTP $code)"
            try {
                val error = JSONObject(body)
                message = error.optString("msg", error.optString("message", message))
                val errorCode = error.optInt("code", 0)
                if (errorCode != 0) message += " [${errorCode}]"
            } catch (_: Exception) { }
            throw IllegalStateException(message)
        }
        return if (body.trimStart().startsWith("[")) JSONArray(body) else JSONObject(body)
    } finally {
        connection.disconnect()
    }
}
