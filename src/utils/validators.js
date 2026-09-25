const { z } = require('zod');

// ====== اسکیمه‌های اعتبارسنجی اصلی (zod) ======
// این اسکیمه‌ها ساختار payload را در مرز ورودی بررسی می‌کنند.
// اعتبارسنجی‌های منطقی/تجاری (مثل وابستگی‌ها) همچنان داخل کنترلرها انجام می‌شود.

const emailSchema = z.string().trim().min(3).max(150).email('ایمیل نامعتبر است');

// اسکیمای شناسه‌ی رکوردها (User، ExamQuestion، ...).
// Prisma شناسه‌ها را با cuid() تولید می‌کند (مثل "cm5abc123xyz...")، نه uuid؛
// اعتبارسنجی .uuid() روی این شناسه‌ها همیشه رد می‌شد و باگ‌هایی مثل
// «شناسه‌ی مشاور نامعتبر است» در ثبت‌نام و ثبت‌نشدن پاسخ‌های آزمون را می‌ساخت.
// اینجا فرمت آزاد اما سخت‌گیرانه‌ی کافی می‌گیریم: حروف/اعداد/خط تیره، بدون فاصله.
const idSchema = z
  .string()
  .trim()
  .min(10, 'شناسه نامعتبر است')
  .max(64, 'شناسه نامعتبر است')
  .regex(/^[A-Za-z0-9_-]+$/, 'شناسه نامعتبر است');

// یک حرف (لاتین یا فارسی) و حداقل یک رقم
const passwordSchema = z
  .string()
  .min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد')
  .max(128, 'رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد')
  .regex(/[A-Za-z\u0600-\u06FF]/, 'رمز عبور باید شامل یک حرف باشد')
  .regex(/\d/, 'رمز عبور باید شامل یک عدد باشد');

const optionalText = (max) => z.string().trim().max(max).optional();

const phoneSchema = z.string().trim().min(1, 'شماره تماس الزامی است').max(20, 'شماره تماس نامعتبر است');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(80, 'نام نباید بیشتر از ۸۰ کاراکتر باشد'),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['STUDENT', 'ADVISOR'], { errorMap: () => ({ message: 'نقش باید STUDENT یا ADVISOR باشد' }) }),
  // شماره تماس در ثبت‌نام الزامی است (در پروفایل هم قابل ویرایش)
  phone: phoneSchema,
  bio: optionalText(500),
  advisorId: idSchema.optional(),
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

// تعیین/عزل نماینده‌ی مؤسسه — leaderId: شناسه‌ی عضو یا null برای عزل
const setLeaderSchema = z.object({
  leaderId: idSchema.nullable(),
});

// ساخت OTP برای ورود یک‌بار مصرف — طول مدت اعتبار به ساعت (پیش‌فرض ۲۴)
const createOtpSchema = z.object({
  ttlHours: z.number().int().min(1).max(168).optional(),
});

// ====== اشتراک و واریز ======

// شماره کارت ۱۶ رقمی — با فاصله یا خط تیره هم قبول است؛ کنترلر نرمال می‌کند
const cardSettingsSchema = z.object({
  cardNumber: z.string().trim().min(16, 'شماره کارت باید ۱۶ رقم باشد').max(19),
  shaba: z.string().trim().max(26, 'شماره شبا نامعتبر است').optional().nullable(),
  holderName: z.string().trim().max(80, 'نام صاحب کارت طولانی است').optional().nullable(),
});

// ثبت رسید واریز توسط پرداخت‌کننده — عکس data URL مثل عکس پروفایل
const createDepositSchema = z.object({
  targetKind: z.enum(['USER', 'INSTITUTE'], { errorMap: () => ({ message: 'مقصد واریز نامعتبر است' }) }),
  targetId: idSchema,
  receiptImageUrl: z.string().startsWith('data:image/', 'عکس رسید باید data URL تصویر باشد')
    .max(700 * 1024, 'عکس رسید خیلی بزرگ است — حداکثر ۵۰۰ کیلوبایت'),
  amount: z.coerce.number().int('مبلغ باید عدد صحیح باشد').min(0).max(10000000000).optional().nullable(),
  note: optionalText(300),
});

// تأیید/رد رسید توسط صاحب کارت — مدت تمدید دستی تعیین می‌شود
const decideDepositSchema = z.object({
  days: z.number().int('مدت تمدید باید عدد صحیح باشد').min(1, 'حداقل ۱ روز').max(3650, 'حداکثر ۳۶۵۰ روز')
    .optional(),
  decisionNote: optionalText(300),
});

// تنظیم اشتراک فردی کاربر توسط سوپرادمین — مثل اشتراک مؤسسه
const updateUserSubscriptionSchema = z.object({
  endsAt: z.string().datetime({ message: 'تاریخ پایان نامعتبر است' }).optional(),
  daysFromNow: z.number().int().min(1).max(3650).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED']).optional(),
}).refine(
  (data) => data.endsAt || data.daysFromNow || data.status,
  { message: 'حداقل یکی از endsAt، daysFromNow یا status باید ارسال شود' }
);

// تنظیم سقف اعضای مؤسسه توسط سوپرادمین — null یعنی بی‌نهایت
const updateInstituteLimitsSchema = z.object({
  maxAdvisors: z.number().int().min(0).max(100000).nullable(),
  maxStudents: z.number().int().min(0).max(100000).nullable(),
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(80).optional(),
  phone: phoneSchema.optional().or(z.literal('').transform(() => '')),
  bio: optionalText(500),
});

const reminderSchema = z.object({
  studentId: idSchema,
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
  questionId: idSchema,
  selectedOption: z.coerce.number().int().min(1, 'شماره‌ی گزینه نامعتبر است').max(6, 'شماره‌ی گزینه نامعتبر است').optional().nullable(),
  textAnswer: z.string().max(10000, 'پاسخ نباید بیشتر از ۱۰۰۰۰ کاراکتر باشد').optional().nullable(),
});

// درخواست کد یک‌بارمصرف ایمیلی برای ورود خودخدمتی (بدون رمز عبور)
const otpRequestSchema = z.object({
  email: emailSchema,
});

// ورود با کد یک‌بارمصرف ایمیلی — کد جای رمز عبور می‌نشیند
const otpLoginSchema = z.object({
  email: emailSchema,
  otp: z.string().trim().min(4, 'کد یک‌بارمصرف نامعتبر است').max(10, 'کد یک‌بارمصرف نامعتبر است'),
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
    otpRequest: otpRequestSchema,
    otpLogin: otpLoginSchema,
    updateInstituteSubscription: updateInstituteSubscriptionSchema,
    updateUserSubscription: updateUserSubscriptionSchema,
    updateInstituteLimits: updateInstituteLimitsSchema,
    cardSettings: cardSettingsSchema,
    createDeposit: createDepositSchema,
    decideDeposit: decideDepositSchema,
    assignInstitute: assignInstituteSchema,
    assignAdvisorFields: assignAdvisorFieldsSchema,
    setLeader: setLeaderSchema,
    createOtp: createOtpSchema,
    updateInstituteSubscription: updateInstituteSubscriptionSchema,
    updateUserSubscription: updateUserSubscriptionSchema,
    updateInstituteLimits: updateInstituteLimitsSchema,
    cardSettings: cardSettingsSchema,
    createDeposit: createDepositSchema,
    decideDeposit: decideDepositSchema,
  },
};