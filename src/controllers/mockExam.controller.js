const prisma = require('../config/prisma');

// ====== نمرات آزمون‌های آزمایشی (MOCK) ======
// دانش‌آموز نتیجه‌ی آزمون‌های آزمایشی بیرون از پلتفرم را ثبت می‌کند:
//   title  — نام آزمون
//   takenAt — تاریخ برگزاری (نمودار بر همین اساس مرتب می‌شود)
//   rank    — تراز کل (اختیاری)
//   percentages — درصدها؛ دیکشنری ساده مثل {"EXPERIMENTAL": 62.5, "BIOLOGY": 48}
//                 (کلیدها آزادند — درصدهای مؤلفه‌های رشته، عمومی/اختصاصی و ...)
// نمودار خطی روند پیشرفت/پسرفت در سه پنل (دانش‌آموز/مشاور/والد) از همین داده می‌آید.

// کلیدهای مجاز درصد — برای جلوگیری از شلوغی داده، کلیدها محدودند ولی آزاد هم هست؛
// این تفکیک برای نمایش در UI استفاده می‌شود (امتحان عمومی/اختصاصی رشته)
const KNOWN_PERCENT_KEYS = {
  HUMANITIES: ['GENERAL', 'SPECIFIC'],
  MATH_PHYSICS: ['GENERAL', 'SPECIFIC'],
  EXPERIMENTAL: ['GENERAL', 'SPECIFIC'],
};

// نرمال‌سازی ورودی درصد: عدد بین ۰ تا ۱۰۰؛ فارسی هم قبول می‌شود
function normalizePercent(value) {
  const v = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error('درصد باید عددی بین ۰ و ۱۰۰ باشد');
  }
  return Math.round(v * 10) / 10; // حداکثر یک رقم اعشار
}

// اعتبارسنجی دیکشنری درصد — همه‌ی کلیدها باید رشته و همه‌ی مقادیر ۰..۱۰۰ باشند
function normalizePercentages(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('درصدها باید به‌شکل دیکشنری (شیء) ارسال شوند');
  }
  const entries = Object.entries(input).slice(0, 12); // سقف منطقی ۱۲ مؤلفه
  if (entries.length === 0) return null;
  const result = {};
  for (const [key, rawValue] of entries) {
    const keyStr = String(key).trim().slice(0, 40);
    if (!keyStr) continue;
    result[keyStr] = normalizePercent(rawValue);
  }
  return Object.keys(result).length > 0 ? result : null;
}

// نرمال‌سازی تراز — ۰ تا ۳۶۵۰ (سقف تراز کنکور سراسری)
function normalizeRank(rank) {
  if (rank === null || rank === undefined || rank === '') return null;
  const v = Number(rank);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 3650) {
    throw new Error('تراز باید عدد صحیح بین ۰ و ۳۶۵۰ باشد');
  }
  return v;
}

// پیدا کردن چرا این کاربر حق دیدن نمرات این دانش‌آموز را دارد:
//   خودش / مشاور متصل (ACTIVE) / والد متصل
// null یعنی دسترسی ندارد.
async function getAccess(actorId, studentId) {
  if (actorId === studentId) return 'SELF';
  const [self, advisor, parent] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { id: true } }),
    prisma.advisorStudentLink.findFirst({ where: { advisorId: actorId, studentId, status: 'ACTIVE' } }),
    prisma.parentLink.findFirst({ where: { parentId: actorId, studentId } }),
  ]);
  if (!self) return null;
  if (advisor) return 'ADVISOR';
  if (parent) return 'PARENT';
  return null;
}

// مشاور می‌تواند فقط به دانش‌آموزهای متصل، والد فقط به فرزندها و دانش‌آموز فقط
// به نمرات خودش ثبت/ویرایش کنند. والد فقط-خواندنی است.
// Faculty: priority به ترتیب SELF > ADVISOR > PARENT — اولی چک می‌شود.

// --- فهرست نمرات ---
// GET /api/students/:studentId/mock-exams — برای همه‌ی سه نقش با دسترسی بالا
// پاسخ: { scores: [{ id, title, takenAt, rank, percentages }] } — مرتب بر اساس takenAt
async function listMockExamScores(req, res, next) {
  try {
    const studentId = req.params.studentId;
    const access = await getAccess(req.user.id, studentId);
    if (!access) {
      return res.status(403).json({ error: 'به این دانش‌آموز دسترسی نداری' });
    }

    const scores = await prisma.mockExamScore.findMany({
      where: { studentId },
      orderBy: { takenAt: 'asc' },
      select: {
        id: true,
        title: true,
        takenAt: true,
        rank: true,
        percentages: true,
        createdAt: true,
      },
    });

    res.json({
      scores: scores.map((s) => ({
        ...s,
        percentages: s.percentages ? JSON.parse(s.percentages) : null,
      })),
      access, // فرانت برای نمایش دکمه‌ی ثبت/ویرایش فقط به دانش‌آموز استفاده می‌کند
    });
  } catch (err) {
    next(err);
  }
}

// --- ایجاد نمره ---
// POST /api/students/:studentId/mock-exams
//   body: { title, takenAt, rank?, percentages? }
// فقط خود دانش‌آموز ثبت می‌کند (والد فقط-خواندنی است و مشاور فعلاً فقط می‌بیند)
async function createMockExamScore(req, res, next) {
  try {
    const studentId = req.params.studentId;
    // فقط خود دانش‌آموز می‌تواند ثبت کند — مالکیت داده
    if (req.user.id !== studentId || req.user.role !== 'STUDENT') {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز نمره‌ی آزمون آزمایشی‌اش را ثبت می‌کند' });
    }

    const { title, takenAt, rank, percentages } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'عنوان آزمون الزامی است' });
    }
    if (!takenAt) {
      return res.status(400).json({ error: 'تاریخ آزمون الزامی است' });
    }
    const takenDate = new Date(takenAt);
    if (Number.isNaN(takenDate.getTime())) {
      return res.status(400).json({ error: 'تاریخ آزمون نامعتبر است' });
    }

    let rankValue;
    let percentagesValue;
    try {
      rankValue = normalizeRank(rank);
      percentagesValue = normalizePercentages(percentages);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const score = await prisma.mockExamScore.create({
      data: {
        studentId,
        title: String(title).trim().slice(0, 190),
        takenAt: takenDate,
        rank: rankValue,
        percentages: percentagesValue ? JSON.stringify(percentagesValue) : null,
      },
    });

    res.status(201).json({
      message: 'نتیجه‌ی آزمون آزمایشی ثبت شد',
      score: { ...score, percentages: percentagesValue },
    });
  } catch (err) {
    next(err);
  }
}

// --- ویرایش نمره ---
// PUT /api/mock-exams/:id — بواسطه شناسه‌ی رکورد
// فقط خود دانش‌آموز
async function updateMockExamScore(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.mockExamScore.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'این نمره یافت نشد' });
    }
    if (existing.studentId !== req.user.id || req.user.role !== 'STUDENT') {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز نمره‌اش را ویرایش می‌کند' });
    }

    const { title, takenAt, rank, percentages } = req.body;
    const data = {};
    if (title !== undefined) {
      if (!String(title).trim()) {
        return res.status(400).json({ error: 'عنوان آزمون نمی‌تواند خالی باشد' });
      }
      data.title = String(title).trim().slice(0, 190);
    }
    if (takenAt !== undefined) {
      const takenDate = new Date(takenAt);
      if (Number.isNaN(takenDate.getTime())) {
        return res.status(400).json({ error: 'تاریخ آزمون نامعتبر است' });
      }
      data.takenAt = takenDate;
    }
    if (rank !== undefined) {
      try {
        data.rank = normalizeRank(rank);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    if (percentages !== undefined) {
      try {
        const p = normalizePercentages(percentages);
        data.percentages = p ? JSON.stringify(p) : null;
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده' });
    }

    const updated = await prisma.mockExamScore.update({ where: { id }, data });
    res.json({
      message: 'نتیجه به‌روزرسانی شد',
      score: { ...updated, percentages: updated.percentages ? JSON.parse(updated.percentages) : null },
    });
  } catch (err) {
    next(err);
  }
}

// --- حذف نمره ---
// DELETE /api/mock-exams/:id — فقط خود دانش‌آموز
async function deleteMockExamScore(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.mockExamScore.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'این نمره یافت نشد' });
    }
    if (existing.studentId !== req.user.id || req.user.role !== 'STUDENT') {
      return res.status(403).json({ error: 'فقط خودِ دانش‌آموز نمره‌اش را حذف می‌کند' });
    }
    await prisma.mockExamScore.delete({ where: { id } });
    res.json({ message: 'نتیجه حذف شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMockExamScores,
  createMockExamScore,
  updateMockExamScore,
  deleteMockExamScore,
  KNOWN_PERCENT_KEYS,
};
