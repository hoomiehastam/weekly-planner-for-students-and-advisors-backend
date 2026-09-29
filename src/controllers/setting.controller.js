const prisma = require('../config/prisma');
const { writeAuditLog } = require('../utils/audit');

// کلید تنظیم «تاریخ کنکور» — روزشمار صفحه‌ی لندینگ از همین تاریخ محاسبه می‌شود.
const KONKUR_DATE_KEY = 'konkur_exam_date';

// تاریخ کنکور را از تنظیمات پلتفرم می‌خواند (عمومی — بدون نیاز به ورود)
// پاسخ: { konkurDate: 'YYYY-MM-DD' } یا { konkurDate: null } اگر هنوز تنظیم نشده باشد.
async function getKonkurDate(_req, res, next) {
  try {
    const setting = await prisma.platformSetting.findUnique({
      where: { key: KONKUR_DATE_KEY },
    });
    res.json({ konkurDate: setting?.value || null });
  } catch (err) {
    next(err);
  }
}

// تاریخ کنکور را سوپرادمین تنظیم می‌کند — body: { date: 'YYYY-MM-DD' }
async function setKonkurDate(req, res, next) {
  try {
    const { date } = req.body;

    const d = new Date(`${date}T00:00:00`);
    if (!date || Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'تاریخ نامعتبر است — قالب صحیح YYYY-MM-DD است' });
    }
    // حداقل فردا — روزشمارِ گذشته بی‌معناست
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d.getTime() <= today.getTime()) {
      return res.status(400).json({ error: 'تاریخ کنکور باید در آینده باشد' });
    }

    const before = await prisma.platformSetting.findUnique({ where: { key: KONKUR_DATE_KEY } });

    await prisma.platformSetting.upsert({
      where: { key: KONKUR_DATE_KEY },
      update: { value: date },
      create: { key: KONKUR_DATE_KEY, value: date },
    });

    await writeAuditLog({
      actorId: req.user.id,
      action: 'KONKUR_DATE_SET',
      targetType: 'SETTING',
      targetId: KONKUR_DATE_KEY,
      details: { before: before?.value || null, after: date },
    });

    res.json({ message: 'تاریخ کنکور به‌روزرسانی شد', konkurDate: date });
  } catch (err) {
    next(err);
  }
}

module.exports = { getKonkurDate, setKonkurDate, KONKUR_DATE_KEY };
