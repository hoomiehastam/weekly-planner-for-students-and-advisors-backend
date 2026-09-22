const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست‌های واحد برای اعتبارسنجی سؤالات آزمون و محاسبه‌ی مهلت
const { validateQuestions, getDeadline } = require('../src/utils/examValidation');

test('validateQuestions: آرایه‌ی خالی باید خطا بدهد', () => {
  assert.throws(() => validateQuestions([]), /حداقل یک سؤال/);
  assert.throws(() => validateQuestions(null), /حداقل یک سؤال/);
  assert.throws(() => validateQuestions(undefined), /حداقل یک سؤال/);
});

test('validateQuestions: نوع سؤال نامعتبر را رد می‌کند', () => {
  assert.throws(
    () => validateQuestions([{ type: 'ESSAY', text: 'چی؟' }]),
    /نوع سؤال 1 معتبر نیست/
  );
});

test('validateQuestions: سؤال بدون متن و عکس باید خطا بدهد', () => {
  assert.throws(
    () => validateQuestions([{ type: 'MULTIPLE_CHOICE', options: 'الف|ب' }]),
    /باید متن یا عکس داشته باشد/
  );
});

test('validateQuestions: تعداد گزینه‌های نامعتبر را رد می‌کند', () => {
  assert.throws(
    () =>
      validateQuestions([
        { type: 'MULTIPLE_CHOICE', text: 'س', options: 'فقط یک گزینه', correctOption: 1 },
      ]),
    /بین ۲ تا ۶ گزینه/
  );
});

test('validateQuestions: گزینه‌ی صحیح خارج از بازه را رد می‌کند', () => {
  assert.throws(
    () =>
      validateQuestions([
        { type: 'MULTIPLE_CHOICE', text: 'س', options: 'الف|ب|ج', correctOption: 9 },
      ]),
    /گزینه‌ی صحیح سؤال 1 معتبر نیست/
  );
});

test('validateQuestions: سؤال تستی معتبر را آماده می‌کند', () => {
  const result = validateQuestions([
    {
      type: 'MULTIPLE_CHOICE',
      text: '  معنی جبر چیست؟  ',
      options: ' الف | ب | ج ز',
      correctOption: 2,
      points: 3,
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'معنی جبر چیست؟');
  assert.equal(result[0].correctOption, 2);
  assert.equal(result[0].points, 3);
  assert.equal(result[0].order, 0);
});

test('validateQuestions: سؤال تشریحی فقط با عکس قبول می‌شود', () => {
  const result = validateQuestions([
    { type: 'DESCRIPTIVE', imageUrl: 'data:image/png;base64,xxx' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'DESCRIPTIVE');
});

test('validateQuestions: چند سؤال با ترتیب درست آماده می‌شود', () => {
  const result = validateQuestions([
    { type: 'DESCRIPTIVE', text: 'یک' },
    { type: 'MULTIPLE_CHOICE', text: 'دو', options: 'الف|ب|ج|د', correctOption: 1 },
  ]);
  assert.equal(result[0].order, 0);
  assert.equal(result[1].order, 1);
});

test('getDeadline: مهلت برابر شروع + مدت است', () => {
  const startedAt = new Date('2026-09-15T10:00:00Z');
  const exam = { durationMinutes: 90 };
  const deadline = getDeadline({ startedAt }, exam);
  assert.equal(deadline.toISOString(), '2026-09-15T11:30:00.000Z');
});

test('getDeadline: مدت صفر، مهلت همان لحظه است', () => {
  const startedAt = new Date('2026-09-15T10:00:00Z');
  const deadline = getDeadline({ startedAt }, { durationMinutes: 0 });
  assert.equal(deadline.toISOString(), startedAt.toISOString());
});