const prisma = require('../config/prisma');
const { toLatinDigits } = require('../utils/faDigits');
const { tehranDayKey, addDaysToKey, parseDateParts } = require('../utils/tehranDate');
const { getStudentAccess } = require('../utils/studentAccess');

// ====== مطالعه‌ی آزاد + پیشروی دروس (دانش‌آموز می‌نویسد؛ مشاور/والد می‌بینند) ======

const MAX_BACK_DAYS = 60; // ثبت برای روزهای گذشته تا ۶۰ روز قبل
const MAX_MINUTES = 1440;

const fail = (status, message) => Object.assign(new Error(message), { status });

// کلید مقایسه‌ی نام درس: ی/ک عربی یکسان، فاصله‌های اضافی فشرده، حروف کوچک
function subjectKeyOf(value) {
  return String(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function cleanText(value, label, max, { required = false } = {}) {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) {
    if (required) throw fail(400, `${label} را بنویس`);
    return null;
  }
  if (v.length > max) throw fail(400, `${label} نباید بیشتر از ${max} نویسه باشد`);
  return v;
}

function cleanTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = toLatinDigits(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw fail(400, 'ساعت باید به شکل ۱۶:۳۰ باشد');
  return v;
}

function minutesBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

// روز مطالعه: «YYYY-MM-DD»؛ نه آینده، نه بیش از ۶۰ روز قبل (به وقت تهران)
function cleanStudyDay(value) {
  const p = parseDateParts(toLatinDigits(value));
  if (!p) throw fail(400, 'تاریخ معتبر نیست');
  const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const today = tehranDayKey(new Date());
  if (key > today) throw fail(400, 'برای روزهای آینده نمی‌شود مطالعه ثبت کرد');
  if (key < addDaysToKey(today, -MAX_BACK_DAYS)) throw fail(400, 'فقط تا ۶۰ روز قبل را می‌شود ثبت کرد');
  return key;
}

function cleanCount(value, label, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(toLatinDigits(value));
  if (!Number.isInteger(n) || n < 0 || n > max) throw fail(400, `${label} باید عدد صحیح بین ۰ و ${max} باشد`);
  return n;
}

// ساخت داده‌ی یک ثبت آزاد از بدنه‌ی درخواست — دقیقه یا (ساعت شروع + پایان) الزامی است
function buildEntryData(body) {
  const startTime = cleanTime(body.startTime);
  const endTime = cleanTime(body.endTime);
  let minutes = cleanCount(body.minutes, 'دقیقه', MAX_MINUTES);
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw fail(400, 'ساعت شروع و پایان را با هم وارد کن');
  }
  if (startTime && endTime) {
    const diff = minutesBetween(startTime, endTime);
    if (diff <= 0) throw fail(400, 'ساعت پایان باید بعد از ساعت شروع باشد');
    minutes = diff; // ساعت‌ها مرجع‌اند؛ دقیقه خودش از روی آن‌ها حساب می‌شود
  }
  if (!minutes || minutes <= 0) throw fail(400, 'مدت مطالعه را (دقیقه یا ساعت شروع و پایان) وارد کن');
  return {
    studyDay: cleanStudyDay(body.studyDay),
    subject: cleanText(body.subject, 'نام درس', 100, { required: true }),
    chapter: cleanText(body.chapter, 'فصل/بخش', 191),
    tagName: cleanText(body.tagName, 'تگ', 60),
    startTime,
    endTime,
    minutes,
    testsTaken: cleanCount(body.testsTaken, 'تعداد تست', 5000),
    note: cleanText(body.note, 'توضیح', 280),
  };
}

function serializeEntry(e) {
  return {
    id: e.id,
    studyDay: e.studyDay,
    subject: e.subject,
    chapter: e.chapter,
    tagName: e.tagName,
    startTime: e.startTime,
    endTime: e.endTime,
    minutes: e.minutes,
    testsTaken: e.testsTaken,
    note: e.note,
    createdAt: e.createdAt,
  };
}

// تگ‌هایی که دانش‌آموز می‌تواند برای ثبت آزاد انتخاب کند: پیش‌فرض‌ها + تگ‌های مشاور فعالش
async function listMyTags(req, res, next) {
  try {
    const link = await prisma.advisorStudentLink.findFirst({
      where: { studentId: req.user.id, status: 'ACTIVE' },
      select: { advisorId: true },
    });
    const tags = await prisma.tag.findMany({
      where: { OR: [{ isDefault: true }, ...(link ? [{ advisorId: link.advisorId }] : [])] },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    });
    res.json({ tags });
  } catch (err) {
    next(err);
  }
}

async function listMyEntries(req, res, next) {
  try {
    const entries = await prisma.studyEntry.findMany({
      where: { studentId: req.user.id },
      orderBy: [{ studyDay: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json({ entries: entries.map(serializeEntry) });
  } catch (err) {
    next(err);
  }
}

async function createEntry(req, res, next) {
  try {
    const data = buildEntryData(req.body || {});
    const count = await prisma.studyEntry.count({ where: { studentId: req.user.id, studyDay: data.studyDay } });
    if (count >= 40) return res.status(400).json({ error: 'برای یک روز حداکثر ۴۰ ثبت می‌شود' });
    const entry = await prisma.studyEntry.create({ data: { ...data, studentId: req.user.id } });
    res.status(201).json({ entry: serializeEntry(entry) });
  } catch (err) {
    next(err);
  }
}

async function updateEntry(req, res, next) {
  try {
    const existing = await prisma.studyEntry.findFirst({ where: { id: req.params.id, studentId: req.user.id } });
    if (!existing) return res.status(404).json({ error: 'ثبت یافت نشد' });
    const data = buildEntryData(req.body || {});
    const entry = await prisma.studyEntry.update({ where: { id: existing.id }, data });
    res.json({ entry: serializeEntry(entry) });
  } catch (err) {
    next(err);
  }
}

async function deleteEntry(req, res, next) {
  try {
    const existing = await prisma.studyEntry.findFirst({ where: { id: req.params.id, studentId: req.user.id } });
    if (!existing) return res.status(404).json({ error: 'ثبت یافت نشد' });
    await prisma.studyEntry.delete({ where: { id: existing.id } });
    res.json({ message: 'حذف شد' });
  } catch (err) {
    next(err);
  }
}

// خود دانش‌آموز / مشاور متصل / والد متصل
async function listEntriesForStudent(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!(await getStudentAccess(req.user.id, studentId))) {
      return res.status(403).json({ error: 'به اطلاعات این دانش‌آموز دسترسی نداری' });
    }
    const entries = await prisma.studyEntry.findMany({
      where: { studentId },
      orderBy: [{ studyDay: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    res.json({ entries: entries.map(serializeEntry) });
  } catch (err) {
    next(err);
  }
}

// ====== پیشروی دروس ======

function serializeProgress(r) {
  return { id: r.id, studyDay: r.studyDay, subject: r.subject, position: r.position, updatedAt: r.updatedAt };
}

// ثبت پیشروی یک روز: { studyDay, items: [{ subject, position }] }
// position خالی = پاک‌کردن ثبتِ همان درس در همان روز
async function saveProgress(req, res, next) {
  try {
    const studyDay = cleanStudyDay(req.body.studyDay);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'حداقل یک درس بفرست' });
    if (items.length > 30) return res.status(400).json({ error: 'تعداد درس‌ها زیاد است' });

    const saved = [];
    for (const it of items) {
      const subject = cleanText(it.subject, 'نام درس', 100, { required: true });
      const subjectKey = subjectKeyOf(subject);
      const position = cleanText(it.position, 'محل پیشروی', 191);
      const where = { studentId_studyDay_subjectKey: { studentId: req.user.id, studyDay, subjectKey } };
      if (!position) {
        await prisma.subjectProgress.deleteMany({ where: { studentId: req.user.id, studyDay, subjectKey } });
        continue;
      }
      const row = await prisma.subjectProgress.upsert({
        where,
        create: { studentId: req.user.id, studyDay, subjectKey, subject, position },
        update: { subject, position },
      });
      saved.push(serializeProgress(row));
    }
    res.json({ progress: saved });
  } catch (err) {
    next(err);
  }
}

// تاریخچه‌ی اخیر (۱۸۰ روز) — کلاینت «آخرین وضعیت هر درس» را از روی آن می‌سازد
async function fetchProgressRows(studentId) {
  const since = addDaysToKey(tehranDayKey(new Date()), -180);
  return prisma.subjectProgress.findMany({
    where: { studentId, studyDay: { gte: since } },
    orderBy: [{ studyDay: 'desc' }, { updatedAt: 'desc' }],
    take: 800,
  });
}

async function listMyProgress(req, res, next) {
  try {
    const rows = await fetchProgressRows(req.user.id);
    res.json({ progress: rows.map(serializeProgress) });
  } catch (err) {
    next(err);
  }
}

async function listProgressForStudent(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!(await getStudentAccess(req.user.id, studentId))) {
      return res.status(403).json({ error: 'به اطلاعات این دانش‌آموز دسترسی نداری' });
    }
    const rows = await fetchProgressRows(studentId);
    res.json({ progress: rows.map(serializeProgress) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  subjectKeyOf,
  listMyTags,
  listMyEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  listEntriesForStudent,
  saveProgress,
  listMyProgress,
  listProgressForStudent,
};
