const { verifyToken, TOKEN_COOKIE } = require('../utils/jwt');
const { hasEffectiveAccess } = require('../utils/subscription');
const prisma = require('../config/prisma');

// مسیرهایی که حتی با اشتراک منقضی باید باز بمانند — وگرنه کاربر راهی برای تمدید
// و مدیریت حسابش ندارد. همه‌ی مسیرهای کاری (برنامه، آزمون، یادآور، مدیریت ...) بسته‌اند.
const SUBSCRIPTION_EXEMPT_PATHS = [
  '/api/subscription/me',
  '/api/deposits',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/me/password',
  '/api/auth/me/photo',
];

function isSubscriptionExempt(method, url) {
  const path = (url || '').split('?')[0];
  // اندپوینت‌های خودِ deposit — همه‌ی متدها آزادند تا کاربر رسیدش را ببیند/بفرستد
  if (path.startsWith('/api/deposits')) return true;
  if (!SUBSCRIPTION_EXEMPT_PATHS.includes(path)) return false;
  // خواندن و تغییر پروفایل/رمز آزاد است؛ ولی تغییر داده‌های دیگر نه
  return ['GET', 'PUT'].includes(method) || path !== '/api/auth/me';
}

// این میان‌افزار مطمئن می‌شود کاربر توکن معتبر فرستاده، سپس اطلاعات کاربر را روی درخواست قرار می‌دهد.
// توکن از دو جا خوانده می‌شود:
//   ۱) کوکی httpOnly (روش اصلی فعلی)
//   ۲) هدر Authorization: Bearer (برای سازگاری با کلاینت‌های قبلی و API های خارجی)
//
// بعد از احراز هویت، اشتراک چک می‌شود (قطع خودکار):
//   دسترسی = اشتراک فردی فعال «یا» اشتراک مؤسسه‌ی عضو فعال (یا هیچ رکوردی نباشد — سازگاری با عقب).
//   اگر اشتراک تمام شده باشد، با کد ۴۰۳ و کد machine-readable یعنی SUBSCRIPTION_EXPIRED رد می‌شود؛
//   فرانت با دیدن این کد، کاربر را به صفحه‌ی واریز/تمدید هدایت می‌کند.
//   نکته: این چک فقط برای نقش‌های کاری است؛ سوپرادمین و مسیرهای مستثنا آزادند.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = req.cookies?.[TOKEN_COOKIE] || bearerToken;

  if (!token) {
    return res.status(401).json({ error: 'ورود لازم است' });
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        subscription: true,
        institute: { include: { subscription: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'حساب کاربری فعال نیست' });
    }

    req.user = user;

    // --- قطع خودکار دسترسی بعد از انقضای اشتراک ---
    if (!isSubscriptionExempt(req.method, req.originalUrl || req.url) && !hasEffectiveAccess(user, {
      userSub: user.subscription,
      instituteSub: user.institute?.subscription || null,
    })) {
      return res.status(403).json({
        error: 'اشتراک شما به پایان رسیده است. برای تمدید، به صفحه‌ی واریز بروید.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'توکن نامعتبر یا منقضی‌شده است' });
  }
}

// این تابع یک میان‌افزار می‌سازد که فقط اجازه‌ی عبور به نقش‌های مشخص‌شده را می‌دهد
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'دسترسی مجاز نیست' });
    }
    next();
  };
}

// میان‌افزار مدیر مؤسسه: نقش را چک می‌کند و instituteId را از رکورد کاربر
// (نه از کلاینت!) روی req می‌گذارد — همه‌ی کوئری‌های مدیر باید با همین اسکوپ شوند.
// مدیریت نهایی: findFirst با { id, instituteId } تا شناسه‌های حدسی چیزی لو ندهند.
//
// دو مسیر مجاز:
//   ۱) کاربر با role=INSTITUTE_MANAGER (عضو مؤسسه با instituteId)
//   ۲) «نماینده/سردار» مؤسسه — عضو معمولی (معمولاً مشاور) که سوپرادمین او را
//      در Institute.leaderId ثبت کرده؛ نقشش تغییر نمی‌کند ولی همین میان‌افزار
//      به او اختیارات مدیریتی مؤسسه‌اش را می‌دهد.
async function requireInstituteManager(req, res, next) {
  if (!req.user) {
    return res.status(403).json({ error: 'دسترسی مجاز نیست' });
  }

  // مسیر ۱: مدیر رسمی مؤسسه
  if (req.user.role === 'INSTITUTE_MANAGER') {
    if (!req.user.instituteId) {
      return res.status(403).json({ error: 'شما به هیچ مؤسه‌ای متصل نیستید' });
    }
    req.instituteId = req.user.instituteId;
    return next();
  }

  // مسیر ۲: نماینده‌ی مؤسسه (leader) — سوپرادمین او را تعیین کرده
  const ledInstitute = await prisma.institute.findFirst({
    where: { leaderId: req.user.id },
    select: { id: true },
  });
  if (ledInstitute) {
    req.instituteId = ledInstitute.id;
    return next();
  }

  return res.status(403).json({ error: 'دسترسی مجاز نیست' });
}

module.exports = { authenticate, requireRole, requireInstituteManager };
