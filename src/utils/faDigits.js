// کپیِ commonjs از shared/fa-digits.mjs مخصوص بک‌اند.
// چرا کپی؟ چون Render فقط پوشه‌ی backend/ را آپلود می‌کند و backend
// نمی‌تواند به shared/ (خارج از درخت) در runtime دسترسی داشته باشد.
// ⚠️ اگر این فایل را تغییر می‌دهی، فایل فرانت را هم به‌روزرسانی کن:
//    shared/fa-digits.mjs  ←  منبع اصلی فرانت (Vite آن را bundle می‌کند)

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

// انگلیسی → فارسی
function toFaDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

// تبدیل ارقام فارسی (۰-۹) و عربی (٠-٩) به ارقام لاتین (0-9)
const FA_LATIN_RE = /[۰-۹]/g;
const AR_LATIN_RE = /[٠-٩]/g;
function toLatinDigits(value) {
  return String(value ?? '')
    .replace(FA_LATIN_RE, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(AR_LATIN_RE, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

module.exports = { FA_DIGITS, toFaDigits, toLatinDigits };