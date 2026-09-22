const prisma = require('../config/prisma');
const { validateQuestions, getDeadline } = require('../utils/examValidation');
const { getPagination, paginationMeta } = require('../utils/pagination');

// این کنترلر همه‌ی عملیات مربوط به آزمون‌ها را مدیریت می‌کند:
// ساخت، مشاهده، شروع، ارسال پاسخ، و نمره‌دهی.

// ====== توابع مشاور ======

// ساخت آزمون جدید برای یک دانش‌آموز
// بدنه‌ی درخواست:
//   {
//     title, description?, studentId, scheduledAt (ISO),
//     durationMinutes, visibleToStudent (bool),
//     questions: [{ type: 'MULTIPLE_CHOICE'|'DESCRIPTIVE', text, options?, correctOption?, points? }]
//   }
async function createExam(req, res, next) {
  try {
    const {
      title,
      description,
      studentId,
      scheduledAt,
      durationMinutes,
      visibleToStudent = false,
      visibleFrom,
      questions = [],
    } = req.body;

    if (!title || !studentId || !scheduledAt || !durationMinutes) {
      return res.status(400).json({ error: 'عنوان، دانش‌آموز، زمان شروع و مدت الزامی هستند' });
    }

    // حالت گروهی: آرایه‌ی studentIds — یک آزمون برای چند دانش‌آموز ساخته می‌شود
    const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : null;

    // اطمینان از اینکه دانش‌آموز(ها) به این مشاور متصل هستند
    let links = null;
    if (studentIds) {
      if (studentIds.length === 0) {
        return res.status(400).json({ error: 'حداقل یک دانش‌آموز انتخاب کنید' });
      }
      if (new Set(studentIds).size !== studentIds.length) {
        return res.status(400).json({ error: 'دانش‌آموزهای تکراری در لیست وجود دارد' });
      }
      links = await prisma.advisorStudentLink.findMany({
        where: { advisorId: req.user.id, studentId: { in: studentIds }, status: 'ACTIVE' },
      });
      const linkedIds = new Set(links.map((l) => l.studentId));
      const missing = studentIds.filter((sid) => !linkedIds.has(sid));
      if (missing.length > 0) {
        return res
          .status(403)
          .json({ error: 'برخی از دانش‌آموزهای انتخاب‌شده به شما متصل نیستند یا هنوز تأیید نکرده‌اید' });
      }
    } else {
      const link = await prisma.advisorStudentLink.findFirst({
        where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
      });
      if (!link) {
        return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نکرده‌اید' });
      }
    }

    const mins = Number(durationMinutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 600) {
      return res.status(400).json({ error: 'مدت آزمون باید بین ۱ و ۶۰۰ دقیقه باشد' });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'حداقل یک سؤال وارد کنید' });
    }

    // اعتبارسنجی و نرمال‌سازی سؤال‌ها (منبع مشترک: utils/examValidation.js)
    const normalizedQuestions = validateQuestions(questions);

    // ساخت آزمون‌ها: تک‌دانش‌آموزی یا گروهی (هر دانش‌آموز نسخه‌ی مستقل خودش را می‌گیرد
    // تا پیشرفت، ارسال و نمره‌دهی هرکدام جدا محاسبه شود)
    const targets = studentIds ? studentIds : [studentId];
    const created = [];
    if (targets.length === 1) {
      const exam = await prisma.exam.create({
        data: {
          title: title.trim(),
          description: description ? description.trim() : null,
          studentId: targets[0],
          advisorId: req.user.id,
          scheduledAt: new Date(scheduledAt),
          durationMinutes: mins,
          visibleToStudent: !!visibleToStudent,
          // اگر visibleToStudent=false و visibleFrom ارسال شده، از آن استفاده کن؛ در غیر این‌صورت null (از scheduledAt استفاده می‌شود)
          visibleFrom: visibleFrom ? new Date(visibleFrom) : null,
          questions: {
            create: normalizedQuestions,
          },
        },
        include: EXAM_INCLUDE_FOR_ADVISOR,
      });
      created.push(exam);
    } else {
      // حالت گروهی — همه در یک تراکنش، تا یا همه ساخته شوند یا هیچ‌کدام
      const rows = targets.map((sid) => ({
        title: title.trim(),
        description: description ? description.trim() : null,
        studentId: sid,
        advisorId: req.user.id,
        scheduledAt: new Date(scheduledAt),
        durationMinutes: mins,
        visibleToStudent: !!visibleToStudent,
        visibleFrom: visibleFrom ? new Date(visibleFrom) : null,
      }));
      const made = await prisma.$transaction(
        rows.map((data) =>
          prisma.exam.create({
            data: { ...data, questions: { create: normalizedQuestions } },
          })
        )
      );
      // همه را دقیقاً با idهای ساخته‌شده برمی‌گردانیم (کوئری جدا، چون include داخل transaction ساده نیست)
      const madeIds = made.map((m) => m.id);
      const exams = await prisma.exam.findMany({
        where: { id: { in: madeIds } },
        include: EXAM_INCLUDE_FOR_ADVISOR,
        orderBy: { createdAt: 'desc' },
      });
      created.push(...exams);
    }

    res.status(201).json({ exam: created[0], exams: created, count: created.length });
  } catch (err) {
    next(err);
  }
}

// به‌روزرسانی آزمون (فقط قبل از شروع)
async function updateExam(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      scheduledAt,
      durationMinutes,
      visibleToStudent,
      visibleFrom,
      questions,
    } = req.body;

    const existing = await prisma.exam.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    // بررسی اینکه هنوز ارسالی وجود ندارد
    const submissionCount = await prisma.examSubmission.count({ where: { examId: id } });
    if (submissionCount > 0) {
      return res.status(400).json({ error: 'بعد از شروع آزمون توسط دانش‌آموز، امکان ویرایش وجود ندارد' });
    }

    const data = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (scheduledAt !== undefined) data.scheduledAt = new Date(scheduledAt);
    if (durationMinutes !== undefined) {
      const mins = Number(durationMinutes);
      if (!Number.isInteger(mins) || mins < 1 || mins > 600) {
        return res.status(400).json({ error: 'مدت آزمون باید بین ۱ و ۶۰۰ دقیقه باشد' });
      }
      data.durationMinutes = mins;
    }
    if (visibleToStudent !== undefined) data.visibleToStudent = !!visibleToStudent;
    if (visibleFrom !== undefined) {
      data.visibleFrom = visibleFrom ? new Date(visibleFrom) : null;
    }

    if (Object.keys(data).length > 0) {
      await prisma.exam.update({ where: { id }, data });
    }

    // اگر سؤال‌ها ارسال شده، جایگزینی کامل (با اعتبارسنجی مشترک)
    if (Array.isArray(questions)) {
      await prisma.examQuestion.deleteMany({ where: { examId: id } });
      if (questions.length > 0) {
        const normalizedQuestions = validateQuestions(questions);
        for (const q of normalizedQuestions) {
          await prisma.examQuestion.create({ data: { examId: id, ...q } });
        }
      }
    }

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: EXAM_INCLUDE_FOR_ADVISOR,
    });

    res.json({ exam });
  } catch (err) {
    next(err);
  }
}

// حذف آزمون
async function deleteExam(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.exam.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    await prisma.exam.delete({ where: { id } });
    res.json({ message: 'آزمون حذف شد' });
  } catch (err) {
    next(err);
  }
}

// گرفتن همه‌ی آزمون‌های یک دانش‌آموز (برای مشاور)
async function getExamsForStudent(req, res, next) {
  try {
    const { studentId } = req.params;

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نکرده‌اید' });
    }

    const where = { studentId };
    const pagination = getPagination(req);
    if (pagination) {
      const total = await prisma.exam.count({ where });
      const exams = await prisma.exam.findMany({
        where,
        include: EXAM_INCLUDE_FOR_ADVISOR,
        orderBy: { scheduledAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      });
      return res.json({ exams, ...paginationMeta(total, pagination) });
    }

    const exams = await prisma.exam.findMany({
      where,
      include: EXAM_INCLUDE_FOR_ADVISOR,
      orderBy: { scheduledAt: 'desc' },
    });

    res.json({ exams });
  } catch (err) {
    next(err);
  }
}

// ====== توابع دانش‌آموز ======

// گرفتن همه‌ی آزمون‌های دانش‌آموز (فقط آن‌هایی که visible هستند یا زمانش فرا رسیده)
async function getMyExams(req, res, next) {
  try {
    const now = new Date();
    // فیلتر visibility به‌صورت native در دیتابیس:
    // - اگر visibleToStudent=true → همیشه نمایش بده
    // - اگر visibleToStudent=false و visibleFrom!=null → فقط اگه visibleFrom <= now
    // - اگر visibleToStudent=false و visibleFrom=null → فقط اگه scheduledAt <= now
    const where = {
      studentId: req.user.id,
      OR: [
        { visibleToStudent: true },
        {
          visibleToStudent: false,
          OR: [
            { visibleFrom: { lte: now } },
            { visibleFrom: null, scheduledAt: { lte: now } },
          ],
        },
      ],
    };
    const include = {
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          type: true,
          text: true,
          options: true,
          points: true,
          order: true,
          imageUrl: true,
        },
      },
      submissions: {
        where: { studentId: req.user.id },
        include: { answers: true },
      },
    };

    const pagination = getPagination(req);
    if (pagination) {
      const total = await prisma.exam.count({ where });
      const exams = await prisma.exam.findMany({
        where,
        include,
        orderBy: { scheduledAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      });
      return res.json({ exams, ...paginationMeta(total, pagination) });
    }

    const exams = await prisma.exam.findMany({
      where,
      include,
      orderBy: { scheduledAt: 'desc' },
    });

    res.json({ exams });
  } catch (err) {
    next(err);
  }
}

// شروع یا از سرگیری آزمون — یک submission می‌سازد یا موجود را برمی‌گرداند
async function startExam(req, res, next) {
  try {
    const { id } = req.params; // examId

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!exam) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (exam.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    // بررسی visibility برای نمایش (مخفی بودن)
    const now = new Date();
    if (!exam.visibleToStudent) {
      const showTime = exam.visibleFrom || exam.scheduledAt;
      if (showTime > now) {
        return res.status(403).json({ error: 'این آزمون هنوز در دسترس نیست' });
      }
    }

    // بررسی اینکه زمان شروع آزمون فرا رسیده باشد — حتی اگه visible=true،
    // دانش‌آموز نمی‌تواند قبل از scheduledAt شروع کند
    if (exam.scheduledAt > now) {
      return res.status(403).json({
        error: 'زمان شروع آزمون هنوز فرا نرسیده است',
        scheduledAt: exam.scheduledAt,
      });
    }

    // بررسی اینکه آیا قبلاً submission.SUBMITTED داریم یا نه
    const submitted = await prisma.examSubmission.findFirst({
      where: { examId: id, studentId: req.user.id, status: { in: ['SUBMITTED', 'GRADED'] } },
    });
    if (submitted) {
      return res.status(400).json({
        error: 'شما قبلاً این آزمون را ارسال کرده‌اید',
        submission: submitted,
      });
    }

    // اگر submission در حال انجام داریم، همان را برگردان
    let submission = await prisma.examSubmission.findFirst({
      where: { examId: id, studentId: req.user.id, status: 'IN_PROGRESS' },
      include: { answers: true },
    });

    if (!submission) {
      // ساخت submission جدید
      const maxScore = exam.questions.reduce((s, q) => s + (q.points || 1), 0);
      submission = await prisma.examSubmission.create({
        data: {
          examId: id,
          studentId: req.user.id,
          status: 'IN_PROGRESS',
          maxScore,
        },
        include: { answers: true },
      });
    }

    // پاسخ‌های ذخیره‌شده را به‌صورت map برمی‌گردانیم
    const answerMap = {};
    for (const a of submission.answers) {
      answerMap[a.questionId] = {
        selectedOption: a.selectedOption,
        textAnswer: a.textAnswer,
      };
    }

    res.json({
      // ساعت سرور برای همگام‌سازی شمارش معکوس در کلاینت (اختلاف ساعت سرور و کلاینت)
      serverTime: new Date().toISOString(),
      submission,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        scheduledAt: exam.scheduledAt,
        durationMinutes: exam.durationMinutes,
        questions: exam.questions.map((q) => ({
          id: q.id,
          type: q.type,
          text: q.text,
          options: q.options,
          points: q.points,
          order: q.order,
        })),
      },
      answers: answerMap,
    });
  } catch (err) {
    next(err);
  }
}

// ذخیره‌ی موقت یک پاسخ (بدون ارسال نهایی)
async function saveAnswer(req, res, next) {
  try {
    const { id } = req.params; // submissionId
    const { questionId, selectedOption, textAnswer } = req.body;

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: { exam: { select: { durationMinutes: true } } },
    });
    if (!submission) {
      return res.status(404).json({ error: 'ارسال آزمون یافت نشد' });
    }
    if (submission.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این ارسال متعلق به شما نیست' });
    }
    if (submission.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'این آزمون قبلاً ارسال شده و قابل تغییر نیست' });
    }

    // ممنوعیت تغییر پاسخ پس از پایان مهلت آزمون (شروع + مدت)
    const deadline = getDeadline(submission, submission.exam);
    if (new Date() > deadline) {
      return res.status(403).json({
        error: 'زمان آزمون به پایان رسیده است و امکان تغییر پاسخ وجود ندارد',
      });
    }

    const question = await prisma.examQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.examId !== submission.examId) {
      return res.status(400).json({ error: 'سؤال متعلق به این آزمون نیست' });
    }

    // upsert answer
    const existing = await prisma.examAnswer.findUnique({
      where: { submissionId_questionId: { submissionId: id, questionId } },
    });

    const data = {
      selectedOption: question.type === 'MULTIPLE_CHOICE' ? selectedOption : null,
      textAnswer: question.type === 'DESCRIPTIVE' ? (textAnswer || null) : null,
    };

    if (existing) {
      await prisma.examAnswer.update({ where: { id: existing.id }, data });
    } else {
      await prisma.examAnswer.create({
        data: { submissionId: id, questionId, ...data },
      });
    }

    res.json({ message: 'پاسخ ذخیره شد' });
  } catch (err) {
    next(err);
  }
}

// ارسال نهایی آزمون
async function submitExam(req, res, next) {
  try {
    const { id } = req.params; // submissionId

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: {
        exam: { include: { questions: true } },
        answers: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ error: 'ارسال آزمون یافت نشد' });
    }
    if (submission.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این ارسال متعلق به شما نیست' });
    }
    if (submission.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'این آزمون قبلاً ارسال شده' });
    }

    // محاسبه‌ی نمره‌ی سؤالات تستی به‌صورت خودکار.
    // به‌جای حلقه‌ی Answers.find درون حلقه (O(n²)) از Map استفاده می‌کنیم و
    // به‌روزرسانی‌ها را یکجا در یک transaction می‌فرستیم (بدون N+1).
    let totalScore = 0;
    let maxScore = 0;
    let mcMaxScore = 0; // فقط نمره‌ی سؤالات تستی — برای آزمون‌های ترکیبی
    let hasDescriptive = false;
    const answerByQuestion = new Map(
      submission.answers.map((a) => [a.questionId, a])
    );
    const scoreUpdates = [];
    for (const q of submission.exam.questions) {
      maxScore += q.points || 1;
      if (q.type === 'DESCRIPTIVE') {
        hasDescriptive = true;
      } else if (q.type === 'MULTIPLE_CHOICE') {
        mcMaxScore += q.points || 1;
        const answer = answerByQuestion.get(q.id);
        if (answer) {
          const expected =
            answer.selectedOption === q.correctOption ? q.points || 1 : 0;
          if (answer.selectedOption === q.correctOption) totalScore += expected;
          if (answer.score !== expected) {
            scoreUpdates.push({ id: answer.id, score: expected });
          }
        }
      }
    }

    if (scoreUpdates.length > 0) {
      await prisma.$transaction(
        scoreUpdates.map((u) =>
          prisma.examAnswer.update({ where: { id: u.id }, data: { score: u.score } })
        )
      );
    }

    // اگر آزمون فقط سؤالات تستی دارد (تشریحی ندارد)، نمره نهایی خودکار تثبیت می‌شود
    // و وضعیت به GRADED تغییر می‌کند — دیگر نیاز به تأیید مشاور نیست
    const finalStatus = hasDescriptive ? 'SUBMITTED' : 'GRADED';
    const gradedAt = hasDescriptive ? null : new Date();

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        status: finalStatus,
        submittedAt: new Date(),
        totalScore,
        maxScore,
        gradedAt,
      },
    });

    // پذیرش ارسال حتی پس از مهلت (فرصت برای ارسال نهایی)، اما مشخص‌کردن تأخیر در پاسخ
    const deadline = getDeadline(submission, submission.exam);
    const late = new Date() > deadline;

    res.json({
      message: hasDescriptive
        ? 'آزمون ارسال شد. سؤالات تشریحی نیاز به نمره‌دهی توسط مشاور دارند.'
        : 'آزمون ارسال شد و نمره‌ی نهایی خودکار ثبت شد.',
      submission: updated,
      autoScore: totalScore,
      maxScore,
      // برای آزمون ترکیبی: بیشترین نمره‌ی قابل کسب از سؤالات تستی (بدون تشریحی)
      autoMaxScore: hasDescriptive ? mcMaxScore : undefined,
      autoGraded: !hasDescriptive,
      deadline,
      late,
      note: hasDescriptive ? 'سؤالات تشریحی نیاز به نمره‌دهی توسط مشاور دارند.' : null,
    });
  } catch (err) {
    next(err);
  }
}

// مرور آزمون توسط دانش‌آموز — فقط پس از ارسال:
// گزینه‌ی صحیح، پاسخ خود دانش‌آموز و نمره‌ی هر سؤال را برمی‌گرداند.
// (در getMyExams عمداً correctOption حذف می‌شود تا پیش از ارسال درز نکند؛
//  این اندپوینت گیت ورودی=status SUBMITTED/GRADED دارد.)
async function getExamReview(req, res, next) {
  try {
    const { id } = req.params; // examId

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!exam) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (exam.studentId !== req.user.id) {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    const submission = await prisma.examSubmission.findFirst({
      where: { examId: id, studentId: req.user.id, status: { in: ['SUBMITTED', 'GRADED'] } },
      include: { answers: true },
    });
    if (!submission) {
      return res.status(403).json({
        error: 'مرور پاسخ‌ها فقط پس از ارسال آزمون امکان‌پذیر است',
      });
    }

    const answerByQuestion = new Map(submission.answers.map((a) => [a.questionId, a]));

    const review = exam.questions.map((q) => {
      const a = answerByQuestion.get(q.id);
      const isMC = q.type === 'MULTIPLE_CHOICE';
      let verdict = null; // فقط سؤالات تستی صحیح/غلط قطعی دارند
      if (isMC) {
        if (a?.selectedOption === null || a?.selectedOption === undefined) {
          verdict = 'unanswered';
        } else if (a.selectedOption === q.correctOption) {
          verdict = 'correct';
        } else {
          verdict = 'wrong';
        }
      }
      return {
        id: q.id,
        type: q.type,
        text: q.text,
        imageUrl: q.imageUrl,
        points: q.points,
        options: isMC && q.options ? q.options.split('|') : null,
        // این‌ها فقط پس از گیت ارسال برمی‌گردند:
        correctOption: isMC ? q.correctOption : null,
        selectedOption: a?.selectedOption ?? null,
        textAnswer: a?.textAnswer ?? null,
        score: a?.score ?? null,
        verdict,
      };
    });

    res.json({
      submission: {
        id: submission.id,
        status: submission.status,
        totalScore: submission.totalScore,
        maxScore: submission.maxScore,
        submittedAt: submission.submittedAt,
        feedback: submission.feedback,
      },
      review,
    });
  } catch (err) {
    next(err);
  }
}

// ====== توابع نمره‌دهی مشاور ======

// گرفتن همه‌ی ارسال‌های یک آزمون (برای مشاور)
async function getExamSubmissions(req, res, next) {
  try {
    const { examId } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      return res.status(404).json({ error: 'آزمون یافت نشد' });
    }
    if (exam.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این آزمون متعلق به شما نیست' });
    }

    const where = { examId };
    const pagination = getPagination(req);
    const submissionsInclude = {
      answers: {
        include: { question: true },
      },
      student: {
        select: { id: true, fullName: true },
      },
    };
    let submissions, total;
    if (pagination) {
      total = await prisma.examSubmission.count({ where });
      submissions = await prisma.examSubmission.findMany({
        where,
        include: submissionsInclude,
        orderBy: { submittedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      });
    } else {
      submissions = await prisma.examSubmission.findMany({
        where,
        include: submissionsInclude,
        orderBy: { submittedAt: 'desc' },
      });
    }

    res.json({ exam, submissions, ...paginationMeta(total, pagination) });
  } catch (err) {
    next(err);
  }
}

// نمره‌دهی به یک پاسخ تشریحی یا کل ارسال
// نکته: پس از GRADED شدن، امکان تغییر نمره وجود ندارد
async function gradeSubmission(req, res, next) {
  try {
    const { id } = req.params; // submissionId
    const { answers, totalScore, feedback } = req.body;

    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: { exam: true },
    });
    if (!submission) {
      return res.status(404).json({ error: 'ارسال یافت نشد' });
    }
    if (submission.exam.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این ارسال متعلق به دانش‌آموز شما نیست' });
    }
    // جلوگیری از تغییر نمره پس از تثبیت
    if (submission.status === 'GRADED') {
      return res.status(400).json({
        error: 'این ارسال قبلاً نمره داده شده و قابل تغییر نیست. نمره پس از تأیید نهایی، تثبیت می‌شود.',
      });
    }

    // آپدیت نمره‌ی هر پاسخ (برای تشریحی) — یکجا در transaction برای جلوگیری از N+1
    if (Array.isArray(answers) && answers.length > 0) {
      const gradedAnswers = answers.filter(
        (a) => a.id && a.score !== undefined && Number.isFinite(Number(a.score))
      );
      if (gradedAnswers.length > 0) {
        await prisma.$transaction(
          gradedAnswers.map((a) =>
            prisma.examAnswer.updateMany({
              where: { id: a.id, submissionId: id },
              data: { score: Number(a.score) },
            })
          )
        );
      }
    }

    // محاسبه‌ی total نهایی از همه‌ی answers
    const allAnswers = await prisma.examAnswer.findMany({ where: { submissionId: id } });
    const computedTotal = allAnswers.reduce((s, a) => s + (a.score || 0), 0);

    const updated = await prisma.examSubmission.update({
      where: { id },
      data: {
        status: 'GRADED',
        totalScore: totalScore !== undefined ? totalScore : computedTotal,
        feedback: feedback !== undefined ? (feedback ? String(feedback).trim() : null) : submission.feedback,
        gradedAt: new Date(),
      },
    });

    res.json({ message: 'نمره ثبت شد', submission: updated });
  } catch (err) {
    next(err);
  }
}

// include برای پاسخ‌های مشاور — شامل correctOption و answers
const EXAM_INCLUDE_FOR_ADVISOR = {
  questions: {
    orderBy: { order: 'asc' },
    include: {
      answers: {
        include: { submission: { select: { id: true, studentId: true, status: true } } },
      },
    },
  },
  submissions: {
    include: { answers: true },
  },
};

module.exports = {
  createExam,
  updateExam,
  deleteExam,
  getExamsForStudent,
  getMyExams,
  startExam,
  saveAnswer,
  submitExam,
  getExamReview,
  getExamSubmissions,
  gradeSubmission,
};
