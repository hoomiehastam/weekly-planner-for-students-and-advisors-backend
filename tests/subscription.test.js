const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isSubscriptionActive,
  hasEffectiveAccess,
  effectiveAccessInfo,
  remainingInstituteCapacity,
  CAPACITY_ERROR,
} = require('../src/utils/subscription');

const now = Date.now();
const daysFromNow = (d) => new Date(now + d * 24 * 60 * 60 * 1000);
const past = (d) => new Date(now - d * 24 * 60 * 60 * 1000);

// ====== isSubscriptionActive ======
test('اشتراک null یعنی بدون رکورد — در سطح رکورد غیرفعال است', () => {
  assert.equal(isSubscriptionActive(null), false);
  assert.equal(isSubscriptionActive(undefined), false);
});

test('کاربر بدون هیچ رکورد اشتراکی آزاد است (سازگاری با عقب)', () => {
  assert.equal(hasEffectiveAccess({ role: 'ADVISOR' }, {}), true);
  assert.equal(hasEffectiveAccess({ role: 'STUDENT' }, { userSub: null, instituteSub: null }), true);
});

test('اشتراک با تاریخ پایان آینده فعال است؛ گذشته منقضی', () => {
  assert.equal(isSubscriptionActive({ status: 'ACTIVE', endsAt: daysFromNow(10) }), true);
  assert.equal(isSubscriptionActive({ status: 'TRIAL', endsAt: daysFromNow(1) }), true);
  assert.equal(isSubscriptionActive({ status: 'GRACE', endsAt: past(1) }), false);
  assert.equal(isSubscriptionActive({ status: 'ACTIVE', endsAt: past(1) }), false);
});

test('وضعیت EXPIRED همیشه بلاک است حتی با تاریخ آینده', () => {
  assert.equal(isSubscriptionActive({ status: 'EXPIRED', endsAt: daysFromNow(30) }), false);
});

// ====== hasEffectiveAccess ======
test('سوپرادمین همیشه دسترسی دارد', () => {
  assert.equal(hasEffectiveAccess({ role: 'SUPERADMIN' }, { userSub: { status: 'EXPIRED', endsAt: past(5) } }), true);
});

test('کاربر با اشتراک فردی فعال دسترسی دارد حتی اگر اشتراک مؤسسه منقضی باشد', () => {
  const user = { role: 'ADVISOR' };
  assert.equal(
    hasEffectiveAccess(user, {
      userSub: { status: 'ACTIVE', endsAt: daysFromNow(20) },
      instituteSub: { status: 'EXPIRED', endsAt: past(3) },
    }),
    true
  );
});

test('کاربر عضو مؤسسه با اشتراک فعال مؤسسه دسترسی دارد حتی بدون اشتراک فردی', () => {
  const user = { role: 'STUDENT', instituteId: 'inst1' };
  assert.equal(
    hasEffectiveAccess(user, {
      userSub: { status: 'ACTIVE', endsAt: past(2) },
      instituteSub: { status: 'TRIAL', endsAt: daysFromNow(5) },
    }),
    true
  );
});

test('هر دو اشتراک منقضی = قطع دسترسی', () => {
  const user = { role: 'ADVISOR' };
  assert.equal(
    hasEffectiveAccess(user, {
      userSub: { status: 'ACTIVE', endsAt: past(1) },
      instituteSub: null,
    }),
    false
  );
});

// ====== effectiveAccessInfo ======
test('اطلاعات دسترسی مؤثر: منبع و تاریخ پایان درست برمی‌گردد', () => {
  const info = effectiveAccessInfo({ role: 'STUDENT' }, {
    userSub: null,
    instituteSub: { status: 'ACTIVE', endsAt: daysFromNow(12) },
  });
  assert.equal(info.hasAccess, true);
  assert.equal(info.source, 'INSTITUTE');
  assert.equal(info.endsAt instanceof Date, true);
});

test('اطلاعات دسترسی مؤثر برای کاربر بلاک‌شده', () => {
  const info = effectiveAccessInfo({ role: 'STUDENT' }, {
    userSub: { status: 'ACTIVE', endsAt: past(4) },
    instituteSub: null,
  });
  assert.equal(info.hasAccess, false);
  assert.equal(info.source, null);
});

// ====== remainingInstituteCapacity ======
test('بدون رکورد اشتراک، ظرفیت نامحدود است', () => {
  const r = remainingInstituteCapacity(null, 'STUDENT', 100);
  assert.equal(r.ok, true);
  assert.equal(r.max, null);
});

test('سقف null یعنی بی‌نهایت', () => {
  const r = remainingInstituteCapacity({ maxStudents: null, maxAdvisors: null }, 'STUDENT', 50);
  assert.equal(r.ok, true);
  assert.equal(r.max, null);
});

test('سقف دانش‌آموز: ظرفیت باقیمانده درست محاسبه می‌شود', () => {
  const r = remainingInstituteCapacity({ maxStudents: 30, maxAdvisors: 3 }, 'STUDENT', 30);
  assert.equal(r.ok, false);
  assert.equal(r.remaining, 0);
  const r2 = remainingInstituteCapacity({ maxStudents: 30, maxAdvisors: 3 }, 'STUDENT', 29);
  assert.equal(r2.ok, true);
  assert.equal(r2.remaining, 1);
});

test('سقف مشاور مستقل از سقف دانش‌آموز چک می‌شود', () => {
  const r = remainingInstituteCapacity({ maxStudents: 100, maxAdvisors: 3 }, 'ADVISOR', 3);
  assert.equal(r.ok, false);
});

test('پیام ارتقا اشتراک در ثابت خطا هست', () => {
  assert.match(CAPACITY_ERROR, /ارتقا/);
});
