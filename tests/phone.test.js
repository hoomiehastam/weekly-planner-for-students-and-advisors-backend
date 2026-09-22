const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست‌های واحد برای نرمال‌سازی شماره تماس و توضیحات
const { normalizePhone, normalizeBio, validatePassword } = require('../src/utils/normalizers');

test('normalizePhone: مقادیر خالی را null برمی‌گرداند', () => {
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('   '), null);
});

test('normalizePhone: موبایل با ۰ حفظ می‌شود', () => {
  assert.equal(normalizePhone('09123456789'), '09123456789');
});

test('normalizePhone: موبایل بدون ۰ صفر می‌گیرد', () => {
  assert.equal(normalizePhone('9123456789'), '09123456789');
});

test('normalizePhone: ارقام فارسی تبدیل می‌شوند', () => {
  assert.equal(normalizePhone('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
});

test('normalizePhone: ارقام عربی تبدیل می‌شوند', () => {
  assert.equal(normalizePhone('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
});

test('normalizePhone: با کد کشور + و ۰۰۹۸ و ۹۸ پذیرفته می‌شود', () => {
  assert.equal(normalizePhone('+989123456789'), '09123456789');
  assert.equal(normalizePhone('00989123456789'), '09123456789');
  assert.equal(normalizePhone('989123456789'), '09123456789');
});

test('normalizePhone: تلفن ثابت با و بدون ۰', () => {
  assert.equal(normalizePhone('02112345678'), '02112345678');
  assert.equal(normalizePhone('2112345678'), '02112345678');
});

test('normalizePhone: شماره‌ی خیلی کوتاه خطا می‌دهد', () => {
  assert.throws(() => normalizePhone('0912'), /فرمت/);
});

test('normalizePhone: کد کشور اشتباه با + خطا می‌دهد', () => {
  assert.throws(() => normalizePhone('+44123456789'), /کد کشور ۹۸ نیست/);
});

test('normalizeBio: مقادیر خالی را null برمی‌گرداند', () => {
  assert.equal(normalizeBio(null), null);
  assert.equal(normalizeBio(undefined), null);
  assert.equal(normalizeBio('   '), null);
});

test('normalizeBio: متن پاک‌سازی می‌شود', () => {
  assert.equal(normalizeBio('  سلام  '), 'سلام');
});

test('normalizeBio: بیش از ۵۰۰ کاراکتر خطا می‌دهد', () => {
  assert.throws(() => normalizeBio('الف'.repeat(501)), /۵۰۰ کاراکتر/);
});

test('validatePassword: رمز کوتاه خطا می‌دهد', () => {
  assert.throws(() => validatePassword('a1'), /۸ کاراکتر/);
});

test('validatePassword: بدون حرف خطا می‌دهد', () => {
  assert.throws(() => validatePassword('12345678'), /یک حرف/);
});

test('validatePassword: بدون عدد خطا می‌دهد', () => {
  assert.throws(() => validatePassword('abcdefgh'), /یک عدد/);
});

test('validatePassword: رمز معتبر پذیرفته می‌شود', () => {
  assert.equal(validatePassword('konkur123'), 'konkur123');
});