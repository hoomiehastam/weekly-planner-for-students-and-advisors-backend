const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست‌های رگرسیون برای اعتبارسنجی شناسه‌ها و OTP
//
// باگ اصلی که این تست‌ها جلوی بازگشتش را می‌گیرند:
// شناسه‌های Prisma از نوع cuid هستند (مثل "cmf3xyz12345abc")، ولی قبلاً
// با z.string().uuid() اعتبارسنجی می‌شدند که همیشه رد می‌شد. نتیجه:
//   ۱) ثبت‌نام دانش‌آموز با انتخاب مشاور → خطای «شناسه‌ی مشاور نامعتبر است»
//   ۲) ذخیره‌ی پاسخ‌های آزمون → خطای 400 و گم‌شدن همه‌ی پاسخ‌ها
//   ۳) ارسال یادآور توسط مشاور → خطای «شناسه‌ی دانش‌آموز نامعتبر است»
const { schemas } = require('../src/utils/validators');

const CUID = 'cmf3xq8k9m2v4b6n8z0c1d3e5'; // فرمت شناسه‌ی Prisma (cuid)

test('register: advisorId به‌صورت cuid باید پذیرفته شود', () => {
  const result = schemas.register.safeParse({
    fullName: 'دانش‌آموز تست',
    email: 'student@example.com',
    password: 'Passw0rd123',
    role: 'STUDENT',
    field: 'EXPERIMENTAL',
    advisorId: CUID,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.advisorId, CUID);
});

test('register: advisorId نامعتبر (فارسی/فاصله) باید رد شود', () => {
  const result = schemas.register.safeParse({
    fullName: 'دانش‌آموز تست',
    email: 'student@example.com',
    password: 'Passw0rd123',
    role: 'STUDENT',
    field: 'EXPERIMENTAL',
    advisorId: 'شناسه نامعتبر',
  });
  assert.equal(result.success, false);
});

test('saveAnswer: questionId به‌صورت cuid باید پذیرفته شود', () => {
  const result = schemas.saveAnswer.safeParse({
    questionId: CUID,
    selectedOption: 3,
    textAnswer: null,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.selectedOption, 3);
});

test('saveAnswer: پاسخ تشریحی بدون گزینه باید پذیرفته شود', () => {
  const result = schemas.saveAnswer.safeParse({
    questionId: CUID,
    selectedOption: null,
    textAnswer: 'پاسخ تشریحی دانش‌آموز',
  });
  assert.equal(result.success, true);
});

test('saveAnswer: شماره‌ی گزینه‌ی خارج از بازه باید رد شود', () => {
  const result = schemas.saveAnswer.safeParse({
    questionId: CUID,
    selectedOption: 0,
  });
  assert.equal(result.success, false);
});

test('reminder: studentId به‌صورت cuid باید پذیرفته شود', () => {
  const result = schemas.reminder.safeParse({
    studentId: CUID,
    message: 'یادآور تست',
  });
  assert.equal(result.success, true);
});

test('otpRequest: ایمیل معتبر باید پذیرفته شود', () => {
  const result = schemas.otpRequest.safeParse({ email: 'user@example.com' });
  assert.equal(result.success, true);
});

test('otpRequest: ایمیل نامعتبر باید رد شود', () => {
  const result = schemas.otpRequest.safeParse({ email: 'not-an-email' });
  assert.equal(result.success, false);
});

test('otpLogin: کد عددی ۶ رقمی باید پذیرفته شود', () => {
  const result = schemas.otpLogin.safeParse({
    email: 'user@example.com',
    otp: '123456',
  });
  assert.equal(result.success, true);
});
