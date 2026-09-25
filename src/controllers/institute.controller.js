const prisma = require('../config/prisma');
const { remainingInstituteCapacity, CAPACITY_ERROR } = require('../utils/subscription');

// ====== کنترلرهای مدیر مؤسسه (و «نماینده/سردار» تعیین‌شده توسط سوپرادمین) ======
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
          select: { status: true, tier: true, endsAt: true, maxAdvisors: true, maxStudents: true },
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
      institute: {
        ...institute,
        advisorCount,
        studentCount,
        pendingCount,
        // ظرفیت باقیمانده برای نمایش هشدار «اشتراک را ارتقا دهید» در پنل مؤسسه
        limits: {
          maxAdvisors: institute.subscription?.maxAdvisors ?? null,
          maxStudents: institute.subscription?.maxStudents ?? null,
          advisorsRemaining: institute.subscription?.maxAdvisors != null
            ? Math.max(0, institute.subscription.maxAdvisors - advisorCount)
            : null,
          studentsRemaining: institute.subscription?.maxStudents != null
            ? Math.max(0, institute.subscription.maxStudents - studentCount)
            : null,
        },
      },
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
        photoUrl: true,
        createdAt: true,
        // فقط اتصال‌های ACTIVE — درخواست‌های PENDING هنوز دانش‌آموزِ مشاور نیستند
        asAdvisorLinks: {
          where: { status: 'ACTIVE' },
          select: { student: { select: { id: true, fullName: true, status: true } } },
        },
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
    // --- محدودیت ظرفیت: تأیید عضو جدید نباید سقف اشتراک را رد کند ---
    const [sub, currentCount] = await Promise.all([
      prisma.instituteSubscription.findUnique({ where: { instituteId: req.instituteId } }),
      prisma.user.count({ where: { instituteId: req.instituteId, role: member.role } }),
    ]);
    const capacity = remainingInstituteCapacity(sub, member.role, currentCount);
    if (!capacity.ok) {
      return res.status(403).json({ error: CAPACITY_ERROR });
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

// فهرست دانش‌آموزان مؤسسه + مشاور متصل هرکدام
// برای کارت‌های «دانش‌آموزان مؤسسه» در پنل مدیر/سردار
async function listInstituteStudents(req, res, next) {
  try {
    const students = await prisma.user.findMany({
      where: { instituteId: req.instituteId, role: 'STUDENT' },
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
        asStudentLinks: {
          select: {
            status: true,
            advisor: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      students: students.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        email: s.email,
        phone: s.phone,
        bio: s.bio,
        field: s.field,
        status: s.status,
        photoUrl: s.photoUrl,
        createdAt: s.createdAt,
        // مشاورِ فعلی (ACTIVE) یا درخواستِ در انتظار (PENDING)
        advisor: s.asStudentLinks.find((l) => l.status === 'ACTIVE')?.advisor || null,
        pendingAdvisor: s.asStudentLinks.find((l) => l.status === 'PENDING')?.advisor || null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// حذف یک عضو از مؤسسه (دانش‌آموز یا مشاور) — کاربر حذف نمی‌شود، فقط مستقل می‌شود
// سردار/مدیر مؤسسه نمی‌تواند خودش را حذف کند (خودقفل‌شدگی)
async function removeMember(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'نمی‌توانید خودتان را از مؤسسه حذف کنید' });
    }
    const member = await prisma.user.findFirst({
      where: { id, instituteId: req.instituteId, role: { in: ['ADVISOR', 'STUDENT'] } },
    });
    if (!member) {
      return res.status(404).json({ error: 'عضوی با این مشخصات در مؤسسه‌ی شما یافت نشد' });
    }
    await prisma.user.update({
      where: { id },
      data: { instituteId: null },
    });
    res.json({ message: `«${member.fullName}» از مؤسسه حذف شد و به حساب مستقل تبدیل شد` });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getInstituteMe,
  listInstituteAdvisors,
  listInstituteStudents,
  approveMember,
  rejectMember,
  removeMember,
};
