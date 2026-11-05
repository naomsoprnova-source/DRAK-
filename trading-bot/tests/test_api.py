import pytest

import drakbot.api as api


def _response(status_code, payload=None, headers=None):
    class Response:
        def __init__(self):
            self.status_code = status_code
            self.headers = headers or {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise api.requests.HTTPError(f"HTTP {self.status_code}")

        def json(self):
            return payload

    return Response()


def _kline(open_time_ms, price):
    step = api.INTERVAL_MS["15m"]
    return [open_time_ms, str(price), str(price + 1), str(price - 1),
            str(price), "10", open_time_ms + step - 1]


def test_get_json_retries_rate_limit_and_uses_no_redirects(monkeypatch):
    replies = [
        _response(429, headers={"Retry-After": "0"}),
        _response(200, {"ok": True}),
    ]
    calls = []
    sleeps = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return replies.pop(0)

    monkeypatch.setattr(api.requests, "get", fake_get)
    monkeypatch.setattr(api.time, "sleep", sleeps.append)
    result = api._get_json(f"{api.PUBLIC_BASE_URL}/api/v3/klines", {"symbol": "BTCUSDT"})

    assert result == {"ok": True}
    assert len(calls) == 2
    assert calls[0][0] == f"{api.PUBLIC_BASE_URL}/api/v3/klines"
    assert all(call[1].get("allow_redirects") is False for call in calls)
    assert sleeps == [0.0]


def test_get_json_stops_after_three_rate_limit_responses(monkeypatch):
    calls = []
    sleeps = []

    def fake_get(_url, **_kwargs):
        calls.append(1)
        return _response(429, headers={"Retry-After": "0"})

    monkeypatch.setattr(api.requests, "get", fake_get)
    monkeypatch.setattr(api.time, "sleep", sleeps.append)
    with pytest.raises(api.MarketDataError, match="rate limit"):
        api._get_json(f"{api.PUBLIC_BASE_URL}/api/v3/klines", {})

    assert len(calls) == 3
    assert sleeps == [0.0, 0.0]


def test_get_json_rejects_redirect_response(monkeypatch):
    observed = {}

    def fake_get(_url, **kwargs):
        observed.update(kwargs)
        return _response(302, {"unexpected": "redirect"}, {"Location": "http://127.0.0.1/"})

    monkeypatch.setattr(api.requests, "get", fake_get)
    with pytest.raises(api.MarketDataError, match="redirect"):
        api._get_json(f"{api.PUBLIC_BASE_URL}/api/v3/klines", {})
    assert observed.get("allow_redirects") is False


def test_fetch_klines_paginates_sorted_complete_public_data(monkeypatch):
    step = api.INTERVAL_MS["15m"]
    monkeypatch.setattr(api, "KLINE_LIMIT", 2)
    replies = [
        _response(200, [_kline(0, 100), _kline(step, 101)]),
        _response(200, [_kline(2 * step, 102)]),
    ]
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return replies.pop(0)

    monkeypatch.setattr(api.requests, "get", fake_get)
    monkeypatch.setattr(api.time, "sleep", lambda _delay: None)
    candles = api.fetch_spot_klines("BTCUSDT", 0, 3 * step - 1)

    assert [c.open_time_ms for c in candles] == [0, step, 2 * step]
    assert [call[1]["params"]["startTime"] for call in calls] == [0, 2 * step]
    assert all(call[0].startswith(api.PUBLIC_BASE_URL + "/api/v3/klines") for call in calls)
    assert all(call[1].get("allow_redirects") is False for call in calls)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/api/v3/klines",
        "https://data-api.binance.vision.attacker.invalid/api/v3/klines",
        "https://data-api.binance.vision/private/api/v3/klines",
    ],
)
def test_get_json_rejects_untrusted_destination_before_network(monkeypatch, url):
    def unexpected_request(*_args, **_kwargs):
        pytest.fail("untrusted destination reached the HTTP client")

    monkeypatch.setattr(api.requests, "get", unexpected_request)
    with pytest.raises(ValueError, match="official public"):
        api._get_json(url, {})


def test_fetch_klines_rejects_wrong_interval_close_time(monkeypatch):
    row = _kline(0, 100)
    row[-1] += 1

    def fake_get(_url, **_kwargs):
        return _response(200, [row])

    monkeypatch.setattr(api.requests, "get", fake_get)
    with pytest.raises(api.MarketDataError, match="candle duration"):
        api.fetch_spot_klines("BTCUSDT", 0, api.INTERVAL_MS["15m"] - 1)


def test_fetch_klines_rejects_open_time_not_aligned_to_interval(monkeypatch):
    row = _kline(1, 100)

    def fake_get(_url, **_kwargs):
        return _response(200, [row])

    monkeypatch.setattr(api.requests, "get", fake_get)
    with pytest.raises(api.MarketDataError, match="open time"):
        api.fetch_spot_klines("BTCUSDT", 0, api.INTERVAL_MS["15m"])
