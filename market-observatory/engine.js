(function(root){
"use strict";
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN}
function sma(a,n){if(a.length<n)return NaN;return mean(a.slice(-n))}
function ema(a,n){if(a.length<n)return NaN;const k=2/(n+1);let v=mean(a.slice(0,n));for(let i=n;i<a.length;i++)v=a[i]*k+v*(1-k);return v}
function rsi(a,n=14){if(a.length<n+1)return NaN;let up=0,down=0;for(let i=a.length-n;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)up+=d;else down-=d}if(down===0)return up===0?50:100;const rs=(up/n)/(down/n);return 100-100/(1+rs)}
function atr(c,n=14){if(c.length<n+1)return NaN;const tr=[];for(let i=1;i<c.length;i++)tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));return mean(tr.slice(-n))}
function analyze(candles){if(!Array.isArray(candles)||candles.length<30)throw new Error("يلزم توفر 30 شمعة مغلقة على الأقل.");const close=candles.map(x=>x.close);const last=close.at(-1),prev=close.at(-2),s20=sma(close,20),s50=sma(close,50),e20=ema(close,20),rv=rsi(close),av=atr(candles);let trend="مختلط";if(last>s20&&e20>sma(close,Math.min(50,close.length)))trend="صاعد";else if(last<s20&&e20<sma(close,Math.min(50,close.length)))trend="هابط";const votes=[last>s20,last>e20,rv>50].filter(Boolean).length;let signal="انتظار";if(trend==="صاعد"&&votes>=2&&rv<70)signal="ميل صعودي غير مؤكد";if(trend==="هابط"&&votes<=1&&rv>30)signal="ميل هبوطي غير مؤكد";return{price:last,previous:prev,change:(last-prev)/prev*100,sma20:s20,sma50:s50,ema20:e20,rsi:rv,atr:av,trend,signal,stopDistance:2*av};}
root.MarketEngine={analyze,sma,ema,rsi,atr};
})(typeof globalThis!=="undefined"?globalThis:this);