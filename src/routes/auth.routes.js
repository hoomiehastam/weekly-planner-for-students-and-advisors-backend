const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  register,
  login,
  logout,
  getMe,
  updateMyProfile,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  changeMyPassword,
  requestOtp,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');

// محدودیت نرخ روی کل مسیر login/register در app.js اعمال شده است

// محدودیت شدید روی درخواست کد یک‌بارمصرف ایمیلی — جلوگیری از spam ایمیل و brute force
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // ۱ ساعت
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تعداد درخواست‌های کد یک‌بارمصرف بیش از حد مجاز است؛ بعداً تلاش کنید' },
});

router.post('/register', validate(schemas.register), register);
router.post('/login', validate(schemas.login), login);
router.post('/logout', logout);

// درخواست کد یک‌بارمصرف ایمیلی برای ورود بدون رمز — کد ۱۰ دقیقه معتبر است
router.post('/otp/request', otpRequestLimiter, validate(schemas.otpRequest), requestOtp);

// بازیابی رمز عبور از طریق ایمیل
router.post('/forgot-password', validate(schemas.forgotPassword), forgotPassword);
router.post('/reset-password', validate(schemas.resetPassword), resetPassword);
router.post('/verify-reset-token', verifyResetToken);

// مسیرهای نیازمند ورود
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, validate(schemas.profile), updateMyProfile);
// تغییر رمز عبور خود کاربر (مثلاً بعد از ورود با OTP)
router.put('/me/password', authenticate, changeMyPassword);

module.exports = router;
