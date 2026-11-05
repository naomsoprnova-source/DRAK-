package com.drak.marketbot

import android.app.Activity
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.security.KeyStore

/** Local-only host for the DRAK paper simulator. It intentionally exposes no native bridge. */
class MainActivity : Activity() {
    private lateinit var webView: WebView

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
                blockNetworkLoads = true
                safeBrowsingEnabled = true
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    return uri.scheme != "file" || uri.path?.startsWith("/android_asset/") != true
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")
    }

    /** Remove encrypted API data left by the previous live-trading build on upgrade. */
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

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
        super.onDestroy()
    }
}
