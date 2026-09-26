const prisma = require('../config/prisma');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sendOtpEmail } = require('../utils/mailer');
const { remainingInstituteCapacity, CAPACITY_ERROR } = require('../utils/subscription');

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
        // مبلغ ماهانه‌ی اشتراک مؤسسه (تومان) — توسط سوپرادمین تعیین می‌شود
        monthlyPrice: true,
        subscription: { select: { status: true, tier: true, endsAt: true, maxAdvisors: true, maxStudents: true } },
        // نماینده‌ی فعلی (سردار) — سوپرادمین او را تعیین می‌کند
        leader: { select: { id: true, fullName: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // کارت واریز هر مؤسسه + کارت پلتفرم — رابطه‌ی polymorphic ندارد، جدا وصل می‌شود
    const [instCards, systemCard] = await Promise.all([
      prisma.cardSettings.findMany({ where: { ownerKind: 'INSTITUTE', ownerId: { in: institutes.map((i) => i.id) } } }),
      prisma.cardSettings.findFirst({ where: { ownerKind: 'SYSTEM' } }),
    ]);
    const cardByInstitute = new Map(instCards.map((c) => [c.ownerId, c]));
    const withCards = institutes.map((i) => ({ ...i, card: cardByInstitute.get(i.id) || null }));
    res.json({ institutes: withCards, systemCard: systemCard || null });
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
    // سوپرادمین هم ممکن است هدفِ تأیید باشد (حسابش در همان فهرست overview می‌آید)
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }
    if (advisor.status === 'ACTIVE') {
      return res.status(400).json({ error: 'این حساب از قبل فعال است' });
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
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });

    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }
    // حساب سوپرادمین هرگز نباید رد/قفل شود — وگرنه دسترسی مدیریتی از دست می‌رود
    if (advisor.role === 'SUPERADMIN') {
      return res.status(400).json({ error: 'حساب سوپرادمین قابل رد کردن نیست' });
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
// شامل شماره تماس مشاور، رشته‌های تخصص و دانش‌آموزان برای ارتباط
async function listAdvisorsOverview(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { role: { in: ['ADVISOR', 'SUPERADMIN'] } },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        status: true,
        // نقش برای فرانت لازم است تا ردیف سوپرادمین را با پیل مشخص نشان دهد
        role: true,
        field: true,
        institute: { select: { id: true, name: true } },
        advisorFields: { select: { field: true } },
        // اشتراک فردی — سوپرادمین برای تمدید/قطع پنل مشاور آن را ویرایش می‌کند
        subscription: { select: { status: true, tier: true, endsAt: true } },
        // مبلغ ماهانه‌ی تعیین‌شده برای این مشاور (تومان)
        monthlyPrice: true,
        asAdvisorLinks: {
          // فقط اتصال‌های ACTIVE — درخواست‌های PENDING هنوز دانش‌آموزِ مشاور نیستند
          // و نباید در فهرست دانش‌آموزان او نمایش داده شوند
          where: { status: 'ACTIVE' },
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
    res.json({
      advisors: advisors.map((a) => ({
        ...a,
        fields: a.advisorFields.map((af) => af.field),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ====== تخصیص رشته‌های تخصص به مشاور ======
// سوپرادمین می‌تواند رشته‌های تخصص مشاور را ویرایش کند.
// body: { fields: ['HUMANITIES', 'MATH_PHYSICS', ...] }
// آرایه‌ی خالی مجاز است (یعنی پاک‌کردن همه‌ی رشته‌ها — ولی این توصیه نمی‌شود)
async function assignAdvisorFields(req, res, next) {
  try {
    const { id } = req.params;
    let { fields } = req.body;

    // اعتبارسنجی: fields باید آرایه باشد
    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'fields باید آرایه باشد' });
    }
    // حذف تکراری‌ها و اعتبارسنجی مقادیر
    const validFields = ['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'];
    const unique = [...new Set(fields)];
    const invalid = unique.find((f) => !validFields.includes(f));
    if (invalid) {
      return res.status(400).json({ error: `رشته‌ی نامعتبر: ${invalid}` });
    }
    if (unique.length > 3) {
      return res.status(400).json({ error: 'نهایتاً ۳ رشته می‌توان انتخاب کرد' });
    }

    // سوپرادمین هم در فهرست overview هست و می‌تواند رشته‌ی تخصص داشته باشد
    // (دانش‌آموزانِ همان رشته او را در فرم ثبت‌نام می‌بینند)
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });
    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }

    // در یک تراکنش: حذف همه‌ی رشته‌های قبلی + اضافه‌کردن رشته‌های جدید
    await prisma.$transaction([
      prisma.advisorField.deleteMany({ where: { userId: id } }),
      ...(unique.length > 0
        ? [prisma.advisorField.createMany({
            data: unique.map((f) => ({ userId: id, field: f })),
          })]
        : []),
    ]);

    res.json({
      message: unique.length > 0
        ? `رشته‌های تخصص مشاور به‌روزرسانی شد: ${unique.join('، ')}`
        : 'همه‌ی رشته‌های تخصص مشاور پاک شد',
      advisor: { id, fullName: advisor.fullName, fields: unique },
    });
  } catch (err) {
    next(err);
  }
}

// ====== غیرفعال‌کردن مشاور (SUSPENDED) ======
// مشاور می‌تواند دوباره فعال شود (reactivate)
// مشاور SUSPENDED نمی‌تواند وارد شود و در فهرست مشاوران فعال دانش‌آموزان نیست
async function deactivateAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });
    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }
    // سوپرادمین نباید بتواند خودش را غیرفعال کند — وگرنه کل پنل مدیریتی قفل می‌شود
    if (advisor.id === req.user.id) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را غیرفعال کنید' });
    }
    if (advisor.status === 'SUSPENDED') {
      return res.status(400).json({ error: 'این حساب از قبل غیرفعال است' });
    }
    await prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
    res.json({ message: `مشاور «${advisor.fullName}» غیرفعال شد`, advisor: { id, status: 'SUSPENDED' } });
  } catch (err) {
    next(err);
  }
}

// ====== فعال‌کردن مجدد مشاور (ACTIVE) ======
async function reactivateAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });
    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }
    if (advisor.status !== 'SUSPENDED') {
      return res.status(400).json({ error: 'این حساب از قبل فعال است یا هنوز تأیید نشده' });
    }
    await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    res.json({ message: `مشاور «${advisor.fullName}» دوباره فعال شد`, advisor: { id, status: 'ACTIVE' } });
  } catch (err) {
    next(err);
  }
}

// ====== حذف مشاور (hard delete) ======
// این عمل قابل بازگشت نیست. همه‌ی داده‌های مرتبط (برنامه‌ها، آزمون‌ها، یادآورها، linkها)
// به‌خاطر onDelete: Cascade حذف می‌شوند.
// توصیه: اول غیرفعال‌کردن، بعد اگر مطمئن بودید حذف کنید.
async function deleteAdvisor(req, res, next) {
  try {
    const { id } = req.params;
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });
    if (!advisor) {
      return res.status(404).json({ error: 'مشاور یافت نشد' });
    }
    // سوپرادمین نباید بتواند حساب خودش را حذف کند — آخرین ادمین از دست می‌رود
    if (advisor.id === req.user.id) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را حذف کنید' });
    }
    const studentCount = await prisma.advisorStudentLink.count({
      where: { advisorId: id },
    });
    // حذف کاربر — همه‌ی روابط cascade می‌شوند
    await prisma.user.delete({ where: { id } });
    res.json({
      message: `مشاور «${advisor.fullName}» حذف شد. ${studentCount} اتصال دانش‌آموز نیز پاک شد.`,
      advisor: { id, fullName: advisor.fullName },
    });
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
        // محدودیت ظرفیت مشاوران مؤسسه — فقط وقتی مشاور را «به داخل» مؤسسه می‌بریم
        if (advisor.instituteId !== trimmed) {
          const [sub, currentCount] = await Promise.all([
            prisma.instituteSubscription.findUnique({ where: { instituteId: trimmed } }),
            prisma.user.count({ where: { instituteId: trimmed, role: 'ADVISOR' } }),
          ]);
          const capacity = remainingInstituteCapacity(sub, 'ADVISOR', currentCount);
          if (!capacity.ok) {
            return res.status(403).json({ error: `${inst.name}: ${CAPACITY_ERROR}` });
          }
        }
        instituteId = trimmed;
      }
    }

    // سوپرادمین هم می‌تواند به مؤسسه تخصیص یابد (یا از آن جدا شود)
    const advisor = await prisma.user.findFirst({
      where: { id, role: { in: ['ADVISOR', 'SUPERADMIN'] } },
    });
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

// ====== تعیین نماینده (سردار) مؤسسه ======
// سوپرادمین یکی از اعضای مؤسسه (معمولاً مشاور) را به‌عنوان نماینده تعیین می‌کند.
// نماینده اختیارات مدیر مؤسسه را دارد (تأیید اعضا، دیدن فهرست‌ها، حذف عضو)
// ولی نقشش INSTITUTE_MANAGER نمی‌شود — فقط Institute.leaderId ست می‌شود.
// body: { leaderId: "userId" } برای تعیین یا { leaderId: null } برای عزل
async function setInstituteLeader(req, res, next) {
  try {
    const { id } = req.params;
    const { leaderId } = req.body;

    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) {
      return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }

    // عزل — leaderId: null
    if (leaderId === null) {
      await prisma.institute.update({ where: { id }, data: { leaderId: null } });
      return res.json({ message: `نماینده‌ی مؤسسه‌ی «${institute.name}» عزل شد` });
    }

    // عضو باید واقعاً عضو همین مؤسسه و فعال باشد
    const member = await prisma.user.findFirst({
      where: {
        id: leaderId,
        instituteId: id,
        role: { in: ['ADVISOR', 'STUDENT'] },
        status: 'ACTIVE',
      },
    });
    if (!member) {
      return res.status(400).json({
        error: 'نماینده باید یک عضو فعال همین مؤسسه باشد (مشاور یا دانش‌آموز)',
      });
    }

    await prisma.institute.update({ where: { id }, data: { leaderId } });
    res.json({
      message: `«${member.fullName}» به‌عنوان نماینده‌ی مؤسسه‌ی «${institute.name}» تعیین شد`,
      leader: { id: member.id, fullName: member.fullName },
    });
  } catch (err) {
    next(err);
  }
}

// ====== ساخت رمز یک‌بار مصرف (OTP) برای کاربر ======
// سوپرادمین وقتی کاربر رمزش را فراموش کرده، یک OTP می‌سازد؛ کد به‌صورت خودکار
// به ایمیل کاربر ارسال می‌شود (اگر SMTP تنظیم باشد؛ در حالت توسعه فقط لاگ می‌شود)
// و برای اطمینان همان‌جا در پاسخ هم برگردانده می‌شود تا در صورت نبود SMTP
// سوپرادمین بتواند دستی به کاربر بدهد. کاربر با ایمیل + OTP وارد می‌شود.
// OTP فقط یک بار کار می‌کند و بعد پاک می‌شود.
// طول عمر پیش‌فرض ۲۴ ساعت است (با ttlHours قابل تنظیم).
//
// نکته‌ی مهم: وقتی OTP ساخته می‌شود:
//   1) mustChangePassword=true می‌شود → کاربر باید بعد از ورود رمز جدید بگذارد
//   2) passwordHash قبلی با یک هش تصادفی جایگزین می‌شود → رمز قبلی دیگر کار نمی‌کند
//      (چون کاربر گفت رمزش را فراموش کرده، منطقی است که رمز قبلی دیگر معتبر نباشد)
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

    // رمز قبلی را بی‌اعتبار می‌کنیم با جایگزینی passwordHash با یک هش تصادفی غیرقابل حدس.
    // اینطوری حتی اگر کاربر رمز قبلیش را به یاد بیاورد، با آن نمی‌تواند وارد شود.
    const randomInvalidator = crypto.randomBytes(32).toString('hex');
    const invalidatedPasswordHash = await bcrypt.hash(randomInvalidator, SALT_ROUNDS);

    await prisma.user.update({
      where: { id },
      data: {
        otpHash,
        otpExpiresAt,
        mustChangePassword: true,
        passwordHash: invalidatedPasswordHash,
      },
    });

    // ارسال خودکار کد به ایمیل کاربر — حتی اگر شکست بخورد، OTP ساخته شده معتبر می‌ماند
    // و در پاسخ به سوپرادمین برگردانده می‌شود تا دستی ارسالش کند.
    let emailed = false;
    try {
      const mailResult = await sendOtpEmail({
        to: user.email,
        otp,
        userName: user.fullName,
        ttlMinutes: ttl * 60,
      });
      emailed = !mailResult?.devMode;
    } catch (mailErr) {
      req.log?.error?.({ err: mailErr }, 'ارسال ایمیل OTP ناموفق');
    }

    res.json({
      message: emailed
        ? 'رمز یک‌بارمصرف ساخته شد و به ایمیل کاربر ارسال شد. رمز قبلی او بی‌اعتبار شد.'
        : 'رمز یک‌بارمصرف ساخته شد. SMTP تنظیم نیست، پس کد را دستی به کاربر بدهید. رمز قبلی او بی‌اعتبار شد.',
      otp,
      emailed,
      expiresAt: otpExpiresAt,
      ttlHours: ttl,
      // اطلاع‌رسانی به ادمین که کاربر باید بعد از ورود رمزش را عوض کند
      note: 'این رمز فقط یک بار قابل استفاده است. کاربر باید بعد از ورود، رمز عبور جدیدی تعیین کند — رمز قبلی دیگر کار نمی‌کند.',
    });
  } catch (err) {
    next(err);
  }
}

// ====== مدیریت دانش‌آموزان (سوپرادمین) ======
// نمای کلی: همه‌ی دانش‌آموزان + مشاور متصل، مؤسسه، رشته، تماس و وضعیت
async function listStudentsOverview(req, res, next) {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        field: true,
        status: true,
        photoUrl: true,
        createdAt: true,
        institute: { select: { id: true, name: true } },
        // اشتراک فردی دانش‌آموز — سوپرادمین می‌تواند دستی تمدید کند
        subscription: { select: { status: true, tier: true, endsAt: true } },
        // مبلغ ماهانه‌ی تعیین‌شده برای این دانش‌آموز (تومان)
        monthlyPrice: true,
        asStudentLinks: {
          select: {
            status: true,
            createdAt: true,
            advisor: { select: { id: true, fullName: true, role: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      students: students.map((s) => {
        const activeLink = s.asStudentLinks.find((l) => l.status === 'ACTIVE');
        const pendingLink = s.asStudentLinks.find((l) => l.status === 'PENDING');
        return {
          id: s.id,
          fullName: s.fullName,
          email: s.email,
          phone: s.phone,
          bio: s.bio,
          field: s.field,
          status: s.status,
          photoUrl: s.photoUrl,
          createdAt: s.createdAt,
          institute: s.institute,
          // مشاور فعلی (ACTIVE) و درخواست در انتظار (PENDING) — جدا از هم
          advisor: activeLink ? activeLink.advisor : null,
          pendingAdvisor: pendingLink ? pendingLink.advisor : null,
          linkCreatedAt: (activeLink || pendingLink)?.createdAt || null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

// غیرفعال‌کردن دانش‌آموز (SUSPENDED) — قابل بازگشت با reactivate
async function deactivateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const student = await prisma.user.findFirst({ where: { id, role: 'STUDENT' } });
    if (!student) {
      return res.status(404).json({ error: 'دانش‌آموز یافت نشد' });
    }
    if (student.id === req.user.id) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را غیرفعال کنید' });
    }
    if (student.status === 'SUSPENDED') {
      return res.status(400).json({ error: 'این حساب از قبل غیرفعال است' });
    }
    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
    res.json({ message: `دانش‌آموز «${student.fullName}» غیرفعال شد`, student: { id, status: 'SUSPENDED' } });
  } catch (err) {
    next(err);
  }
}

// فعال‌کردن مجدد دانش‌آموز
async function reactivateStudent(req, res, next) {
  try {
    const { id } = req.params;
    const student = await prisma.user.findFirst({ where: { id, role: 'STUDENT' } });
    if (!student) {
      return res.status(404).json({ error: 'دانش‌آموز یافت نشد' });
    }
    if (student.status !== 'SUSPENDED') {
      return res.status(400).json({ error: 'این حساب غیرفعال نیست' });
    }
    await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    res.json({ message: `دانش‌آموز «${student.fullName}» دوباره فعال شد`, student: { id, status: 'ACTIVE' } });
  } catch (err) {
    next(err);
  }
}

// حذف دانش‌آموز (hard delete) — برنامه‌ها، آزمون‌ها و یادآورهایش cascade می‌شوند
async function deleteStudent(req, res, next) {
  try {
    const { id } = req.params;
    const student = await prisma.user.findFirst({ where: { id, role: 'STUDENT' } });
    if (!student) {
      return res.status(404).json({ error: 'دانش‌آموز یافت نشد' });
    }
    if (student.id === req.user.id) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را حذف کنید' });
    }
    await prisma.user.delete({ where: { id } });
    res.json({
      message: `دانش‌آموز «${student.fullName}» حذف شد. همه‌ی برنامه‌ها و آزمون‌های او نیز پاک شد.`,
      student: { id, fullName: student.fullName },
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم اشتراک فردی کاربر توسط سوپرادمین ======
// مثل اشتراک مؤسسه: تاریخ پایان (endsAt) یا تعداد روز از حالا (daysFromNow) + وضعیت.
// کاربرد اصلی: تمدید/قطع پنل مشاورها و دانش‌آموزهایی که عضو هیچ مؤسسه‌ای نیستند.
// کاربر سوپرادمین اشتراک نمی‌خواهد (همیشه آزاد است) — رد می‌شود.
async function updateUserSubscription(req, res, next) {
  try {
    const { id } = req.params;
    const { endsAt, daysFromNow: days, status } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
    if (user.role === 'SUPERADMIN') {
      return res.status(400).json({ error: 'سوپرادمین به اشتراک نیاز ندارد' });
    }

    let finalEndsAt;
    if (endsAt) {
      finalEndsAt = new Date(endsAt);
      if (isNaN(finalEndsAt.getTime())) {
        return res.status(400).json({ error: 'تاریخ پایان نامعتبر است' });
      }
    } else if (days) {
      finalEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const data = {};
    if (finalEndsAt) data.endsAt = finalEndsAt;
    if (status) data.status = status;

    const subscription = await prisma.userSubscription.upsert({
      where: { userId: id },
      create: {
        userId: id,
        status: status || 'ACTIVE',
        startsAt: new Date(),
        endsAt: finalEndsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: data,
    });

    res.json({
      message: 'اشتراک کاربر به‌روزرسانی شد',
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

// ====== تنظیم سقف اعضای مؤسسه توسط سوپرادمین ======
// body: { maxAdvisors: number|null, maxStudents: number|null } — null یعنی بی‌نهایت.
// وقتی ظرفیت پر شود، ثبت‌نام/تأیید عضو جدید با پیام ارتقا اشتراک رد می‌شود.
async function updateInstituteLimits(req, res, next) {
  try {
    const { id } = req.params;
    const { maxAdvisors, maxStudents } = req.body;

    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) return res.status(404).json({ error: 'مؤسسه یافت نشد' });

    const subscription = await prisma.instituteSubscription.upsert({
      where: { instituteId: id },
      create: {
        instituteId: id,
        status: 'TRIAL',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        maxAdvisors,
        maxStudents,
      },
      update: { maxAdvisors, maxStudents },
    });

    res.json({
      message: 'محدودیت اعضای مؤسسه به‌روزرسانی شد',
      limits: { maxAdvisors: subscription.maxAdvisors, maxStudents: subscription.maxStudents },
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم مبلغ ماهانه‌ی اشتراک یک کاربر (دانش‌آموز/مشاور) توسط سوپرادمین ======
// body: { monthlyPrice: number|null } — به تومان؛ null یعنی حذف قیمت (مدت تمدید دستی تعیین می‌شود)
// دانش‌آموز/مشاور این مبلغ را در صفحه‌ی واریز می‌بیند و مبنای محاسبه‌ی خودکار
// روزهای تمدید هنگام تأیید رسید است (مبلغ واریزی ÷ قیمت ماهانه × ۳۰ روز).
async function updateUserMonthlyPrice(req, res, next) {
  try {
    const { id } = req.params;
    const { monthlyPrice } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
    if (user.role === 'SUPERADMIN') {
      return res.status(400).json({ error: 'سوپرادمین به اشتراک و قیمت‌گذاری نیاز ندارد' });
    }

    const price = monthlyPrice === null || monthlyPrice === undefined || monthlyPrice === ''
      ? null
      : Number(monthlyPrice);
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10000000000)) {
      return res.status(400).json({ error: 'مبلغ ماهانه باید عدد صحیح غیرمنفی باشد' });
    }

    const updated = await prisma.user.update({ where: { id }, data: { monthlyPrice: price } });
    res.json({
      message: price != null ? `مبلغ ماهانه‌ی «${updated.fullName}» به ${price.toLocaleString('fa-IR')} تومان تنظیم شد` : `مبلغ ماهانه‌ی «${updated.fullName}» حذف شد`,
      monthlyPrice: updated.monthlyPrice,
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم مبلغ ماهانه‌ی اشتراک مؤسسه توسط سوپرادمین ======
// body: { monthlyPrice: number|null } — به تومان؛ null یعنی حذف قیمت.
async function updateInstituteMonthlyPrice(req, res, next) {
  try {
    const { id } = req.params;
    const { monthlyPrice } = req.body;

    const institute = await prisma.institute.findUnique({ where: { id } });
    if (!institute) return res.status(404).json({ error: 'مؤسسه یافت نشد' });

    const price = monthlyPrice === null || monthlyPrice === undefined || monthlyPrice === ''
      ? null
      : Number(monthlyPrice);
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10000000000)) {
      return res.status(400).json({ error: 'مبلغ ماهانه باید عدد صحیح غیرمنفی باشد' });
    }

    await prisma.institute.update({ where: { id }, data: { monthlyPrice: price } });
    res.json({
      message: price != null ? `مبلغ ماهانه‌ی مؤسسه‌ی «${institute.name}» به ${price.toLocaleString('fa-IR')} تومان تنظیم شد` : `مبلغ ماهانه‌ی مؤسسه‌ی «${institute.name}» حذف شد`,
      monthlyPrice: price,
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم/ویرایش کارت واریز مؤسسه یا کارت پلتفرم توسط سوپرادمین ======
// body: { kind: 'INSTITUTE'|'SYSTEM', cardNumber, shaba?, holderName? }
async function setCardSettings(req, res, next) {
  try {
    const { kind, cardNumber, shaba, holderName } = req.body;

    // نرمال‌سازی شماره کارت (فاصله/خط تیره/اعداد فارسی)
    const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
    const normalized = String(cardNumber)
      .replace(/[\s-]/g, '')
      .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)));
    if (!/^\d{16}$/.test(normalized)) {
      return res.status(400).json({ error: 'شماره کارت باید دقیقاً ۱۶ رقم باشد' });
    }

    const ownerId = kind === 'INSTITUTE' ? req.params.id : null;
    if (kind === 'INSTITUTE') {
      const inst = await prisma.institute.findUnique({ where: { id: ownerId } });
      if (!inst) return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }
    if (kind !== 'INSTITUTE' && kind !== 'SYSTEM') {
      return res.status(400).json({ error: 'نوع کارت نامعتبر است' });
    }
    // مبلغ ماهانه‌ی اختیاری روی کارت — null/خالی یعنی حذف قیمت
    let monthlyPrice = null;
    if (req.body.monthlyPrice !== null && req.body.monthlyPrice !== undefined && req.body.monthlyPrice !== '') {
      monthlyPrice = Number(req.body.monthlyPrice);
      if (!Number.isInteger(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 10000000000) {
        return res.status(400).json({ error: 'مبلغ ماهانه باید عدد صحیح غیرمنفی باشد' });
      }
    }

    // نکته: برای کارت SYSTEM، ownerId قرار است null باشد و Prisma در where
    // ترکیبی ownerKind_ownerId مقدار null را نمی‌پذیرد — پس SYSTEM را با findFirst
    // و INSTITUTE را با upsert معمولی مدیریت می‌کنیم.
    const cardData = { cardNumber: normalized, shaba: shaba || null, holderName: holderName || null, monthlyPrice };
    const card = kind === 'SYSTEM'
      ? await prisma.cardSettings.findFirst({ where: { ownerKind: 'SYSTEM' } })
      : null;
    const saved = kind === 'SYSTEM'
      ? (card
        ? prisma.cardSettings.update({
          where: { id: card.id },
          data: cardData,
        })
        : prisma.cardSettings.create({
          data: { ownerKind: 'SYSTEM', ownerId: null, ...cardData },
        }))
      : await prisma.cardSettings.upsert({
        where: { ownerKind_ownerId: { ownerKind: 'INSTITUTE', ownerId } },
        create: { ownerKind: 'INSTITUTE', ownerId, ...cardData },
        update: cardData,
      });

    res.json({ message: 'شماره کارت ذخیره شد', card: saved });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
  listStudentsOverview,
  deactivateStudent,
  reactivateStudent,
  deleteStudent,
  createInstitute,
  listInstitutes,
  activateInstitute,
  deleteInstitute,
  updateInstituteSubscription,
  assignAdvisorToInstitute,
  assignAdvisorFields,
  deactivateAdvisor,
  reactivateAdvisor,
  deleteAdvisor,
  createUserOtp,
  setInstituteLeader,
  updateUserSubscription,
  updateInstituteLimits,
  updateUserMonthlyPrice,
  updateInstituteMonthlyPrice,
  setCardSettings,
};
