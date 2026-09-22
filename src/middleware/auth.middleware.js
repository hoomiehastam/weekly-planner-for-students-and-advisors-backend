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
async function requireInstituteManager(req, res, next) {
  if (!req.user || req.user.role !== 'INSTITUTE_MANAGER') {
    return res.status(403).json({ error: 'دسترسی مجاز نیست' });
  }
  if (!req.user.instituteId) {
    return res.status(403).json({ error: 'شما به هیچ مؤسه‌ای متصل نیستید' });
  }
  req.instituteId = req.user.instituteId;
  next();
}

module.exports = { authenticate, requireRole, requireInstituteManager };
