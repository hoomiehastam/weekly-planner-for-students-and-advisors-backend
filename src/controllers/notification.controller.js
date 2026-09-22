const prisma = require('../config/prisma');

// تعداد یادآورهای خوانده‌نشده و برنامه‌هایی که بعد از آخرین بازدید تغییر کرده‌اند را برمی‌گرداند
async function getSummary(req, res, next) {
  try {
    const now = new Date();
    const lastViewed = req.user.plansLastViewedAt || new Date(0);

    const [unreadReminders, updatedPlans] = await Promise.all([
      prisma.reminder.count({ where: { studentId: req.user.id, readAt: null } }),
      prisma.studyPlan.count({
        where: {
          studentId: req.user.id,
          startsAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          updatedAt: { gt: lastViewed },
        },
      }),
    ]);

    res.json({ unreadReminders, updatedPlans });
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
