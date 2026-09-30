const prisma = require('../config/prisma');
const { pruneAdvisorStudentLinks } = require('../utils/orphans');
const { CAPACITY_ERROR, remainingInstituteCapacity } = require('../utils/subscription');

// فهرست دانش‌آموزهای «فعال» مشاور — فقط اتصال‌های ACTIVE.
// درخواست‌های PENDING اینجا نیستند (به /api/advisors/me/pending-students بروید)
// تا دانش‌آموز قبل از تأیید مشاور، در فهرست دانش‌آموزان او ظاهر نشود.
async function listMyStudents(req, res, next) {
  try {
    // لینک یتیم (دانش‌آموز حذف‌شده‌ای که ردیفش مانده) رابطه‌ی الزامیِ student را
    // null برمی‌گرداند و کل فهرست را می‌شکند — اول پاکش می‌کنیم.
    await pruneAdvisorStudentLinks();
    const links = await prisma.advisorStudentLink.findMany({
      where: { advisorId: req.user.id, status: 'ACTIVE' },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            bio: true,
            field: true,
            photoUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const students = links.map((link) => ({
      ...link.student,
      linkId: link.id,
      linkStatus: link.status,
      weeklyGoalMinutes: link.weeklyGoalMinutes,
    }));
    res.json({ students });
  } catch (err) {
    next(err);
  }
}

// دریافت هدف هفتگی دانش‌آموز (برای خودش)
// حتی اگر link هنوز PENDING است، هدف را برمی‌گرداند (البته مشاور هنوز فرصت تنظیم نداشته)
async function getMyWeeklyGoal(req, res, next) {
  try {
    const link = await prisma.advisorStudentLink.findFirst({
      where: { studentId: req.user.id, status: { in: ['PENDING', 'ACTIVE', 'REJECTED'] } },
      select: { weeklyGoalMinutes: true, status: true },
    });
    res.json({
      weeklyGoalMinutes: link?.weeklyGoalMinutes || null,
      linkStatus: link?.status || null,
    });
  } catch (err) {
    next(err);
  }
}

// مشاور هدف هفتگی را برای یکی از دانش‌آموزهای خودش تنظیم می‌کند
// نکته: فقط لینک‌های ACTIVE قابل تنظیم هدف هستند (PENDING نباید هدف بگیرد)
async function setStudentWeeklyGoal(req, res, next) {
  try {
    const { studentId } = req.params;
    const { weeklyGoalMinutes } = req.body;

    if (
      weeklyGoalMinutes === null ||
      weeklyGoalMinutes === undefined ||
      !Number.isInteger(weeklyGoalMinutes) ||
      weeklyGoalMinutes < 0 ||
      weeklyGoalMinutes > 7 * 24 * 60 // نهایتاً ۷ روز × ۲۴ ساعت
    ) {
      return res.status(400).json({ error: 'هدف هفتگی نامعتبر است (دقیقه، بین ۰ و ۱۰۰۸۰)' });
    }

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نشده' });
    }

    await prisma.advisorStudentLink.update({
      where: { id: link.id },
      data: { weeklyGoalMinutes },
    });

    res.json({ message: 'هدف هفتگی به‌روزرسانی شد', weeklyGoalMinutes });
  } catch (err) {
    next(err);
  }
}

// دریافت اطلاعات مشاور دانش‌آموز (نام، ایمیل، شماره تماس، توضیحات، رشته)
// حتی اگر link هنوز PENDING است، اطلاعات مشاور را برمی‌گرداند تا دانش‌آموز بداند چه کسی باید تأییدش کند.
// در فرانت، وضعیت link نشان داده می‌شود.
async function getMyAdvisor(req, res, next) {
  try {
    const link = await prisma.advisorStudentLink.findFirst({
      where: { studentId: req.user.id, status: { in: ['PENDING', 'ACTIVE', 'REJECTED'] } },
      include: {
        advisor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            bio: true,
            field: true,
          },
        },
      },
    });
    if (!link) {
      return res.status(404).json({ error: 'هنوز مشاوری به شما متصل نشده' });
    }
    res.json({
      advisor: link.advisor,
      linkStatus: link.status,
      linkCreatedAt: link.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

// دانش‌آموز خودش مشاور انتخاب می‌کند (بعد از تکمیل رشته داخل پنل)
// قواعد همان ثبت‌نام است: مشاور فعال + هم‌مؤسسه با دانش‌آموز + تخصص در رشته‌ی او.
// اگر قبلاً لینک REJECTED/PENDING داشته باشد، همان لینک به مشاور جدید به‌روزرسانی می‌شود.
async function chooseMyAdvisor(req, res, next) {
  try {
    const { advisorId } = req.body;
    const student = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!student || student.role !== 'STUDENT') {
      return res.status(403).json({ error: 'فقط دانش‌آموز مشاور انتخاب می‌کند' });
    }
    if (!student.field) {
      return res.status(400).json({ error: 'اول رشته‌ی تحصیلی‌ات را انتخاب کن، بعد مشاورت را' });
    }

    const advisor = await prisma.user.findFirst({
      where: { id: advisorId, role: { in: ['ADVISOR', 'SUPERADMIN'] }, status: 'ACTIVE' },
      include: { advisorFields: { select: { field: true } } },
    });
    if (!advisor) {
      return res.status(400).json({ error: 'مشاور انتخاب‌شده یافت نشد یا هنوز فعال نیست' });
    }
    if (advisor.instituteId !== (student.instituteId || null)) {
      return res.status(400).json({
        error: student.instituteId
          ? 'این مشاور عضو مؤسسه‌ی تو نیست؛ از مشاوران همان مؤسسه انتخاب کن'
          : 'این مشاور عضو یک مؤسسه است؛ برای انتخابش باید ابتدا عضو همان مؤسسه شوی',
      });
    }
    const advisorFieldList = advisor.advisorFields.map((af) => af.field);
    if (!advisorFieldList.includes(student.field)) {
      return res.status(400).json({ error: 'این مشاور در رشته‌ی تو تخصص ندارد' });
    }

    // دانش‌آموز مؤسسه‌ای باید قبلاً توسط مدیر مؤسسه تأیید شده باشد (ACTIVE)؛
    // این مسیر فقط برای ACTIVE باز است (requireRole این را در سطح مسیر تضمین نمی‌کند؛
    // status در authenticate چک می‌شود — اینجا دیگر نگرانی نیست).
    const existing = await prisma.advisorStudentLink.findFirst({
      where: {
        studentId: student.id,
        status: { in: ['PENDING', 'ACTIVE', 'REJECTED'] },
      },
    });

    let link;
    if (existing) {
      link = await prisma.advisorStudentLink.update({
        where: { id: existing.id },
        data: { advisorId: advisor.id, status: 'PENDING' },
      });
    } else {
      link = await prisma.advisorStudentLink.create({
        data: { advisorId: advisor.id, studentId: student.id, status: 'PENDING' },
      });
    }

    res.json({
      message: `درخواست اتصال به «${advisor.fullName}» ارسال شد — بعد از تأیید او، برنامه‌ات را اینجا می‌بینی`,
      linkId: link.id,
      advisor: { id: advisor.id, fullName: advisor.fullName },
      linkStatus: link.status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyStudents, getMyWeeklyGoal, setStudentWeeklyGoal, getMyAdvisor, chooseMyAdvisor };
