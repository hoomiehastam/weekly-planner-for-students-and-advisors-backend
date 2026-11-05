require('dotenv').config({ override: true });
const app = require('./app');
const prisma = require('./config/prisma');
const { pruneAdvisorStudentLinks, pruneOrphanRows } = require('./utils/orphans');

const PORT = process.env.PORT || 4000;
const SWEEP_ON_BOOT = process.env.ORPHAN_SWEEP_ON_BOOT === '1';

async function start() {
  // ۱. اتصال به دیتابیس در شروع — اگر دسترسی دیتابیس مشکل داشته باشد،
  // سرور را کرش نمی‌کنیم تا وب‌سرور (Passenger) خطای ۵۰۳ ندهد و خطا در لاگ و UI مشخص باشد.
  try {
    await prisma.$connect();
    console.log('✅ اتصال به دیتابیس برقرار شد');

    try {
      const deleted = await pruneAdvisorStudentLinks({ force: true });
      if (deleted > 0) console.log(`🧹 ${deleted} لینک یتیم AdvisorStudentLink پاک شد.`);
    } catch (err) {
      console.error('⚠️  پاک‌سازی لینک‌های یتیم انجام نشد:', err.message);
    }

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
  } catch (err) {
    console.error('❌ خطا در اتصال به دیتابیس در زمان بوت:', err.message);
  }

  // ۲. اجرای وب‌سرور — باید همیشه گوش دهد تا اتصال با فرانت‌اند قطع نشود
  try {
    app.listen(PORT, () => {
      console.log(`🚀 سرور روی پورت ${PORT} در حال اجراست`);
    });
  } catch (err) {
    console.error('❌ خطا در اجرای وب‌سرور روی پورت:', err.message);
    process.exit(1);
  }
}

start();

// بستن تمیز اتصال دیتابیس هنگام خاموش شدن سرور
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
