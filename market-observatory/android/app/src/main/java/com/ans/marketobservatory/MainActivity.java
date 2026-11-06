package com.ans.marketobservatory;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    private static final Set<String> SYMBOLS = new HashSet<>(Arrays.asList("BTCUSDT", "ETHUSDT", "SOLUSDT"));
    private static final Set<String> INTERVALS = new HashSet<>(Arrays.asList("15m", "1h", "4h", "1d"));
    private static final String LOCAL_ENTRY = "file:///android_asset/index.html";
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

    private WebView webView;
    private final ExecutorService networkWorker = Executors.newFixedThreadPool(2);

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(11, 17, 16));
        window.setNavigationBarColor(Color.rgb(11, 17, 16));
        window.getDecorView().setSystemUiVisibility(0);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 17, 16));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        if (android.os.Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new PublicMarketBridge(), "DRAK");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !LOCAL_ENTRY.equals(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !LOCAL_ENTRY.equals(url);
            }
        });
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        } else {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            });
        }
        setContentView(webView);
        webView.loadUrl(LOCAL_ENTRY);
    }

    @Override
    protected void onDestroy() {
        networkWorker.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("DRAK");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void reply(String callbackId, JSONObject payload) {
        if (webView == null || !callbackId.matches("[A-Za-z0-9_-]{1,64}")) return;
        String script = "window.nativeResult(" + JSONObject.quote(callbackId) + "," +
                JSONObject.quote(payload.toString()) + ");";
        runOnUiThread(() -> {
            if (webView != null && !isFinishing() && !isDestroyed()) webView.evaluateJavascript(script, null);
        });
    }

    private JSONObject error(String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("ok", false);
            payload.put("error", message);
        } catch (org.json.JSONException ignored) {
            return new JSONObject();
        }
        return payload;
    }

    private final class PublicMarketBridge {
        @JavascriptInterface
        public void getKlines(String symbol, String interval, int limit, String callbackId) {
            if (callbackId == null || !callbackId.matches("[A-Za-z0-9_-]{1,64}")) return;
            String cleanSymbol = symbol == null ? "" : symbol.trim().toUpperCase(java.util.Locale.ROOT);
            String cleanInterval = interval == null ? "" : interval.trim();
            if (!SYMBOLS.contains(cleanSymbol) || !INTERVALS.contains(cleanInterval) || limit < 50 || limit > 1000) {
                reply(callbackId, error("طلب بيانات السوق غير مسموح أو خارج الحدود."));
                return;
            }
            networkWorker.execute(() -> {
                try {
                    reply(callbackId, fetchKlines(cleanSymbol, cleanInterval, limit));
                } catch (Exception exception) {
                    String message = exception.getMessage();
                    reply(callbackId, error(message == null || message.trim().isEmpty()
                            ? "تعذر جلب بيانات السوق العامة." : message));
                }
            });
        }
    }

    private JSONObject fetchKlines(String symbol, String interval, int limit) throws Exception {
        String query = "symbol=" + URLEncoder.encode(symbol, StandardCharsets.UTF_8.name()) +
                "&interval=" + URLEncoder.encode(interval, StandardCharsets.UTF_8.name()) +
                "&limit=" + limit;
        HttpsURLConnection connection = (HttpsURLConnection) new java.net.URL(
                "https://api.binance.com/api/v3/klines?" + query).openConnection();
        connection.setRequestMethod("GET");
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status != HttpsURLConnection.HTTP_OK) {
                throw new IllegalStateException("تعذر جلب السوق (HTTP " + status + ").");
            }
            byte[] bytes = readLimited(connection.getInputStream());
            JSONArray raw = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
            JSONArray closed = new JSONArray();
            long now = System.currentTimeMillis();
            long previousTime = -1;
            for (int i = 0; i < raw.length(); i++) {
                JSONArray row = raw.optJSONArray(i);
                if (row == null || row.length() < 7) throw new IllegalStateException("رد الشموع من Binance غير مكتمل.");
                long openTime = row.optLong(0, -1);
                long closeTime = row.optLong(6, -1);
                if (openTime <= 0 || closeTime < openTime) throw new IllegalStateException("زمن شمعة Binance غير صالح.");
                if (closeTime >= now) continue;
                if (openTime <= previousTime) throw new IllegalStateException("ترتيب شموع Binance غير صالح.");
                double open = numberAt(row, 1);
                double high = numberAt(row, 2);
                double low = numberAt(row, 3);
                double close = numberAt(row, 4);
                double volume = numberAt(row, 5);
                if (!Double.isFinite(open) || !Double.isFinite(high) || !Double.isFinite(low) ||
                        !Double.isFinite(close) || !Double.isFinite(volume) || open <= 0 || high <= 0 ||
                        low <= 0 || close <= 0 || volume < 0 || high < Math.max(open, Math.max(close, low)) ||
                        low > Math.min(open, Math.min(close, high))) {
                    throw new IllegalStateException("قيم OHLCV من Binance غير متسقة.");
                }
                closed.put(new JSONObject().put("time", openTime).put("open", open).put("high", high)
                        .put("low", low).put("close", close).put("volume", volume).put("closeTime", closeTime));
                previousTime = openTime;
            }
            if (closed.length() < 50) throw new IllegalStateException("لم تصل 50 شمعة مكتملة وصالحة.");
            return new JSONObject().put("ok", true).put("symbol", symbol).put("interval", interval)
                    .put("dataSource", "Binance Spot API").put("candles", closed);
        } finally {
            connection.disconnect();
        }
    }

    private double numberAt(JSONArray row, int index) {
        Object value = row.opt(index);
        if (value == null || value == JSONObject.NULL) return Double.NaN;
        try { return Double.parseDouble(String.valueOf(value)); }
        catch (NumberFormatException exception) { return Double.NaN; }
    }

    private byte[] readLimited(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_RESPONSE_BYTES) throw new IllegalStateException("حجم رد السوق أكبر من الحد الآمن.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
