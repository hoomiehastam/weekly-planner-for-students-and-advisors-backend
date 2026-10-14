const prisma = require('../config/prisma');

// ====== دسترسی به داده‌ی یک دانش‌آموز ======
// چرا این کاربر حق دیدن داده‌ی این دانش‌آموز را دارد:
//   'SELF'    — خودِ دانش‌آموز
//   'ADVISOR' — مشاور متصل و تأییدشده (ACTIVE)
//   'PARENT'  — والد متصل
//   null      — دسترسی ندارد
// در چند کنترلر (نمرات آزمون آزمایشی، برنامه‌ی امتحان‌ها و ...) یکسان استفاده می‌شود
// تا منطق دسترسی یک‌جا بماند و از هم واگرا نشود.
async function getStudentAccess(actorId, studentId) {
  if (!actorId || !studentId) return null;
  if (actorId === studentId) return 'SELF';
  const [self, advisor, parent] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true } }),
    prisma.advisorStudentLink.findFirst({ where: { advisorId: actorId, studentId, status: 'ACTIVE' } }),
    prisma.parentLink.findFirst({ where: { parentId: actorId, studentId } }),
  ]);
  if (!self) return null;
  if (advisor) return 'ADVISOR';
  if (parent) return 'PARENT';
  return null;
}

module.exports = { getStudentAccess };
