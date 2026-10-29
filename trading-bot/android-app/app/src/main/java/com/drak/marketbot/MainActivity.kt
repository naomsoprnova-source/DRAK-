package com.drak.marketbot

import android.app.Activity
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val io: ExecutorService = Executors.newFixedThreadPool(3)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        clearLegacyAccountData()
        window.statusBarColor = android.graphics.Color.rgb(9, 15, 27)
        window.navigationBarColor = android.graphics.Color.rgb(9, 15, 27)
        webView = WebView(this)
        webView.setBackgroundColor(android.graphics.Color.rgb(9, 15, 27))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = false
        webView.settings.allowFileAccessFromFileURLs = false
        webView.settings.allowUniversalAccessFromFileURLs = false
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val requested = request?.url?.toString() ?: return true
                return requested != HOME_URL
            }
        }
        webView.addJavascriptInterface(MarketBridge(), "DRAK")
        setContentView(webView)
        webView.loadUrl(HOME_URL)
    }

    override fun onDestroy() {
        io.shutdownNow()
        webView.removeJavascriptInterface("DRAK")
        webView.destroy()
        super.onDestroy()
    }

    private fun clearLegacyAccountData() {
        // Older versions stored exchange credentials; erase them on upgrade and never read them.
        try { deleteSharedPreferences("drak_secure") } catch (_: Exception) { }
        try {
            val store = KeyStore.getInstance("AndroidKeyStore")
            store.load(null)
            val obsoleteAlias = "drak_api_credentials_v1"
            if (store.containsAlias(obsoleteAlias)) store.deleteEntry(obsoleteAlias)
        } catch (_: Exception) { }
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
            val result = try {
                action()
            } catch (error: Exception) {
                JSONObject().put("ok", false).put("error", cleanError(error.message ?: "تعذر تحديث بيانات السوق"))
            }
            reply(callbackId, result)
        }
    }

    private fun cleanError(message: String): String = message
        .replace(Regex("[\\r\\n\\t]+"), " ")
        .take(200)

    inner class MarketBridge {
        @JavascriptInterface
        fun getMarket(symbol: String, callbackId: String) = async(callbackId) {
            val clean = validateSymbol(symbol)
            val ticker = PublicMarketApi.ticker(clean)
            JSONObject()
                .put("ok", true)
                .put("symbol", clean)
                .put("price", ticker.getString("lastPrice").toDouble())
                .put("changePercent", ticker.getString("priceChangePercent").toDoubleOrNull() ?: 0.0)
                .put("high", ticker.getString("highPrice").toDoubleOrNull() ?: 0.0)
                .put("low", ticker.getString("lowPrice").toDoubleOrNull() ?: 0.0)
                .put("quoteVolume", ticker.getString("quoteVolume").toDoubleOrNull() ?: 0.0)
                .put("fetchedAt", System.currentTimeMillis())
        }

        @JavascriptInterface
        fun getKlines(symbol: String, interval: String, limit: Int, callbackId: String) = async(callbackId) {
            val clean = validateSymbol(symbol)
            val supportedIntervals = setOf("1m", "5m", "15m", "30m", "1h", "4h", "1d")
            require(interval in supportedIntervals) { "الإطار الزمني غير مدعوم." }
            val safeLimit = limit.coerceIn(30, 500)
            JSONObject()
                .put("ok", true)
                .put("symbol", clean)
                .put("interval", interval)
                .put("klines", PublicMarketApi.klines(clean, interval, safeLimit))
        }
    }

    private fun validateSymbol(value: String): String {
        val symbol = value.trim().uppercase(Locale.ROOT)
        require(symbol.matches(Regex("[A-Z0-9]{5,20}"))) { "رمز الأصل غير صالح." }
        return symbol
    }

    companion object {
        private const val HOME_URL = "file:///android_asset/index.html"
    }
}

/** Read-only public market data. Requests are fixed to unauthenticated HTTPS GET endpoints. */
private object PublicMarketApi {
    private const val BASE = "https://api.binance.com"

    fun ticker(symbol: String): JSONObject = request(
        "/api/v3/ticker/24hr",
        linkedMapOf("symbol" to symbol)
    ) as JSONObject

    fun klines(symbol: String, interval: String, limit: Int): JSONArray = request(
        "/api/v3/klines",
        linkedMapOf("symbol" to symbol, "interval" to interval, "limit" to limit.toString())
    ) as JSONArray

    private fun request(path: String, params: LinkedHashMap<String, String>): Any {
        require(path == "/api/v3/ticker/24hr" || path == "/api/v3/klines") { "طلب السوق غير مدعوم." }
        val query = params.entries.joinToString("&") { (key, value) ->
            "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
        }
        val connection = (URL("$BASE$path?$query").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "DRAK-Demo-Android")
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.use { input ->
                BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).readText()
            } ?: "{}"
            if (status !in 200..299) throw IllegalStateException("تعذر جلب السعر العام (HTTP $status).")
            return if (body.trimStart().startsWith("[")) JSONArray(body) else JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }
}
