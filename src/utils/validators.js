const { z } = require('zod');

// ====== اسکیمه‌های اعتبارسنجی اصلی (zod) ======
// این اسکیمه‌ها ساختار payload را در مرز ورودی بررسی می‌کنند.
// اعتبارسنجی‌های منطقی/تجاری (مثل وابستگی‌ها) همچنان داخل کنترلرها انجام می‌شود.

const emailSchema = z.string().trim().min(3).max(150).email('ایمیل نامعتبر است');

// یک حرف (لاتین یا فارسی) و حداقل یک رقم
const passwordSchema = z
  .string()
  .min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد')
  .max(128, 'رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد')
  .regex(/[A-Za-z\u0600-\u06FF]/, 'رمز عبور باید شامل یک حرف باشد')
  .regex(/\d/, 'رمز عبور باید شامل یک عدد باشد');

const optionalText = (max) => z.string().trim().max(max).optional();

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(80, 'نام نباید بیشتر از ۸۰ کاراکتر باشد'),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['STUDENT', 'ADVISOR'], { errorMap: () => ({ message: 'نقش باید STUDENT یا ADVISOR باشد' }) }),
  phone: optionalText(20),
  bio: optionalText(500),
  advisorId: z.string().uuid('شناسه‌ی مشاور نامعتبر است').optional(),
  // کد دعوت مؤسسه — اختیاری؛ با این کد عضو مؤسسه می‌شوی
  instituteCode: z.string().trim().min(1).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'ایمیل الزامی است'),
  password: z.string().min(1, 'رمز عبور الزامی است'),
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(80).optional(),
  phone: optionalText(20),
  bio: optionalText(500),
});

const reminderSchema = z.object({
  studentId: z.string().uuid('شناسه‌ی دانش‌آموز نامعتبر است'),
  message: z.string().trim().min(1, 'متن یادآور الزامی است').max(500, 'متن یادآور نباید بیشتر از ۵۰۰ کاراکتر باشد'),
});

const tagSchema = z.object({
  name: z.string().trim().min(1, 'نام تگ الزامی است').max(60, 'نام تگ نباید بیشتر از ۶۰ کاراکتر باشد'),
});

// هدف هفتگی به دقیقه؛ مرز حداکثری ۷ روز = ۱۰۰۸۰ دقیقه
const weeklyGoalSchema = z.object({
  weeklyGoalMinutes: z.coerce.number({ message: 'مقدار باید عدد باشد' }).int('مقدار باید عدد صحیح باشد').min(0).max(10080),
});

// ذخیره‌ی موقت پاسخ — فقط ساختار؛ صحت وابستگی به سؤال در کنترلر بررسی می‌شود
const saveAnswerSchema = z.object({
  questionId: z.string().uuid('شناسه‌ی سؤال نامعتبر است'),
  selectedOption: z.coerce.number().int().optional().nullable(),
  textAnswer: z.string().max(10000, 'پاسخ نباید بیشتر از ۱۰۰۰۰ کاراکتر باشد').optional().nullable(),
});

// میان‌افزار اعتبارسنجی: در صورت خطا، اولین پیام خطا با کد ۴۰۰ برمی‌گردد
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues[0]?.message || 'ورودی نامعتبر است';
      return res.status(400).json({ error: message });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = {
  validate,
  schemas: {
    register: registerSchema,
    login: loginSchema,
    profile: profileSchema,
    reminder: reminderSchema,
    tag: tagSchema,
    weeklyGoal: weeklyGoalSchema,
    saveAnswer: saveAnswerSchema,
  },
};