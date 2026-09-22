// بارگذاری متغیرهای محیطی از فایل .env
// نکته‌ی مهم: override: true باعث می‌شود مقادیر فایل .env بر متغیرهای از پیش موجود
// shell ارجحیت داشته باشند. این رفتار برای اجرای لوکال مفید است.
// در محیط Render خودش DATABASE_URL را در runtime تزریق می‌کند؛ چون فایل .env در
// Render وجود ندارد، این override تأثیری روی محیط تولید نخواهد داشت.
require('dotenv').config({ override: true });
const app = require('./app');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    // یک تست ساده‌ی اتصال به دیتابیس قبل از بالا آمدن سرور
    await prisma.$connect();
    console.log('✅ اتصال به دیتابیس برقرار شد');

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
