const { toFaDigits, toLatinDigits } = require('./faDigits');

// نرمال‌سازی و اعتبارسنجی شماره تماس و توضیحات (bio) بر اساس فرمت ایران
// جدا از کنترلر auth تا به‌صورت واحد قابل تست باشد.

// پیام راهنمای فرمت‌های قابل قبول شماره تماس ایران
const PHONE_FORMAT_HINT =
  'فرمت‌های قابل قبول:\n' +
  '• موبایل با ۰: ۰۹۱۲۳۴۵۶۷۸۹ (۱۱ رقم)\n' +
  '• موبایل بدون ۰: ۹۱۲۳۴۵۶۷۸۹ (۱۰ رقم)\n' +
  '• با کد کشور: +۹۸۹۱۲۳۴۵۶۷۸۹ یا ۰۰۹۸۹۱۲۳۴۵۶۷۸۹\n' +
  '• ثابت با ۰: ۰۲۱۱۲۳۴۵۶۷۸ (۱۱ رقم)';

// تبدیل اعداد انگلیسی به فارسی برای پیام‌های خطا (نام مستعار برای سازگاری)
const toFa = toFaDigits;

// نرمال‌سازی شماره تماس بر اساس فرمت ایران
// برخلاف نسخه‌ی قبلی، به‌جای یک چک کلیِ طول، هر فرمت را جداگانه اعتبارسنجی می‌کند
// و در صورت خطا، دقیقاً می‌گوید کدام فرمت با چه مشکلی روبه‌رو شده.
//
// فرمت‌های قابل قبول و محدودیت‌های هرکدام:
//   1. 09XXXXXXXXX   — ۱۱ رقم، شروع با ۰، ششمین رقم ۹ (موبایل) یا غیر ۹ (ثابت)
//   2. 9XXXXXXXXX    — ۱۰ رقم، شروع با ۹ (موبایل بدون ۰)
//   3. +989XXXXXXXXX — +۹۸ + ۱۰ رقم شروع با ۹ (موبایل بین‌المللی)
//   4. +98XXXXXXXXX  — +۹۸ + ۱۰ رقم شروع با کد شهر (ثابت بین‌المللی)
//   5. 00989XXXXXXXXX — ۰۰۹۸ + ۱۰ رقم (بین‌المللی با ۰۰۹۸)
//   6. 989XXXXXXXXX  — ۹۸ + ۱۰ رقم (بدون +)
//   7. XXXXXXXXXX     — ۱۰ رقم، شروع با کد شهر (ثابت بدون ۰)
function normalizePhone(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // تبدیل اعداد فارسی و عربی به انگلیسی (از منبع واحد shared/fa-digits.mjs)
  const normalized = toLatinDigits(trimmed);

  // تشخیص وجود + در ابتدا و استخراج فقط اعداد
  const hasPlus = normalized.startsWith('+');
  const digits = normalized.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    throw new Error('شماره تماس خالی است. ' + PHONE_FORMAT_HINT);
  }

  let result;

  // ---------- فرمت‌های با کد کشور ----------
  if (hasPlus) {
    // +989XXXXXXXXX یا +98XXXXXXXXX
    if (!digits.startsWith('98')) {
      throw new Error(
        'شماره با + شروع شده ولی کد کشور ۹۸ نیست. ' + PHONE_FORMAT_HINT
      );
    }
    const nationalPart = digits.slice(2); // بعد از 98
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با +۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    // nationalPart باید یا با 9 شروع شود (موبایل) یا با کد شهر (ثابت)
    // در هر دو حالت، خروجی 0 + nationalPart است
    result = '0' + nationalPart;
  } else if (digits.startsWith('0098')) {
    // 00989XXXXXXXXX یا 0098XXXXXXXXX
    const nationalPart = digits.slice(4); // بعد از 0098
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۰۰۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد، ولی ${toFa(nationalPart.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  } else if (digits.startsWith('98') && digits.length === 12) {
    // 989XXXXXXXXX (بدون +، ۱۲ رقم)
    const nationalPart = digits.slice(2);
    if (nationalPart.length !== 10) {
      throw new Error(
        `شماره با ۹۸ باید ۱۰ رقم بعد از کد کشور داشته باشد. ` + PHONE_FORMAT_HINT
      );
    }
    result = '0' + nationalPart;
  }
  // ---------- فرمت‌های داخلی ----------
  else if (digits.startsWith('0')) {
    // 0XXXXXXXXX — باید دقیقاً ۱۱ رقم باشد
    if (digits.length !== 11) {
      throw new Error(
        `شماره با ۰ باید ۱۱ رقم باشد، ولی ${toFa(digits.length)} رقم وارد شده. ` +
        PHONE_FORMAT_HINT
      );
    }
    result = digits;
  } else if (digits.startsWith('9') && digits.length === 10) {
    // 9XXXXXXXXX — موبایل بدون ۰
    result = '0' + digits;
  } else if (digits.length === 10) {
    // XXXXXXXXXX — ثابت بدون ۰ (شروع با کد شهر مثل 21، 31، ...)
    result = '0' + digits;
  } else {
    // هیچ فرمت شناخته‌شده‌ای تطابق نکرد
    throw new Error(
      `شماره تماس با هیچ فرمت قابل قبولی تطابق ندارد (${toFa(digits.length)} رقم). ` +
      PHONE_FORMAT_HINT
    );
  }

  // اعتبارسنجی نهایی خروجی: باید ۱۱ رقم و با ۰ شروع شود
  if (result.length !== 11 || !result.startsWith('0')) {
    throw new Error(
      'خروجی نرمال‌سازی معتبر نیست. ' + PHONE_FORMAT_HINT
    );
  }

  return result;
}

// اعتبارسنجی ساده‌ی توضیحات: محدود به ۵۰۰ کاراکتر
function normalizeBio(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new Error('توضیحات نباید بیشتر از ۵۰۰ کاراکتر باشد');
  }
  return trimmed;
}

// اعتبارسنجی رمز عبور: حداقل ۸ کاراکتر با حداکثر ۱۲۸، شامل حرف و عدد
function validatePassword(password) {
  const v = String(password || '');
  if (v.length < 8) throw new Error('رمز عبور باید حداقل ۸ کاراکتر باشد');
  if (v.length > 128) throw new Error('رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد');
  if (!/[a-zA-Z\u0600-\u06FF]/.test(v)) throw new Error('رمز عبور باید حداقل یک حرف داشته باشد');
  if (!/\d/.test(v)) throw new Error('رمز عبور باید حداقل یک عدد داشته باشد');
  return v;
}

module.exports = { normalizePhone, normalizeBio, validatePassword, toFa };