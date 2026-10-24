const crypto = require('crypto');
const prisma = require('../config/prisma');

// ====== تخفیف دعوت دوست ======
// - عدد تصادفی ۵ تا ۱۵ درصد (برای هر دعوت یک‌بار، برابر برای هر دو طرف)
// - فعال‌سازی: بعد از اولین پرداخت تأییدشده‌ی دعوت‌شده
// - اعتبار: ۳۶۵ روز از لحظه‌ی فعال‌سازی هر تخفیف
// - سقف مجموع تخفیف فعال هر دانش‌آموز: ۱۵ درصد (دعوت بعدی بالاتر نمی‌برد)
const MIN_PERCENT = 5;
const MAX_PERCENT = 15;
const PERCENT_CAP = 15;
const VALID_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function drawPercent(randomInt = crypto.randomInt) {
  return randomInt(MIN_PERCENT, MAX_PERCENT + 1);
}

// درصدی که واقعاً به یک طرف داده می‌شود: min(قرعه، جای باقیمانده تا سقف)
function appliedPercent(drawn, currentActive) {
  return Math.max(0, Math.min(drawn, PERCENT_CAP - Math.max(0, currentActive || 0)));
}

// قیمت بعد از تخفیف (گرد به تومان)
function applyDiscount(price, percent) {
  if (price == null) return null;
  if (!percent) return price;
  return Math.round((price * (100 - percent)) / 100);
}

// مجموع درصد تخفیف فعال و نامنقضی یک کاربر (حداکثر سقف)
async function getActiveDiscountPercent(userId, db = prisma, now = new Date()) {
  const rows = await db.referral.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { gt: now },
      OR: [{ inviterId: userId }, { inviteeId: userId }],
    },
    select: { inviterId: true, inviterPercent: true, inviteePercent: true, expiresAt: true },
  });
  const sum = rows.reduce(
    (s, r) => s + (r.inviterId === userId ? r.inviterPercent || 0 : r.inviteePercent || 0),
    0
  );
  return Math.min(PERCENT_CAP, sum);
}

// فهرست تخفیف‌های فعال + دعوت‌های در انتظار یک دانش‌آموز (برای نمایش در پنل خودش)
async function getReferralSummary(userId, db = prisma, now = new Date()) {
  const rows = await db.referral.findMany({
    where: { OR: [{ inviterId: userId }, { inviteeId: userId }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, inviterId: true, status: true, drawnPercent: true,
      inviterPercent: true, inviteePercent: true, activatedAt: true, expiresAt: true, createdAt: true,
      invitee: { select: { fullName: true } },
      inviter: { select: { fullName: true } },
    },
  });
  const items = rows.map((r) => {
    const mine = r.inviterId === userId;
    const active = r.status === 'ACTIVE' && r.expiresAt && r.expiresAt > now;
    return {
      id: r.id,
      role: mine ? 'INVITER' : 'INVITEE',
      otherName: mine ? r.invitee.fullName : r.inviter.fullName,
      status: r.status === 'ACTIVE' && !active ? 'EXPIRED' : r.status,
      percent: r.status === 'ACTIVE' ? (mine ? r.inviterPercent : r.inviteePercent) : null,
      activatedAt: r.activatedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    };
  });
  const percent = Math.min(
    PERCENT_CAP,
    items.filter((i) => i.status === 'ACTIVE').reduce((s, i) => s + (i.percent || 0), 0)
  );
  return { percent, cap: PERCENT_CAP, min: MIN_PERCENT, max: MAX_PERCENT, items };
}

// آیا برنامه‌ی تخفیف برای این مشاور/مؤسسه روشن است؟ (مشاور مؤسسه‌ای → هر دو باید روشن باشند)
async function isReferralEnabledForAdvisor(advisorId, db = prisma) {
  const advisor = await db.user.findUnique({
    where: { id: advisorId },
    select: { referralEnabled: true, institute: { select: { referralEnabled: true } } },
  });
  if (!advisor) return false;
  if (advisor.referralEnabled === false) return false;
  if (advisor.institute && advisor.institute.referralEnabled === false) return false;
  return true;
}

// ساخت رکورد دعوت هنگام ثبت‌نام دعوت‌شده (وضعیت PENDING تا اولین پرداخت تأییدشده)
async function createReferral(inviterId, inviteeId, db = prisma) {
  return db.referral.create({
    data: { inviterId, inviteeId, drawnPercent: drawPercent(), status: 'PENDING' },
  });
}

// بعد از تأیید پرداخت یک کاربر صدا زده می‌شود؛ اگر او دعوت‌شده‌ی یک دعوت PENDING باشد، فعالش می‌کند.
// برمی‌گرداند: null یا { inviterPercent, inviteePercent, expiresAt }
async function activateReferralForPayer(userId, db = prisma, now = new Date()) {
  const ref = await db.referral.findUnique({ where: { inviteeId: userId } });
  if (!ref || ref.status !== 'PENDING') return null;

  const [inviterNow, inviteeNow] = await Promise.all([
    getActiveDiscountPercent(ref.inviterId, db, now),
    getActiveDiscountPercent(ref.inviteeId, db, now),
  ]);
  const inviterPercent = appliedPercent(ref.drawnPercent, inviterNow);
  const inviteePercent = appliedPercent(ref.drawnPercent, inviteeNow);
  const expiresAt = new Date(now.getTime() + VALID_DAYS * DAY_MS);

  await db.referral.update({
    where: { id: ref.id },
    data: { status: 'ACTIVE', inviterPercent, inviteePercent, activatedAt: now, expiresAt },
  });
  return { inviterPercent, inviteePercent, expiresAt };
}

module.exports = {
  MIN_PERCENT, MAX_PERCENT, PERCENT_CAP, VALID_DAYS,
  drawPercent, appliedPercent, applyDiscount,
  getActiveDiscountPercent, getReferralSummary,
  isReferralEnabledForAdvisor, createReferral, activateReferralForPayer,
};
