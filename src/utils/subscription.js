// ====== منطق اشتراک: دسترسی مؤثر و محدودیت اعضای مؤسسه ======
// قانون کلی: دسترسی هر کاربر = اشتراک مؤسسه‌اش فعال «یا» اشتراک فردی‌اش فعال.
// تاریخ‌ها هر بار در لحظه‌ی چک محاسبه می‌شوند (lazy)؛ هیچ cron لازم نیست:
// اگر endsAt گذشته باشد، همان لحظه دسترسی قطع است. تمدید یعنی endsAt جلو برود.

// آیا یک رکورد اشتراک (UserSubscription یا InstituteSubscription) فعال است؟
// TRIAL و ACTIVE و GRACE (رواداری بعد از انقضا) همه تا endsAt دسترسی می‌دهند؛
// EXPIRED هرگز. null (بدون رکورد) در این سطح یعنی «رکوردی نیست» و false است؛
// قانون سازگاری با عقب (هیچ رکوردی = آزاد) در سطح hasEffectiveAccess اعمال می‌شود.
// واقعیت منبع حقیقت، مقایسه‌ی endsAt با الان است — پس تمدید یعنی جلو بردن endsAt
// و انقضا خودبه‌خود (بدون cron) بلاک می‌کند.
function isSubscriptionActive(sub) {
  if (!sub) return false;
  if (sub.status === 'EXPIRED') return false;
  return new Date(sub.endsAt).getTime() > Date.now();
}

// آیا این کاربر الان اجازه‌ی کار در پنل دارد؟
//   - SUPERADMIN همیشه آزاد است.
//   - اگر هیچ رکورد اشتراکی (نه فردی نه مؤسسه) وجود نداشته باشد → آزاد
//     (سازگاری با عقب: حساب‌های قدیمی قبل از این ویژگی بلاک نمی‌شوند؛
//     برای ثبت‌نام‌های جدید خودمان رکورد TRIAL می‌سازیم).
//   - در غیر این صورت دسترسی یعنی حداقل یکی از رکوردها فعال باشد؛
//     پس مشاور مستقل با اشتراک منقضی بلاک می‌شود و عضو مؤسسه با اشتراک
//     منقضی مؤسسه هم (مگر اشتراک فردی فعال داشته باشد).
function hasEffectiveAccess(user, { userSub, instituteSub } = {}) {
  if (!user || user.role === 'SUPERADMIN') return true;
  // والد خودش اشتراک ندارد؛ دیدنش تابع اشتراک فرزند است، نه خودش — همیشه آزاد
  if (user.role === 'PARENT') return true;
  if (!userSub && !instituteSub) return true; // سازگاری با عقب
  return isSubscriptionActive(userSub) || isSubscriptionActive(instituteSub);
}

// حساب اشتراک مؤثر کاربر برای نمایش در UI.
// منبع دسترسی: USER (اشتراک فردی) / INSTITUTE (اشتراک مؤسسه) / USER+INSTITUTE (هر دو)
// / UNSET (هیچ رکورد فعالی نیست و به‌خاطر سازگاری با عقب دسترسی آزاد است) / SUPERADMIN.
// endsAt = دیرترین پایان میان اشتراک‌های فعال (null یعنی نامشخص/نامحدود).
function effectiveAccessInfo(user, { userSub, instituteSub } = {}) {
  if (!user || user.role === 'SUPERADMIN') {
    return { hasAccess: true, endsAt: null, source: 'SUPERADMIN' };
  }
  if (user.role === 'PARENT') {
    return { hasAccess: true, endsAt: null, source: 'PARENT' };
  }
  if (!userSub && !instituteSub) {
    return { hasAccess: true, endsAt: null, source: 'UNSET' }; // سازگاری با عقب
  }
  const personalActive = isSubscriptionActive(userSub);
  const instituteActive = isSubscriptionActive(instituteSub);
  if (!personalActive && !instituteActive) {
    return { hasAccess: false, endsAt: null, source: null };
  }
  const activeEnds = [];
  if (personalActive) activeEnds.push(new Date(userSub.endsAt).getTime());
  if (instituteActive) activeEnds.push(new Date(instituteSub.endsAt).getTime());
  const endsAt = new Date(Math.max(...activeEnds));
  const source = personalActive && instituteActive
    ? 'USER+INSTITUTE'
    : (personalActive ? 'USER' : 'INSTITUTE');
  return { hasAccess: true, endsAt, source };
}

// ====== محدودیت اعضای مؤسسه ======
// ظرفیت باقیمانده مؤسسه برای یک نقش (null سقف = بی‌نهایت)
// چک در سه نقطه انجام می‌شود: ثبت‌نام با کد مؤسسه، تأیید عضو توسط مدیر،
// تخصیص مشاور توسط سوپرادمین.
function remainingInstituteCapacity(subscription, role, currentCount) {
  if (!subscription) return { ok: true, remaining: Infinity, max: null };
  const max = role === 'ADVISOR' ? subscription.maxAdvisors : subscription.maxStudents;
  if (max === null || max === undefined) return { ok: true, remaining: Infinity, max: null };
  const remaining = max - (currentCount || 0);
  return { ok: remaining > 0, remaining, max };
}

const CAPACITY_ERROR = 'ظرفیت مؤسسه تکمیل شده است؛ برای افزودن مشاور/دانش‌آموز بیشتر، اشتراک خود را ارتقا دهید.';

module.exports = {
  isSubscriptionActive,
  hasEffectiveAccess,
  effectiveAccessInfo,
  remainingInstituteCapacity,
  CAPACITY_ERROR,
};
