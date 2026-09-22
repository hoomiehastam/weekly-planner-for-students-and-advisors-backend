const prisma = require('../config/prisma');

// ====== کنترلرهای مدیر مؤسسه ======
// قانون طلایی اسکوپینگ: هر کوئری با instituteId که از req.user (نه کلاینت) آمده
// فیلتر می‌شود، و رکورد تکی همیشه با findFirst({ id, instituteId }) گرفته می‌شود
// تا شناسه‌ی حدسی چیزی لو ندهد (۴۰۴، نه ۴۰۳-بعد-از-گرفتن).
// مدیر فقط «خواندنی + تأیید اعضا» است — ساخت برنامه/آزمون ندارد (requireRole خودش این را می‌بندد).

// نمای کلی مؤسسه: مشخصات + شمارنده‌ها
async function getInstituteMe(req, res, next) {
  try {
    const institute = await prisma.institute.findFirst({
      where: { id: req.instituteId },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        createdAt: true,
        subscription: {
          select: { status: true, tier: true, endsAt: true },
        },
      },
    });
    if (!institute) {
      return res.status(404).json({ error: 'مؤسسه یافت نشد' });
    }

    const [advisorCount, studentCount, pendingCount] = await Promise.all([
      prisma.user.count({ where: { instituteId: req.instituteId, role: 'ADVISOR' } }),
      prisma.user.count({ where: { instituteId: req.instituteId, role: 'STUDENT' } }),
      prisma.user.count({
        where: { instituteId: req.instituteId, status: 'PENDING', role: { in: ['ADVISOR', 'STUDENT'] } },
      }),
    ]);

    res.json({
      institute: { ...institute, advisorCount, studentCount, pendingCount },
    });
  } catch (err) {
    next(err);
  }
}

// فهرست مشاوران مؤسسه + تعداد دانش‌آموزان هرکدام
// فقط اعضای مؤسسه‌ی خود مدیر — نه یک قطره از مؤسسه‌های دیگر یا مستقل‌ها
async function listInstituteAdvisors(req, res, next) {
  try {
    const advisors = await prisma.user.findMany({
      where: { instituteId: req.instituteId, role: 'ADVISOR' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        bio: true,
        status: true,
        createdAt: true,
        asAdvisorLinks: { select: { student: { select: { id: true, fullName: true, status: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      advisors: advisors.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        email: a.email,
        phone: a.phone,
        bio: a.bio,
        status: a.status,
        createdAt: a.createdAt,
        students: a.asAdvisorLinks.map((l) => l.student),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// تأیید/رد یک عضو در انتظار (مشاور یا دانش‌آموز) — فقطِ مؤسسه‌ی خودی
// فقط status تغییر می‌کند: نقش و instituteId دست‌نیافتنی‌اند (ضد escalade)
async function approveMember(req, res, next) {
  try {
    const { id } = req.params;
    const member = await prisma.user.findFirst({
      where: { id, instituteId: req.instituteId, role: { in: ['ADVISOR', 'STUDENT'] }, status: 'PENDING' },
    });
    if (!member) {
      return res.status(404).json({ error: 'درخواستی برای تأیید یافت نشد' });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true, fullName: true, role: true, status: true },
    });
    res.json({ message: 'عضو تأیید شد', member: updated });
  } catch (err) {
    next(err);
  }
}

async function rejectMember(req, res, next) {
  try {
    const { id } = req.params;
    const member = await prisma.user.findFirst({
      where: { id, instituteId: req.instituteId, role: { in: ['ADVISOR', 'STUDENT'] }, status: 'PENDING' },
    });
    if (!member) {
      return res.status(404).json({ error: 'درخواستی برای رد یافت نشد' });
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { status: 'REJECTED' },
      select: { id: true, fullName: true, role: true, status: true },
    });
    res.json({ message: 'عضو رد شد', member: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getInstituteMe,
  listInstituteAdvisors,
  approveMember,
  rejectMember,
};
