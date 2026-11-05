from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "app/src/main/java/com/drak/marketbot/MainActivity.kt"
MANIFEST = ROOT / "app/src/main/AndroidManifest.xml"
ASSETS = ROOT / "app/src/main/assets"
NESTED_WORKFLOW = ROOT / ".github/workflows/android-apk.yml"


class PaperOnlyBoundaryTests(unittest.TestCase):
    def test_manifest_has_no_network_or_vibration_permissions(self):
        manifest = MANIFEST.read_text(encoding="utf-8")
        self.assertNotIn("android.permission.INTERNET", manifest)
        self.assertNotIn("android.permission.VIBRATE", manifest)

    def test_upgrade_removes_legacy_exchange_state_and_key_store(self):
        app = (ASSETS / "app.js").read_text(encoding="utf-8")
        native = MAIN.read_text(encoding="utf-8")
        self.assertIn("LEGACY_STORAGE_KEY = 'drak_ui_v1'", app)
        self.assertIn("localStorage.removeItem(LEGACY_STORAGE_KEY)", app)
        self.assertIn('getSharedPreferences("drak_secure"', native)
        self.assertIn('"drak_api_credentials_v1"', native)

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

    def test_native_shell_has_no_bridge_http_or_exchange_order_code(self):
        source = MAIN.read_text(encoding="utf-8")
        forbidden = (
            "@JavascriptInterface",
            "HttpURLConnection",
            "HttpsURLConnection",
            "BinanceApi",
            "SecureStore",
            "HmacSHA256",
            "/api/v3/order",
            "X-MBX-APIKEY",
        )
        for marker in forbidden:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, source)

    def test_local_ui_blocks_all_connections_and_has_no_external_resources(self):
        html = (ASSETS / "index.html").read_text(encoding="utf-8")
        self.assertIn("connect-src 'none'", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("http://", html)
        self.assertIn("paper-engine.js", html)
        self.assertIn("app.js", html)

    def test_assets_contain_no_credentials_or_exchange_endpoint(self):
        for path in ASSETS.glob("*.js"):
            source = path.read_text(encoding="utf-8")
            for marker in ("api.binance.com", "testnet.binance", "/api/v3/order", "apiSecret", "apiKey"):
                with self.subTest(path=path.name, marker=marker):
                    self.assertNotIn(marker, source)


if __name__ == "__main__":
    unittest.main()
