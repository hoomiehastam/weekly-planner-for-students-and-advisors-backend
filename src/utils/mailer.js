// ابزار ارسال ایمیل — از nodemailer استفاده می‌کند.
// در محیط توسعه (NODE_ENV !== 'production') اگر SMTP تنظیم نشد،
// ایمیل در لاگ چاپ می‌شود تا نیاز به سرویس واقعی نباشد.
//
// تنظیمات از متغیرهای محیطی خوانده می‌شود:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//
// برای Gmail:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465 (یا 587 برای STARTTLS)
//   SMTP_USER=your_email@gmail.com
//   SMTP_PASS=app_password  (گذرواژه‌ی اپلیکیشن، نه گذرواژه‌ی عادی — باید 2FA فعال باشد)
//   SMTP_FROM="پلتفرم کنکور <your_email@gmail.com>"

let transporter = null;
let transporterInitAttempted = false;

async function getTransporter() {
  if (transporter) return transporter;
  if (transporterInitAttempted) return null;
  transporterInitAttempted = true;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // اگر هیچ تنظیماتی نبود، در محیط توسعه لاگ می‌اندازیم
  if (!host || !user || !pass) {
    return null;
  }

  try {
    // lazy require تا اگر nodemailer نصب نبود در محیط dev بدون SMTP خراب نشود
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host,
      port: port || 465,
      secure: (port || 465) === 465,
      auth: { user, pass },
    });
    return transporter;
  } catch (err) {
    console.warn('[mailer] nodemailer در دسترس نیست — ایمیل‌ها فقط لاگ می‌شوند', err.message);
    return null;
  }
}

// ارسال یک ایمیل — در محیط توسعه یا وقتی SMTP تنظیم نیست، محتوای ایمیل را در لاگ چاپ می‌کند
async function sendMail({ to, subject, html, text }) {
  const t = await getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@konkur.local';

  if (!t) {
    // حالت توسعه: لاگ کن تا توسعه‌دهنده لینک/کد را ببیند
    console.log('────────── EMAIL (dev mode) ──────────');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:', text || html);
    console.log('──────────────────────────────────────');
    return { devMode: true };
  }

  return t.sendMail({ from, to, subject, html, text });
}

// ایمیل بازیابی رمز عبور — لینک بازنشانی برای کاربر می‌فرستد
async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  const subject = 'بازیابی رمز عبور — پلتفرم کنکور';
  const text = `سلام ${userName || ''}،
برای بازیابی رمز عبور روی لینک زیر کلیک کنید (یا آن را در مرورگر کپی کنید):
${resetUrl}
این لینک تا ۱ ساعت معتبر است.
اگر شما چنین درخواستی نداده‌اید، این ایمیل را نادیده بگیرید.`;
  const html = `
<div dir="rtl" style="font-family: sans-serif; line-height:1.8; color:#222;">
  <h2 style="color:#4a3fbe;">بازیابی رمز عبور</h2>
  <p>سلام ${userName || ''}،</p>
  <p>برای بازیابی رمز عبور خود روی دکمه‌ی زیر کلیک کنید:</p>
  <p style="text-align:center; margin: 24px 0;">
    <a href="${resetUrl}" style="background:linear-gradient(135deg,#ff8a3d,#ff6b9d); color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700;">
      بازیابی رمز عبور
    </a>
  </p>
  <p style="font-size:13px; color:#666;">
    یا این لینک را در مرورگر کپی کنید:<br>
    <code dir="ltr">${resetUrl}</code>
  </p>
  <p style="font-size:13px; color:#666;">این لینک تا ۱ ساعت معتبر است.</p>
  <hr style="border:0; border-top:1px solid #eee; margin:24px 0;">
  <p style="font-size:12px; color:#999;">اگر شما چنین درخواستی نداده‌اید، این ایمیل را نادیده بگیرید.</p>
</div>`;
  return sendMail({ to, subject, html, text });
}

// ایمیل کد یک‌بارمصرف (OTP) — برای ورود بدون رمز عبور یا بازیابی حساب
// کد به‌صورت متن واضح فرستاده می‌شود و تا زمان مشخصی معتبر است.
async function sendOtpEmail({ to, otp, userName, ttlMinutes = 10 }) {
  const subject = `کد ورود یک‌بارمصرف: ${otp} — پلتفرم کنکور`;
  const text = `سلام ${userName || ''}،
کد یک‌بارمصرف ورود شما:
${otp}
این کد تا ${ttlMinutes} دقیقه معتبر است و فقط یک بار قابل استفاده است.
اگر شما چنین درخواستی نداده‌اید، این ایمیل را نادیده بگیرید و رمز عبور خود را عوض کنید.`;
  const html = `
<div dir="rtl" style="font-family: sans-serif; line-height:1.8; color:#222;">
  <h2 style="color:#4a3fbe;">کد ورود یک‌بارمصرف</h2>
  <p>سلام ${userName || ''}،</p>
  <p>کد ورود یک‌بارمصرف شما:</p>
  <p style="text-align:center; margin: 24px 0;">
    <span dir="ltr" style="display:inline-block; background:#f4f2ff; border:1px dashed #4a3fbe; color:#4a3fbe; padding:12px 28px; border-radius:8px; font-size:28px; font-weight:800; letter-spacing:6px;">${otp}</span>
  </p>
  <p style="font-size:13px; color:#666;">این کد تا <b>${ttlMinutes} دقیقه</b> معتبر است و فقط یک بار قابل استفاده است.</p>
  <hr style="border:0; border-top:1px solid #eee; margin:24px 0;">
  <p style="font-size:12px; color:#999;">اگر شما چنین درخواستی نداده‌اید، این ایمیل را نادیده بگیرید و برای امنیت بیشتر رمز عبور خود را تغییر دهید.</p>
</div>`;
  return sendMail({ to, subject, html, text });
}

module.exports = { sendMail, sendPasswordResetEmail, sendOtpEmail };
