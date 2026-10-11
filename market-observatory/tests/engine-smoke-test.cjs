const assert=require("node:assert/strict");require("../engine.js");const E=global.MarketEngine;
const closes=Array.from({length:80},(_,i)=>100+i);const candles=closes.map((close,i)=>({open:close-.2,high:close+1,low:close-1,close,volume:100,time:i}));
assert.equal(E.sma(closes,5),177);assert.ok(E.ema(closes,20)>0);assert.ok(E.rsi(closes)>99);assert.ok(E.atr(candles)>0);
const result=E.analyze(candles);assert.equal(result.price,179);assert.equal(result.trend,"صاعد");assert.ok(Number.isFinite(result.stopDistance));
assert.throws(()=>E.analyze([]));console.log("نجحت جميع اختبارات المحرك الأساسية.");