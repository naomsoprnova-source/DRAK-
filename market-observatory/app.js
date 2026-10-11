(function(){
"use strict";
const $=id=>document.getElementById(id);const fmt=(n,d=4)=>Number.isFinite(n)?n.toLocaleString("en-US",{maximumFractionDigits:d}):"غير متاح";
function row(name,value,reading){const tr=document.createElement("tr");for(const v of [name,value,reading]){const td=document.createElement("td");td.textContent=v;tr.appendChild(td)}$("indicators").appendChild(tr)}
async function run(){const btn=$("run");btn.disabled=true;$("status").textContent="جارٍ جلب بيانات السوق…";try{
const symbol=$("symbol").value.trim().toUpperCase();if(!/^[A-Z0-9]{5,20}$/.test(symbol))throw new Error("اكتب رمز زوج صحيحًا مثل BTCUSDT.");
const interval=$("interval").value;const limit=Math.max(100,Math.min(500,Number($("limit").value)||300));
const url="https://api.binance.com/api/v3/klines?symbol="+encodeURIComponent(symbol)+"&interval="+encodeURIComponent(interval)+"&limit="+limit;
const res=await fetch(url,{headers:{Accept:"application/json"}});if(!res.ok)throw new Error("تعذر جلب البيانات (HTTP "+res.status+"). تحقق من الزوج أو الاتصال.");const raw=await res.json();if(!Array.isArray(raw)||raw.length<30)throw new Error("البيانات المستلمة غير كافية.");
const now=Date.now();const rows=raw.map(k=>({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],closeTime:+k[6]})).filter(k=>k.closeTime<now);
const a=MarketEngine.analyze(rows);$("price").textContent=fmt(a.price,8)+" USDT";$("trend").textContent=a.trend;$("rsi").textContent=fmt(a.rsi,2);$("change").textContent=fmt(a.change,3)+"%";$("change").className="metric "+(a.change>=0?"good":"bad");
$("summary").textContent="القراءة الآلية: "+a.signal+". هذه إشارة وصفية وليست توقعًا مضمونًا.";
$("indicators").replaceChildren();row("المتوسط البسيط 20",fmt(a.sma20,8),a.price>a.sma20?"السعر فوقه":"السعر تحته");row("المتوسط البسيط 50",fmt(a.sma50,8),a.price>a.sma50?"السعر فوقه":"السعر تحته");row("المتوسط الأسي 20",fmt(a.ema20,8),a.price>a.ema20?"السعر فوقه":"السعر تحته");row("RSI 14",fmt(a.rsi,2),a.rsi>=70?"تشبّع شرائي محتمل":a.rsi<=30?"تشبّع بيعي محتمل":"المنطقة الوسطى");row("ATR 14",fmt(a.atr,8),"مقياس تذبذب وليس اتجاهًا");
const cap=Math.max(0,Number($("capital").value)||0),risk=Math.max(0,Math.min(5,Number($("risk").value)||0))/100,fee=Math.max(0,Number($("fee").value)||0)/100,dist=a.stopDistance;const cash=cap*risk;const qty=dist>0?cash/(dist+2*a.price*fee):NaN;$("stop").textContent=fmt(a.price-dist,8)+" USDT";$("riskCash").textContent=fmt(cash,4)+" USDT";$("qty").textContent=fmt(qty,8);$("notional").textContent=fmt(qty*a.price,4)+" USDT";
$("status").textContent="نجح الجلب: "+rows.length+" شمعة مغلقة. آخر إغلاق: "+new Date(rows.at(-1).closeTime).toLocaleString();
}catch(e){$("status").textContent=e.message||"حدث خطأ غير متوقع."}finally{btn.disabled=false}}
$("run").addEventListener("click",run);
})();