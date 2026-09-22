// این اسکریپت چهار تگ پیش‌فرض درسی و یک حساب سوپرادمین اولیه را در دیتابیس می‌سازد
// اجرا با: node prisma/seed.js
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_TAGS = ['پیشروی', 'تمرین', 'مرور', 'آمادگی امتحان'];

async function seedTags() {
  for (const name of DEFAULT_TAGS) {
    const existing = await prisma.tag.findFirst({ where: { name, isDefault: true } });
    if (!existing) {
      await prisma.tag.create({ data: { name, isDefault: true } });
    }
  }
  console.log('✅ تگ‌های پیش‌فرض ساخته شدند:', DEFAULT_TAGS.join('، '));
}

// این تابع فقط وقتی کاری انجام می‌دهد که مشخصه‌های محیطی سوپرادمین تنظیم شده باشند
// و هنوز هیچ سوپرادمینی در دیتابیس وجود نداشته باشد
async function seedSuperadmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ℹ️ مشخصه‌های سوپرادمین تنظیم نشده، این مرحله رد شد');
    return;
  }

  const existing = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
  if (existing) {
    console.log('ℹ️ یک سوپرادمین از قبل وجود دارد، حساب جدیدی ساخته نشد');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      fullName: 'سوپرادمین',
      email,
      passwordHash,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
    },
  });
  console.log('✅ حساب سوپرادمین ساخته شد');
}

async function main() {
  await seedTags();
  await seedSuperadmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
