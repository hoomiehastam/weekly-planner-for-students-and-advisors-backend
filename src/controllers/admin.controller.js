const prisma = require('../config/prisma');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const OTP_LENGTH = 8;
const OTP_TTL_HOURS_DEFAULT = 24;
const SALT_ROUNDS = 10;

// فهرست مشاورانی که هنوز منتظر تایید هستند
// شامل شماره تماس و توضیحات تا سوپرادمین با آگاهی کامل تصمیم بگیرد
// اعضای مؤسسه هم با نام مؤسسه‌شان نشان داده می‌شوند (تأییدشان حق مدیر مؤسسه است،
// ولی سوپرادمین همیشه override دارد)
async function listPendingAdvisors(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: 'ADVISOR', status: 'PENDING' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        createdAt: true,
        institute: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ advisors });
  } catch (err) {
    next(err);
  }
}

// ====== مدیریت مؤسسه‌ها (سوپرادمین) ======

// ثبت مؤسسه‌ی جدید — سوپرادمین دستی می‌سازد (فروش B2B؛ ثبت‌نام عمومی مؤسسه فعلاً نیست)
// کد دعوت خودکار تولید می‌شود تا مدیر مؤسسه در ثبت‌نام اعضا بدهد
async function createInstitute(req, res, next) {
  try {
    const { name } = req.body;
    const trimmed = String(name || '').trim();
    if (trimmed.length < 2) {
      return res.status(400).json({ error: 'نام مؤسسه باید حداقل ۲ کاراکتر باشد' });
    }

    // کد ۸ کاراکتری بدون حروف گیج‌کننده (0/O/1/I)
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.randomBytes(8))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
      .slice(0, 8);

    const institute = await prisma.institute.create({
      data: { name: trimmed, code },
    });
    res.status(201).json({ message: 'مؤسسه ساخته شد', institute });
  } catch (err) {
    next(err);
  }
}

// فهرست مؤسسه‌ها + شمارنده‌ها + اشتراک
async function listInstitutes(req, res, next) {
  try {
    const institutes = await prisma.institute.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        createdAt: true,
        subscription: { select: { status: true, tier: true, endsAt: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ institutes });
  } catch (err) {
    next(err);
  }
}

// تأیید مؤسسه (پس از ثبت + در صورت نیاز پس از پرداخت)
async function activateInstitute(req, res, next) {
  try {
    const { id } = req.params;
    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) {
      return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }
    // فعال‌سازی + آغاز دوره‌ی آزمایشی ۱۴ روزه در یک تراکنش
    const updated = prisma.institute.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    const sub = prisma.instituteSubscription.upsert({
      where: { instituteId: id },
      create: {
        instituteId: id,
        status: 'TRIAL',
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      update: { status: 'ACTIVE' },
    });
    await prisma.$transaction([updated, sub]);
    res.json({ message: 'مؤسسه فعال شد', institute: { id, status: 'ACTIVE' } });
  } catch (err) {
    next(err);
  }
}

// تایید یک مشاور: وضعیتش به فعال تغییر می‌کند
async function approveAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({ where: { id, role: 'ADVISOR' } });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    res.json({ message: 'مشاور تایید شد', advisor: { id: updated.id, fullName: updated.fullName } });
  } catch (err) {
    next(err);
  }
}

// رد یک مشاور: وضعیتش به رد شده تغییر می‌کند
async function rejectAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({ where: { id, role: 'ADVISOR' } });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'REJECTED' },
    });

    res.json({ message: 'مشاور رد شد', advisor: { id: updated.id, fullName: updated.fullName } });
  } catch (err) {
    next(err);
  }
}

// نمای کلی سوپرادمین: هر مشاور و تعداد دانش‌آموزانش
// شامل شماره تماس مشاور و دانش‌آموزان برای ارتباط
async function listAdvisorsOverview(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: { in: ['ADVISOR', 'SUPERADMIN'] }, status: 'ACTIVE' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        institute: { select: { id: true, name: true } },
        asAdvisorLinks: {
          select: {
            student: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    res.json({ advisors });
  } catch (err) {
    next(err);
  }
}

// ====== حذف مؤسسه ======
// وقتی یک مؤسسه حذف می‌شود:
//   - اشتراک مؤسسه (InstituteSubscription) به‌خاطر onDelete: Cascade حذف می‌شود
//   - اعضای مؤسسه (User.instituteId) به‌خاطر onDelete: SetNull به null تبدیل می‌شوند (مستقل می‌شوند)
//   - کد دعوت دیگر معتبر نیست
async function deleteInstitute(req, res, next) {
  try {
    const { id } = req.params;
    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) {
      return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }

    // قبل از حذف، شمارش اعضا را برمی‌گردانیم تا در صورت نیاز در لاگ بماند
    const memberCount = await prisma.user.count({ where: { instituteId: id } });

    await prisma.institute.delete({ where: { id } });

    res.json({
      message: `مؤسسه «${institute.name}» حذف شد. ${memberCount} کاربر به‌حساب مستقل تبدیل شدند.`,
      institute: { id, name: institute.name },
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم مدت اشتراک مؤسسه ======
// سوپرادمین می‌تواند:
//   - تاریخ پایان را تنظیم کند (endsAt: ISO date string)
//   - یا تعداد روز از حالا را بدهد (daysFromNow: number)
//   - وضعیت اشتراک را تغییر دهد (TRIAL | ACTIVE | GRACE | EXPIRED)
async function updateInstituteSubscription(req, res, next) {
  try {
    const { id } = req.params;
    const { endsAt, daysFromNow, status } = req.body;

    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) {
      return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }

    // محاسبه‌ی تاریخ پایان نهایی
    let finalEndsAt;
    if (endsAt) {
      finalEndsAt = new Date(endsAt);
      if (isNaN(finalEndsAt.getTime())) {
        return res.status(400).json({ error: 'تاریخ پایان نامعتبر است' });
      }
    } else if (daysFromNow) {
      finalEndsAt = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
    }

    // upsert چون ممکن است هنوز اشتراکی وجود نداشته باشد
    const data = {};
    if (finalEndsAt) data.endsAt = finalEndsAt;
    if (status) data.status = status;

    const subscription = await prisma.instituteSubscription.upsert({
      where: { instituteId: id },
      create: {
        instituteId: id,
        status: status || 'ACTIVE',
        startsAt: new Date(),
        endsAt: finalEndsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: data,
    });

    res.json({
      message: 'اشتراک مؤسسه به‌روزرسانی شد',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        endsAt: subscription.endsAt,
        tier: subscription.tier,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ====== تخصیص مشاور به مؤسسه‌ی خاص (یا جدا کردنش) ======
// این امکان را می‌دهد که یک مشاور فقط برای یک مؤسسه‌ی خاص فعال باشد
// (یعنی فقط دانش‌آموزان همان مؤسسه می‌توانند انتخابش کنند).
// instituteId: null یعنی مشاور مستقل می‌شود
async function assignAdvisorToInstitute(req, res, next) {
  try {
    const { id } = req.params;
    let { instituteId } = req.body;

    // پذیرفتن null صریح (برای مستقل کردن) ولی رد کردن رشته‌ی خالی
    if (instituteId !== null && instituteId !== undefined) {
      const trimmed = String(instituteId).trim();
      if (!trimmed) {
        instituteId = null;
      } else {
        // اعتبارسنجی وجود مؤسسه
        const inst = await prisma.institute.findUnique({ where: { id: trimmed } });
        if (!inst) {
          return res.status(400).json({ error: 'مؤسسه‌ی انتخاب‌شده یافت نشد' });
        }
        if (inst.status !== 'ACTIVE') {
          return res.status(400).json({ error: 'مؤسسه‌ی انتخاب‌شده هنوز تأیید نشده است' });
        }
        instituteId = trimmed;
      }
    }

    const advisor = await prisma.user.findFirst({ where: { id, role: 'ADVISOR' } });
    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    // هشدار: اگر مشاور دانش‌آموزانی از مؤسسه‌ی دیگری داشته باشد، تغییر مؤسسه
    // ممکن است باعث شود آن دانش‌آموزان دیگر نتوانند به او دسترسی داشته باشند.
    // برای سادگی فعلاً فقط مؤسسه‌ی مشاور را تغییر می‌دهیم.
    const updated = await prisma.user.update({
      where: { id },
      data: { instituteId },
      select: {
        id: true,
        fullName: true,
        instituteId: true,
        institute: { select: { id: true, name: true } },
      },
    });

    res.json({
      message: updated.institute
        ? `مشاور به مؤسسه‌ی «${updated.institute.name}» تخصیص داده شد`
        : 'مشاور از مؤسسه جدا شد و مستقل شد',
      advisor: updated,
    });
  } catch (err) {
    next(err);
  }
}

// ====== ساخت رمز یک‌بار مصرف (OTP) برای کاربر ======
// سوپرادمین وقتی کاربر رمزش را فراموش کرده، یک OTP می‌سازد و به کاربر می‌دهد.
// کاربر با ایمیل + OTP وارد می‌شود. OTP فقط یک بار کار می‌کند و بعد پاک می‌شود.
// طول عمر پیش‌فرض ۲۴ ساعت است (با ttlHours قابل تنظیم).
async function createUserOtp(req, res, next) {
  try {
    const { id } = req.params;
    const { ttlHours } = req.body || {};

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }

    // تولید OTP: ۸ کاراکتر از حروف و اعداد بدون ابهام
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const otp = Array.from(crypto.randomBytes(OTP_LENGTH))
      .map((b) => alphabet[b % alphabet.length])
      .join('')
      .slice(0, OTP_LENGTH);

    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const ttl = ttlHours || OTP_TTL_HOURS_DEFAULT;
    const otpExpiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id },
      data: { otpHash, otpExpiresAt },
    });

    res.json({
      message: 'رمز یک‌بار مصرف ساخته شد. آن را به کاربر بدهید.',
      otp,
      expiresAt: otpExpiresAt,
      ttlHours: ttl,
      // اطلاع‌رسانی به ادمین که کاربر باید بعد از ورود رمزش را عوض کند
      note: 'این رمز فقط یک بار قابل استفاده است. کاربر باید بعد از ورود، رمز عبور جدیدی تعیین کند.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
  createInstitute,
  listInstitutes,
  activateInstitute,
  deleteInstitute,
  updateInstituteSubscription,
  assignAdvisorToInstitute,
  createUserOtp,
};
