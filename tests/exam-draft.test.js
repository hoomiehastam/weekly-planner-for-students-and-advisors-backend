const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExamDrafts, persianWeekday, tehranDayIndex } = require('../src/utils/examDraft');

// ظهر تهران = ۰۸:۳۰ UTC
const noon = (ymd) => `${ymd}T08:30:00.000Z`;

test('روز هفته‌ی شمسی: شنبه ۰ و جمعه ۶ (۱۴ آذر ۱۴۰۵ = شنبه ۵ دسامبر ۲۰۲۶)', () => {
  assert.equal(persianWeekday(tehranDayIndex(noon('2026-12-05'))), 0);
  assert.equal(persianWeekday(tehranDayIndex(noon('2026-12-11'))), 6);
});

test('بلوک‌ها قبل از امتحان و به تعداد بازه‌های لازم چیده می‌شوند', () => {
  const r = buildExamDrafts({
    events: [{ id: 'a', title: 'امتحان ریاضی', subject: 'ریاضی', dueAt: noon('2026-12-05'), neededSessions: 3 }],
    from: noon('2026-12-01'),
    to: noon('2026-12-12'),
  });
  assert.equal(r.weeks.length, 1);
  assert.equal(r.weeks[0].sessionCount, 3);
  // سه روز قبل از شنبه: چهارشنبه ۴، پنجشنبه ۵، جمعه ۶
  assert.deepEqual(r.weeks[0].days.map((d) => d.dayOfWeek), [4, 5, 6]);
});

test('امتحانِ بدون تخمین یک بلوک می‌گیرد و امتحانِ روز اول بازه با هشدار کنار می‌رود', () => {
  const r = buildExamDrafts({
    events: [
      { id: 'a', title: 'فیزیک', dueAt: noon('2026-12-09') },
      { id: 'b', title: 'اول بازه', dueAt: noon('2026-12-01') },
    ],
    from: noon('2026-12-01'),
    to: noon('2026-12-12'),
  });
  assert.equal(r.eventCount, 1);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /اول بازه/);
});

test('چند بلوک در یک روز همپوشانی ندارند و پشت‌سرهم با فاصله‌اند', () => {
  const events = [1, 2, 3].map((i) => ({ id: `e${i}`, title: `امتحان ${i}`, dueAt: noon('2026-12-10') }));
  const r = buildExamDrafts({ events, from: noon('2026-12-01'), to: noon('2026-12-12') });
  const day = r.weeks[0].days.find((d) => d.items.length === 3);
  assert.ok(day);
  const times = day.items.map((i) => [i.startTime, i.endTime]);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i][0] >= times[i - 1][1]);
});

test('بازه‌ی بیش از ۱۰ هفته و طول بلوک نامعتبر رد می‌شود', () => {
  assert.throws(() => buildExamDrafts({ events: [], from: noon('2026-01-01'), to: noon('2026-06-01') }), /۱۰ هفته/);
  assert.throws(() => buildExamDrafts({ events: [], from: noon('2026-12-01'), to: noon('2026-12-05'), sessionMinutes: 10 }), /۳۰ تا ۲۴۰/);
});

test('امتحان‌های دو هفته‌ی مختلف → دو پیش‌نویس جدا با بازه‌ی شنبه تا جمعه', () => {
  const r = buildExamDrafts({
    events: [
      { id: 'a', title: 'الف', dueAt: noon('2026-12-02') },
      { id: 'b', title: 'ب', dueAt: noon('2026-12-16') },
    ],
    from: noon('2026-11-28'),
    to: noon('2026-12-20'),
  });
  assert.equal(r.weeks.length, 2);
  assert.ok(r.weeks[0].expiresAt > r.weeks[0].startsAt);
  assert.ok(r.weeks[1].startsAt > r.weeks[0].expiresAt);
});
