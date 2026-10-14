const prisma = require('../config/prisma');
const { getStudentAccess } = require('../utils/studentAccess');

// ====== برنامه‌ی امتحان‌ها و پرسش‌های مدرسه ======
// دانش‌آموز خودش ثبت می‌کند که چه روزی چه امتحان یا پرسشی دارد:
//   title  — عنوان (مثلاً «امتحان ریاضی نوبت اول»)
//   kind   — نوع: EXAM (امتحان) یا QUIZ (پرسش/کوییز کلاسی)
//   subject — درس (اختیاری، مثل «ریاضی ۲»)
//   dueAt  — تاریخ برگزاری (شمسی از فرانت می‌آید و به ISO تبدیل می‌شود)
//   note   — توضیح اختیاری (مثلاً «فصل ۱ تا ۴ — نمره‌دار»)
// این فهرست هم در پنل خودِ دانش‌آموز و هم در پنل مشاورِ متصل (فقط‌خواندنی) نمایش
// داده می‌شود تا مشاور بتواند برنامه‌ریزی را با امتحان‌ها هم‌تراز کند.

const KINDS = ['EXAM', 'QUIZ'];

function normalizeText(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function normalizeKind(value, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('نوع مورد (امتحان یا پرسش) الزامی است');
    return null;
  }
  const v = String(value).trim().toUpperCase();
  if (!KINDS.includes(v)) throw new Error('نوع مورد باید امتحان یا پرسش باشد');
  return v;
}

function parseDueAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('تاریخ برگزاری نامعتبر است');
  return d;
}

// --- فهرست برنامه‌ی امتحان‌ها ---
// GET /api/students/:studentId/exam-events — دانش‌آموز/مشاور/والد با دسترسی
// پاسخ: { events: [...], access } — مرتب بر اساس تاریخ برگزاری (نزدیک‌ترین اول)
async function listStudentExamEvents(req, res, next) {
  try {
    const { studentId } = req.params;
    const access = await getStudentAccess(req.user.id, studentId);
    if (!access) {
      return res.status(403).json({ error: 'به این دانش‌آموز دسترسی نداری' });
    }

    const events = await prisma.studentExamEvent.findMany({
      where: { studentId },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        title: true,
        kind: true,
        subject: true,
        dueAt: true,
        note: true,
        createdAt: true,
      },
    });

    res.json({ events, access });
  } catch (err) {
    next(err);
  }
}

// --- ثبت مورد جدید ---
// POST /api/students/me/exam-events — فقط خود دانش‌آموز
async function createExamEvent(req, res, next) {
  try {
    if (req.user.role !== 'STUDENT') {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز برنامه‌ی امتحان‌هایش را ثبت می‌کند' });
    }
    const { title, kind, subject, dueAt, note } = req.body;

    let kindValue;
    let dueDate;
    try {
      kindValue = normalizeKind(kind, { required: true });
      dueDate = parseDueAt(dueAt);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const trimmedTitle = normalizeText(title, 190);
    if (!trimmedTitle) {
      return res.status(400).json({ error: 'عنوان امتحان یا پرسش الزامی است' });
    }

    const event = await prisma.studentExamEvent.create({
      data: {
        studentId: req.user.id,
        title: trimmedTitle,
        kind: kindValue,
        subject: normalizeText(subject, 60),
        dueAt: dueDate,
        note: normalizeText(note, 500),
      },
    });

    res.status(201).json({ message: 'برنامه‌ی امتحان ثبت شد', event });
  } catch (err) {
    next(err);
  }
}

// --- ویرایش مورد ---
// PUT /api/students/me/exam-events/:eventId — فقط صاحب رکورد
async function updateExamEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    const existing = await prisma.studentExamEvent.findUnique({ where: { id: eventId } });
    if (!existing) {
      return res.status(404).json({ error: 'این مورد یافت نشد' });
    }
    if (existing.studentId !== req.user.id) {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز برنامه‌اش را ویرایش می‌کند' });
    }

    const { title, kind, subject, dueAt, note } = req.body;
    const data = {};
    if (title !== undefined) {
      const t = normalizeText(title, 190);
      if (!t) return res.status(400).json({ error: 'عنوان امتحان یا پرسش الزامی است' });
      data.title = t;
    }
    if (kind !== undefined) {
      try {
        data.kind = normalizeKind(kind, { required: true });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    if (subject !== undefined) data.subject = normalizeText(subject, 60);
    if (note !== undefined) data.note = normalizeText(note, 500);
    if (dueAt !== undefined) {
      try {
        data.dueAt = parseDueAt(dueAt);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده' });
    }

    const event = await prisma.studentExamEvent.update({ where: { id: eventId }, data });
    res.json({ message: 'برنامه‌ی امتحان به‌روزرسانی شد', event });
  } catch (err) {
    next(err);
  }
}

// --- حذف مورد ---
// DELETE /api/students/me/exam-events/:eventId — فقط صاحب رکورد
async function deleteExamEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    const existing = await prisma.studentExamEvent.findUnique({ where: { id: eventId } });
    if (!existing) {
      return res.status(404).json({ error: 'این مورد یافت نشد' });
    }
    if (existing.studentId !== req.user.id) {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز برنامه‌اش را حذف می‌کند' });
    }
    await prisma.studentExamEvent.delete({ where: { id: eventId } });
    res.json({ message: 'مورد حذف شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listStudentExamEvents,
  createExamEvent,
  updateExamEvent,
  deleteExamEvent,
  KINDS,
};
