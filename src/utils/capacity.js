const prisma = require('../config/prisma');
const { hasEffectiveAccess, CAPACITY_ERROR } = require('./subscription');

// ====== سقف دانش‌آموز فعال ======
// «دانش‌آموز فعال» = حساب ACTIVE + اتصال به مشاور ACTIVE + اشتراک معتبر
// (اشتراک فردی یا اشتراک مؤسسه فعال باشد؛ حساب بدون هیچ رکورد اشتراک مطابق قاعده‌ی
// سازگاری با عقب «فعال» حساب می‌شود).
//
// قاعده‌ی اعمال:
//   - مشاور عضو مؤسسه: فقط سقف مؤسسه (InstituteSubscription.maxStudents) — سقف شخصی ندارد.
//   - مشاور مستقل: سقف شخصی User.maxActiveStudents.
//   - سوپرادمین (در نقش مشاور): بدون سقف.
// سقف فقط «ورودی جدید» را می‌بندد؛ دانش‌آموزان فعلی هیچ‌وقت به‌خاطر کاهش سقف قطع نمی‌شوند.

const ADVISOR_CAPACITY_ERROR = 'ظرفیت دانش‌آموز این مشاور تکمیل است و فعلاً دانش‌آموز جدید نمی‌پذیرد.';

const STUDENT_SELECT = {
  id: true,
  role: true,
  status: true,
  subscription: true,
  institute: { select: { subscription: true } },
};

// آیا این دانش‌آموزِ واکشی‌شده (با select بالا) «فعال» حساب می‌شود؟
function isStudentCountable(student) {
  if (!student || student.status !== 'ACTIVE') return false;
  return hasEffectiveAccess(student, {
    userSub: student.subscription,
    instituteSub: student.institute?.subscription || null,
  });
}

// تعداد دانش‌آموزان فعال یک مشاور
async function countActiveStudentsOfAdvisor(advisorId, db = prisma) {
  const links = await db.advisorStudentLink.findMany({
    where: { advisorId, status: 'ACTIVE', student: { role: 'STUDENT' } },
    select: { student: { select: STUDENT_SELECT } },
  });
  return links.filter((l) => isStudentCountable(l.student)).length;
}

// تعداد دانش‌آموزان فعال یک مؤسسه (عضو مؤسسه + اتصال ACTIVE به یکی از مشاوران)
async function countActiveStudentsOfInstitute(instituteId, db = prisma) {
  const students = await db.user.findMany({
    where: {
      instituteId,
      role: 'STUDENT',
      status: 'ACTIVE',
      asStudentLinks: { some: { status: 'ACTIVE' } },
    },
    select: STUDENT_SELECT,
  });
  return students.filter(isStudentCountable).length;
}

// وضعیت ظرفیت مشاور برای پذیرش دانش‌آموز تازه
//   { scope: 'INSTITUTE'|'ADVISOR'|null, max, count, ok, error }
async function getAdvisorRoom(advisor, db = prisma) {
  if (!advisor) return { scope: null, max: null, count: 0, ok: true };

  if (advisor.instituteId) {
    const sub = await db.instituteSubscription.findUnique({ where: { instituteId: advisor.instituteId } });
    const max = sub?.maxStudents ?? null;
    if (max === null) return { scope: 'INSTITUTE', max: null, count: 0, ok: true };
    const count = await countActiveStudentsOfInstitute(advisor.instituteId, db);
    return { scope: 'INSTITUTE', max, count, ok: count < max, error: CAPACITY_ERROR };
  }

  if (advisor.role === 'SUPERADMIN') return { scope: null, max: null, count: 0, ok: true };

  const max = advisor.maxActiveStudents ?? null;
  if (max === null) return { scope: 'ADVISOR', max: null, count: 0, ok: true };
  const count = await countActiveStudentsOfAdvisor(advisor.id, db);
  return { scope: 'ADVISOR', max, count, ok: count < max, error: ADVISOR_CAPACITY_ERROR };
}

module.exports = {
  ADVISOR_CAPACITY_ERROR,
  isStudentCountable,
  countActiveStudentsOfAdvisor,
  countActiveStudentsOfInstitute,
  getAdvisorRoom,
};
