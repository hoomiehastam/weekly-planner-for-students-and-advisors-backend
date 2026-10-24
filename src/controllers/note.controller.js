const prisma = require('../config/prisma');

// ====== یادداشت خصوصی مشاور درباره‌ی دانش‌آموز ======
// فقط نویسنده (مشاور؛ یا سوپرادمین در نقش مشاور برای دانش‌آموزان خودش) می‌خواند و می‌نویسد.
// این مسیرها فقط با requireRole('ADVISOR','SUPERADMIN') ثبت شده‌اند و همه‌ی کوئری‌ها با
// advisorId = کاربر جاری اسکوپ می‌شوند؛ پس دانش‌آموز، والد، مدیر مؤسسه و مشاور دیگر راهی ندارند.
// هیچ‌کدام از پاسخ‌های دیگر (پروفایل، برنامه، گزارش) این یادداشت‌ها را برنمی‌گردانند.

const MAX_NOTE_LENGTH = 4000;
const MAX_NOTES_PER_STUDENT = 500;

// دانش‌آموز باید اتصال فعال (ACTIVE) به همین مشاور داشته باشد
async function assertOwnStudent(advisorId, studentId) {
  const link = await prisma.advisorStudentLink.findFirst({
    where: { advisorId, studentId, status: 'ACTIVE' },
    select: { id: true },
  });
  return !!link;
}

function serialize(n) {
  return { id: n.id, content: n.content, createdAt: n.createdAt, updatedAt: n.updatedAt };
}

async function listNotes(req, res, next) {
  try {
    const { studentId } = req.params;
    if (!(await assertOwnStudent(req.user.id, studentId))) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }
    const notes = await prisma.studentNote.findMany({
      where: { advisorId: req.user.id, studentId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ notes: notes.map(serialize) });
  } catch (err) {
    next(err);
  }
}

async function createNote(req, res, next) {
  try {
    const { studentId } = req.params;
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'متن یادداشت خالی است' });
    if (content.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ error: `یادداشت نباید بیشتر از ${MAX_NOTE_LENGTH} نویسه باشد` });
    }
    if (!(await assertOwnStudent(req.user.id, studentId))) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }
    const count = await prisma.studentNote.count({ where: { advisorId: req.user.id, studentId } });
    if (count >= MAX_NOTES_PER_STUDENT) {
      return res.status(400).json({ error: 'سقف تعداد یادداشت برای این دانش‌آموز پر شده؛ چند یادداشت قدیمی را پاک یا در هم ادغام کن' });
    }
    const note = await prisma.studentNote.create({
      data: { advisorId: req.user.id, studentId, content },
    });
    res.status(201).json({ note: serialize(note) });
  } catch (err) {
    next(err);
  }
}

async function updateNote(req, res, next) {
  try {
    const { studentId, noteId } = req.params;
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'متن یادداشت خالی است' });
    if (content.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ error: `یادداشت نباید بیشتر از ${MAX_NOTE_LENGTH} نویسه باشد` });
    }
    const existing = await prisma.studentNote.findFirst({
      where: { id: noteId, advisorId: req.user.id, studentId },
    });
    if (!existing) return res.status(404).json({ error: 'یادداشت یافت نشد' });
    const note = await prisma.studentNote.update({ where: { id: noteId }, data: { content } });
    res.json({ note: serialize(note) });
  } catch (err) {
    next(err);
  }
}

async function deleteNote(req, res, next) {
  try {
    const { studentId, noteId } = req.params;
    const existing = await prisma.studentNote.findFirst({
      where: { id: noteId, advisorId: req.user.id, studentId },
    });
    if (!existing) return res.status(404).json({ error: 'یادداشت یافت نشد' });
    await prisma.studentNote.delete({ where: { id: noteId } });
    res.json({ message: 'یادداشت حذف شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotes, createNote, updateNote, deleteNote, MAX_NOTE_LENGTH };
