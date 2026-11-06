package com.drak.marketbot

import android.app.Activity
import android.os.Bundle
import android.os.Vibrator
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.security.KeyStore
import java.util.concurrent.Executors

/** Local DRAK paper lab. The only network path is the narrow public-market bridge. */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val networkWorker = Executors.newFixedThreadPool(2)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        removeLegacyTradingCredentials()

        window.statusBarColor = android.graphics.Color.rgb(16, 20, 17)
        window.navigationBarColor = android.graphics.Color.rgb(16, 20, 17)

        webView = WebView(this).apply {
            setBackgroundColor(android.graphics.Color.rgb(16, 20, 17))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                // The HTML cannot fetch arbitrary network resources. Public Binance reads
                // are performed only by BinanceMarketBridge using its fixed HTTPS host.
                blockNetworkLoads = true
                safeBrowsingEnabled = true
            }
            addJavascriptInterface(
                BinanceMarketBridge(
                    webView = this,
                    worker = networkWorker,
                    vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator
                ),
                "DrakBridge"
            )
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    val isLocalAsset = uri.scheme == "file" && uri.host.isNullOrEmpty() &&
                        uri.path?.startsWith("/android_asset/") == true
                    return !isLocalAsset
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")
    }

    /** Remove encrypted credentials left by earlier builds; local paper history is migrated in app.js. */
    private fun removeLegacyTradingCredentials() {
        runCatching {
            getSharedPreferences("drak_secure", MODE_PRIVATE).edit().clear().commit()
        }
        runCatching {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            if (keyStore.containsAlias("drak_api_credentials_v1")) {
                keyStore.deleteEntry("drak_api_credentials_v1")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("DrakBridge")
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
        networkWorker.shutdownNow()
        super.onDestroy()
    }
}
