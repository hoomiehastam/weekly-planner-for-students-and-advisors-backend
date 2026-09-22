// یک نمونه‌ی واحد (singleton) از Prisma Client می‌سازیم
// تا در طول اجرای برنامه فقط یک اتصال به دیتابیس باز بماند
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
