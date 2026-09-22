const prisma = require('../config/prisma');
const crypto = require('crypto');

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

module.exports = {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
  createInstitute,
  listInstitutes,
  activateInstitute,
};
