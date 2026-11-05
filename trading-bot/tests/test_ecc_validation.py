import ast
import math
from pathlib import Path

import pytest

from drakbot.api import (
    PUBLIC_BASE_URL,
    fetch_min_notional,
    fetch_spot_klines,
    read_candles_csv,
)
from drakbot.cli import _args
from drakbot.config import StrategyConfig


@pytest.mark.parametrize(
    "field,value",
    [
        ("initial_capital", math.nan),
        ("min_notional", math.inf),
        ("stop_atr_multiple", math.inf),
        ("reward_risk_ratio", math.nan),
        ("train_fraction", math.nan),
    ],
)
def test_config_rejects_non_finite_numeric_values(field, value):
    config = StrategyConfig(**{field: value})
    with pytest.raises(ValueError, match=field):
        config.validate()


@pytest.mark.parametrize(
    "field,value",
    [
        ("ema_fast", 0),
        ("rsi_period", 0),
        ("macd_signal", 0),
        ("volume_period", -1),
        ("htf_ema_fast", 1.5),
        ("max_hold_bars", True),
        ("max_trades_per_day", 1.5),
    ],
)
def test_config_requires_positive_integer_periods_and_limits(field, value):
    config = StrategyConfig(**{field: value})
    with pytest.raises(ValueError, match=field):
        config.validate()


UNTRUSTED_BASE_URLS = [
    "http://data-api.binance.vision",
    "https://127.0.0.1",
    "https://data-api.binance.vision.attacker.invalid",
    "https://data-api.binance.vision:8443",
    "https://user@data-api.binance.vision",
    "https://data-api.binance.vision/private",
]


@pytest.mark.parametrize("base_url", UNTRUSTED_BASE_URLS)
@pytest.mark.parametrize("operation", ["klines", "exchange_info"])
def test_market_data_rejects_untrusted_base_url_before_network(monkeypatch, base_url, operation):
    def unexpected_request(*_args, **_kwargs):
        pytest.fail("untrusted base URL reached the HTTP client")

    monkeypatch.setattr("drakbot.api.requests.get", unexpected_request)
    with pytest.raises(ValueError, match="official public"):
        if operation == "klines":
            fetch_spot_klines("BTCUSDT", 0, 899_999, base_url=base_url)
        else:
            fetch_min_notional("BTCUSDT", base_url=base_url)


def test_cli_rejects_untrusted_api_base_url():
    with pytest.raises(SystemExit) as exc_info:
        _args(["backtest", "--api-base-url", "http://127.0.0.1"])
    assert exc_info.value.code == 2


def test_cli_keeps_the_official_public_api_base_url():
    assert _args(["backtest"]).api_base_url == PUBLIC_BASE_URL
    assert _args(["backtest", "--api-base-url", PUBLIC_BASE_URL]).api_base_url == PUBLIC_BASE_URL


def test_market_data_module_uses_only_requests_get_and_fixed_public_origin():
    api_path = Path(__file__).parents[1] / "drakbot" / "api.py"
    tree = ast.parse(api_path.read_text(encoding="utf-8"))
    request_methods = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if isinstance(node.func.value, ast.Name) and node.func.value.id == "requests":
            request_methods.append(node.func.attr)
    assert request_methods == ["get"]
    assert PUBLIC_BASE_URL == "https://data-api.binance.vision"


def test_csv_rejects_non_finite_market_data(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text(
        "open_time_ms,open,high,low,close,volume,close_time_ms\n"
        "0,nan,101,99,100,10,899999\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="finite"):
        read_candles_csv(path)


def test_environment_secret_files_are_ignored():
    ignore_file = Path(__file__).parents[1] / ".gitignore"
    patterns = set(ignore_file.read_text(encoding="utf-8").splitlines())
    assert ".env" in patterns
    assert ".env.*" in patterns
    assert "!.env.example" in patterns


def test_csv_rejects_inconsistent_15m_close_time(tmp_path):
    path = tmp_path / "wrong-duration.csv"
    path.write_text(
        "open_time_ms,open,high,low,close,volume,close_time_ms\n"
        "0,100,101,99,100,10,900000\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="15m close time"):
        read_candles_csv(path)


def test_config_rejects_inverted_higher_timeframe_emas():
    config = StrategyConfig(htf_ema_fast=50, htf_ema_slow=20)
    with pytest.raises(ValueError, match="htf_ema_fast"):
        config.validate()


@pytest.mark.parametrize("symbol", ["../outside", "BTC/USDT", "..", "BTCUSDT.csv", "https://example.invalid"])
def test_cli_rejects_symbol_that_could_escape_report_filename(symbol):
    with pytest.raises(SystemExit) as exc_info:
        _args(["backtest", "--symbol", symbol])
    assert exc_info.value.code == 2


def test_market_data_rejects_unsafe_symbol_before_network(monkeypatch):
    def unexpected_request(*_args, **_kwargs):
        pytest.fail("unsafe symbol reached the HTTP client")

    monkeypatch.setattr("drakbot.api.requests.get", unexpected_request)
    with pytest.raises(ValueError, match="symbol"):
        fetch_spot_klines("../outside", 0, 899_999)


def test_cli_normalizes_valid_symbol_to_uppercase():
    assert _args(["backtest", "--symbol", "btcusdt"]).symbol == "BTCUSDT"
