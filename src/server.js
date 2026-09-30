// بارگذاری متغیرهای محیطی از فایل .env
// نکته‌ی مهم: override: true باعث می‌شود مقادیر فایل .env بر متغیرهای از پیش موجود
// shell ارجحیت داشته باشند. این رفتار برای اجرای لوکال مفید است.
// در محیط Render خودش DATABASE_URL را در runtime تزریق می‌کند؛ چون فایل .env در
// Render وجود ندارد، این override تأثیری روی محیط تولید نخواهد داشت.
require('dotenv').config({ override: true });
const app = require('./app');
const prisma = require('./config/prisma');
const { pruneOrphanRows } = require('./utils/orphans');

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    // یک تست ساده‌ی اتصال به دیتابیس قبل از بالا آمدن سرور
    await prisma.$connect();
    console.log('✅ اتصال به دیتابیس برقرار شد');

    // یک‌بار در شروع سرور: ردیف‌های یتیم (ارجاع به کاربر/مؤسسه‌ی حذف‌شده) پاک می‌شوند.
    // تا وقتی این‌ها بمانند، کوئری‌هایی که رابطه‌ی «الزامی» دارند (مثل student در
    // AdvisorStudentLink) خطای Inconsistent query result می‌دهند و پنل بالا نمی‌آید.
    // اگر خطا داد، حذف کاربرها همچنان کار می‌کند و اسکریپت تعمیر را اجرا کنید.
    try {
      const report = await pruneOrphanRows();
      const total = report.reduce((sum, r) => sum + r.deleted, 0);
      if (total > 0) {
        console.log(`🧹 ${total} ردیف یتیم پاک شد:`, report);
      }
    } catch (err) {
      console.error('⚠️  پاک‌سازی ردیف‌های یتیم انجام نشد:', err.message);
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
