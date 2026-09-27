const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست‌های رگرسیون برای باگ ذخیره‌ی کارت سوپرادمین:
// ۱) zod فیلد monthlyPrice را از بدنه حذف می‌کرد → مبلغ ماهانه هرگز ذخیره نمی‌شد
// ۲) کنترلر setCardSettings نتیجه‌ی update/create را await نمی‌کرد → پاسخ
//    «ذخیره شد» قبل از نوشتن در دیتابیس برمی‌گشت (و گاهی هیچ‌چیز ثبت نمی‌شد)
const { schemas } = require('../src/utils/validators');

test('cardSettings: monthlyPrice عدد صحیح باید پذیرفته شود (قبلاً حذف می‌شد)', () => {
  const result = schemas.cardSettings.safeParse({
    cardNumber: '6037997512345678',
    shaba: 'IR820540102680020817909002',
    holderName: 'نام صاحب کارت',
    monthlyPrice: 500000,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.monthlyPrice, 500000);
});

test('cardSettings: بدون monthlyPrice هم معتبر است (اختیاری)', () => {
  const result = schemas.cardSettings.safeParse({ cardNumber: '6037997512345678' });
  assert.equal(result.success, true);
});

test('cardSettings: monthlyPrice null باید پذیرفته شود (حذف قیمت)', () => {
  const result = schemas.cardSettings.safeParse({
    cardNumber: '6037997512345678',
    monthlyPrice: null,
  });
  assert.equal(result.success, true);
});

test('cardSettings: شماره کارت کوتاه‌تر از ۱۶ رقم باید رد شود', () => {
  const result = schemas.cardSettings.safeParse({
    cardNumber: '603799751234567',
    monthlyPrice: 500000,
  });
  assert.equal(result.success, false);
});

// نرمال‌سازی شماره کارت در کنترلر — با فاصله هم باید ۱۶ رقم تمیز شود
test('cardSettings: شماره کارت با فاصله قبول است (نرمال‌سازی در کنترلر)', () => {
  const result = schemas.cardSettings.safeParse({
    cardNumber: '6037 9975 1234 5678',
  });
  assert.equal(result.success, true);
});
