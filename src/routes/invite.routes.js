const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  getMyAdvisorInvite,
  updateMyAdvisorInvite,
  lookupInvite,
  getMyFriendInvite,
} = require('../controllers/invite.controller');

// جستجوی عمومی کد (صفحه‌ی ثبت‌نام) — محدودیت نرخ برای جلوگیری از حدس‌زدن کدها
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کن' },
});
router.get('/lookup/:code', lookupLimiter, lookupInvite);

// مشاور (و سوپرادمین در نقش مشاور): لینک دعوت دانش‌آموز
router.get('/advisor/me', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), getMyAdvisorInvite);
router.put('/advisor/me', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), validate(schemas.advisorInviteSettings), updateMyAdvisorInvite);

// دانش‌آموز: لینک دعوت دوست + وضعیت تخفیف
router.get('/student/me', authenticate, requireRole('STUDENT'), getMyFriendInvite);

module.exports = router;
