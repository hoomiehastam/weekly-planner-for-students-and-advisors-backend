const express = require('express');
const router = express.Router();
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
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');

// محدودیت نرخ روی کل مسیر login/register در app.js اعمال شده است

router.post('/register', validate(schemas.register), register);
router.post('/login', validate(schemas.login), login);
router.post('/logout', logout);

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
