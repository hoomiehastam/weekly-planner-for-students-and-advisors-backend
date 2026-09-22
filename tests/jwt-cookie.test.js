const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست رگرسیون برای باگ «خروج واقعی انجام نمی‌شد»:
// مرورگر فقط وقتی حذف کوکی را می‌پذیرد که attributeهای آن (secure/sameSite/path)
// با همان‌هایی که موقع ست‌شدن استفاده شده‌اند یکسان باشد، و maxAge هم نباید پاس داده شود
// (پاس‌دادن maxAge کوکی را تمدید می‌کند، نه حذف).
// اگر کسی clearTokenCookie را به حالت بدون attribute برگرداند، این تست شکست می‌خورد.
const { setTokenCookie, clearTokenCookie, TOKEN_COOKIE, tokenCookieOptions } = require('../src/utils/jwt');

function makeRes() {
  const calls = { cookie: [], clearCookie: [] };
  return {
    calls,
    cookie(name, value, options) {
      calls.cookie.push({ name, value, options });
    },
    clearCookie(name, options) {
      calls.clearCookie.push({ name, options });
    },
  };
}

test('clearTokenCookie: حذف کوکی با همان attributeهای ست‌شدن (بدون maxAge)', () => {
  const res = makeRes();

  setTokenCookie(res, 'fake-token');
  clearTokenCookie(res);

  assert.equal(res.calls.cookie.length, 1);
  assert.equal(res.calls.cookie[0].name, TOKEN_COOKIE);

  assert.equal(res.calls.clearCookie.length, 1, 'clearCookie دقیقاً یک‌بار صدا زده شود');
  const { name, options } = res.calls.clearCookie[0];
  assert.equal(name, TOKEN_COOKIE, 'نام کوکی هنگام حذف باید همان نام ست‌شدن باشد');

  const expected = tokenCookieOptions();
  for (const key of Object.keys(expected)) {
    if (key === 'maxAge') continue; // maxAge نباید در حذف باشد
    assert.equal(
      options[key],
      expected[key],
      `attribute «${key}» هنگام حذف باید با مقدار ست‌شدن یکسان باشد`
    );
  }
  assert.equal(
    options.maxAge,
    undefined,
    'maxAge نباید در حذف کوکی پاس داده شود؛ وگرنه کوکی تمدید می‌شود نه حذف'
  );
});
