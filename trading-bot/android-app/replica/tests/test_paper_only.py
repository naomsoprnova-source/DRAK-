from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "app/src/main/java/com/drak/marketbot/MainActivity.kt"
BRIDGE = ROOT / "app/src/main/java/com/drak/marketbot/BinanceMarketBridge.kt"
MANIFEST = ROOT / "app/src/main/AndroidManifest.xml"
ASSETS = ROOT / "app/src/main/assets"
NESTED_WORKFLOW = ROOT / ".github/workflows/android-apk.yml"


class PaperOnlyBoundaryTests(unittest.TestCase):
    def test_manifest_has_only_required_network_and_optional_haptic_permissions(self):
        manifest = MANIFEST.read_text(encoding="utf-8")
        self.assertIn('android.permission.INTERNET', manifest)
        self.assertIn('android.permission.VIBRATE', manifest)
        self.assertIn('android:usesCleartextTraffic="false"', manifest)
        self.assertNotIn('android.permission.CAMERA', manifest)
        self.assertNotIn('android.permission.RECORD_AUDIO', manifest)
        self.assertIn('android:allowBackup="false"', manifest)

    def test_upgrade_removes_legacy_exchange_state_and_keystore(self):
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        native = MAIN.read_text(encoding="utf-8")
        self.assertIn("LEGACY_STORAGE_KEYS = ['drak_ui_v1', 'drak_paper_local_v2']", app)
        self.assertIn("localStorage.removeItem(key)", app)
        self.assertIn('getSharedPreferences("drak_secure"', native)
        self.assertIn('"drak_api_credentials_v1"', native)
        self.assertNotIn('WebViewLocalStorage', native)

    def test_nested_workflow_is_archived_not_executable(self):
        archived = NESTED_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("INACTIVE ARCHIVE", archived)
        self.assertNotIn("runs-on:", archived)

    def test_untrusted_local_state_uses_own_key_allowlists(self):
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        self.assertIn("Object.prototype.hasOwnProperty.call(object, key)", app)
        self.assertIn("hasOwn(STRATEGIES, settings.strategy)", app)
        self.assertIn("hasOwn(Engine.SYMBOLS, settings.symbol)", app)
        self.assertIn("hasOwn(Engine.INTERVALS, settings.interval)", app)
        self.assertIn("hasOwn(Engine.SYMBOLS, position.symbol)", app)
        self.assertIn("hasOwn(Engine.INTERVALS, position.interval)", app)
        self.assertIn("hasOwn(Engine.SYMBOLS, item.symbol)", app)
        self.assertIn("hasOwn(Engine.INTERVALS, item.interval)", app)

    def test_webview_is_local_only_and_native_bridge_is_scoped(self):
        source = MAIN.read_text(encoding="utf-8")
        self.assertIn('blockNetworkLoads = true', source)
        self.assertIn('allowUniversalAccessFromFileURLs = false', source)
        self.assertIn('allowFileAccessFromFileURLs = false', source)
        self.assertIn('MIXED_CONTENT_NEVER_ALLOW', source)
        self.assertIn('uri.scheme == "file"', source)
        self.assertIn('"DrakBridge"', source)
        bridge = BRIDGE.read_text(encoding="utf-8")
        self.assertIn('private const val API_HOST = "data-api.binance.vision"', bridge)
        self.assertIn('connection.requestMethod = "GET"', bridge)
        self.assertIn('connection.instanceFollowRedirects = false', bridge)
        self.assertIn('setOf("BTCUSDT", "ETHUSDT", "SOLUSDT")', bridge)
        self.assertIn('setOf("5m", "15m", "1h", "4h", "1d")', bridge)
        self.assertIn('/api/v3/klines', bridge)
        self.assertIn('/api/v3/ticker/price', bridge)
        self.assertIn('/api/v3/time', bridge)

    def test_native_layer_has_no_account_or_order_api_or_credentials(self):
        source = (MAIN.read_text(encoding="utf-8") + BRIDGE.read_text(encoding="utf-8"))
        forbidden = (
            "/api/v3/order", "/api/v3/account", "X-MBX-APIKEY", "HmacSHA256",
            "apiSecret", "apiKey", "POST", "PUT", "DELETE"
        )
        for marker in forbidden:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, source)

    def test_local_ui_has_no_direct_network_or_external_resources(self):
        html = (ASSETS / "index.html").read_text(encoding="utf-8")
        self.assertIn("connect-src 'none'", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("http://", html)
        self.assertIn("market-bridge.js", html)
        self.assertIn("paper-engine.js", html)
        self.assertIn("app.js", html)
        bridge_js = (ASSETS / "market-bridge.js").read_text(encoding="utf-8")
        self.assertNotIn("XMLHttpRequest", bridge_js)
        self.assertNotIn("fetch(", bridge_js)

    def test_assets_have_no_credentials_or_mutating_exchange_endpoint(self):
        for path in ASSETS.glob("*.js"):
            source = path.read_text(encoding="utf-8")
            for marker in ("/api/v3/order", "apiSecret", "apiKey", "HmacSHA256", "X-MBX-APIKEY"):
                with self.subTest(path=path.name, marker=marker):
                    self.assertNotIn(marker, source)
        engine = (ASSETS / "paper-engine.js").read_text(encoding="utf-8")
        self.assertIn("startingCapital == null ? 11", engine)
        self.assertIn("amount supports", engine.lower()) if "amount supports" in engine.lower() else None
        self.assertIn("amountInput * 100", engine)
        self.assertNotIn("generateCandles", engine)
        self.assertNotIn("Math.random", engine)

    def test_version_is_030_and_keeps_android_9_minimum(self):
        gradle = (ROOT / "app/build.gradle.kts").read_text(encoding="utf-8")
        self.assertIn('minSdk = 26', gradle)
        self.assertIn('versionCode = 3', gradle)
        self.assertIn('versionName = "0.3.0"', gradle)


if __name__ == "__main__":
    unittest.main()
