// ====== پاک‌سازی ردیف‌های یتیم (orphan rows) ======
//
// چرا این فایل وجود دارد؟
// در schema، رابطه‌هایی مثل AdvisorStudentLink.student «الزامی» تعریف شده‌اند و
// قید خارجی‌شان ON DELETE CASCADE است. پس در یک دیتابیس سالم، حذف یک دانش‌آموز
// باید لینک‌هایش را هم پاک کند. ولی اگر قیدهای خارجی روی سرور واقعاً ساخته
// نشده باشند (مثلاً مایگریشن با دسترسی محدود اعمال شده، یا جدول‌ها با
// FOREIGN_KEY_CHECKS=0 / از phpMyAdmin ساخته یا حذف شده باشند)، ردیف لینک
// باقی می‌ماند و به کاربرِ حذف‌شده اشاره می‌کند. آن‌وقت هر کوئری‌ای که لینک را
// همراه رابطه‌ی student می‌خواند (مثل فهرست مشاوران در پنل سوپرادمین) با این خطا
// می‌شکند و کل فهرست نمایش داده نمی‌شود:
//
//   Inconsistent query result: Field student is required to return data, got `null` instead
//
// این ماژول سه کار می‌کند:
//   ۱) pruneAdvisorStudentLinks: پیش از خواندن لینک‌ها، ردیف‌های یتیم همان جدول
//      را پاک می‌کند تا یک ردیف خراب کل پنل را از کار نیندازد (خودترمیم‌شونده).
//   ۲) pruneOrphanRows: جاروی کامل همه‌ی جدول‌ها — یک‌بار در شروع سرور.
//   ۳) deleteUserRelatedRows: در حذف سختِ کاربر، ردیف‌های وابسته را صریحاً پاک
//      می‌کند تا به cascade دیتابیس وابسته نباشیم و یتیم جدید نسازیم.
//
// توابع پاک‌سازی fail-safe هستند: خطا نمی‌دهند و فقط لاگ می‌کنند، چون پاک‌سازی
// داده‌ی کمکی است و نباید خودِ درخواست را بشکند.
// برای تعمیر کامل (پاک‌سازی + ساخت قیدهای خارجی جاافتاده) یا:
//   prisma/repair-orphans.js  (نیازمند موتور Prisma)
//   prisma/repair-orphans.sql (بدون Prisma — برای phpMyAdmin/هاست‌هایی که موتور
//                             Prisma در آن‌ها پانیک می‌کند)

const prisma = require('../config/prisma');

// پاک‌سازی لینک‌های یتیم در مسیرِ هر درخواست لازم نیست؛ داده‌ی یتیم خودش
// تولید نمی‌شود (حذف کاربر صریحاً پاکش می‌کند) و اسکریپت تعمیر/جاروی بوت هم
// یک‌بار کافی است. پس با یک تال‌تایم کوتاه محدودش می‌کنیم تا روی هاست‌های
// ضعیف، کوئری اضافه به دیتابیس نرود.
// نکته‌ی دوم: روی بعضی هاست‌های اشتراکی موتور Prisma با
// «PANIC: timer has gone away» می‌میرد و کل کلاینت از کار می‌افتد؛
// محدود کردن تعداد فراخوانی یعنی یک پانیک، کل پنل را نمی‌خواباند.
const PRUNE_THROTTLE_MS = 60_000;
let lastPruneAt = 0;

/**
 * پاک‌کردن لینک‌های مشاور↔دانش‌آموزِ یتیم (که مشاور یا دانش‌آموزشان دیگر وجود ندارد).
 * روی هر کوئری‌ای که لینک را همراه رابطه‌ی student/advisor می‌خواند صدا زده می‌شود،
 * ولی حداکثر یک‌بار در هر ۶۰ ثانیه واقعاً اجرا می‌شود.
 * @param {object} [opts]
 * @param {boolean} [opts.force] تال‌تایم را نادیده بگیر (برای اسکریپت تعمیر)
 * @returns {Promise<number>} تعداد ردیف‌های پاک‌شده
 */
async function pruneAdvisorStudentLinks({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastPruneAt < PRUNE_THROTTLE_MS) return 0;
  lastPruneAt = now;
  try {
    // LEFT JOIN + IS NULL یعنی «طرفِ مقابل پیدا نشد» — چون advisorId/studentId در
    // schema اجباری‌اند، نبودِ ردیف متناظر در User یعنی لینک یتیم.
    // (به‌جای NOT EXISTS از JOIN استفاده شده چون این دستور DELETE است.)
    return await prisma.$executeRaw`
      DELETE l FROM \`AdvisorStudentLink\` l
      LEFT JOIN \`User\` s ON s.\`id\` = l.\`studentId\`
      LEFT JOIN \`User\` a ON a.\`id\` = l.\`advisorId\`
      WHERE s.\`id\` IS NULL OR a.\`id\` IS NULL
    `;
  } catch (err) {
    // این خطا fail-safe است و فقط لاگ می‌شود. توجه: خطای
    // «PANIC: timer has gone away» از موتور Prisma «non-recoverable» است، یعنی
    // کلاینت بعد از آن موقتاً از کار می‌افتد و کوئری‌های بعدی هم خطا می‌دهند.
    // برای همین تعداد فراخوانی محدود است و در آن حالت باید از
    // prisma/repair-orphans.sql داخل phpMyAdmin استفاده کنید.
    console.error('[orphans] prune AdvisorStudentLinks failed:', err.message);
    return 0;
  }
}

/**
 * جاروی کاملِ ردیف‌های یتیم در همه‌ی جدول‌هایی که به User/Institute اشاره می‌کنند.
 * با اسکریپت تعمیر اجرا می‌شود (یا در شروع سرور، اگر ORPHAN_SWEEP_ON_BOOT=1 باشد).
 * ترتیب از بچه به والد است تا هر جدول قبل از والدش پاک شود.
 *
 * نکته‌ی مهم: خطاها برگردانده می‌شوند و پنهان نمی‌شوند. روی هاست‌هایی که موتور
 * Prisma پانیک می‌کند («PANIC: timer has gone away») هر کوئری می‌شکند؛ اگر این
 * خطاها نادیده گرفته شوند، گزارش «هیچ ردیف یتیمی نبود» غلط از آب درمی‌آید.
 * @returns {Promise<{deleted: Array<{table: string, deleted: number}>, failed: Array<{table: string, message: string}>}>}
 */
async function pruneOrphanRows() {
  const sweeps = [
    ['ExamAnswer', 'DELETE a FROM `ExamAnswer` a LEFT JOIN `ExamSubmission` s ON s.`id` = a.`submissionId` LEFT JOIN `ExamQuestion` q ON q.`id` = a.`questionId` WHERE s.`id` IS NULL OR q.`id` IS NULL'],
    ['ExamSubmission', 'DELETE s FROM `ExamSubmission` s LEFT JOIN `Exam` e ON e.`id` = s.`examId` LEFT JOIN `User` u ON u.`id` = s.`studentId` WHERE e.`id` IS NULL OR u.`id` IS NULL'],
    ['ExamQuestion', 'DELETE q FROM `ExamQuestion` q LEFT JOIN `Exam` e ON e.`id` = q.`examId` WHERE e.`id` IS NULL'],
    ['Exam', 'DELETE e FROM `Exam` e LEFT JOIN `User` st ON st.`id` = e.`studentId` LEFT JOIN `User` ad ON ad.`id` = e.`advisorId` WHERE st.`id` IS NULL OR ad.`id` IS NULL'],
    ['PlanItemLog', 'DELETE l FROM `PlanItemLog` l LEFT JOIN `PlanItem` i ON i.`id` = l.`planItemId` WHERE i.`id` IS NULL'],
    ['PlanItemTag', 'DELETE t FROM `PlanItemTag` t LEFT JOIN `PlanItem` i ON i.`id` = t.`itemId` LEFT JOIN `Tag` g ON g.`id` = t.`tagId` WHERE i.`id` IS NULL OR g.`id` IS NULL'],
    ['PlanItem', 'DELETE i FROM `PlanItem` i LEFT JOIN `PlanDay` d ON d.`id` = i.`dayId` WHERE d.`id` IS NULL'],
    ['PlanDay', 'DELETE d FROM `PlanDay` d LEFT JOIN `StudyPlan` p ON p.`id` = d.`planId` WHERE p.`id` IS NULL'],
    ['StudyPlan', 'DELETE p FROM `StudyPlan` p LEFT JOIN `User` st ON st.`id` = p.`studentId` LEFT JOIN `User` ad ON ad.`id` = p.`advisorId` WHERE st.`id` IS NULL OR ad.`id` IS NULL'],
    ['Reminder', 'DELETE r FROM `Reminder` r LEFT JOIN `User` st ON st.`id` = r.`studentId` LEFT JOIN `User` ad ON ad.`id` = r.`advisorId` WHERE st.`id` IS NULL OR ad.`id` IS NULL'],
    ['Tag', 'DELETE g FROM `Tag` g LEFT JOIN `User` a ON a.`id` = g.`advisorId` WHERE g.`advisorId` IS NOT NULL AND a.`id` IS NULL'],
    ['AdvisorField', 'DELETE f FROM `AdvisorField` f LEFT JOIN `User` u ON u.`id` = f.`userId` WHERE u.`id` IS NULL'],
    ['AdvisorStudentLink', 'DELETE l FROM `AdvisorStudentLink` l LEFT JOIN `User` s ON s.`id` = l.`studentId` LEFT JOIN `User` a ON a.`id` = l.`advisorId` WHERE s.`id` IS NULL OR a.`id` IS NULL'],
    ['ParentLink', 'DELETE p FROM `ParentLink` p LEFT JOIN `User` s ON s.`id` = p.`studentId` LEFT JOIN `User` pa ON pa.`id` = p.`parentId` WHERE s.`id` IS NULL OR pa.`id` IS NULL'],
    ['ParentInvite', 'DELETE i FROM `ParentInvite` i LEFT JOIN `User` s ON s.`id` = i.`studentId` WHERE s.`id` IS NULL'],
    ['UserSubscription', 'DELETE b FROM `UserSubscription` b LEFT JOIN `User` u ON u.`id` = b.`userId` WHERE u.`id` IS NULL'],
    ['DepositRequest', 'DELETE d FROM `DepositRequest` d LEFT JOIN `User` p ON p.`id` = d.`payerId` LEFT JOIN `User` o ON o.`id` = d.`ownerId` WHERE p.`id` IS NULL OR o.`id` IS NULL'],
    ['PasswordReset', 'DELETE r FROM `PasswordReset` r LEFT JOIN `User` u ON u.`id` = r.`userId` WHERE r.`userId` IS NOT NULL AND u.`id` IS NULL'],
    ['InstituteSubscription', 'DELETE b FROM `InstituteSubscription` b LEFT JOIN `Institute` i ON i.`id` = b.`instituteId` WHERE i.`id` IS NULL'],
    ['AuditLog', 'DELETE a FROM `AuditLog` a LEFT JOIN `User` u ON u.`id` = a.`actorId` WHERE a.`actorId` IS NOT NULL AND u.`id` IS NULL'],
  ];

  const deleted = [];
  const failed = [];
  for (const [table, sql] of sweeps) {
    try {
      const count = await prisma.$executeRawUnsafe(sql);
      if (count > 0) deleted.push({ table, deleted: count });
    } catch (err) {
      // یک جدولِ غایب (مثلاً روی دیتابیسی که مایگریشنش اعمال نشده) نباید بقیه را متوقف کند
      failed.push({ table, message: err.message });
    }
  }
  return { deleted, failed };
}

/**
 * حذف صریحِ همه‌ی ردیف‌های وابسته به یک کاربر، قبل از حذف سختِ خودِ کاربر.
 * ترتیب از بچه به والد است تا با رفتار cascade دیتابیس ناسازگاری نداشته باشیم.
 *
 * روی دیتابیس سالم تقریباً هیچ ردیفی نمی‌ماند (cascade دیتابیس قبلاً پاک کرده)؛
 * روی دیتابیسی که قیدهایش ساخته نشده، همین تابع تضمین می‌کند یتیم باقی نماند.
 *
 * @param {object} client کلاینت Prisma (می‌تواند tx باشد تا با حذف اتمیک شود)
 * @param {string} userId شناسه‌ی کاربری که حذف می‌شود
 */
async function deleteUserRelatedRows(client, userId) {
  const c = client || prisma;
  // کاربر ممکن است هم دانش‌آموز باشد هم مشاور/سازنده — هر دو طرف پاک می‌شود
  const asStudent = { studentId: userId };
  const asOwner = { advisorId: userId };
  const planWhere = { OR: [asStudent, asOwner] };
  const examWhere = { OR: [asStudent, asOwner] };
  const submissionWhere = { OR: [asStudent, { exam: asOwner }] };

  // --- زنجیره‌ی آزمون: پاسخ ← ارسال/سؤال ← آزمون ---
  await c.examAnswer.deleteMany({ where: { submission: submissionWhere } });
  await c.examSubmission.deleteMany({ where: submissionWhere });
  await c.examQuestion.deleteMany({ where: { exam: examWhere } });
  await c.exam.deleteMany({ where: examWhere });

  // --- زنجیره‌ی برنامه: لاگ/تگ آیتم ← آیتم ← روز ← برنامه ---
  await c.planItemLog.deleteMany({ where: { planItem: { day: { plan: planWhere } } } });
  await c.planItemTag.deleteMany({ where: { item: { day: { plan: planWhere } } } });
  await c.planItem.deleteMany({ where: { day: { plan: planWhere } } });
  await c.planDay.deleteMany({ where: { plan: planWhere } });
  await c.studyPlan.deleteMany({ where: planWhere });

  // --- بقیه‌ی وابسته‌ها ---
  await c.reminder.deleteMany({ where: { OR: [{ advisorId: userId }, { studentId: userId }] } });
  await c.tag.deleteMany({ where: { advisorId: userId } });
  await c.advisorField.deleteMany({ where: { userId } });
  await c.depositRequest.deleteMany({ where: { OR: [{ payerId: userId }, { ownerId: userId }] } });
  await c.passwordReset.deleteMany({ where: { userId } });
  await c.parentInvite.deleteMany({ where: { studentId: userId } });
  await c.parentLink.deleteMany({ where: { OR: [{ parentId: userId }, { studentId: userId }] } });
  await c.userSubscription.deleteMany({ where: { userId } });
  await c.advisorStudentLink.deleteMany({ where: { OR: [{ advisorId: userId }, { studentId: userId }] } });
}

module.exports = { pruneAdvisorStudentLinks, pruneOrphanRows, deleteUserRelatedRows };
