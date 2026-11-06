'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const activityPath = path.resolve(__dirname, '../app/src/main/java/com/ans/marketobservatory/MainActivity.java');
const source = fs.readFileSync(activityPath, 'utf8');

function bridgeSource(javaSource) {
  const marker = /@JavascriptInterface/;
  const match = marker.exec(javaSource);
  assert.ok(match, 'MainActivity must contain a JavaScript bridge');
  // Keep the policy scan scoped to the bridge method/class after the first exposed interface.
  return javaSource.slice(match.index);
}

function methodBodyContaining(sourceText, methodName) {
  const start = sourceText.indexOf(methodName);
  if (start < 0) return '';
  const open = sourceText.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < sourceText.length; i += 1) {
    if (sourceText[i] === '{') depth += 1;
    if (sourceText[i] === '}') {
      depth -= 1;
      if (depth === 0) return sourceText.slice(open + 1, i);
    }
  }
  return '';
}

test('جسر البيانات محصور بمضيف Binance ومسار klines وطلب GET فقط', () => {
  const bridge = bridgeSource(source);
  const request = methodBodyContaining(source, 'private JSONObject fetchKlines');
  assert.match(request, /new java\.net\.URL\(\s*"https:\/\/api\.binance\.com\/api\/v3\/klines\?/s, 'network URL should be a fixed Binance host and klines path');
  assert.match(request, /setRequestMethod\s*\(\s*"GET"\s*\)/);
  assert.match(request, /setInstanceFollowRedirects\s*\(\s*false\s*\)/, 'fixed-host requests must not follow redirects');
  assert.doesNotMatch(bridge, /String\s+(?:url|method)\b/i, 'JavaScript must not choose a URL or HTTP method');
  assert.doesNotMatch(bridge, /apiKey|secret|order|createOrder|buyMarket|sellMarket/i, 'bridge must not expose private credentials or trading operations');
});

test('إعدادات WebView تعطل وصول file URL وتمنع التنقل الخارجي', () => {
  assert.match(source, /setAllowFileAccessFromFileURLs\s*\(\s*false\s*\)/);
  assert.match(source, /setAllowUniversalAccessFromFileURLs\s*\(\s*false\s*\)/);

  const navigationMethods = [...source.matchAll(/boolean shouldOverrideUrlLoading/g)];
  assert.equal(navigationMethods.length, 2, 'both WebViewClient navigation overloads should be guarded');
  for (const match of navigationMethods) {
    const body = methodBodyContaining(source.slice(match.index), 'shouldOverrideUrlLoading');
    assert.ok(body, 'navigation callback body should be present');
    assert.match(body, /return\s+(?:true|!\s*LOCAL_ENTRY\.equals)\b/, 'external navigations should be cancelled');
    assert.match(body, /LOCAL_ENTRY|equals|https?|getHost|host|origin|startsWith|equalsIgnoreCase/i, 'navigation policy should distinguish allowed local content from external URLs');
  }
});
