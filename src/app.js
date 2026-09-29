const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { requestLogger } = require('./config/logger');

const app = express();

// هدرهای امنیتی پایه
app.use(helmet());

// محدودکردن مبدأ درخواست‌ها به فرانت‌اند مجاز
// در حالت تولید از متغیر محیطی CORS_ORIGIN استفاده می‌شود (چند origin با کاما)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // درخواست‌های غیرمرورگری مثل curl یا سرورها origin ندارند؛ مجازند
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(Object.assign(new Error('مبدأ درخواست مجاز نیست'), { status: 403 }));
    },
    credentials: true,
  })
);

// رد سرعت درخواست‌های احراز هویت برای مقابله با brute force
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000, // ۱۵ دقیقه
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد درخواست‌های شما بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید' },
  })
);

// محدودیت شدیدتر روی درخواست بازیابی رمز عبور — جلوگیری از spam ایمیل
app.use(
  '/api/auth/forgot-password',
  rateLimit({
    windowMs: 60 * 60 * 1000, // ۱ ساعت
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد درخواست‌های بازیابی رمز عبور بیش از حد مجاز است؛ بعداً تلاش کنید' },
  })
);

// محدودیت حجم بدنه‌ی درخواست — عکس‌های base64 سؤالات آزمون می‌توانند حجیم باشند
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// لاگ‌گیری ساختاریافته‌ی همه‌ی درخواست‌ها
app.use(requestLogger);

// اندپوینت سلامت سرور - برای اطمینان از بالا بودن سرویس و اتصال درست
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'konkur-backend' });
});

// ریشه‌ی سایت - Render با HEAD / سلامت سرویس را چک می‌کند و پاسخ
// 200 لازم است تا خدمت «healthy» شناخته شود (Express خودش HEAD را از این GET پاسخ می‌دهد)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'konkur-backend' });
});

// مسیرهای فاز یک: ثبت‌نام و ورود، فهرست عمومی مشاوران، و بخش مدیریت سوپرادمین
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/advisors', require('./routes/advisor.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/tags', require('./routes/tag.routes'));
app.use('/api/plans', require('./routes/plan.routes'));
app.use('/api/quotes', require('./routes/quote.routes'));
app.use('/api/students', require('./routes/student.routes'));
app.use('/api/reminders', require('./routes/reminder.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/exams', require('./routes/exam.routes'));
app.use('/api/institute', require('./routes/institute.routes'));
app.use('/api/subscription', require('./routes/subscription.routes'));
app.use('/api/settings', require('./routes/setting.routes'));
app.use('/api/parents', require('./routes/parent.routes'));

// هندلر ۴۰۴ برای مسیرهای تعریف‌نشده
app.use((req, res) => {
  res.status(404).json({ error: 'مسیر مورد نظر یافت نشد' });
});

// هندلر مرکزی خطا - هر throw ناگهانی در route ها اینجا گرفته می‌شود
// و خطاهای قاب‌شناسایی (مثل ValidationError با status) با کد مناسب برمی‌گردند
app.use((err, req, res, next) => {
  req.log?.error({ err }, 'درخواست ناموفق');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || 'خطای داخلی سرور رخ داد',
  });
});

module.exports = app;