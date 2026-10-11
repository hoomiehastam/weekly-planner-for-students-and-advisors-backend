// اعتبارسنجی و نرمال‌سازی سؤالات آزمون به‌صورت مجزا از کنترلر
// تا هم در createExam/updateExam استفاده شود و هم به‌صورت واحد قابل تست باشد.

// خطای اعتبارسنجی با HTTP status 400؛ هندلر مرکزی خطا همین status را برمی‌گرداند
function validationError(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

// اعتبارسنجی و نرمال‌سازی یک سؤال.
// خروجی همان ساختاری است که Prisma برای ساخت سؤال نیاز دارد.
function validateQuestion(q, n, idx) {
  if (!q || !['MULTIPLE_CHOICE', 'DESCRIPTIVE'].includes(q.type)) {
    throw validationError(`نوع سؤال ${n} معتبر نیست`);
  }

  const text = q.text ? String(q.text).trim() : '';
  const imageUrl = q.imageUrl ? String(q.imageUrl).trim() : '';

  if (!text && !imageUrl) {
    throw validationError(`سؤال ${n} باید متن یا عکس داشته باشد`);
  }

  let correctOption = null;

  if (q.type === 'MULTIPLE_CHOICE') {
    if (!q.options || typeof q.options !== 'string') {
      throw validationError(`گزینه‌های سؤال ${n} الزامی است (با | جدا کنید)`);
    }
    const opts = q.options.split('|').map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2 || opts.length > 6) {
      throw validationError(`سؤال ${n} باید بین ۲ تا ۶ گزینه داشته باشد`);
    }
    const c = Number(q.correctOption);
    if (!Number.isInteger(c) || c < 1 || c > opts.length) {
      throw validationError(`گزینه‌ی صحیح سؤال ${n} معتبر نیست`);
    }
    correctOption = c;
  }

  return {
    type: q.type,
    text: text || null,
    options: q.type === 'MULTIPLE_CHOICE' ? q.options.split('|').map((s) => s.trim()).join('|') : null,
    correctOption,
    points: typeof q.points === 'number' && q.points > 0 ? q.points : 1,
    imageUrl: imageUrl || null,
    order: typeof q.order === 'number' ? q.order : idx,
  };
}

// اعتبارسنجی کل آرایه‌ی سؤال‌ها و برگرداندن نسخه‌ی نرمال‌شده.
// در صورت وجود هر خطا، با پیام خطا مربوطه throw می‌کند.
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw validationError('حداقل یک سؤال باید وارد شود');
  }
  return questions.map((q, i) => validateQuestion(q, i + 1, i));
}

// محاسبه‌ی مهلت تحویل آزمون = زمان شروع + مدت آزمون (به دقیقه)
function getDeadline(submission, exam) {
  const startedAt = submission.startedAt instanceof Date ? submission.startedAt : new Date(submission.startedAt);
  return new Date(startedAt.getTime() + (exam.durationMinutes || 0) * 60000);
}

module.exports = { validateQuestions, validateQuestion, getDeadline, validationError };