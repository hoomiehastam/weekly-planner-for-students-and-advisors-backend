const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { normalizePhone, normalizeBio, validatePassword } = require('../utils/normalizers');
const { sendPasswordResetEmail } = require('../utils/mailer');

const SALT_ROUNDS = 10;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_EXPIRY_HOURS = 1;

// ثبت‌نام کاربر جدید. دانش‌آموز بلافاصله فعال می‌شود، مشاور منتظر تأیید می‌ماند
// (تأیید مشاورِ مؤسسه‌ای: مدیر مؤسسه — مشاور مستقل: سوپرادمین)
// با کد مؤسسه (instituteCode) عضو مؤسسه می‌شوی؛ بدون کد مستقل می‌مانی.
// قانون مرز tenant: مشاورِ انتخابی دانش‌آموز باید هم‌مؤسسه با او باشد یا هر دو مستقل.
async function register(req, res, next) {
  try {
    const { fullName, email, password, role, advisorId, phone, bio, instituteCode } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ error: 'همه‌ی فیلدها الزامی هستند' });
    }

    if (!['STUDENT', 'ADVISOR'].includes(role)) {
      return res.status(400).json({ error: 'نقش انتخاب‌شده معتبر نیست' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'این ایمیل قبلاً ثبت شده است' });
    }

    // نرمال‌سازی شماره تماس، توضیحات و اعتبارسنجی رمز عبور
    let phoneValue = null;
    let bioValue = null;
    let passwordValue;
    try {
      phoneValue = normalizePhone(phone);
      bioValue = normalizeBio(bio);
      passwordValue = validatePassword(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // عضویت اختیاری در مؤسسه با کد دعوت
    let institute = null;
    if (instituteCode) {
      institute = await prisma.institute.findUnique({ where: { code: String(instituteCode).trim() } });
      if (!institute) {
        return res.status(400).json({ error: 'کد مؤسسه معتبر نیست' });
      }
      if (institute.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'این مؤسسه هنوز تأیید نشده است' });
      }
    }

    // دانش‌آموز باید حتماً یک مشاور فعال را انتخاب کند
    // + قانون مرز مؤسسه: مشاور و دانش‌آموز باید هم‌مؤسسه باشند یا هر دو مستقل
    let advisor = null;
    if (role === 'STUDENT') {
      if (!advisorId) {
        return res.status(400).json({ error: 'انتخاب مشاور برای دانش‌آموز الزامی است' });
      }
      advisor = await prisma.user.findFirst({
        where: { id: advisorId, role: 'ADVISOR', status: 'ACTIVE' },
      });
      if (!advisor) {
        return res.status(400).json({ error: 'مشاور انتخاب‌شده یافت نشد یا هنوز فعال نیست' });
      }
      const advisorInst = advisor.instituteId;
      const studentInst = institute ? institute.id : null;
      if (advisorInst !== studentInst) {
        return res.status(400).json({
          error: institute
            ? 'در ثبت‌نام مؤسسه‌ای باید از مشاوران همان مؤسسه انتخاب کنی'
            : 'این مشاور عضو یک مؤسسه است؛ برای ثبت‌نام نزد او باید کد همان مؤسسه را وارد کنی',
        });
      }
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

    // دانش‌آموز مستقل بلافاصله فعال است؛ مشاور و اعضای مؤسسه در انتظار تأیید می‌مانند
    // (تأیید اعضای مؤسسه با مدیر مؤسسه است، مستقل‌ها با سوپرادمین)
    const status = role === 'STUDENT' && !institute ? 'ACTIVE' : 'PENDING';

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        role,
        status,
        phone: phoneValue,
        bio: bioValue,
        instituteId: institute ? institute.id : null,
      },
    });

    if (role === 'STUDENT') {
      await prisma.advisorStudentLink.create({
        data: { advisorId: advisor.id, studentId: user.id },
      });
    }

    // فقط کاربر فعال بلافاصله توکن می‌گیرد؛ بقیه باید تأیید شوند
    if (status === 'ACTIVE') {
      const token = generateToken(user);
      setTokenCookie(res, token);
      return res.status(201).json({
        message: 'ثبت‌نام با موفقیت انجام شد',
        user: { id: user.id, fullName: user.fullName, role: user.role },
      });
    }

    return res.status(201).json({
      message: institute
        ? 'ثبت‌نام ثبت شد. حساب شما پس از تأیید مدیر مؤسسه فعال می‌شود'
        : 'ثبت‌نام ثبت شد. حساب شما پس از تأیید سوپرادمین فعال می‌شود',
    });
  } catch (err) {
    next(err);
  }
}

// ورود کاربر با ایمیل و رمز عبور (یا رمز یک‌بار مصرف OTP که سوپرادمین ساخته)
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'ایمیل و رمز عبور الزامی هستند' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
    }

    // ۱) ابتدا OTP را بررسی می‌کنیم — اگر کاربر رمز یک‌بار مصرف داشته باشد و درست وارد کند،
    // ورود موفق است و OTP بلافاصله پاک می‌شود (یک‌بار مصرف)
    if (user.otpHash && user.otpExpiresAt && user.otpExpiresAt > new Date()) {
      const otpMatches = await bcrypt.compare(password, user.otpHash);
      if (otpMatches) {
        // OTP درست بود — پاکش می‌کنیم و توکن می‌دهیم
        await prisma.user.update({
          where: { id: user.id },
          data: { otpHash: null, otpExpiresAt: null },
        });

        if (user.status === 'PENDING') {
          return res.status(403).json({
            error: user.instituteId
              ? 'حساب شما هنوز توسط مدیر مؤسسه تأیید نشده است'
              : 'حساب شما هنوز تأیید نشده است',
          });
        }
        if (user.status === 'REJECTED') {
          return res.status(403).json({ error: 'درخواست عضویت شما تایید نشد' });
        }

        const token = generateToken(user);
        setTokenCookie(res, token);
        return res.json({
          user: {
            id: user.id,
            fullName: user.fullName,
            role: user.role,
            phone: user.phone,
            bio: user.bio,
            mustChangePassword: true, // یادآوری به کاربر که رمزش را عوض کند
          },
        });
      }
      // OTP درست نبود — به مسیر عادی رمز عبور می‌رویم
    } else if (user.otpHash && user.otpExpiresAt && user.otpExpiresAt <= new Date()) {
      // OTP منقضی شده — پاکش می‌کنیم
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: null, otpExpiresAt: null },
      });
    }

    // ۲) مسیر عادی: بررسی رمز عبور
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'ایمیل یا رمز عبور اشتباه است' });
    }

    if (user.status === 'PENDING') {
      return res.status(403).json({
        error: user.instituteId
          ? 'حساب شما هنوز توسط مدیر مؤسسه تأیید نشده است'
          : 'حساب شما هنوز تأیید نشده است',
      });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({ error: 'درخواست عضویت شما تایید نشد' });
    }

    const token = generateToken(user);
    setTokenCookie(res, token);
    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
        bio: user.bio,
      },
    });
  } catch (err) {
    next(err);
  }
}

// خروج: کوکی توکن پاک می‌شود (در سمت سرور توکن JWT بی‌حالتی است و فقط انقضای آن کار می‌کند)
async function logout(req, res) {
  clearTokenCookie(res);
  res.json({ message: 'خروج انجام شد' });
}

// اطلاعات کاربر لاگین‌شده بر اساس کوکی/توکن معتبر
async function getMe(req, res) {
  res.json({
    user: {
      id: req.user.id,
      fullName: req.user.fullName,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      bio: req.user.bio,
    },
  });
}

// کاربر می‌تواند اطلاعات پروفایل خودش را ویرایش کند
// محدودیت‌ها بر اساس نقش:
//   - STUDENT: فقط phone و bio قابل ویرایش است (نام قابل تغییر نیست تا از مسخره‌بازی جلوگیری شود)
//   - ADVISOR و SUPERADMIN: fullName، phone و bio قابل ویرایش است
async function updateMyProfile(req, res, next) {
  try {
    const { fullName, phone, bio } = req.body;
    const role = req.user.role;

    const data = {};

    // فقط مشاور و سوپرادمین می‌توانند نام خود را تغییر دهند
    // دانش‌آموز نمی‌تواند نامش را تغییر دهد (برای جلوگیری از مسخره‌بازی)
    if (fullName !== undefined) {
      if (role === 'STUDENT') {
        return res.status(403).json({
          error: 'دانش‌آموز نمی‌تواند نام خود را تغییر دهد. در صورت نیاز، با مشاور یا سوپرادمین تماس بگیرید.',
        });
      }
      const trimmedName = String(fullName).trim();
      if (trimmedName.length < 2) {
        return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد' });
      }
      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'نام نباید بیشتر از ۱۰۰ کاراکتر باشد' });
      }
      data.fullName = trimmedName;
    }

    // phone برای همه‌ی نقش‌ها قابل ویرایش است
    if (phone !== undefined) {
      try {
        data.phone = normalizePhone(phone);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // bio برای همه‌ی نقش‌ها قابل ویرایش است
    if (bio !== undefined) {
      try {
        data.bio = normalizeBio(bio);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        phone: true,
        bio: true,
      },
    });

    res.json({
      message: 'پروفایل به‌روزرسانی شد',
      user: updated,
    });
  } catch (err) {
    next(err);
  }
}

// تغییر رمز عبور خود توسط کاربر لاگین‌شده
// کاربرد: بعد از ورود با OTP، کاربر باید رمزش را عوض کند
async function changeMyPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'رمز عبور جدید الزامی است' });
    }

    let passwordValue;
    try {
      passwordValue = validatePassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }

    // اگر کاربر currentPassword فرستاده، آن را بررسی می‌کنیم (برای تغییر عادی رمز)
    // اگر نفرستاده (مثلاً بعد از ورود با OTP)، فقط رمز جدید را تنظیم می‌کنیم
    if (currentPassword) {
      const matches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
      }
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, otpHash: null, otpExpiresAt: null },
    });

    res.json({ message: 'رمز عبور با موفقیت تغییر کرد' });
  } catch (err) {
    next(err);
  }
}

// درخواست بازیابی رمز عبور — ایمیل را می‌گیرد و لینک بازیابی به آن می‌فرستد
// نکته‌ی امنیتی: چه ایمیل وجود داشته باشد چه نداشته، همین پاسخ را برمی‌گردانیم
// تا با brute-force نتوان فهمید کدام ایمیل‌ها در سیستم ثبت هستند.
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // توکن یک‌بار مصرف با طول کافی
      const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

      await prisma.passwordReset.create({
        data: { email, token, expiresAt, userId: user.id },
      });

      // URL بازیابی — فرانت این لینک را به‌صورت /reset-password?token=XXX هندل می‌کند
      const baseUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      // ارسال ایمیل — اگر SMTP تنظیم نباشد، در لاگ چاپ می‌شود
      try {
        await sendPasswordResetEmail({ to: email, resetUrl, userName: user.fullName });
      } catch (mailErr) {
        // حتی اگر ایمیل فرستاده نشد، به کاربر پیام موفقیت می‌دهیم (امنیت)
        req.log?.error?.({ err: mailErr }, 'ارسال ایمیل بازیابی ناموفق');
      }
    }

    res.json({
      message: 'اگر این ایمیل در سیستم ثبت باشد، لینک بازیابی به آن ارسال شد.',
    });
  } catch (err) {
    next(err);
  }
}

// تنظیم رمز عبور جدید با توکن بازیابی
async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    let passwordValue;
    try {
      passwordValue = validatePassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const reset = await prisma.passwordReset.findUnique({ where: { token } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return res.status(400).json({ error: 'توکن نامعتبر یا منقضی است' });
    }

    const user = await prisma.user.findUnique({ where: { email: reset.email } });
    if (!user) {
      return res.status(400).json({ error: 'کاربر یافت نشد' });
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

    // در یک تراکنش: رمز جدید + علامت‌گذاری توکن به‌عنوان استفاده‌شده + پاک‌سازی OTP
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, otpHash: null, otpExpiresAt: null },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ message: 'رمز عبور با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.' });
  } catch (err) {
    next(err);
  }
}

// اعتبارسنجی توکن بازیابی — برای اینکه فرانت قبل از نمایش فرم بداند توکن معتبر است یا نه
async function verifyResetToken(req, res, next) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'توکن الزامی است' });
    }
    const reset = await prisma.passwordReset.findUnique({ where: { token } });
    const valid = reset && !reset.usedAt && reset.expiresAt > new Date();
    res.json({ valid });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateMyProfile,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  changeMyPassword,
};
