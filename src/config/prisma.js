// یک نمونه‌ی واحد (singleton) از Prisma Client می‌سازیم
// تا در طول اجرای برنامه فقط یک اتصال به دیتابیس باز بماند
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// تشخیص «Prisma Client قدیمی»: وقتی مدل جدیدی به schema.prisma اضافه می‌شود ولی بعد از آن
// `prisma generate` اجرا نشده (مثلاً روی سرور با کش node_modules)، کد با خطای مبهم
// «Cannot read properties of undefined (reading 'findMany')» می‌ترکد.
// اینجا با مقایسه‌ی مدل‌های schema و کلاینت ساخته‌شده، علت واقعی را صریح در لاگ می‌نویسیم.
// (فقط هشدار است؛ سرور را نمی‌خوابانیم تا بقیه‌ی بخش‌ها کار کنند.)
try {
  const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const missing = [...schema.matchAll(/^model\s+(\w+)/gm)]
    .map((m) => m[1])
    .filter((name) => !prisma[name.charAt(0).toLowerCase() + name.slice(1)]);
  if (missing.length > 0) {
    console.error(
      `[prisma] Prisma Client قدیمی است — مدل‌های بدون کلاینت: ${missing.join(', ')}. ` +
      'روی سرور «npx prisma generate» را اجرا و سرویس را دوباره راه‌اندازی کنید ' +
      '(یا Deploy با «Clear build cache»).'
    );
  }
} catch {
  // فایل schema روی سرور نبود؛ بررسی رد می‌شود
}

module.exports = prisma;
