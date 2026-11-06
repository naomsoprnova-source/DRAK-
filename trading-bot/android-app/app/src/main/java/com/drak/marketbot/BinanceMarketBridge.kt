package com.drak.marketbot

import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.HttpsURLConnection
import java.util.concurrent.ExecutorService

/** Narrow, read-only bridge for Binance's public Spot market-data-only API. */
internal class BinanceMarketBridge(
    private val webView: WebView,
    private val worker: ExecutorService,
    private val vibrator: Vibrator?
) {
    @JavascriptInterface
    fun fetchTickers(requestId: String) {
        if (!validRequestId(requestId)) return
        worker.execute {
            val result = try {
                val serverTime = readServerTime()
                val symbolsJson = JSONArray(ALLOWED_SYMBOLS.toList()).toString()
                val uri = Uri.parse("$BASE_URL/api/v3/ticker/price")
                    .buildUpon()
                    .appendQueryParameter("symbols", symbolsJson)
                    .build()
                val rows = JSONArray(readHttps(uri.toString()))
                JSONObject().put("ok", true).put("serverTime", serverTime).put("data", rows).toString()
            } catch (error: Throwable) {
                errorResult(error)
            }
            deliver(requestId, result)
        }
    }

    @JavascriptInterface
    fun fetchKlines(
        symbol: String,
        interval: String,
        startTime: String,
        endTime: String,
        limit: String,
        requestId: String
    ) {
        if (!validRequestId(requestId)) return
        val cleanSymbol = symbol.uppercase()
        if (cleanSymbol !in ALLOWED_SYMBOLS || interval !in ALLOWED_INTERVALS) {
            deliver(requestId, errorJson("رمز السوق أو الفاصل غير مسموح."))
            return
        }
        val parsedLimit = limit.toIntOrNull()
        if (parsedLimit == null || parsedLimit !in 1..MAX_KLINE_LIMIT) {
            deliver(requestId, errorJson("حد الشموع يجب أن يكون بين 1 و1000."))
            return
        }
        val start = startTime.toLongOrNull()
        val end = endTime.toLongOrNull()
        if ((startTime.isNotEmpty() && (start == null || start < 0L)) ||
            (endTime.isNotEmpty() && (end == null || end < 0L)) ||
            (start != null && end != null && (end < start || end - start > MAX_HISTORY_MS))) {
            deliver(requestId, errorJson("نطاق التاريخ غير صالح أو أطول من المسموح."))
            return
        }
        worker.execute {
            val result = try {
                val serverTime = readServerTime()
                val builder = Uri.parse("$BASE_URL/api/v3/klines")
                    .buildUpon()
                    .appendQueryParameter("symbol", cleanSymbol)
                    .appendQueryParameter("interval", interval)
                    .appendQueryParameter("limit", parsedLimit.toString())
                if (start != null) builder.appendQueryParameter("startTime", start.toString())
                if (end != null) builder.appendQueryParameter("endTime", end.toString())
                val rows = JSONArray(readHttps(builder.build().toString()))
                JSONObject().put("ok", true).put("serverTime", serverTime).put("symbol", cleanSymbol)
                    .put("interval", interval).put("data", rows).toString()
            } catch (error: Throwable) {
                errorResult(error)
            }
            deliver(requestId, result)
        }
    }

    @JavascriptInterface
    fun vibrate(milliseconds: String) {
        val duration = milliseconds.toLongOrNull() ?: return
        if (duration !in 1L..1000L) return
        try {
            val deviceVibrator = vibrator ?: return
            if (!deviceVibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                deviceVibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                deviceVibrator.vibrate(duration)
            }
        } catch (_: SecurityException) {
            // Haptics are optional; failure never affects market data or the paper ledger.
        }
    }

    private fun readServerTime(): Long {
        val value = JSONObject(readHttps("$BASE_URL/api/v3/time")).optLong("serverTime", -1L)
        if (value <= 0L) throw MarketDataException("تعذر التحقق من وقت Binance.")
        return value
    }

    private fun readHttps(rawUrl: String): String {
        val url = URL(rawUrl)
        if (url.protocol != "https" || url.host != API_HOST || url.port != -1 || url.userInfo != null) {
            throw MarketDataException("تم رفض وجهة بيانات غير مسموحة.")
        }
        val connection = (url.openConnection() as? HttpsURLConnection)
            ?: throw MarketDataException("تعذر إنشاء اتصال HTTPS آمن.")
        connection.instanceFollowRedirects = false
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        connection.requestMethod = "GET"
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("User-Agent", "DRAK-Paper/0.3.0")
        try {
            val status = connection.responseCode
            if (status != HttpsURLConnection.HTTP_OK) {
                val retryAfter = connection.getHeaderField("Retry-After")?.toLongOrNull()
                throw MarketDataException(
                    when (status) {
                        429, 418 -> "Binance طلبت إيقاف الطلبات مؤقتًا (HTTP $status). انتظر قبل التحديث."
                        403, 451 -> "رفضت Binance الاتصال من هذه الشبكة أو المنطقة (HTTP $status)."
                        in 500..599 -> "خدمة Binance غير متاحة مؤقتًا (HTTP $status)."
                        else -> "رفضت Binance طلب البيانات (HTTP $status)."
                    }, status, retryAfter
                )
            }
            return connection.inputStream.use { readBounded(it, MAX_RESPONSE_BYTES) }
        } catch (error: SocketTimeoutException) {
            throw MarketDataException("انتهت مهلة الاتصال بواجهة Binance.", cause = error)
        } catch (error: UnknownHostException) {
            throw MarketDataException("تعذر الوصول إلى خادم بيانات Binance؛ تحقق من الإنترنت.", cause = error)
        } finally {
            connection.disconnect()
        }
    }

    private fun readBounded(input: InputStream, maxBytes: Int): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > maxBytes) throw MarketDataException("استجابة البيانات أكبر من الحد المسموح.")
            output.write(buffer, 0, count)
        }
        return output.toString(Charsets.UTF_8.name())
    }

    private fun errorResult(error: Throwable): String {
        val marketError = error as? MarketDataException
        val message = marketError?.message ?: "تعذر جلب بيانات Binance. لا توجد بيانات بديلة مصطنعة."
        val result = JSONObject().put("ok", false).put("error", message)
        marketError?.httpStatus?.let { result.put("httpStatus", it) }
        marketError?.retryAfterSeconds?.let { result.put("retryAfterSeconds", it) }
        return result.toString()
    }

    private fun errorJson(message: String): String = JSONObject().put("ok", false).put("error", message).toString()

    private fun deliver(requestId: String, payload: String) {
        val numericId = requestId.toLongOrNull() ?: return
        webView.post {
            if (!webView.isAttachedToWindow) return@post
            val safePayload = JSONObject.quote(payload)
            webView.evaluateJavascript(
                "window.DrakBridgeCallbacks&&window.DrakBridgeCallbacks.onResponse($numericId,$safePayload);",
                null
            )
        }
    }

    private fun validRequestId(value: String): Boolean = value.length in 1..15 && value.all { it in '0'..'9' }

    private class MarketDataException(
        message: String,
        val httpStatus: Int? = null,
        val retryAfterSeconds: Long? = null,
        cause: Throwable? = null
    ) : Exception(message, cause)

    companion object {
        private const val API_HOST = "data-api.binance.vision"
        private const val BASE_URL = "https://data-api.binance.vision"
        private val ALLOWED_SYMBOLS = setOf("BTCUSDT", "ETHUSDT", "SOLUSDT")
        private val ALLOWED_INTERVALS = setOf("5m", "15m", "1h", "4h", "1d")
        private const val MAX_KLINE_LIMIT = 1000
        private const val MAX_RESPONSE_BYTES = 1_500_000
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 12_000
        private const val MAX_HISTORY_MS = 366L * 24L * 60L * 60L * 1000L
    }
}
