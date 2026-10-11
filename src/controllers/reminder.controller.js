const prisma = require('../config/prisma');

// مشاور یک یادآور متنی برای یکی از دانش‌آموزهای خودش می‌فرستد
async function sendReminder(req, res, next) {
  try {
    const { studentId, message } = req.body;

    if (!studentId || !message || !message.trim()) {
      return res.status(400).json({ error: 'شناسه‌ی دانش‌آموز و متن یادآور الزامی هستند' });
    }

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نکرده‌اید' });
    }

    const reminder = await prisma.reminder.create({
      data: { advisorId: req.user.id, studentId, message: message.trim() },
    });

    res.status(201).json({ reminder });
  } catch (err) {
    next(err);
  }
}

// دانش‌آموز همه‌ی یادآورهایی که دریافت کرده را می‌بیند، تازه‌ترین‌ها اول
async function getMyReminders(req, res, next) {
  try {
    const reminders = await prisma.reminder.findMany({
      where: { studentId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ reminders });
  } catch (err) {
    next(err);
  }
}

// مشاور یادآورهایی که برای یک دانش‌آموز خاص فرستاده را می‌بیند
async function getRemindersForStudent(req, res, next) {
  try {
    const { studentId } = req.params;

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نکرده‌اید' });
    }

    const reminders = await prisma.reminder.findMany({
      where: { advisorId: req.user.id, studentId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ reminders });
  } catch (err) {
    next(err);
  }
}

// حذف یک یادآور — دانش‌آموز می‌تواند یادآور خودش را حذف کند؛
// مشاور هم می‌تواند یادآوری که فرستاده را حذف کند.
async function deleteReminder(req, res, next) {
  try {
    const { id } = req.params;

    const reminder = await prisma.reminder.findUnique({ where: { id } });
    if (!reminder) {
      return res.status(404).json({ error: 'یادآور یافت نشد' });
    }

    // بررسی دسترسی: به‌صورت پیش‌فرض رد — فقط دانش‌آموز دریافت‌کننده یا مشاور فرستنده
    // (و سوپرادمین) اجازه‌ی حذف دارند؛ نقش‌های دیگر (والد، مدیر مؤسسه و…) رد می‌شوند.
    const isStudentOwner = req.user.role === 'STUDENT' && reminder.studentId === req.user.id;
    const isAdvisorOwner = req.user.role === 'ADVISOR' && reminder.advisorId === req.user.id;
    const isSuperadmin = req.user.role === 'SUPERADMIN';
    if (!isStudentOwner && !isAdvisorOwner && !isSuperadmin) {
      return res.status(403).json({ error: 'این یادآور متعلق به شما نیست' });
    }

    await prisma.reminder.delete({ where: { id } });
    res.json({ message: 'یادآور حذف شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendReminder, getMyReminders, getRemindersForStudent, deleteReminder };
