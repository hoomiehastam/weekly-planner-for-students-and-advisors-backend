const jwt = require('jsonwebtoken');

// نام کوکی‌ای که توکن در آن نگه داشته می‌شود
const TOKEN_COOKIE = 'konkur_token';

// transform "7d", "30m", "2h" به میلی‌ثانیه برای maxAge کوکی
function expiresInToMs(expiresIn) {
  const value = process.env.JWT_EXPIRES_IN || expiresIn || '7d';
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) return 7 * 24 * 60 * 60 * 1000; // پیش‌فرض ۷ روز
  const n = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * multipliers[unit];
}

// گزینه‌های کوکی توکن:
//   - httpOnly تا جاوااسکریپت به آن دسترسی نداشته باشد (ضد XSS)
//   - در تولید Secure + SameSite=None تا در دامنه‌ی جدا (فرانت در Render) هم ارسال شود
//   - در توسعه SameSite=Lax که برای localhost (درخواست same-site) کافی است
function tokenCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: expiresInToMs(),
    path: '/',
  };
}

// یک توکن جدید برای کاربر می‌سازد؛ شناسه و نقش کاربر داخل توکن قرار می‌گیرد
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// یک توکن را بررسی می‌کند و در صورت معتبر بودن محتوایش را برمی‌گرداند
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// توکن را به‌صورت httpOnly کوکی روی پاسخ قرار می‌دهد
function setTokenCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, tokenCookieOptions());
}

// کوکی توکن را حذف می‌کند (برای خروج)
// نکته‌ی مهم: مرورگر فقط «حذف» کوکی‌ای را می‌پذیرد که با همان attributeهای ست‌شدن
// (secure / sameSite / path) همراه باشد. پس همان گزینه‌ها را پاس می‌دهیم به‌جز maxAge —
// پاس‌دادن maxAge باعث می‌شود کوکی به‌جای حذف، دوباره ۷ روز تمدید شود!
function clearTokenCookie(res) {
  const { maxAge: _ignored, ...attrs } = tokenCookieOptions();
  res.clearCookie(TOKEN_COOKIE, attrs);
}

module.exports = {
  generateToken,
  verifyToken,
  TOKEN_COOKIE,
  setTokenCookie,
  clearTokenCookie,
  tokenCookieOptions,
};