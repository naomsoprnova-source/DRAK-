"""Command line for public-data backtests. No trading/order command exists."""
import argparse
import bisect
import hashlib
import json
import math
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import requests

from .api import PUBLIC_BASE_URL, MarketDataError, fetch_min_notional, fetch_spot_klines, read_candles_csv, write_candles_csv
from .backtest import backtest_range
from .config import StrategyConfig
from .models import Candle, iso_utc
from .strategy import BAR_MS, entry_signals

DAY_MS = 24 * 60 * 60 * 1000


def _args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="اختبار تاريخي ورقي لبيانات Binance Spot العامة؛ لا يرسل أوامر تداول."
    )
    parser.add_argument("backtest", nargs="?", choices=("backtest",), default="backtest")
    parser.add_argument("--symbol", default="BTCUSDT", help="زوج Spot، الافتراضي BTCUSDT")
    parser.add_argument("--days", type=int, default=90, help="فترة القياس، الافتراضي 90 يومًا")
    parser.add_argument("--data-csv", help="قراءة شموع 15m محفوظة بدل الاتصال بالشبكة")
    parser.add_argument("--save-data", help="حفظ الشموع الخام في CSV بعد جلبها")
    parser.add_argument("--report-dir", default="reports", help="مجلد تقارير JSON وMarkdown")
    parser.add_argument("--api-base-url", default=PUBLIC_BASE_URL, help="نقطة Binance العامة، لا تستخدم مفاتيح API")
    parser.add_argument("--capital", type=float, default=11.0, help="رأس المال الافتراضي بعملة التسعير")
    parser.add_argument("--fee-rate", type=float, default=0.001, help="رسوم كل جهة؛ الافتراضي 0.1%%")
    parser.add_argument("--slippage-rate", type=float, default=0.0005, help="انزلاق افتراضي لكل تنفيذ؛ الافتراضي 0.05%%")
    parser.add_argument("--risk-pct", type=float, default=1.0, help="المخاطرة النظرية عند الوقف كنسبة من الرصيد")
    parser.add_argument("--min-notional", type=float, help="تجاوز الحد الأدنى الحالي للزوج؛ لا يؤثر على بيانات تاريخية قديمة")
    parser.add_argument("--train-fraction", type=float, default=0.70, help="حصة الجزء الأول، الافتراضي 70%%")
    parser.add_argument("--warmup-days", type=int, default=21, help="تاريخ إضافي لتهيئة المؤشرات قبل فترة القياس")
    return parser.parse_args(argv)


def _fingerprint(candles: list[Candle]) -> str:
    digest = hashlib.sha256()
    for c in candles:
        digest.update((f"{c.open_time_ms},{c.open:.12g},{c.high:.12g},{c.low:.12g},"
                       f"{c.close:.12g},{c.volume:.12g},{c.close_time_ms}\n").encode("ascii"))
    return digest.hexdigest()


def _pretty_pct(value: float | int) -> str:
    return f"{float(value):+.4f}%"


def _markdown_report(report: dict) -> str:
    meta = report["metadata"]
    config = report["config"]
    sections = [
        f"# نتيجة الاختبار التاريخي الورقي — {meta['symbol']} ({meta['days']} يومًا)",
        "",
        f"- مصدر الشموع: {meta['data_source']}",
        f"- وقت الجلب (UTC): {meta['retrieved_at_utc']}",
        f"- فترة القياس: {meta['measurement_start_utc']} إلى {meta['measurement_end_utc']}",
        f"- الشموع: {meta['measurement_bars']} شمعة 15m؛ بصمة البيانات SHA-256: `{meta['data_sha256']}`",
        f"- تقسيم زمني: {meta['train_fraction'] * 100:.0f}% تدريب وصفي / {(1-meta['train_fraction']) * 100:.0f}% اختبار خارج العينة",
        f"- الحد الأدنى للقيمة الاسمية المستخدم: {meta['min_notional_quote']:.8g} {meta['quote_asset']} ({meta['min_notional_source']})",
        "",
        "> هذه نتائج محاكاة تاريخية على شموع OHLC، وليست ربحًا محققًا أو توقعًا للأداء المستقبلي. لا ينفّذ البرنامج أي صفقات حقيقية.",
        "",
        "## النتائج",
        "",
        "| الجزء | البداية (UTC) | النهاية (UTC) | الصفقات | صافي الرصيد | العائد | أقصى تراجع | نسبة الصفقات الرابحة | معامل الربح | الرسوم | شراء واحتفاظ للمقارنة |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, title in (("train", "التدريب"), ("out_of_sample", "خارج العينة"), ("full_period", "الفترة كاملة")):
        item = report["periods"][name]
        s = item["summary"]
        sections.append(
            f"| {title} | {item['period_start_utc']} | {item['period_end_utc']} | {s['trade_count']} | "
            f"{s['final_equity']:.6f} {meta['quote_asset']} | {_pretty_pct(s['return_pct'])} | "
            f"{s['max_drawdown_pct']:.4f}% | {s['win_rate_pct']:.2f}% | {s['profit_factor']} | {s['total_fees_quote']:.6f} | "
            f"{_pretty_pct(s['benchmark_return_pct'])} |"
        )
    sections.extend([
        "",
        "## افتراضات التنفيذ والاستراتيجية",
        "",
        f"- شراء فوري طويل فقط؛ رصيد البداية {config['initial_capital']:.2f} {meta['quote_asset']} لكل جزء منفصل.",
        f"- الدخول عند افتتاح الشمعة التالية بعد تقاطع EMA {config['ema_fast']}/{config['ema_slow']}، وRSI {config['rsi_min']:.0f}–{config['rsi_max']:.0f}، وMACD موجب، وحجم لا يقل عن متوسط {config['volume_period']} شمعة.",
        f"- فلتر الساعة: إغلاق الساعة المكتملة فوق EMA {config['htf_ema_slow']} وEMA {config['htf_ema_fast']} فوق EMA {config['htf_ema_slow']}.",
        f"- الوقف {config['stop_atr_multiple']} ATR والهدف {config['reward_risk_ratio']}R؛ لا تتجاوز المخاطرة المستهدفة {config['risk_fraction']*100:.2f}% من الرصيد لكل صفقة، ويُرفض المركز إذا كان أصغر من الحد الأدنى للقيمة الاسمية.",
        f"- رسم مفترض {config['fee_rate']*100:.3f}% وانزلاق مفترض {config['slippage_rate']*100:.3f}% في كل جهة؛ لا تمثل هذه التكاليف بالضرورة رسوم حساب أو تنفيذ المستخدم.",
        "- إذا لامس الوقف والهدف داخل الشمعة نفسها، يحتسب المحرك الوقف أولًا. الانزلاق والرسوم مفترضان، والشموع لا تحاكي عمق السوق أو التنفيذ الجزئي.",
        "- وقت الخروج المسجل عند لمس الوقف أو الهدف داخل الشمعة هو وقت إغلاق شمعة 15m؛ بيانات OHLC لا تحدد لحظة اللمس الفعلية.",
        "- فُصلت نافذتا التدريب والاختبار زمنيًا، وأُعيد رأس المال الافتراضي إلى قيمته الابتدائية في كل نافذة. لم تُجرَ عملية تحسين للمعلمات على بيانات الاختبار.",
        "- الحد الأدنى للقيمة الاسمية هو مرشح Binance الحالي وقت الجلب، وليس تاريخًا مؤرشفًا لقواعد التداول السابقة.",
        "",
        "## إعادة الإنتاج",
        "",
        "`python main.py backtest --symbol " + meta["symbol"] + " --days " + str(meta["days"]) + " --data-csv data/" + meta["data_file_name"] + " --min-notional " + str(meta["min_notional_quote"]) + "`",
        "",
        "يعتمد هذا المشروع على مواصفات أولية موصوفة للمستخدم، لذلك فالمنطق هنا افتراض تجريبي معلن لا نسخة موثقة من استراتيجية سابقة.",
    ])
    return "\n".join(sections) + "\n"


def run_backtest_command(args: argparse.Namespace) -> dict:
    if args.days < 2:
        raise ValueError("--days must be at least 2 so the 70/30 split contains both periods")
    if args.warmup_days < 1:
        raise ValueError("--warmup-days must be positive")
    config = StrategyConfig(
        initial_capital=args.capital,
        fee_rate=args.fee_rate,
        slippage_rate=args.slippage_rate,
        risk_fraction=args.risk_pct / 100.0,
        train_fraction=args.train_fraction,
    )
    config.validate()
    if args.data_csv:
        candles = read_candles_csv(args.data_csv)
        data_source = f"CSV محلي ({Path(args.data_csv).as_posix()})؛ مصدره الأصلي غير قابل للتحقق من الملف وحده"
        retrieval_time = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        now_ms = int(time.time() * 1000)
        active_end_exclusive = (now_ms // BAR_MS) * BAR_MS
        active_start_ms = active_end_exclusive - args.days * DAY_MS
        warmup_hours = math.ceil(config.htf_ema_slow * 5 / 24)
        warmup_days = max(args.warmup_days, warmup_hours + 1)
        fetch_start_ms = (active_start_ms - warmup_days * DAY_MS) // BAR_MS * BAR_MS
        candles = fetch_spot_klines(args.symbol, fetch_start_ms, active_end_exclusive - 1,
                                    interval="15m", base_url=args.api_base_url)
        retrieval_time = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        data_source = f"Binance Spot public REST: {args.api_base_url.rstrip('/')}/api/v3/klines"
        if args.save_data:
            write_candles_csv(candles, args.save_data)

    if len(candles) < 500:
        raise ValueError(f"البيانات غير كافية لتهيئة المؤشرات: وردت {len(candles)} شمعة فقط")
    if any(a.open_time_ms >= b.open_time_ms for a, b in zip(candles, candles[1:])):
        raise ValueError("candle timestamps must be strictly increasing")
    if any(b.open_time_ms - a.open_time_ms != BAR_MS for a, b in zip(candles, candles[1:])):
        raise ValueError("15m candle history has a time gap; refusing to report a backtest on incomplete data")
    active_end_exclusive = candles[-1].close_time_ms + 1
    active_start_ms = active_end_exclusive - args.days * DAY_MS
    open_times = [c.open_time_ms for c in candles]
    begin = bisect.bisect_left(open_times, active_start_ms)
    end = len(candles)
    measurement_count = end - begin
    if measurement_count < 200:
        raise ValueError(f"only {measurement_count} candles fall inside the requested measurement window")
    split = begin + max(1, min(measurement_count - 1, int(measurement_count * config.train_fraction)))

    min_notional_source = "تجاوز يدوي عبر --min-notional"
    if args.min_notional is not None:
        min_notional = args.min_notional
    elif not args.data_csv:
        try:
            min_notional = fetch_min_notional(args.symbol, base_url=args.api_base_url)
            min_notional_source = "exchangeInfo العام الحالي؛ ليس مرشحًا تاريخيًا"
        except MarketDataError as exc:
            min_notional = config.min_notional
            min_notional_source = "قيمة افتراضية 5 USDT بسبب تعذّر جلب exchangeInfo"
            print(f"تحذير: {exc}; استخدام حد أدنى افتراضي {min_notional:g}.", file=sys.stderr)
    else:
        min_notional = config.min_notional
        min_notional_source = "قيمة افتراضية 5 USDT لملف CSV دون مرشح تاريخي"
    if min_notional < 0:
        raise ValueError("--min-notional must not be negative")
    config = StrategyConfig(**{**asdict(config), "min_notional": min_notional})
    signals, atr_values = entry_signals(candles, config)

    train_result = backtest_range(candles, signals, atr_values, begin, split, config, min_notional)
    test_result = backtest_range(candles, signals, atr_values, split, end, config, min_notional)
    full_result = backtest_range(candles, signals, atr_values, begin, end, config, min_notional)
    quote_asset = "USDT" if args.symbol.upper().endswith("USDT") else "عملة التسعير"
    data_file_name = Path(args.save_data).name if args.save_data else Path(args.data_csv).name if args.data_csv else "<ملف-CSV-المحفوظ>"
    report = {
        "project": "DRAK Binance Spot paper-only backtester",
        "version": "0.2.0",
        "metadata": {
            "symbol": args.symbol.upper(), "quote_asset": quote_asset, "days": args.days,
            "data_source": data_source, "retrieved_at_utc": retrieval_time,
            "measurement_start_utc": iso_utc(candles[begin].open_time_ms),
            "measurement_end_utc": iso_utc(candles[end - 1].close_time_ms),
            "measurement_bars": measurement_count,
            "input_start_utc": iso_utc(candles[0].open_time_ms),
            "input_end_utc": iso_utc(candles[-1].close_time_ms),
            "data_sha256": _fingerprint(candles), "data_file_name": data_file_name,
            "train_fraction": config.train_fraction,
            "min_notional_quote": min_notional, "min_notional_source": min_notional_source,
            "timeframe": "15m", "higher_timeframe_filter": "1h aggregated from complete 15m bars",
            "orders_sent": 0,
        },
        "config": asdict(config),
        "periods": {
            "train": train_result.to_dict(candles),
            "out_of_sample": test_result.to_dict(candles),
            "full_period": full_result.to_dict(candles),
        },
        "caveat": "Historical OHLC paper simulation only; not evidence of future profitability. No live trading functionality.",
    }
    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{args.symbol.upper()}_{args.days}d_backtest"
    json_path = report_dir / f"{stem}.json"
    md_path = report_dir / f"{stem}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    md_path.write_text(_markdown_report(report), encoding="utf-8")
    print(json.dumps({
        "status": "completed",
        "symbol": args.symbol.upper(),
        "data_source": data_source,
        "measurement_bars": measurement_count,
        "periods": {name: {key: value for key, value in item["summary"].items()}
                    for name, item in report["periods"].items()},
        "reports": [str(json_path), str(md_path)],
        "orders_sent": 0,
        "caveat": report["caveat"],
    }, ensure_ascii=False, indent=2, allow_nan=False))
    return report


def main(argv: list[str] | None = None) -> int:
    args = _args(argv)
    try:
        run_backtest_command(args)
        return 0
    except (MarketDataError, requests.RequestException, ValueError) as exc:
        print(f"فشل الاختبار دون اختلاق نتائج: {exc}", file=sys.stderr)
        return 2
