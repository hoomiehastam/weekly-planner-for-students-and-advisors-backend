const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startOfTehranDay, endOfTehranDay, tehranDayKey, weekdayIndexOfKey, resolveStudyDay,
} = require('../src/utils/tehranDate');

test('پایان روز تهران = ۲۳:۵۹:۵۹ همان روز (۲۰:۲۹:۵۹ به وقت UTC)', () => {
  assert.equal(endOfTehranDay('2026-11-05').toISOString(), '2026-11-05T20:29:59.999Z');
  // کلاینت قدیمی ISO نیمه‌شبِ UTC می‌فرستاد؛ همان روزِ نوشته‌شده ملاک است
  assert.equal(endOfTehranDay('2026-11-05T00:00:00.000Z').toISOString(), '2026-11-05T20:29:59.999Z');
});

test('شروع روز تهران = ۰۰:۰۰ همان روز (۲۰:۳۰ روز قبل به وقت UTC)', () => {
  assert.equal(startOfTehranDay('2026-11-05').toISOString(), '2026-11-04T20:30:00.000Z');
});

test('برنامه‌ای که تا ۱۴ آبان ست شده، ظهر و شبِ همان روز هنوز فعال است', () => {
  const expiresAt = endOfTehranDay('2026-11-05');
  const noon = new Date('2026-11-05T08:30:00Z'); // ۱۲:۰۰ تهران
  const night = new Date('2026-11-05T20:00:00Z'); // ۲۳:۳۰ تهران
  const nextMorning = new Date('2026-11-05T20:31:00Z'); // ۰۰:۰۱ فردا
  assert.ok(expiresAt >= noon);
  assert.ok(expiresAt >= night);
  assert.ok(expiresAt < nextMorning);
});

test('روز هفته: شنبه=۰ و جمعه=۶', () => {
  assert.equal(weekdayIndexOfKey('2026-10-31'), 0); // شنبه
  assert.equal(weekdayIndexOfKey('2026-11-01'), 1); // یکشنبه
  assert.equal(weekdayIndexOfKey('2026-11-06'), 6); // جمعه
});

test('دوشنبه ساعتِ یکشنبه را ثبت می‌کند ← برای یکشنبه ثبت شود', () => {
  const startsAt = startOfTehranDay('2026-10-31'); // شنبه
  const monday = new Date('2026-11-02T10:00:00Z');
  assert.equal(resolveStudyDay({ startsAt, dayOfWeek: 1, now: monday }), '2026-11-01');
  assert.equal(resolveStudyDay({ startsAt, dayOfWeek: 2, now: monday }), '2026-11-02');
});

test('روزی که هنوز نرسیده به آینده نمی‌رود', () => {
  const startsAt = startOfTehranDay('2026-11-02'); // دوشنبه
  const monday = new Date('2026-11-02T10:00:00Z');
  assert.equal(resolveStudyDay({ startsAt, dayOfWeek: 5, now: monday }), '2026-11-02');
});

test('امروز نسبت به تهران حساب می‌شود (۰۰:۱۰ بامداد تهران هنوز UTC روز قبل است)', () => {
  assert.equal(tehranDayKey(new Date('2026-11-01T20:40:00Z')), '2026-11-02');
});
