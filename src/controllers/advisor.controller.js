const prisma = require('../config/prisma');
const { pruneAdvisorStudentLinks } = require('../utils/orphans');

// این فهرست بدون نیاز به ورود در دسترس است، چون دانش‌آموز باید قبل از ثبت‌نام مشاورش را انتخاب کند.
// پارامترهای query:
//   ?instituteId=XXX  — فقط مشاوران همان مؤسسه (اگر ارسال نشود: فقط مشاوران مستقل)
//   ?field=HUMANITIES|MATH_PHYSICS|EXPERIMENTAL  — فقط مشاورانی که این رشته را در تخصص‌هایشان دارند
// برمی‌گرداند: id, fullName, bio, fields (آرایه رشته‌ها), activeStudentCount
async function listActiveAdvisors(req, res, next) {
  try {
    const { instituteId, field } = req.query;

    // اعتبارسنجی field اگر ارسال شده
    let fieldFilter = undefined;
    if (field) {
      if (!['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'].includes(field)) {
        return res.status(400).json({ error: 'رشته‌ی تحصیلی نامعتبر است' });
      }
      fieldFilter = field;
    }

    // اعتبارسنجی instituteId اگر ارسال شده
    let targetInstituteId = null;
    let filterByInstitute = false;
    if (instituteId && instituteId !== 'null' && instituteId !== '') {
      const inst = await prisma.institute.findUnique({
        where: { id: instituteId },
        select: { id: true, status: true },
      });
      if (!inst) {
        return res.status(400).json({ error: 'مؤسسه‌ی انتخاب‌شده یافت نشد' });
      }
      if (inst.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'این مؤسسه هنوز تأیید نشده است' });
      }
      targetInstituteId = inst.id;
      filterByInstitute = true;
    }

    // شرط فیلتر:
    //   - با instituteId: فقط مشاوران همون مؤسسه
    //   - بدون instituteId: فقط مشاوران مستقل (instituteId === null)
    //   - با field: فقط مشاورانی که این رشته را در advisorFields دارند
    const where = {
      status: 'ACTIVE',
      ...(fieldFilter
        ? { advisorFields: { some: { field: fieldFilter } } }
        : {}),
      ...(filterByInstitute
        ? { role: 'ADVISOR', instituteId: targetInstituteId }
        : { role: { in: ['ADVISOR', 'SUPERADMIN'] }, instituteId: null }),
    };

    const advisors = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        photoUrl: true,
        bio: true,
        field: true,
        // رشته‌های تخصص مشاور (چندتا)
        advisorFields: { select: { field: true } },
        // تعداد دانش‌آموزان فعال هر مشاور
        _count: {
          select: {
            asAdvisorLinks: { where: { status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    res.json({
      advisors: advisors.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        photoUrl: a.photoUrl || null,
        bio: a.bio,
        field: a.field, // برای backward compatibility
        fields: a.advisorFields.map((af) => af.field), // آرایه‌ی رشته‌ها
        activeStudentCount: a._count.asAdvisorLinks,
      })),
      filter: {
        type: filterByInstitute ? 'institute' : 'independent',
        instituteId: filterByInstitute ? targetInstituteId : null,
        field: fieldFilter || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

// فهرست عمومی مؤسسه‌های فعال — برای انتخاب در فرم ثبت‌نام
// فقط id و name را برمی‌گرداند (نه کد، نه اطلاعات حساس)
// فقط مؤسسه‌های ACTIVE نمایش داده می‌شوند
async function listPublicInstitutes(req, res, next) {
  try {
    const institutes = await prisma.institute.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        // تعداد مشاوران فعال هر مؤسسه — تا دانش‌آموز بداند گزینه‌های زیادی دارد
        _count: {
          select: {
            members: { where: { role: 'ADVISOR', status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json({
      institutes: institutes.map((i) => ({
        id: i.id,
        name: i.name,
        activeAdvisorCount: i._count.members,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ====== درخواست‌های اتصال دانش‌آموز به مشاور ======

// مشاور: فهرست دانش‌آموزانی که درخواست اتصال داده‌اند و هنوز PENDING هستند
async function listPendingStudentRequests(req, res, next) {
  try {
    // لینک یتیم (دانش‌آموز حذف‌شده) رابطه‌ی الزامیِ student را null برمی‌گرداند
    // و کل فهرست درخواست‌ها را خراب می‌کند — اول پاکش می‌کنیم.
    await pruneAdvisorStudentLinks();
    const links = await prisma.advisorStudentLink.findMany({
      where: { advisorId: req.user.id, status: 'PENDING' },
      select: {
        id: true,
        createdAt: true,
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
      orderBy: { createdAt: 'asc' },
    });
    res.json({ requests: links });
  } catch (err) {
    next(err);
  }
}

// مشاور: فهرست دانش‌آموزان فعال (تأییدشده) — برای کارهای روزمره
async function listActiveStudents(req, res, next) {
  try {
    await pruneAdvisorStudentLinks();
    const links = await prisma.advisorStudentLink.findMany({
      where: { advisorId: req.user.id, status: 'ACTIVE' },
      select: {
        id: true,
        weeklyGoalMinutes: true,
        student: {
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
      orderBy: { createdAt: 'asc' },
    });
    res.json({ students: links });
  } catch (err) {
    next(err);
  }
}

// مشاور: قبول یک درخواست اتصال دانش‌آموز
async function acceptStudentRequest(req, res, next) {
  try {
    const { id } = req.params; // id = linkId
    const link = await prisma.advisorStudentLink.findFirst({
      where: { id, advisorId: req.user.id, status: 'PENDING' },
    });
    if (!link) {
      return res.status(404).json({ error: 'درخواست یافت نشد یا قبلاً تصمیم گرفته شده' });
    }
    await prisma.advisorStudentLink.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    res.json({ message: 'دانش‌آموز قبول شد. اکنون می‌توانید برای او برنامه و آزمون بسازید.' });
  } catch (err) {
    next(err);
  }
}

// مشاور: رد یک درخواست اتصال دانش‌آموز
// وقتی رد می‌شود، link به REJECTED تغییر می‌کند. دانش‌آموز در پنلش می‌بیند که رد شده
// و می‌تواند مشاور دیگری انتخاب کند (با ثبت‌نام مجدد یا endpoint جداگانه).
async function rejectStudentRequest(req, res, next) {
  try {
    const { id } = req.params;
    const link = await prisma.advisorStudentLink.findFirst({
      where: { id, advisorId: req.user.id, status: 'PENDING' },
    });
    if (!link) {
      return res.status(404).json({ error: 'درخواست یافت نشد یا قبلاً تصمیم گرفته شده' });
    }
    await prisma.advisorStudentLink.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    res.json({ message: 'درخواست دانش‌آموز رد شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listActiveAdvisors,
  listPublicInstitutes,
  listPendingStudentRequests,
  listActiveStudents,
  acceptStudentRequest,
  rejectStudentRequest,
};
