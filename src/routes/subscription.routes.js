const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  getMySubscription,
  getMyCard,
  setMyCard,
  getDepositContext,
  createDeposit,
  listMyDeposits,
  listIncomingDeposits,
  approveDeposit,
  rejectDeposit,
} = require('../controllers/subscription.controller');

// نکته: این مسیرها در middleware احراز هویت از قطع دسترسیِ اشتراک منقضی مستثنا هستند
// تا کاربرِ بلاک‌شده هم بتواند وضعیتش را ببیند و تمدید کند.

router.get('/me', authenticate, getMySubscription);
router.get('/me/card', authenticate, getMyCard);
router.put('/me/card', authenticate, validate(schemas.cardSettings), setMyCard);
router.get('/deposit-context', authenticate, getDepositContext);

// محدودیت ثبت رسید: هر رسید تا ~۷۰۰KB عکس base64 دارد — جلوگیری از سنگین‌کردن دیتابیس
const depositLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ۱ ساعت
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد درخواست‌های ثبت رسید بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید' },
});

// چرخه‌ی رسید واریز
router.get('/deposits/mine', authenticate, listMyDeposits);
router.get('/deposits/incoming', authenticate, listIncomingDeposits);
router.post('/deposits', depositLimiter, authenticate, validate(schemas.createDeposit), createDeposit);
router.post('/deposits/:id/approve', authenticate, validate(schemas.decideDeposit), approveDeposit);
router.post('/deposits/:id/reject', authenticate, validate(schemas.decideDeposit), rejectDeposit);

module.exports = router;
