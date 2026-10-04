const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { toLatinDigits, toFaDigits } = require('./../utils/faDigits');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { normalizePhone, normalizeBio, validatePassword } = require('../utils/normalizers');
const { sendPasswordResetEmail, sendOtpEmail } = require('../utils/mailer');
const { remainingInstituteCapacity, CAPACITY_ERROR } = require('../utils/subscription');

const SALT_ROUNDS = 10;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_EXPIRY_HOURS = 1;
// دوره‌ی آزمایشی پیش‌فرض اشتراک فردی تازه‌ثبت‌نام‌ها
const TRIAL_DAYS = 14;
// پیشوند ایمیل داخلی کاربرانی که هنگام ثبت‌نام ایمیل نداده‌اند —
// این ایمیل فقط شناسه‌ی یکتای دیتابیس است؛ ورود با شماره تماس انجام می‌شود.
const LOCAL_EMAIL_DOMAIN = 'local.daneshamozino.ir';

// آیا مشخصات ضروری نقش کامل است؟ (ثبت‌نام مینیمال: اول فقط شماره+رمز)
//   والد/سوپرادمین/مدیر مؤسسه: همیشه کامل؛ دانش‌آموز: وقتی رشته دارد؛
//   مشاور: وقتی حداقل یک تخصص دارد.
// برای مشاور یک کوئری شمارش می‌زنیم چون فرانت بعد از login دیگر getMe را صدا
// نمی‌زند و اگر اینجا دقیق نباشد، مودال «تکمیل ثبت‌نام» بعد از ورود مجدد دیده نمی‌شود.
async function isRegistrationComplete(user) {
  if (user.role === 'PARENT') return true;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'INSTITUTE_MANAGER') return true;
  if (user.role === 'STUDENT') return !!user.field;
  if (user.role === 'ADVISOR') {
    const count = await prisma.advisorField.count({ where: { advisorId: user.id } });
    return count > 0;
  }
  return true;
}

// نام‌های موقتی که ثبت‌نام مینیمال خودبخود می‌سازد — دانش‌آموز فقط تا وقتی یکی از
// این‌ها را دارد می‌تواند نام واقعی‌اش را بگذارد (دقیقاً همان یک‌بارِ «تکمیل ثبت‌نام»)
const GENERATED_PLACEHOLDER_NAMES = ['دانش‌آموز جدید', 'مشاور جدید', 'والد'];

// ====== تنظیمات ورود خودخدمتی با کد ایمیلی (OTP) ======
const OTP_LOGIN_LENGTH = 6; // کد عددی ۶ رقمی
const OTP_LOGIN_TTL_MINUTES = 10; // عمر کد ورود خودخدمتی
const OTP_LOGIN_RESEND_COOLDOWN_MS = 60 * 1000; // حداقل فاصله بین دو درخواست کد
// فاصله‌ی مجاز بین درخواست‌های هر کاربر — در حافظه (برای استقرار تک‌نمونه‌ای کافی است؛
// نمونه‌های چندتایی می‌توانند از Redis استفاده کنند)
const otpLastRequestAt = new Map();

// ثبت‌نام کاربر جدید.
//   دانش‌آموز مستقل: بلافاصله ACTIVE ولی link با مشاور PENDING (مشاور باید تأیید کند)
//   دانش‌آموز مؤسسه‌ای: PENDING تا مدیر مؤسسه تأیید کند
//   مشاور مستقل: PENDING تا سوپرادمین تأیید کند
//   مشاور مؤسسه‌ای: PENDING تا مدیر مؤسسه تأیید کند
//
// تغییرات مهم:
//   ۱) دانش‌آموز: field تکی الزامی است (رشته‌ی خودش)
//   ۲) مشاور: fields آرایه‌ای الزامی است (می‌تواند چند رشته داشته باشد) → در جدول AdvisorField ذخیره می‌شود
//   ۳) link با مشاور PENDING ساخته می‌شود
async function register(req, res, next) {
  try {
    const { fullName, email, password, role, advisorId, phone, bio, field, fields, instituteId, instituteCode, parentInviteCode } = req.body;

    // ثبت‌نام مینیمال — همه‌ی نقش‌ها فقط شماره تماس + رمز می‌دهند؛ بقیه‌ی مشخصات
    // بعد از ورود، داخل پنل تکمیل می‌شود. شماره برای همه الزامی است: والد با آن
    // وارد می‌شود و برای بقیه، خط ارتباط مشاور ↔ دانش‌آموز از همین‌جا می‌آید.
    if (!password || !role) {
      return res.status(400).json({ error: 'رمز عبور و نقش الزامی هستند' });
    }
    if (!['STUDENT', 'ADVISOR', 'PARENT'].includes(role)) {
      return res.status(400).json({ error: 'نقش انتخاب‌شده معتبر نیست' });
    }
    const isParent = role === 'PARENT';
    if (!String(phone || '').trim()) {
      return res.status(400).json({ error: 'شماره تماس الزامی است' });
    }

    // اعتبارسنجی رشته‌ی تحصیلی — همه‌ی رشته‌ها اختیاری‌اند (بعداً داخل پنل تکمیل می‌شود)
    let studentField = null;
    let advisorFields = null;
    if (role === 'PARENT') {
      // والد مشاور و مؤسسه ندارد — فقط فیلدهای پایه را پر می‌کند
    } else if (role === 'STUDENT') {
      studentField = field && ['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'].includes(field) ? field : null;
    } else {
      // ADVISOR — fields آرایه‌ای اختیاری
      let fieldsArray = Array.isArray(fields) ? fields : [];
      if (field && !fieldsArray.includes(field)) {
        fieldsArray = [field, ...fieldsArray];
      }
      fieldsArray = [...new Set(fieldsArray)];
      const invalid = fieldsArray.find((f) => !['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'].includes(f));
      if (invalid) {
        return res.status(400).json({ error: 'رشته‌ی تحصیلی نامعتبر است' });
      }
      advisorFields = fieldsArray.length > 0 ? fieldsArray : null;
    }

    // ثبت‌نام والد: کد دعوت فرزند را زودتر می‌خوانیم تا «مشخصات خودبخود» از فرزند ساخته شود
    // (یک‌مرحله‌ای بودن یعنی والد چیزی جز شماره و رمز وارد نمی‌کند)
    let parentInvite = null;
    if (isParent && parentInviteCode) {
      parentInvite = await prisma.parentInvite.findUnique({
        where: { code: String(parentInviteCode).trim().toUpperCase() },
        include: { student: { select: { fullName: true } } },
      });
      // کد بد/منقضی مانع ثبت‌نام نیست — کاربر بعداً از داخل پنل می‌تواند اتصال بدهد
    }

    // نام و ایمیل:
    //   با ثبت‌نام مینیمال، هیچ کاربری چیزی برای نام/ایمیل الزامی ندارد؛
    //   اگر نداد، هر دو خودبخود ساخته می‌شود (نام موقت + ایمیل داخلی یکتا).
    //   کاربر بعداً از پنل (پروفایل / کارت تکمیل ثبت‌نام) تکمیلش می‌کند.
    //   والد: نام از فرزندِ کد دعوت ساخته می‌شود و ایمیلش همیشه داخلی است؛
    //   ورود والد با شماره تماس انجام می‌شود نه ایمیل.
    let finalFullName = fullName ? String(fullName).trim() : '';
    let finalEmail = email ? String(email).trim() : '';
    if (isParent) {
      const normalizedPhoneForId = String(phone || '').replace(/[^\d]/g, '');
      const digitsForId = normalizedPhoneForId || Date.now().toString();
      finalEmail = `parent${digitsForId.slice(-10)}@parents.daneshamozino.local`;
      finalFullName = parentInvite
        ? `والد ${(parentInvite.student?.fullName || 'فرزند شما').trim()}`
        : (finalFullName || 'والد');
    } else if (!finalFullName) {
      finalFullName = role === 'STUDENT' ? 'دانش‌آموز جدید' : 'مشاور جدید';
    }
    if (!finalEmail) {
      // ایمیل داخلی یکتا: پیشوند نقش + ۱۰ رقم آخر شماره (یا تصادفی) + تایم‌استمپ کوتاه
      const digits = String(phone || '').replace(/[^\d]/g, '').slice(-10) || crypto.randomBytes(5).toString('hex');
      const rolePrefix = role.toLowerCase();
      finalEmail = `${rolePrefix}.${digits}.${Date.now().toString(36)}@${LOCAL_EMAIL_DOMAIN}`;
    }

    const existing = await prisma.user.findUnique({ where: { email: finalEmail } });
    if (existing) {
      return res.status(409).json({ error: isParent
        ? 'با این شماره تماس قبلاً حساب والد ساخته شده است. از صفحه‌ی ورود استفاده کن.'
        : 'این ایمیل قبلاً ثبت شده است' });
    }

    let phoneValue = null;
    let bioValue = null;
    let passwordValue;
    try {
      // شماره تماس الزامی است (بالای تابع چک شد که خالی نباشد) — فرمت معتبر هم لازم است
      phoneValue = normalizePhone(phone);
      bioValue = normalizeBio(bio);
      passwordValue = validatePassword(password);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // عضویت اختیاری در مؤسسه
    let institute = null;
    if (instituteId) {
      institute = await prisma.institute.findUnique({ where: { id: instituteId } });
      if (!institute) {
        return res.status(400).json({ error: 'مؤسسه‌ی انتخاب‌شده یافت نشد' });
      }
    } else if (instituteCode) {
      institute = await prisma.institute.findUnique({ where: { code: String(instituteCode).trim() } });
      if (!institute) {
        return res.status(400).json({ error: 'کد مؤسسه معتبر نیست' });
      }
    }
    if (institute && institute.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'این مؤسسه هنوز تأیید نشده است' });
    }

    // --- محدودیت ظرفیت مؤسسه ---
    // اگر تعداد مشاور/دانش‌آموز مؤسسه به سقف اشتراکش رسیده باشد، عضو جدید پذیرفته نمی‌شود.
    if (institute) {
      const [sub, currentCount] = await Promise.all([
        prisma.instituteSubscription.findUnique({ where: { instituteId: institute.id } }),
        prisma.user.count({ where: { instituteId: institute.id, role } }),
      ]);
      const capacity = remainingInstituteCapacity(sub, role, currentCount);
      if (!capacity.ok) {
        return res.status(403).json({ error: CAPACITY_ERROR });
      }
    }

    // مشاور برای دانش‌آموز اختیاری است (بعداً داخل پنل انتخاب می‌کند)؛
    // اگر ارسال شده باشد اعتبارسنجی کامل می‌شود:
    //   + مرز مؤسسه: مشاور و دانش‌آموز باید هم‌مؤسسه باشند یا هر دو مستقل
    //   + مشاور باید رشته‌ی دانش‌آموز را در تخصص‌هایش داشته باشد
    let advisor = null;
    if (role === 'STUDENT' && advisorId) {
      // سوپرادمین هم می‌تواند مشاور باشد (در فهرست مشاوران مستقل نمایش داده می‌شود)
      advisor = await prisma.user.findFirst({
        where: { id: advisorId, role: { in: ['ADVISOR', 'SUPERADMIN'] }, status: 'ACTIVE' },
        include: { advisorFields: { select: { field: true } } },
      });
      if (!advisor) {
        return res.status(400).json({ error: 'مشاور انتخاب‌شده یافت نشد یا هنوز فعال نیست' });
      }
      const advisorInst = advisor.instituteId;
      const studentInst = institute ? institute.id : null;
      if (advisorInst !== studentInst) {
        return res.status(400).json({
          error: institute
            ? 'در ثبت‌نام مؤسسه‌ای باید از مشاوران همان مؤسسه انتخاب کنی'
            : 'این مشاور عضو یک مؤسسه است؛ برای ثبت‌نام نزد او باید عضو همان مؤسسه باشی',
        });
      }
      if (studentField) {
        // بررسی تطابق رشته: رشته‌ی دانش‌آموز باید در تخصص‌های مشاور باشد
        const advisorFieldList = advisor.advisorFields.map((af) => af.field);
        if (!advisorFieldList.includes(studentField)) {
          return res.status(400).json({
            error: 'این مشاور در رشته‌ی شما تخصص ندارد. لطفاً مشاوری از همان رشته انتخاب کنید.',
          });
        }
      }
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

    // والد فوراً فعال می‌شود — چیزی برای تأیید ندارد؛ دسترسی‌اش با اتصال به فرزند معنا پیدا می‌کند
    const status = role === 'PARENT' || (role === 'STUDENT' && !institute) ? 'ACTIVE' : 'PENDING';

    // ساخت کاربر + رشته‌های تخصص مشاور (اگر مشاور است) + اشتراک آزمایشی در یک تراکنش
    // (به ثبت‌نام‌های جدید ۱۴ روز TRIAL داده می‌شود تا چرخه‌ی واریز از روز اول معنا داشته باشد)
    const user = await prisma.user.create({
      data: {
        fullName: finalFullName,
        email: finalEmail,
        passwordHash,
        role,
        status,
        phone: phoneValue,
        bio: bioValue,
        field: role === 'STUDENT' ? studentField : null,
        instituteId: institute ? institute.id : null,
        subscription: {
          create: {
            status: 'TRIAL',
            endsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          },
        },
        ...(role === 'ADVISOR' && advisorFields
          ? { advisorFields: { create: advisorFields.map((f) => ({ field: f })) } }
          : {}),
      },
    });

    if (role === 'STUDENT' && advisor) {
      await prisma.advisorStudentLink.create({
        data: { advisorId: advisor.id, studentId: user.id, status: 'PENDING' },
      });
    }

    // اگر والد با کد دعوت ثبت‌نام کرده، همین‌جا به فرزند وصلش می‌کنیم
    // (کد قبلاً در بالای تابع خوانده شده تا نام والد از فرزند ساخته شود؛ اینجا فقط اعتبار و مصرف کد)
    let childName = null;
    if (isParent && parentInvite) {
      if (!parentInvite.usedAt && parentInvite.expiresAt > new Date()) {
        await prisma.$transaction([
          prisma.parentLink.create({
            data: { parentId: user.id, studentId: parentInvite.studentId },
          }),
          prisma.parentInvite.update({
            where: { id: parentInvite.id },
            data: { usedAt: new Date() },
          }),
        ]);
        childName = (await prisma.user.findUnique({
          where: { id: parentInvite.studentId },
          select: { fullName: true },
        }))?.fullName || null;
      } else {
        // کد بد/منقضی مانع ثبت‌نام نیست — کاربر بعداً از داخل پنل می‌تواند اتصال بدهد
        await prisma.auditLog.create({
          data: {
            actorId: null,
            action: 'PARENT_INVITE_INVALID_AT_REGISTER',
            targetType: 'USER',
            targetId: user.id,
            details: JSON.stringify({ code: parentInviteCode }),
          },
        }).catch(() => {});
      }
    }

    if (status === 'ACTIVE') {
      const token = generateToken(user);
      setTokenCookie(res, token);
      // registrationComplete: آیا مشخصات ضروری نقش از قبل کامل است؟
      //   والد/سوپرادمین/مدیر مؤسسه: همیشه بله (مودال تکمیل نمی‌بینند)؛
      //   دانش‌آموز: وقتی رشته دارد؛ مشاور: وقتی تخصص دارد.
      const registrationComplete =
        role === 'PARENT'
        || role === 'SUPERADMIN'
        || role === 'INSTITUTE_MANAGER'
        || (role === 'STUDENT' && !!studentField)
        || (role === 'ADVISOR' && Array.isArray(advisorFields) && advisorFields.length > 0);
      return res.status(201).json({
        message: role === 'PARENT'
          ? childName
            ? `ثبت‌نام انجام شد و به «${childName}» وصل شدی`
            : 'ثبت‌نام انجام شد. با کد دعوت فرزندت از پنل خودت وصل شو'
          : 'ثبت‌نام انجام شد',
        user: { id: user.id, fullName: user.fullName, role: user.role, field: user.field },
        registrationComplete,
      });
    }

    return res.status(201).json({
      message: institute
        ? 'ثبت‌نام ثبت شد. حساب شما پس از تأیید مدیر مؤسسه فعال می‌شود'
        : 'ثبت‌نام ثبت شد. حساب شما پس از تأیید سوپرادمین فعال می‌شود',
    });
  } catch (err) {
    next(err);
  }
}

// همه‌ی شکل‌هایی که یک شماره ممکن است در دیتابیس ذخیره شده باشد.
// ثبت‌نام‌های جدید همیشه به شکل ۰۹۱۲۳۴۵۶۷۸۹ ذخیره می‌شوند، ولی داده‌های قدیمی‌تر
// ممکن است بدون صفر اول، با +۹۸، یا با ارقام فارسی ذخیره شده باشند.
function phoneVariants(normalized) {
  const national = normalized.slice(1); // بدون صفر اول (۱۰ رقم)
  const base = [normalized, national, `+98${national}`, `98${national}`, `0098${national}`];
  const fa = [toFaDigits(normalized), toFaDigits(national)];
  return [...new Set([...base, ...fa])];
}

// پیدا کردن کاربرانِ کاندیدا برای ورود. چون ستون شماره تماس یکتا نیست (مثلاً والد و فرزند
// ممکن است یک شماره بدهند)، ممکن است چند کاربر برگردد؛ انتخاب نهایی با تطابق رمز است.
async function findLoginCandidates(identifier) {
  // ایمیل
  if (identifier.includes('@')) {
    const u = await prisma.user.findUnique({ where: { email: identifier } });
    return u ? [u] : [];
  }

  // شماره تماس
  const looksLikePhone = /^[+\d][\d\s()-]{9,}$/.test(toLatinDigits(identifier));
  if (looksLikePhone) {
    let phoneValue = null;
    try {
      phoneValue = normalizePhone(identifier);
    } catch {
      phoneValue = null; // شکل شماره دارد ولی فرمتش درست نیست
    }
    if (phoneValue) {
      return prisma.user.findMany({
        where: { phone: { in: phoneVariants(phoneValue) } },
        orderBy: { createdAt: 'asc' },
      });
    }
    return [];
  }

  // هیچ‌کدام — برای سازگاری با گذشته به‌عنوان ایمیل جستجو می‌شود
  const u = await prisma.user.findUnique({ where: { email: identifier } });
  return u ? [u] : [];
}

// از میان کاندیداها، کاربری را برمی‌گرداند که رمز (یا رمز یک‌بارمصرف) واردشده مال اوست.
// اگر هیچ‌کدام تطابق نداشت، اولین کاندیدا برمی‌گردد تا همان پیام خطای عادی نشان داده شود.
async function pickUserByCredentials(candidates, password) {
  if (candidates.length <= 1) return candidates[0] || null;
  for (const c of candidates) {
    if (c.otpHash && c.otpExpiresAt && c.otpExpiresAt > new Date()) {
      if (await bcrypt.compare(password, c.otpHash)) return c;
    }
    if (c.mustChangePassword !== true && (await bcrypt.compare(password, c.passwordHash))) return c;
  }
  return candidates[0];
}

// ورود کاربر با رمز عبور — شناسه می‌تواند «ایمیل» یا «شماره تماس» باشد (یا رمز یک‌بار مصرف OTP)
// ورود با شماره مخصوصاً برای والدین است که در ثبت‌نام یک‌مرحله‌ای فقط شماره می‌دهند و ایمیلشان خودبخود ساخته می‌شود.
async function login(req, res, next) {
  try {
    const { email: identifierRaw, password } = req.body;
    const identifier = String(identifierRaw || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'ایمیل/شماره تماس و رمز عبور الزامی هستند' });
    }

    // کاربر را با ایمیل یا شماره تماس پیدا می‌کنیم (جزئیات در findLoginCandidates)
    const candidates = await findLoginCandidates(identifier);
    const user = await pickUserByCredentials(candidates, String(password));
    if (!user) {
      return res.status(401).json({ error: 'ایمیل/شماره تماس یا رمز عبور اشتباه است' });
    }

    // ۱) ابتدا OTP را بررسی می‌کنیم — اگر کاربر رمز یک‌بار مصرف داشته باشد و درست وارد کند،
    // ورود موفق است و OTP بلافاصله پاک می‌شود (یک‌بار مصرف)
    if (user.otpHash && user.otpExpiresAt && user.otpExpiresAt > new Date()) {
      const otpMatches = await bcrypt.compare(password, user.otpHash);
      if (otpMatches) {
        // اول وضعیت حساب را بررسی می‌کنیم تا OTP هدر نرود؛
        // اگر همین حالا پاکش کنیم، کاربر غیرفعال/PENDING باید از سوپرادمین یا ایمیل کد جدید بگیرد
        if (user.status === 'PENDING') {
          return res.status(403).json({
            error: user.instituteId
              ? 'حساب شما هنوز توسط مدیر مؤسسه تأیید نشده است'
              : 'حساب شما هنوز تأیید نشده است',
          });
        }
        if (user.status === 'REJECTED') {
          return res.status(403).json({ error: 'درخواست عضویت شما تایید نشد' });
        }
        if (user.status === 'SUSPENDED') {
          return res.status(403).json({ error: 'حساب شما توسط سوپرادمین غیرفعال شده است. با پشتیبانی تماس بگیرید.' });
        }

        // OTP درست بود و حساب هم سالم است — پاکش می‌کنیم و توکن می‌دهیم
        await prisma.user.update({
          where: { id: user.id },
          data: { otpHash: null, otpExpiresAt: null },
        });

      const token = generateToken(user);
      setTokenCookie(res, token);
      // اگر mustChangePassword=true باشد، فرانت کاربر را به /change-password هدایت می‌کند
      return res.json({
        user: {
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          phone: user.phone,
          bio: user.bio,
          field: user.field,
          photoUrl: user.photoUrl,
          mustChangePassword: user.mustChangePassword === true,
          registrationComplete: await isRegistrationComplete(user),
        },
      });
      }
      // OTP درست نبود — به مسیر عادی رمز عبور می‌رویم
    } else if (user.otpHash && user.otpExpiresAt && user.otpExpiresAt <= new Date()) {
      // OTP منقضی شده — پاکش می‌کنیم
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: null, otpExpiresAt: null },
      });
    }

    // ۲) مسیر عادی: بررسی رمز عبور
    // نکته‌ی مهم: اگر mustChangePassword=true باشد، یعنی سوپرادمین قبلاً OTP ساخته
    // و رمز قبلی بی‌اعتبار شده. در این حالت حتی اگر کاربر رمز قبلی را به‌خاطر بیاورد،
    // نباید بتواند وارد شود — باید از سوپرادمین OTP جدید بگیرد.
    if (user.mustChangePassword === true) {
      return res.status(403).json({
        error: 'رمز عبور شما توسط سوپرادمین بازنشانی شده. برای ورود، از او یک رمز یک‌بار مصرف (OTP) جدید بگیرید.',
        mustChangePassword: true,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'ایمیل/شماره تماس یا رمز عبور اشتباه است' });
    }

    if (user.status === 'PENDING') {
      return res.status(403).json({
        error: user.instituteId
          ? 'حساب شما هنوز توسط مدیر مؤسسه تأیید نشده است'
          : 'حساب شما هنوز تأیید نشده است',
      });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({ error: 'درخواست عضویت شما تایید نشد' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'حساب شما توسط سوپرادمین غیرفعال شده است. با پشتیبانی تماس بگیرید.' });
    }

    const token = generateToken(user);
    setTokenCookie(res, token);
    return res.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
        bio: user.bio,
        field: user.field,
        photoUrl: user.photoUrl,
        mustChangePassword: false,
        registrationComplete: await isRegistrationComplete(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

// خروج: کوکی توکن پاک می‌شود (در سمت سرور توکن JWT بی‌حالتی است و فقط انقضای آن کار می‌کند)
async function logout(req, res) {
  clearTokenCookie(res);
  res.json({ message: 'خروج انجام شد' });
}

// اطلاعات کاربر لاگین‌شده بر اساس کوکی/توکن معتبر
async function getMe(req, res) {
  // اگر این کاربر نماینده‌ی (سردار) یک مؤسسه باشد، فرانت باید لینک پنل مؤسسه را نشان دهد
  const ledInstitute = await prisma.institute.findFirst({
    where: { leaderId: req.user.id },
    select: { id: true, name: true },
  });

  // رشته‌های تخصص مشاور — فرانت برای کارت «تکمیل ثبت‌نام» و فیلتر مشاوران لازمش دارد
  let advisorFields = null;
  if (req.user.role === 'ADVISOR') {
    const afRows = await prisma.advisorField.findMany({
      where: { advisorId: req.user.id },
      select: { field: true },
    });
    advisorFields = afRows.map((af) => af.field);
  }

  // آیا مشخصات ضروری نقش کامل است؟ (ثبت‌نام مینیمال: اول فقط شماره+رمز)
  // سوپرادمین و مدیر مؤسسه اصلاً مودال تکمیل را نبینند — حساب‌شان چیز اضافه‌ای ندارد.
  // کاربران فعلی سیستم چون field/fields دارند از قبل true می‌گیرند؛ مودال فقط
  // برای تازه‌ثبت‌نام‌های بدون رشته باز می‌ماند.
  const registrationComplete =
    req.user.role === 'PARENT'
    || req.user.role === 'SUPERADMIN'
    || req.user.role === 'INSTITUTE_MANAGER'
    || (req.user.role === 'STUDENT' && !!req.user.field)
    || (req.user.role === 'ADVISOR' && Array.isArray(advisorFields) && advisorFields.length > 0);

  res.json({
    user: {
      id: req.user.id,
      fullName: req.user.fullName,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      bio: req.user.bio,
      field: req.user.field,
      fields: advisorFields,
      photoUrl: req.user.photoUrl,
      // نمایندگی مؤسسه — null یعنی نماینده نیست
      ledInstitute: ledInstitute || null,
      // برای اینکه فرانت بداند آیا باید صفحه‌ی تغییر رمز اجباری را نشان دهد یا خیر
      mustChangePassword: req.user.mustChangePassword === true,
      // ثبت‌نام مینیمال: false یعنی کارت «تکمیل ثبت‌نام» در داشبورد باز بماند
      registrationComplete,
    },
    // وضعیت اشتراک برای نمایش در هدر و هشدار نزدیکی انقضا
    access: {
      hasAccess: req.hasAccess !== false,
      userSubscription: req.user.subscription && {
        status: req.user.subscription.status,
        endsAt: req.user.subscription.endsAt,
      },
      instituteSubscription: req.user.institute?.subscription && {
        status: req.user.institute.subscription.status,
        endsAt: req.user.institute.subscription.endsAt,
        instituteName: req.user.institute.name,
      },
    },
  });
}

// کاربر می‌تواند اطلاعات پروفایل خودش را ویرایش کند
// محدودیت‌ها بر اساس نقش:
//   - STUDENT: فقط phone و bio قابل ویرایش است (نام قابل تغییر نیست تا از مسخره‌بازی جلوگیری شود)
//   - ADVISOR و SUPERADMIN: fullName، phone و bio قابل ویرایش است
async function updateMyProfile(req, res, next) {
  try {
    const { fullName, phone, bio, field, fields, instituteId } = req.body;
    const role = req.user.role;

    const data = {};

    // تکمیل ثبت‌نام داخل پنل — رشته‌ی دانش‌آموز (تکی)
    if (field !== undefined) {
      if (role !== 'STUDENT') {
        return res.status(403).json({ error: 'فقط دانش‌آموز رشته‌ی تحصیلی دارد' });
      }
      if (!field) {
        return res.status(400).json({ error: 'رشته‌ی تحصیلی نامعتبر است' });
      }
      data.field = field;
    }

    // تکمیل ثبت‌نام داخل پنل — رشته‌های تخصص مشاور (چندتا)
    if (fields !== undefined) {
      if (role !== 'ADVISOR') {
        return res.status(403).json({ error: 'فقط مشاور رشته‌ی تخصص دارد' });
      }
      const fieldsArray = [...new Set(Array.isArray(fields) ? fields : [])];
      const invalid = fieldsArray.find((f) => !['HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL'].includes(f));
      if (invalid) {
        return res.status(400).json({ error: 'رشته‌ی تحصیلی نامعتبر است' });
      }
      // تراکنش: پاک‌کردن قبلی‌ها + نوشتن جدیدها (آرایه‌ی خالی یعنی پاک‌کردن)
      await prisma.$transaction([
        prisma.advisorField.deleteMany({ where: { advisorId: req.user.id } }),
        ...(fieldsArray.length > 0
          ? [prisma.advisorField.createMany({
              data: fieldsArray.map((f) => ({ advisorId: req.user.id, field: f })),
            })]
          : []),
      ]);
      // اگر مشاور دیگر هیچ تخصصی ندارد و دانش‌آموزی هم وصل نیست، لینک‌هایش را نمی‌خوریم؛
      // فقط وضعیت تکمیل بودن ثبت‌نام پایین می‌آید (فرانت کارت را دوباره نشان می‌دهد).
    }

    // تکمیل ثبت‌نام داخل پنل — عضویت در مؤسسه (دانش‌آموز/مشاور)
    if (instituteId !== undefined) {
      if (role === 'PARENT' || role === 'INSTITUTE_MANAGER') {
        return res.status(403).json({ error: 'این نقش عضو مؤسسه نمی‌شود' });
      }
      if (instituteId === null || instituteId === '') {
        data.instituteId = null;
      } else if (instituteId !== req.user.instituteId) {
        // عضویت جدید/تغییر مؤسسه — مثل ثبت‌نام: بررسی ظرفیت + رفتن به صف تأیید مدیر
        const inst = await prisma.institute.findUnique({ where: { id: instituteId } });
        if (!inst) {
          return res.status(400).json({ error: 'مؤسسه‌ی انتخاب‌شده یافت نشد' });
        }
        if (inst.status !== 'ACTIVE') {
          return res.status(400).json({ error: 'این مؤسسه هنوز تأیید نشده است' });
        }
        const [sub, currentCount] = await Promise.all([
          prisma.instituteSubscription.findUnique({ where: { instituteId: inst.id } }),
          prisma.user.count({ where: { instituteId: inst.id, role } }),
        ]);
        const capacity = remainingInstituteCapacity(sub, role, currentCount);
        if (!capacity.ok) {
          return res.status(403).json({ error: CAPACITY_ERROR });
        }
        data.instituteId = inst.id;
        if (req.user.status === 'ACTIVE') {
          data.status = 'PENDING'; // تا تأیید مدیر مؤسسه
        }
      }
    }

    // نام: مشاور/سوپرادمین هر وقت بخواهند عوض می‌کنند.
    // دانش‌آموز فقط وقتی می‌تواند نام بگذارد که هنوز نام موقتِ ثبت‌نام مینیمال
    // («دانش‌آموز جدید») را دارد — یعنی دقیقاً همان یک‌بارِ «تکمیل ثبت‌نام»؛
    // بعد از آن تغییر نام مسدود می‌ماند (برای جلوگیری از مسخره‌بازی).
    if (fullName !== undefined) {
      const trimmedName = String(fullName).trim();
      if (trimmedName.length < 2) {
        return res.status(400).json({ error: 'نام باید حداقل ۲ کاراکتر باشد' });
      }
      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'نام نباید بیشتر از ۱۰۰ کاراکتر باشد' });
      }
      if (role === 'STUDENT') {
        const currentName = String(req.user.fullName || '').trim();
        const isFreshPlaceholder = !currentName || GENERATED_PLACEHOLDER_NAMES.includes(currentName);
        if (!isFreshPlaceholder) {
          return res.status(403).json({
            error: 'دانش‌آموز نمی‌تواند نام خود را تغییر دهد. در صورت نیاز، با مشاور یا سوپرادمین تماس بگیرید.',
          });
        }
      }
      data.fullName = trimmedName;
    }

    // phone برای همه‌ی نقش‌ها قابل ویرایش است
    if (phone !== undefined) {
      try {
        data.phone = normalizePhone(phone);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // bio برای همه‌ی نقش‌ها قابل ویرایش است
    if (bio !== undefined) {
      try {
        data.bio = normalizeBio(bio);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // فیلدهای مشاور جدا از data در تراکنش خودش ذخیره می‌شود؛ همین که یکی ارسال شده باشد کافی است
    const hasFieldUpdate = fields !== undefined && role === 'ADVISOR';
    if (Object.keys(data).length === 0 && !hasFieldUpdate) {
      return res.status(400).json({ error: 'هیچ فیلدی برای به‌روزرسانی ارسال نشده' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        bio: true,
        photoUrl: true,
        field: true,
        instituteId: true,
      },
    });

    // رشته‌های تخصص مشاور — اگر در همین درخواست عوض شده از متغیر، وگرنه از دیتابیس
    let updatedFields;
    if (hasFieldUpdate) {
      updatedFields = [...new Set(Array.isArray(fields) ? fields : [])];
    } else if (role === 'ADVISOR') {
      const afRows = await prisma.advisorField.findMany({
        where: { advisorId: req.user.id },
        select: { field: true },
      });
      updatedFields = afRows.map((af) => af.field);
    }

    // وضعیت تکمیل ثبت‌نام بعد از این به‌روزرسانی
    const registrationComplete =
      role === 'PARENT'
      || role === 'SUPERADMIN'
      || role === 'INSTITUTE_MANAGER'
      || (role === 'STUDENT' && !!updated.field)
      || (role === 'ADVISOR' && Array.isArray(updatedFields) && updatedFields.length > 0);

    res.json({
      message: 'پروفایل به‌روزرسانی شد',
      user: {
        ...updated,
        fields: updatedFields || undefined,
        registrationComplete,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ====== عکس پروفایل ======
// body: { photoUrl: "data:image/png;base64,..." } یا { photoUrl: null } برای حذف
// عکس به‌صورت data URL در دیتابیس ذخیره می‌شود (مثل imageUrl سؤالات آزمون).
// فرمت‌های مجاز png/jpeg/webp/gif و سقف ~۵۰۰KB عکس واقعی (حدود ۷۰۰KB data URL).
const MAX_PHOTO_DATAURL_LENGTH = 700 * 1024;
const ALLOWED_PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

async function updateMyPhoto(req, res, next) {
  try {
    const { photoUrl } = req.body;

    // حذف عکس — null یا رشته‌ی خالی یعنی پاک‌کردن
    if (photoUrl === null || photoUrl === '') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { photoUrl: null },
      });
      return res.json({ message: 'عکس پروفایل حذف شد', photoUrl: null });
    }

    if (typeof photoUrl !== 'string' || !photoUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'عکس باید به‌صورت data URL تصویر ارسال شود' });
    }

    // استخراج MIME از data URL: data:image/png;base64,...
    const mimeMatch = photoUrl.match(/^data:(image\/[a-zA-Z+]+);/);
    const mime = mimeMatch ? mimeMatch[1].toLowerCase() : '';
    if (!ALLOWED_PHOTO_MIME.includes(mime)) {
      return res.status(400).json({ error: 'فرمت عکس باید PNG، JPEG، WebP یا GIF باشد' });
    }

    if (photoUrl.length > MAX_PHOTO_DATAURL_LENGTH) {
      return res.status(413).json({ error: 'عکس خیلی بزرگ است — حداکثر ۵۰۰ کیلوبایت' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { photoUrl },
      select: { id: true, photoUrl: true },
    });

    res.json({ message: 'عکس پروفایل به‌روزرسانی شد', photoUrl: updated.photoUrl });
  } catch (err) {
    next(err);
  }
}

// تغییر رمز عبور خود توسط کاربر لاگین‌شده
// کاربرد ۱: بعد از ورود با OTP، کاربر مجبور است رمزش را عوض کند (mustChangePassword=true)
// کاربرد ۲: تغییر داوطلبانه‌ی رمز توسط کاربر (نیاز به currentPassword دارد)
async function changeMyPassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'رمز عبور جدید الزامی است' });
    }

    let passwordValue;
    try {
      passwordValue = validatePassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ error: 'کاربر یافت نشد' });
    }

    // دو حالت داریم:
    //   ۱) حالت اجباری (mustChangePassword=true): کاربر با OTP وارد شده، هویتش تأیید شده.
    //      نیازی به currentPassword نیست. فقط رمز جدید را تنظیم می‌کنیم.
    //   ۲) حالت داوطلبانه: کاربر می‌خواهد رمزش را عوض کند. باید currentPassword بفرستد
    //      و با passwordHash فعلی مطابقت داشته باشد.
    if (!user.mustChangePassword) {
      // حالت داوطلبانه — currentPassword الزامی است
      if (!currentPassword) {
        return res.status(400).json({ error: 'رمز عبور فعلی الزامی است' });
      }
      const matches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
      }
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);
    // پاک‌سازی mustChangePassword و otpHash بعد از تعیین رمز جدید
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        otpHash: null,
        otpExpiresAt: null,
        mustChangePassword: false,
      },
    });

    res.json({ message: 'رمز عبور با موفقیت تغییر کرد' });
  } catch (err) {
    next(err);
  }
}

// درخواست بازیابی رمز عبور — ایمیل را می‌گیرد و لینک بازیابی به آن می‌فرستد
// نکته‌ی امنیتی: چه ایمیل وجود داشته باشد چه نداشته، همین پاسخ را برمی‌گردانیم
// تا با brute-force نتوان فهمید کدام ایمیل‌ها در سیستم ثبت هستند.
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // توکن یک‌بار مصرف با طول کافی
      const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

      await prisma.passwordReset.create({
        data: { email, token, expiresAt, userId: user.id },
      });

      // URL بازیابی — فرانت این لینک را به‌صورت /reset-password?token=XXX هندل می‌کند
      const baseUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      // ارسال ایمیل — اگر SMTP تنظیم نباشد، در لاگ چاپ می‌شود
      try {
        await sendPasswordResetEmail({ to: email, resetUrl, userName: user.fullName });
      } catch (mailErr) {
        // حتی اگر ایمیل فرستاده نشد، به کاربر پیام موفقیت می‌دهیم (امنیت)
        req.log?.error?.({ err: mailErr }, 'ارسال ایمیل بازیابی ناموفق');
      }
    }

    res.json({
      message: 'اگر این ایمیل در سیستم ثبت باشد، لینک بازیابی به آن ارسال شد.',
    });
  } catch (err) {
    next(err);
  }
}

// تنظیم رمز عبور جدید با توکن بازیابی
async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    let passwordValue;
    try {
      passwordValue = validatePassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const reset = await prisma.passwordReset.findUnique({ where: { token } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return res.status(400).json({ error: 'توکن نامعتبر یا منقضی است' });
    }

    const user = await prisma.user.findUnique({ where: { email: reset.email } });
    if (!user) {
      return res.status(400).json({ error: 'کاربر یافت نشد' });
    }

    const passwordHash = await bcrypt.hash(passwordValue, SALT_ROUNDS);

    // در یک تراکنش: رمز جدید + علامت‌گذاری توکن به‌عنوان استفاده‌شده + پاک‌سازی OTP
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, otpHash: null, otpExpiresAt: null },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ message: 'رمز عبور با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.' });
  } catch (err) {
    next(err);
  }
}

// اعتبارسنجی توکن بازیابی — برای اینکه فرانت قبل از نمایش فرم بداند توکن معتبر است یا نه
async function verifyResetToken(req, res, next) {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'توکن الزامی است' });
    }
    const reset = await prisma.passwordReset.findUnique({ where: { token } });
    const valid = reset && !reset.usedAt && reset.expiresAt > new Date();
    res.json({ valid });
  } catch (err) {
    next(err);
  }
}

// ====== درخواست کد یک‌بارمصرف ایمیلی برای ورود (خودخدمتی) ======
// کاربر ایمیلش را وارد می‌کند و یک کد عددی ۶ رقمی برایش ایمیل می‌شود؛
// سپس با ایمیل + همان کد از مسیر عادی login وارد می‌شود (کد جای رمز می‌نشیند).
// نکات امنیتی:
//   - پاسخ همیشه یکسان است تا با آن نتوان فهمید کدام ایمیل‌ها ثبت هستند (ضد enumeration)
//   - کد با bcrypt هش می‌شود، ۱۰ دقیقه اعتبار دارد و بعد از ورود موفق پاک می‌شود
//   - بین دو درخواست برای یک حساب حداقل ۶۰ ثانیه فاصله لازم است (ضد spam ایمیل)
//   - رمز عبور قبلی باطل نمی‌شود و mustChangePassword هم true نمی‌شود —
//     این مسیر «ورود بدون رمز» است، نه بازنشانی اجباری (برای بازنشانی، مسیر forgot-password هست)
async function requestOtp(req, res, next) {
  try {
    const { email } = req.body;

    const genericMessage =
      'اگر این ایمیل در سیستم ثبت باشد، کد ورود یک‌بارمصرف به آن ارسال شد. صندوق ورودی (و پوشه‌ی اسپم) را بررسی کنید.';

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ message: genericMessage });
    }

    // محدودیت فاصله‌ی بین درخواست‌ها — ۶۰ ثانیه برای هر حساب
    const last = otpLastRequestAt.get(user.id) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < OTP_LOGIN_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_LOGIN_RESEND_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({
        error: `کد قبلاً ارسال شده است؛ ${waitSec} ثانیه دیگر دوباره تلاش کنید`,
      });
    }

    // تولید کد عددی ۶ رقمی
    let otp = '';
    for (let i = 0; i < OTP_LOGIN_LENGTH; i += 1) {
      otp += String(crypto.randomInt(0, 10));
    }

    const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const otpExpiresAt = new Date(Date.now() + OTP_LOGIN_TTL_MINUTES * 60 * 1000);

    // توجه: برخلاف OTP سوپرادمین، اینجا passwordHash دست نمی‌خورد و
    // mustChangePassword هم تغییر نمی‌کند — فقط یک کد ورود موقت می‌سازیم.
    await prisma.user.update({
      where: { id: user.id },
      data: { otpHash, otpExpiresAt },
    });
    otpLastRequestAt.set(user.id, Date.now());

    // اگر ایمیل شکست خورد، به کاربر همان پیام عمومی را می‌دهیم و کد بی‌اعتبار می‌ماند
    let devOtp = null;
    try {
      const mailResult = await sendOtpEmail({
        to: user.email,
        otp,
        userName: user.fullName,
        ttlMinutes: OTP_LOGIN_TTL_MINUTES,
      });
      // در حالت توسعه (SMTP تنظیم نشده) کد فقط در لاگ سرور می‌رود — همان را
      // در پاسخ هم برمی‌گردانیم تا تست «ورود بدون رمز» بدون کاویدن لاگ‌ها ممکن باشد.
      // در تولید هرگز برنمی‌گردد (devMode فقط وقتی SMTP نیست true می‌شود).
      if (mailResult?.devMode && process.env.NODE_ENV !== 'production') {
        devOtp = otp;
      }
    } catch (mailErr) {
      req.log?.error?.({ err: mailErr }, 'ارسال ایمیل OTP ورود ناموفق');
      otpLastRequestAt.delete(user.id);
    }

    const response = { message: genericMessage, ttlMinutes: OTP_LOGIN_TTL_MINUTES };
    if (devOtp) response.devOtp = devOtp;
    res.json(response);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateMyProfile,
  updateMyPhoto,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  changeMyPassword,
  requestOtp,
};
