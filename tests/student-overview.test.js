const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toStudentOverview } = require('../src/controllers/admin.controller');

// رگرسیون: پنل سوپرادمین وضعیت اشتراک و مبلغ ماهانه‌ی هر دانش‌آموز را از
// GET /api/admin/students می‌خواند. اگر نگاشتِ ردیف این دو فیلد را برندارد، پنل
// بی‌صدا همیشه «بدون اشتراک» نشان می‌دهد و تغییرِ وضعیت اشتراک دیده نمی‌شود —
// در حالی که سوپرادمین فکر می‌کند ذخیره شده. این تست جلوی برگشتش را می‌گیرد.

function row(overrides = {}) {
  return {
    id: 'stu1',
    fullName: 'زهرا احمدی',
    email: 'zahra@example.com',
    phone: '09120000000',
    bio: null,
    field: 'HUMANITIES',
    status: 'ACTIVE',
    photoUrl: null,
    createdAt: new Date('2026-01-01'),
    institute: null,
    subscription: { status: 'TRIAL', tier: 'STANDARD', endsAt: new Date('2026-02-01') },
    monthlyPrice: 250000,
    asStudentLinks: [],
    ...overrides,
  };
}

test('اشتراک و مبلغ ماهانه در پاسخ فهرست دانش‌آموزان برمی‌گردد', () => {
  const out = toStudentOverview(row());
  assert.equal(out.subscription.status, 'TRIAL');
  assert.equal(out.subscription.tier, 'STANDARD');
  assert.equal(out.monthlyPrice, 250000);
});

test('تغییر وضعیت اشتراک بلافاصله در نگاشت دیده می‌شود', () => {
  const before = toStudentOverview(row({ subscription: { status: 'TRIAL', tier: 'STANDARD', endsAt: new Date('2026-02-01') } }));
  const after = toStudentOverview(row({ subscription: { status: 'ACTIVE', tier: 'STANDARD', endsAt: new Date('2026-03-01') } }));
  assert.equal(before.subscription.status, 'TRIAL');
  assert.equal(after.subscription.status, 'ACTIVE');
});

test('دانش‌آموز بدون اشتراک/قیمت، null برمی‌گرداند نه undefined جاافتاده', () => {
  const out = toStudentOverview(row({ subscription: null, monthlyPrice: null }));
  assert.equal(out.subscription, null);
  assert.equal(out.monthlyPrice, null);
  // کلید باید وجود داشته باشد تا فرانت بتواند به آن تکیه کند
  assert.ok('subscription' in out);
  assert.ok('monthlyPrice' in out);
});

test('مشاور فعال از لینک ACTIVE و مشاور در انتظار از لینک PENDING خوانده می‌شود', () => {
  const advisor = { id: 'adv1', fullName: 'آقای رضایی', role: 'ADVISOR' };
  const pending = { id: 'adv2', fullName: 'خانم کریمی', role: 'ADVISOR' };
  const out = toStudentOverview(row({
    asStudentLinks: [
      { status: 'REJECTED', createdAt: new Date('2026-01-05'), advisor: { id: 'adv3', fullName: 'ردشده', role: 'ADVISOR' } },
      { status: 'ACTIVE', createdAt: new Date('2026-01-10'), advisor },
      { status: 'PENDING', createdAt: new Date('2026-01-15'), advisor: pending },
    ],
  }));
  assert.equal(out.advisor.id, 'adv1');
  assert.equal(out.pendingAdvisor.id, 'adv2');
});

test('دانش‌آموز بدون لینک، مشاور null می‌گیرد و خطا نمی‌دهد', () => {
  const out = toStudentOverview(row());
  assert.equal(out.advisor, null);
  assert.equal(out.pendingAdvisor, null);
  assert.equal(out.linkCreatedAt, null);
});
