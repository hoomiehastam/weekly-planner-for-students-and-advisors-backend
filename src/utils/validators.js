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
  // رشته‌ی تحصیلی — برای دانش‌آموز الزامی (تکی)، برای مشاور اختیاری (چون می‌تواند fields بفرستد)
  field: z.enum(['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'], {
    errorMap: () => ({ message: 'رشته باید یکی از HUMANITIES، MATH_PHYSICS یا EXPERIMENTAL باشد' }),
  }).optional(),
  // رشته‌های تخصص مشاور — آرایه‌ای از رشته‌ها (فقط برای ADVISOR)
  // اگر ارسال شود، field تکی نادیده گرفته می‌شود
  fields: z.array(
    z.enum(['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'])
  ).min(1, 'حداقل یک رشته باید انتخاب شود').max(3, 'نهایتاً ۳ رشته').optional(),
  // برای ثبت‌نام مؤسسه‌ای: شناسه‌ی مؤسسه
  instituteId: z.string().cuid('شناسه‌ی مؤسسه نامعتبر است').optional().nullable(),
  instituteCode: z.string().trim().min(1).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'ایمیل الزامی است'),
  password: z.string().min(1, 'رمز عبور الزامی است'),
});

// درخواست بازنشانی رمز عبور — فقط ایمیل لازم است
const forgotPasswordSchema = z.object({
  email: emailSchema,
});

// تنظیم رمز عبور جدید با توکن بازیابی
const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'توکن الزامی است'),
  newPassword: passwordSchema,
});

// تنظیم مدت اشتراک مؤسسه توسط سوپرادمین — تعداد روز + وضعیت
const updateInstituteSubscriptionSchema = z.object({
  endsAt: z.string().datetime({ message: 'تاریخ پایان نامعتبر است' }).optional(),
  daysFromNow: z.number().int().min(1).max(3650).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED']).optional(),
}).refine(
  (data) => data.endsAt || data.daysFromNow || data.status,
  { message: 'حداقل یکی از endsAt، daysFromNow یا status باید ارسال شود' }
);

// تخصیص مشاور به مؤسسه — instituteId می‌تواند null باشد (یعنی مستقل شدن)
const assignInstituteSchema = z.object({
  instituteId: z.string().cuid().optional().nullable(),
});

// تخصیص رشته‌های تخصص به مشاور — آرایه‌ای از رشته‌ها (می‌تواند خالی باشد برای پاک‌کردن)
const assignAdvisorFieldsSchema = z.object({
  fields: z.array(
    z.enum(['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'])
  ).max(3, 'نهایتاً ۳ رشته').default([]),
});

// ساخت OTP برای ورود یک‌بار مصرف — طول مدت اعتبار به ساعت (پیش‌فرض ۲۴)
const createOtpSchema = z.object({
  ttlHours: z.number().int().min(1).max(168).optional(),
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
    forgotPassword: forgotPasswordSchema,
    resetPassword: resetPasswordSchema,
    updateInstituteSubscription: updateInstituteSubscriptionSchema,
    assignInstitute: assignInstituteSchema,
    assignAdvisorFields: assignAdvisorFieldsSchema,
    createOtp: createOtpSchema,
  },
};