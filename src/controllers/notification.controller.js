const prisma = require('../config/prisma');

// تعداد یادآورهای خوانده‌نشده و برنامه‌هایی که بعد از آخرین بازدید تغییر کرده‌اند را برمی‌گرداند
async function getSummary(req, res, next) {
  try {
    const now = new Date();
    const lastViewed = req.user.plansLastViewedAt || new Date(0);

    // برنامه‌های «فعال» برای دانش‌آموز: منتشرشده، شروع‌شده و تمام‌نشده
    const activeWhere = {
      studentId: req.user.id,
      isDraft: false,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    };

    const [unreadReminders, updatedPlans, newest, activeCount] = await Promise.all([
      prisma.reminder.count({ where: { studentId: req.user.id, readAt: null } }),
      prisma.studyPlan.count({ where: { ...activeWhere, updatedAt: { gt: lastViewed } } }),
      prisma.studyPlan.findFirst({ where: activeWhere, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      prisma.studyPlan.count({ where: activeWhere }),
    ]);

    // plansVersion: «اثر انگشت» برنامه‌های فعال (تازه‌ترین تغییر + تعداد). پنل دانش‌آموز هر چند ثانیه
    // این را می‌پرسد و اگر عوض شده بود، برنامه‌ها را دوباره می‌خواند؛ پس بعد از ویرایش مشاور
    // لازم نیست دانش‌آموز صفحه را دستی رفرش کند. حذف/انقضای یک برنامه هم تعداد را عوض می‌کند.
    const plansVersion = `${newest ? newest.updatedAt.getTime() : 0}:${activeCount}`;

    res.json({
      unreadReminders,
      updatedPlans,
      plansVersion,
      plansLastViewedAt: req.user.plansLastViewedAt || null,
    });
  } catch (err) {
    next(err);
  }
}

// وقتی دانش‌آموز یادآورها یا برنامه‌ها را واقعاً می‌بیند، این تابع آن بخش را «دیده‌شده» علامت می‌زند
async function markSeen(req, res, next) {
  try {
    const { type } = req.body;

    if (type === 'reminders') {
      await prisma.reminder.updateMany({
        where: { studentId: req.user.id, readAt: null },
        data: { readAt: new Date() },
      });
    } else if (type === 'plans') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { plansLastViewedAt: new Date() },
      });
    } else {
      return res.status(400).json({ error: 'نوع اعلان معتبر نیست' });
    }

    res.json({ message: 'به‌روزرسانی شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary, markSeen };
