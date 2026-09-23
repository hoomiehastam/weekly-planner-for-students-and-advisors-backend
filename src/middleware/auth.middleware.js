const { verifyToken, TOKEN_COOKIE } = require('../utils/jwt');
const prisma = require('../config/prisma');

// این میان‌افزار مطمئن می‌شود کاربر توکن معتبر فرستاده، سپس اطلاعات کاربر را روی درخواست قرار می‌دهد.
// توکن از دو جا خوانده می‌شود:
//   ۱) کوکی httpOnly (روش اصلی فعلی)
//   ۲) هدر Authorization: Bearer (برای سازگاری با کلاینت‌های قبلی و API های خارجی)
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = req.cookies?.[TOKEN_COOKIE] || bearerToken;

  if (!token) {
    return res.status(401).json({ error: 'ورود لازم است' });
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'حساب کاربری فعال نیست' });
    }

    req.user = user;
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
