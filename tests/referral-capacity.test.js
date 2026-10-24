const { test } = require('node:test');
const assert = require('node:assert/strict');

// پرایزما در محیط تست لازم نیست؛ ماژول‌ها فقط برای توابع خالص بارگذاری می‌شوند
require.cache[require.resolve('../src/config/prisma')] = { id: 'x', filename: 'x', loaded: true, exports: {} };

const {
  drawPercent, appliedPercent, applyDiscount, MIN_PERCENT, MAX_PERCENT, PERCENT_CAP,
} = require('../src/utils/referral');
const { isStudentCountable } = require('../src/utils/capacity');
const { generateInviteCode, normalizeInviteCode } = require('../src/utils/inviteCode');

test('قرعه همیشه بین ۵ و ۱۵ است و هر دو سر بازه ممکن‌اند', () => {
  assert.equal(drawPercent(() => 5), 5);
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const n = drawPercent();
    assert.ok(n >= MIN_PERCENT && n <= MAX_PERCENT);
    seen.add(n);
  }
  assert.ok(seen.has(5) && seen.has(15));
});

test('سقف ۱۵ درصد: دعوت جدید بیشتر از جای باقیمانده نمی‌دهد', () => {
  assert.equal(PERCENT_CAP, 15);
  assert.equal(appliedPercent(10, 0), 10);
  assert.equal(appliedPercent(10, 12), 3);
  assert.equal(appliedPercent(10, 15), 0);
  assert.equal(appliedPercent(7, 20), 0);
});

test('اعمال تخفیف روی قیمت ماهانه', () => {
  assert.equal(applyDiscount(1000000, 10), 900000);
  assert.equal(applyDiscount(1000000, 0), 1000000);
  assert.equal(applyDiscount(null, 10), null);
  assert.equal(applyDiscount(333333, 15), 283333);
});

test('تعریف «دانش‌آموز فعال»: حساب فعال + اشتراک معتبر', () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);
  const base = { role: 'STUDENT', status: 'ACTIVE', institute: null };
  assert.equal(isStudentCountable({ ...base, subscription: { status: 'ACTIVE', endsAt: future } }), true);
  assert.equal(isStudentCountable({ ...base, subscription: { status: 'ACTIVE', endsAt: past } }), false);
  assert.equal(isStudentCountable({ ...base, status: 'SUSPENDED', subscription: { status: 'ACTIVE', endsAt: future } }), false);
  // اشتراک مؤسسه فعال، اشتراک فردی منقضی → همچنان فعال
  assert.equal(
    isStudentCountable({ ...base, subscription: { status: 'EXPIRED', endsAt: past }, institute: { subscription: { status: 'ACTIVE', endsAt: future } } }),
    true
  );
  // بدون هیچ رکورد اشتراک → سازگاری با عقب (فعال)
  assert.equal(isStudentCountable({ ...base, subscription: null }), true);
});

test('کد دعوت: ۸ نویسه‌ی بی‌ابهام و نرمال‌سازی ورودی', () => {
  for (let i = 0; i < 200; i += 1) assert.match(generateInviteCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(normalizeInviteCode(' ab2cd3ef '), 'AB2CD3EF');
  assert.equal(normalizeInviteCode('x'), null);
  assert.equal(normalizeInviteCode('ab-12'), null);
});
