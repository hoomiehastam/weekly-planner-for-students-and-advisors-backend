// بارگذاری متغیرهای محیطی از فایل .env
// نکته‌ی مهم: override: true باعث می‌شود مقادیر فایل .env بر متغیرهای از پیش موجود
// shell ارجحیت داشته باشند. این رفتار برای اجرای لوکال مفید است.
// در محیط Render خودش DATABASE_URL را در runtime تزریق می‌کند؛ چون فایل .env در
// Render وجود ندارد، این override تأثیری روی محیط تولید نخواهد داشت.
require('dotenv').config({ override: true });
const app = require('./app');
const prisma = require('./config/prisma');
const { pruneAdvisorStudentLinks, pruneOrphanRows } = require('./utils/orphans');

const PORT = process.env.PORT || 4000;
const SWEEP_ON_BOOT = process.env.ORPHAN_SWEEP_ON_BOOT === '1';

async function start() {
  try {
    // یک تست ساده‌ی اتصال به دیتابیس قبل از بالا آمدن سرور
    await prisma.$connect();
    console.log('✅ اتصال به دیتابیس برقرار شد');

    // یک‌بار در شروع سرور: لینک‌های یتیمِ AdvisorStudentLink پاک می‌شوند.
    // تا وقتی این‌ها بمانند، کوئری‌هایی که رابطه‌ی «الزامی» دارند (مثل student در
    // AdvisorStudentLink) خطای Inconsistent query result می‌دهند و پنل بالا نمی‌آید.
    // فقط یک کوئری است تا ریسک پاک‌سازی در مسیرِ بالا آمدن سرور حداقلی بماند.
    try {
      const deleted = await pruneAdvisorStudentLinks({ force: true });
      if (deleted > 0) console.log(`🧹 ${deleted} لینک یتیم AdvisorStudentLink پاک شد.`);
    } catch (err) {
      console.error('⚠️  پاک‌سازی لینک‌های یتیم انجام نشد:', err.message);
    }

    // جاروی کاملِ همه‌ی جدول‌ها فقط به‌صورت دستی: پیش‌فرض خاموش است چون بیست
    // کوئری پشت‌سرهم در مسیر بوت (و روی هاست‌های ضعیف) می‌تواند موتور Prisma را
    // پانیک کند و کل سرویس را از کار بیندازد. برای اجرا:
    //   ORPHAN_SWEEP_ON_BOOT=1 npm start
    // یا بدون Prisma: prisma/repair-orphans.sql را در phpMyAdmin بزنید.
    if (SWEEP_ON_BOOT) {
      try {
        const { deleted, failed } = await pruneOrphanRows();
        const total = deleted.reduce((sum, r) => sum + r.deleted, 0);
        if (total > 0) console.log(`🧹 ${total} ردیف یتیم پاک شد:`, deleted);
        if (failed.length) {
          console.error(`⚠️  ${failed.length} جدول پاک نشد (موتور Prisma یا جدول مشکل دارد):`);
          for (const f of failed) console.error(`   - ${f.table}: ${f.message}`);
        }
      } catch (err) {
        console.error('⚠️  پاک‌سازی ردیف‌های یتیم انجام نشد:', err.message);
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 سرور روی پورت ${PORT} در حال اجراست`);
    });
  } catch (err) {
    console.error('❌ خطا در اتصال به دیتابیس یا اجرای سرور:', err.message);
    process.exit(1);
  }
}

start();

// بستن تمیز اتصال دیتابیس هنگام خاموش شدن سرور
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
