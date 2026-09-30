// ====== اسکریپت تعمیر: پاک‌سازی ردیف‌های یتیم + بازگرداندن قیدهای خارجی ======
//
// چه وقتی لازم است؟
// اگر روی سرور قیدهای خارجی (FOREIGN KEY) واقعاً ساخته نشده باشند — مثلاً جدول‌ها
// با phpMyAdmin و FOREIGN_KEY_CHECKS=0 ساخته شده باشند، یا مایگریشن با کاربرِ
// بدون مجوز REFERENCES اعمال شده باشد — با حذف یک دانش‌آموز، ردیف‌های
// AdvisorStudentLink باقی می‌مانند. بعد کوئری‌هایی که رابطه‌ی «الزامی»
// student/advisor را می‌خوانند با این خطا می‌شکنند و پنل سوپرادمین بالا نمی‌آید:
//
//   Inconsistent query result: Field student is required to return data, got `null` instead
//
// این اسکریپت دو کار می‌کند (idempotent — چند بار اجرا شدن مشکلی ندارد):
//   ۱) ردیف‌های یتیم همه‌ی جدول‌ها را پاک می‌کند.
//   ۲) قیدهای خارجی ON DELETE CASCADE / SET NULL که در schema.prisma تعریف شده‌اند
//      را (در صورت نبود) می‌سازد تا این دست‌داده‌های کثیف دوباره ساخته نشوند.
//
// اجرا:  node prisma/repair-orphans.js
//        (یا: npm run db:repair)
//
// هشدار: قبل از اجرا از دیتابیس بکاپ بگیرید — این اسکریپت داده حذف می‌کند
// (فقط ردیف‌هایی که به کاربر/مؤسسه‌ی ناموجود اشاره می‌کنند، یعنی داده‌ی بی‌معنا).

require('dotenv').config({ override: true });
const prisma = require('../src/config/prisma');
const { pruneOrphanRows } = require('../src/utils/orphans');

// هر قید: [نامConstraint, جدول, ستون, جدول/ستون مرجع, ON DELETE]
// دقیقاً مطابق schema.prisma. نام‌ها با چیزی که `prisma migrate dev` می‌سازد یکی است
// تا اگر بعداً مایگریشن جدیدی ساخته شد، تداخل نکند.
const CONSTRAINTS = [
  ['Institute_leaderId_fkey', 'Institute', 'leaderId', 'User', 'id', 'SET NULL'],
  ['User_instituteId_fkey', 'User', 'instituteId', 'Institute', 'id', 'SET NULL'],
  ['InstituteSubscription_instituteId_fkey', 'InstituteSubscription', 'instituteId', 'Institute', 'id', 'CASCADE'],
  ['UserSubscription_userId_fkey', 'UserSubscription', 'userId', 'User', 'id', 'CASCADE'],
  ['DepositRequest_payerId_fkey', 'DepositRequest', 'payerId', 'User', 'id', 'CASCADE'],
  ['DepositRequest_ownerId_fkey', 'DepositRequest', 'ownerId', 'User', 'id', 'CASCADE'],
  ['PasswordReset_userId_fkey', 'PasswordReset', 'userId', 'User', 'id', 'CASCADE'],
  ['AuditLog_actorId_fkey', 'AuditLog', 'actorId', 'User', 'id', 'SET NULL'],
  ['AdvisorStudentLink_advisorId_fkey', 'AdvisorStudentLink', 'advisorId', 'User', 'id', 'CASCADE'],
  ['AdvisorStudentLink_studentId_fkey', 'AdvisorStudentLink', 'studentId', 'User', 'id', 'CASCADE'],
  ['AdvisorField_userId_fkey', 'AdvisorField', 'userId', 'User', 'id', 'CASCADE'],
  ['Tag_advisorId_fkey', 'Tag', 'advisorId', 'User', 'id', 'CASCADE'],
  ['StudyPlan_studentId_fkey', 'StudyPlan', 'studentId', 'User', 'id', 'CASCADE'],
  ['StudyPlan_advisorId_fkey', 'StudyPlan', 'advisorId', 'User', 'id', 'CASCADE'],
  ['PlanDay_planId_fkey', 'PlanDay', 'planId', 'StudyPlan', 'id', 'CASCADE'],
  ['PlanItem_dayId_fkey', 'PlanItem', 'dayId', 'PlanDay', 'id', 'CASCADE'],
  ['PlanItemTag_itemId_fkey', 'PlanItemTag', 'itemId', 'PlanItem', 'id', 'CASCADE'],
  ['PlanItemTag_tagId_fkey', 'PlanItemTag', 'tagId', 'Tag', 'id', 'CASCADE'],
  ['PlanItemLog_planItemId_fkey', 'PlanItemLog', 'planItemId', 'PlanItem', 'id', 'CASCADE'],
  ['PlanItemLog_tagId_fkey', 'PlanItemLog', 'tagId', 'Tag', 'id', 'SET NULL'],
  ['Reminder_advisorId_fkey', 'Reminder', 'advisorId', 'User', 'id', 'CASCADE'],
  ['Reminder_studentId_fkey', 'Reminder', 'studentId', 'User', 'id', 'CASCADE'],
  ['Exam_studentId_fkey', 'Exam', 'studentId', 'User', 'id', 'CASCADE'],
  ['Exam_advisorId_fkey', 'Exam', 'advisorId', 'User', 'id', 'CASCADE'],
  ['ExamQuestion_examId_fkey', 'ExamQuestion', 'examId', 'Exam', 'id', 'CASCADE'],
  ['ExamSubmission_examId_fkey', 'ExamSubmission', 'examId', 'Exam', 'id', 'CASCADE'],
  ['ExamSubmission_studentId_fkey', 'ExamSubmission', 'studentId', 'User', 'id', 'CASCADE'],
  ['ExamAnswer_submissionId_fkey', 'ExamAnswer', 'submissionId', 'ExamSubmission', 'id', 'CASCADE'],
  ['ExamAnswer_questionId_fkey', 'ExamAnswer', 'questionId', 'ExamQuestion', 'id', 'CASCADE'],
  ['ParentLink_parentId_fkey', 'ParentLink', 'parentId', 'User', 'id', 'CASCADE'],
  ['ParentLink_studentId_fkey', 'ParentLink', 'studentId', 'User', 'id', 'CASCADE'],
  ['ParentInvite_studentId_fkey', 'ParentInvite', 'studentId', 'User', 'id', 'CASCADE'],
];

// قیدهای موجود به‌همراه قانون ON DELETEشان.
// (اگر قیدی با قانون اشتباه ساخته شده باشد — مثلاً SET NULL به‌جای CASCADE —
// باید بازسازی شود، وگرنه همان باگِ ردیف یتیم برمی‌گردد.)
async function existingConstraints() {
  const rows = await prisma.$queryRaw`
    SELECT kcu.CONSTRAINT_NAME, kcu.TABLE_NAME, rc.DELETE_RULE
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     AND rc.TABLE_NAME = kcu.TABLE_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  `;
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.CONSTRAINT_NAME).toUpperCase(), {
      table: r.TABLE_NAME,
      deleteRule: String(r.DELETE_RULE || '').toUpperCase(),
    });
  }
  return map;
}

async function ensureForeignKeys() {
  const existing = await existingConstraints();
  const added = [];
  const kept = [];
  const rebuilt = [];

  for (const [name, table, column, refTable, refColumn, onDelete] of CONSTRAINTS) {
    const current = existing.get(name.toUpperCase());
    if (current && current.deleteRule === onDelete && current.table === table) {
      kept.push(name);
      continue;
    }
    try {
      // اگر با قانون اشتباه وجود دارد، اول حذفش می‌کنیم (وجودش را از information_schema
      // تأیید کرده‌ایم پس DROP امن است)
      if (current) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``,
        );
        rebuilt.push(name);
      }
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ` +
        `FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`${refColumn}\`) ` +
        `ON DELETE ${onDelete} ON UPDATE CASCADE`,
      );
      added.push(name);
    } catch (err) {
      console.error(`  ⚠️  ساخت قید ${name} انجام نشد: ${err.message}`);
    }
  }
  return { added, kept, rebuilt };
}

async function main() {
  console.log('🧹 در حال پاک‌سازی ردیف‌های یتیم…');
  const report = await pruneOrphanRows();
  if (report.length === 0) {
    console.log('✅ هیچ ردیف یتیمی پیدا نشد.');
  } else {
    for (const { table, deleted } of report) {
      console.log(`   - ${table}: ${deleted} ردیف پاک شد`);
    }
  }

  console.log('🔗 در حال بررسی قیدهای خارجی…');
  const { added, kept, rebuilt } = await ensureForeignKeys();
  console.log(`✅ ${kept.length} قید سالم از قبل وجود داشت.`);
  if (rebuilt.length) console.log(`♻️  ${rebuilt.length} قید با قانون اشتباه بازسازی شد.`);
  if (added.length) {
    console.log(`🛠️  ${added.length} قید ساخته شد:`);
    for (const name of added) console.log(`   - ${name}`);
  }
  console.log('🎉 تعمیر تمام شد.');
}

main()
  .catch((err) => {
    console.error('❌ تعمیر ناموفق بود:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
