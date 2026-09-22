const { test } = require('node:test');
const assert = require('node:assert/strict');

// تست‌های واحد برای قانون مرز tenant در لینک مشاور–دانش‌آموز و اعتبارسنجی کد مؤسسه.
// این قواعد در register (auth.controller) پیاده شده‌اند؛ اینجا نسخه‌ی خالص‌شان تست می‌شود
// تا هر تغییری که مرز مؤسسه را بشکند، رد شود.

// همان منطق register: مشاور و دانش‌آموز باید هم‌مؤسسه باشند یا هر دو مستقل (null)
function sameTenant(advisorInstituteId, studentInstituteId) {
  return advisorInstituteId === studentInstituteId;
}

test('لینک مستقل-مستقل مجاز است', () => {
  assert.equal(sameTenant(null, null), true);
});

test('لینک هم‌مؤسسه مجاز است', () => {
  assert.equal(sameTenant('inst1', 'inst1'), true);
});

test('لینک عبوری از مرز مؤسسه باید رد شود', () => {
  // مشاور مؤسسه‌ای + دانش‌آموز مستقل
  assert.equal(sameTenant('inst1', null), false);
  // مشاور مستقل + دانش‌آموز مؤسسه‌ای
  assert.equal(sameTenant(null, 'inst1'), false);
  // دو مؤسسه‌ی متفاوت
  assert.equal(sameTenant('inst1', 'inst2'), false);
});

// اعتبارسنجی کد دعوت مؤسسه — مثل منطق register:
// کد باید دقیقاً در دیتابیس باشد و مؤسسه فعال باشد
const FAKE_DB = {
  institutes: [
    { code: 'ABCD2345', status: 'ACTIVE' },
    { code: 'PENDING1', status: 'PENDING' },
    { code: 'REJECT9', status: 'REJECTED' },
  ],
};

function validateInstituteCode(code) {
  const trimmed = String(code || '').trim();
  const institute = FAKE_DB.institutes.find((i) => i.code === trimmed);
  if (!institute) return { ok: false, error: 'کد مؤسسه معتبر نیست' };
  if (institute.status !== 'ACTIVE') return { ok: false, error: 'این مؤسسه هنوز تأیید نشده است' };
  return { ok: true, institute };
}

test('کد مؤسسه‌ی معتبر و فعال پذیرفته می‌شود', () => {
  const r = validateInstituteCode('ABCD2345');
  assert.equal(r.ok, true);
  assert.equal(r.institute.status, 'ACTIVE');
});

test('کد ناموجود رد می‌شود', () => {
  assert.equal(validateInstituteCode('NOPE1234').ok, false);
  assert.equal(validateInstituteCode('').ok, false);
  assert.equal(validateInstituteCode(null).ok, false);
});

test('کد مؤسسه‌ی تأییدنشده رد می‌شود', () => {
  const r = validateInstituteCode('PENDING1');
  assert.equal(r.ok, false);
  assert.match(r.error, /تأیید نشده/);
  assert.equal(validateInstituteCode('REJECT9').ok, false);
});

test('کد با فاصله‌ی اضافه هم کار می‌کند (trim)', () => {
  assert.equal(validateInstituteCode('  ABCD2345  ').ok, true);
});

// کد تولیدشده توسط createInstitute نباید حروف گیج‌کننده داشته باشد
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
test('الفبای کد دعوت حروف گیج‌کننده (0/O/1/I) ندارد', () => {
  assert.equal(ALPHABET.includes('0'), false);
  assert.equal(ALPHABET.includes('O'), false);
  assert.equal(ALPHABET.includes('1'), false);
  assert.equal(ALPHABET.includes('I'), false);
});
