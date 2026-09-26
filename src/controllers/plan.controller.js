const prisma = require('../config/prisma');

// این کنترلر همه‌ی عملیات مربوط به برنامه‌ی مطالعاتی را مدیریت می‌کند:
// ساخت، ویرایش کامل، مشاهده، و تغییر وضعیت آیتم‌ها.

// اعتبارسنجی ساده‌ی فرمت ساعت (HH:MM)؛ در صورت خالی بودن هم عبور می‌کند
function validateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  // نرمال‌سازی ارقام فارسی/عربی به لاتین — کاربر با کیبورد فارسی هم بتواند ساعت بنویسد
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const v = String(value).trim()
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw new Error('فرمت ساعت معتبر نیست؛ باید به شکل HH:MM باشد (مثل 08:30)');
  }
  return v;
}

// --- اعتبارسنجی همپوشانی بازه‌های ساعتی در یک روز ---
// یک نفر نمی‌تواند همزمان دو درس را بخواند؛ پس بازه‌های زمان‌دارِ یک روز
// نباید روی هم بیفتند. بازه‌های بی‌زمان آزادند.
// در صورت همپوشانی، خطا با نام درس‌ها و بازه‌ها پرتاب می‌شود.
function assertNoOverlap(days, DAY_NAMES) {
  for (const d of days) {
    const timed = (d.items || [])
      .filter((it) => it.startTime && it.endTime)
      .map((it) => ({ subject: it.subject || 'بدون نام', start: it.startTime, end: it.endTime }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 1; i < timed.length; i++) {
      const prev = timed[i - 1];
      const cur = timed[i];
      if (cur.start < prev.end) {
        const dayName = DAY_NAMES[d.dayOfWeek] || `روز ${d.dayOfWeek}`;
        throw new Error(
          `در ${dayName} بازه‌ی «${prev.subject}» (${prev.start}–${prev.end}) با «${cur.subject}» (${cur.start}–${cur.end}) همپوشانی دارد`
        );
      }
    }
  }
}

// نام روزهای هفته برای پیام‌های خطا
const DAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

// اعتبارسنجی روز هفته ۰ تا ۶
function validateDayOfWeek(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error('روز هفته باید بین ۰ (شنبه) تا ۶ (جمعه) باشد');
  }
  return n;
}

// اعتبارسنجی عدد صحیح مثبت یا null
function validateNullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('مقدار باید عدد صحیح مثبت باشد');
  }
  return n;
}

// اعتبارسنجی تگ‌ها: فقط تگ‌های پیش‌فرض یا تگ‌های شخصی همین مشاور (یا سوپرادمین) قابل انتساب‌اند
async function assertTagsValid(db, tags, advisorId) {
  if (!tags || tags.length === 0) return;
  const unique = [...new Set(tags.map((t) => String(t)).filter(Boolean))];
  if (unique.length === 0) return;
  const count = await db.tag.count({
    where: { id: { in: unique }, OR: [{ isDefault: true }, { advisorId }] },
  });
  if (count !== unique.length) {
    throw new Error('یک یا چند تگ نامعتبر یا متعلق به شما نیست');
  }
}

// نرمال‌سازی یک آیتم ورودی به ساختار پایدار برای ساخت/به‌روزرسانی
function toItemInput(it, idx) {
  const tags = Array.isArray(it.tags)
    ? [...new Set(it.tags.map((t) => (t == null ? '' : String(t))).filter(Boolean))]
    : [];
  return {
    id: it.id || null,
    subject: String(it.subject?.trim() || ''),
    description: it.description ? String(it.description).trim() : null,
    startTime: validateTime(it.startTime),
    endTime: validateTime(it.endTime),
    order: typeof it.order === 'number' ? it.order : idx,
    tags,
  };
}

// ساخت داده‌ی Prisma برای آیتم جدید (روز موجود یا روز تازه)
function itemCreateData(it) {
  const data = {
    subject: it.subject,
    description: it.description,
    startTime: it.startTime,
    endTime: it.endTime,
    order: it.order,
  };
  if (it.tags.length > 0) {
    data.tags = { create: it.tags.map((tagId) => ({ tagId })) };
  }
  return data;
}

// جایگزینی diff محور روزها و آیتم‌های یک برنامه در یک تراکنش.
// آیتم‌هایی که شناسه دارند به‌روزرسانی می‌شوند و فیلدهای دانش‌آموز
// (status، actualMinutes، testsTaken و لاگ‌های per-tag) دست‌نخورده می‌مانند.
async function replaceDays(tx, { planId, advisorId, days }) {
  const incomingDays = days.map((d) => ({
    dayOfWeek: validateDayOfWeek(d.dayOfWeek),
    items: (d.items || []).map((it, idx) => toItemInput(it, idx)),
  }));

  // اعتبارسنجی همپوشانی بازه‌های ساعتی هر روز (پیام خطا به کلاینت برمی‌گردد)
  assertNoOverlap(incomingDays, DAY_NAMES);

  // اعتبارسنجی متمرکز همه‌ی تگ‌ها قبل از هر تغییری
  for (const day of incomingDays) {
    for (const item of day.items) {
      await assertTagsValid(tx, item.tags, advisorId);
    }
  }

  const existingDays = await tx.planDay.findMany({
    where: { planId },
    include: { items: { include: { tags: true } } },
  });
  const daysByDOW = new Map(existingDays.map((d) => [d.dayOfWeek, d]));
  const incomingDOWs = new Set(incomingDays.map((d) => d.dayOfWeek));

  // حذف روزهایی که دیگر در درخواست نیستند (cascade آیتم‌ها و لاگ‌هایشان را هم می‌گیرد)
  const daysToDelete = existingDays.filter((d) => !incomingDOWs.has(d.dayOfWeek));
  if (daysToDelete.length > 0) {
    await tx.planDay.deleteMany({ where: { id: { in: daysToDelete.map((d) => d.id) } } });
  }

  for (const incoming of incomingDays) {
    const existingDay = daysByDOW.get(incoming.dayOfWeek);

    // روز کاملاً جدید
    if (!existingDay) {
      await tx.planDay.create({
        data: {
          planId,
          dayOfWeek: incoming.dayOfWeek,
          items: { create: incoming.items.map((it) => itemCreateData(it)) },
        },
      });
      continue;
    }

    const existingItems = existingDay.items;
    const existingById = new Map(existingItems.map((it) => [it.id, it]));

    const toUpdate = incoming.items.filter((it) => it.id && existingById.has(it.id));
    const toCreate = incoming.items.filter((it) => !(it.id && existingById.has(it.id)));
    const keptIds = new Set(toUpdate.map((it) => it.id));

    // به‌روزرسانی آیتم‌های حفظ‌شده — فقط فیلدهای ساختاری؛ وضعیت و لاگ‌ها دست نمی‌خورد
    for (const it of toUpdate) {
      await tx.planItem.update({
        where: { id: it.id },
        data: {
          subject: it.subject,
          description: it.description,
          startTime: it.startTime,
          endTime: it.endTime,
          order: it.order,
        },
      });

      // همگام‌سازی تگ‌ها
      const currentTagIds = new Set(existingById.get(it.id).tags.map((t) => t.tagId));
      const nextTagIds = new Set(it.tags);
      const toRemove = [...currentTagIds].filter((t) => !nextTagIds.has(t));
      const toAdd = [...nextTagIds].filter((t) => !currentTagIds.has(t));
      if (toRemove.length > 0) {
        await tx.planItemTag.deleteMany({ where: { itemId: it.id, tagId: { in: toRemove } } });
      }
      for (const tagId of toAdd) {
        await tx.planItemTag.create({ data: { itemId: it.id, tagId } });
      }
    }

    // ساخت آیتم‌های جدید
    for (const it of toCreate) {
      await tx.planItem.create({ data: itemCreateData(it) });
    }

    // حذف آیتم‌های روز که دیگر در درخواست نیستند
    const toDeleteIds = existingItems
      .map((it) => it.id)
      .filter((idStr) => !keptIds.has(idStr));
    if (toDeleteIds.length > 0) {
      await tx.planItem.deleteMany({ where: { id: { in: toDeleteIds } } });
    }
  }
}

// یک برنامه‌ی مطالعاتی جدید می‌سازد؛ همراه با روزها و آیتم‌ها و تگ‌ها
// بدنه‌ی درخواست:
//   { studentId, title, note?, startsAt, expiresAt?, days: [{ dayOfWeek, items: [{ subject, description?, startTime?, endTime?, tags: [tagId] }] }] }
async function createPlan(req, res, next) {
  try {
    const { studentId, title, note, startsAt, expiresAt, days = [] } = req.body;

    if (!studentId || !title || !startsAt) {
      return res.status(400).json({ error: 'شناسه‌ی دانش‌آموز، عنوان و تاریخ شروع الزامی هستند' });
    }

    // اعتبارسنجی همپوشانی بازه‌های ساعتی هر روز
    try {
      assertNoOverlap(
        days.map((d) => ({ dayOfWeek: d.dayOfWeek, items: (d.items || []).map((it) => toItemInput(it, 0)) })),
        DAY_NAMES
      );
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // اطمینان از اینکه این دانش‌آموز واقعاً به این مشاور متصل است و link فعال است
    // (PENDING نباید بتواند برنامه بسازد — مشاور هنوز تأیید نکرده)
    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId, status: 'ACTIVE' },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست یا هنوز تأیید نکرده‌اید' });
    }

    // اعتبارسنجی تگ‌ها قبل از ساخت
    for (const d of days) {
      for (const item of d.items || []) {
        await assertTagsValid(
          prisma,
          (Array.isArray(item.tags) ? item.tags : []).map((t) => String(t)),
          req.user.id
        );
      }
    }

    const plan = await prisma.studyPlan.create({
      data: {
        title: String(title).trim(),
        note: note ? String(note).trim() : null,
        studentId,
        advisorId: req.user.id,
        startsAt: new Date(startsAt),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        days: {
          create: days.map((d) => ({
            dayOfWeek: validateDayOfWeek(d.dayOfWeek),
            items: {
              create: (d.items || []).map((it, idx) => itemCreateData(toItemInput(it, idx))),
            },
          })),
        },
      },
      include: PLAN_INCLUDE,
    });

    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
}

// ویرایش برنامه‌ی موجود به‌صورت diff محور:
//   - عنوان، توضیح، بازه‌ی زمانی به‌روز می‌شود
//   - آیتم‌های دارای شناسه به‌روزرسانی می‌شوند و داده‌های ثبت‌شده‌ی دانش‌آموز
//     (status، actualMinutes، testsTaken و لاگ‌های per-tag) حفظ می‌شوند
//   - آیتم‌های جدید ساخته و آیتم‌های حذف‌شده پاک می‌شوند
async function updatePlan(req, res, next) {
  try {
    const { id } = req.params;
    const { title, note, startsAt, expiresAt, days } = req.body;

    const existing = await prisma.studyPlan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'برنامه‌ی مطالعاتی یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این برنامه متعلق به شما نیست' });
    }

    const updatedPlanFields = {};
    if (title !== undefined) {
      const t = String(title).trim();
      if (!t) return res.status(400).json({ error: 'عنوان برنامه نمی‌تواند خالی باشد' });
      updatedPlanFields.title = t;
    }
    if (note !== undefined) updatedPlanFields.note = note ? String(note).trim() : null;
    if (startsAt !== undefined) updatedPlanFields.startsAt = new Date(startsAt);
    if (expiresAt !== undefined) {
      updatedPlanFields.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (Object.keys(updatedPlanFields).length > 0) {
        await tx.studyPlan.update({ where: { id }, data: updatedPlanFields });
      }

      if (Array.isArray(days)) {
        await replaceDays(tx, { planId: id, advisorId: req.user.id, days });
      }

      return tx.studyPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
    });

    res.json({ plan });
  } catch (err) {
    next(err);
  }
}

// لیست برنامه‌های فعال دانش‌آموز (همان دانش‌آموز لاگین‌شده)
async function getMyPlans(req, res, next) {
  try {
    const now = new Date();
    const plans = await prisma.studyPlan.findMany({
      where: {
        studentId: req.user.id,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      include: PLAN_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
}

// لیست همه‌ی برنامه‌های یک دانش‌آموز خاص برای مشاور
async function getPlansForStudent(req, res, next) {
  try {
    const { studentId } = req.params;

    const link = await prisma.advisorStudentLink.findFirst({
      where: { advisorId: req.user.id, studentId },
    });
    if (!link) {
      return res.status(403).json({ error: 'این دانش‌آموز به شما متصل نیست' });
    }

    const plans = await prisma.studyPlan.findMany({
      where: { studentId },
      include: PLAN_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
}

// دانش‌آموز وضعیت یک آیتم را تغییر می‌دهد (مثلاً به DONE)
async function updateItemStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['PENDING', 'DONE', 'SKIPPED'].includes(status)) {
      return res.status(400).json({ error: 'وضعیت معتبر نیست' });
    }

    // فقط آیتمی قابل تغییر است که متعلق به این دانش‌آموز باشد
    const item = await prisma.planItem.findFirst({
      where: { id, day: { plan: { studentId: req.user.id } } },
    });
    if (!item) {
      return res.status(404).json({ error: 'آیتم یافت نشد' });
    }

    const updated = await prisma.planItem.update({
      where: { id },
      data: { status },
    });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
}

// دانش‌آموز می‌تواند تعداد دقیقه‌ی واقعی مطالعه و تعداد تست‌های زده‌شده را برای یک آیتم ثبت کند
// بدنه‌ی درخواست: { actualMinutes?, testsTaken? }
// اگر مقدار null ارسال شود، فیلد پاک می‌شود.
async function updateItemProgress(req, res, next) {
  try {
    const { id } = req.params;
    const { actualMinutes, testsTaken } = req.body;

    // اعتبارسنجی: حداقل یکی از دو فیلد باید ارسال شده باشد
    if (actualMinutes === undefined && testsTaken === undefined) {
      return res.status(400).json({ error: 'حداقل یکی از actualMinutes یا testsTaken را ارسال کن' });
    }

    const item = await prisma.planItem.findFirst({
      where: { id, day: { plan: { studentId: req.user.id } } },
    });
    if (!item) {
      return res.status(404).json({ error: 'آیتم یافت نشد' });
    }

    const data = {};
    if (actualMinutes !== undefined) {
      data.actualMinutes = validateNullableInt(actualMinutes);
    }
    if (testsTaken !== undefined) {
      data.testsTaken = validateNullableInt(testsTaken);
    }

    const updated = await prisma.planItem.update({
      where: { id },
      data,
    });

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
}

// حذف یک برنامه‌ی مطالعاتی (فقط مشاور صاحب برنامه یا سوپرادمین)
async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.studyPlan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'برنامه یافت نشد' });
    }
    if (existing.advisorId !== req.user.id && req.user.role !== 'SUPERADMIN') {
      return res.status(403).json({ error: 'این برنامه متعلق به شما نیست' });
    }

    await prisma.studyPlan.delete({ where: { id } });
    res.json({ message: 'برنامه حذف شد' });
  } catch (err) {
    next(err);
  }
}

// مدل‌های همراه (eager load) که در همه‌ی پاسخ‌های plan با هم برمی‌گردند
const PLAN_INCLUDE = {
  days: {
    orderBy: { dayOfWeek: 'asc' },
    include: {
      items: {
        orderBy: { order: 'asc' },
        include: {
          tags: { include: { tag: true } },
          itemLogs: { include: { tag: true } },
        },
      },
    },
  },
};

// ============================================================
// لاگ‌های per-tag برای آیتم‌های درسی
// ============================================================

// ذخیره یا به‌روزرسانی لاگ per-tag برای یک آیتم درسی.
// دانش‌آموز برای هر تگ (یا «سایر» با tagId=null) می‌تواند دقیقه و تعداد تست ثبت کند.
// اگر لاگی برای این (itemId, tagId) از قبل وجود داشته باشد، به‌روزرسانی می‌شود؛
// در غیر این‌صورت ساخته می‌شود (upsert).
// نکته: لاگ با دقیقه‌ی ۰ حذف می‌شود «مگر اینکه» testsTaken یا note داشته باشد —
// اینطوری ثبتِ فقطِ تعداد تست (بدون زمان) هم ممکن است.
// بدنه‌ی درخواست:
//   { tagId?: string|null, minutes: number, testsTaken?: number|null, note?: string }
async function setItemTagLog(req, res, next) {
  try {
    const { id } = req.params; // شناسه‌ی PlanItem
    const { tagId = null, minutes, testsTaken = null, note = null } = req.body;

    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 0 || mins > 1440) {
      return res.status(400).json({ error: 'دقیقه باید عدد صحیح بین ۰ و ۱۴۴۰ باشد' });
    }

    // اطمینان از اینکه آیتم متعلق به این دانش‌آموز است
    const item = await prisma.planItem.findFirst({
      where: { id, day: { plan: { studentId: req.user.id } } },
    });
    if (!item) {
      return res.status(404).json({ error: 'آیتم یافت نشد' });
    }

    // اگر tagId ارسال شده، مطمئن شو این تگ واقعاً به این آیتم اختصاص دارد
    if (tagId) {
      const tagLink = await prisma.planItemTag.findUnique({
        where: { itemId_tagId: { itemId: id, tagId } },
      });
      if (!tagLink) {
        return res.status(400).json({ error: 'این تگ به این درس اختصاص ندارد' });
      }
    }

    // اعتبارسنجی testsTaken
    let testsValue = null;
    if (testsTaken !== null && testsTaken !== undefined && testsTaken !== '') {
      const t = Number(testsTaken);
      if (!Number.isInteger(t) || t < 0) {
        return res.status(400).json({ error: 'تعداد تست باید عدد صحیح مثبت باشد' });
      }
      testsValue = t;
    }

    const noteValue = note ? String(note).trim().slice(0, 280) : null;

    // اگر دقیقه‌ی ۰ ارسال شد ولی تست یا توضیح دارد، لاگ نگه داشته می‌شود (ثبتِ فقط تست)
    const keepWithZeroMinutes = mins === 0 && (testsValue !== null || noteValue !== null);

    // upsert: اگر لاگی برای این (itemId, tagId) هست، به‌روزرسانی کن؛ وگرنه بساز
    // نکته: از findFirst استفاده می‌کنیم چون tagId می‌تواند null باشد و
    // در PostgreSQL NULL در unique constraint متمایز محسوب می‌شود.
    const existing = await prisma.planItemLog.findFirst({
      where: { planItemId: id, tagId: tagId || null },
    });

    let log;
    if (existing) {
      if (mins === 0 && !keepWithZeroMinutes) {
        await prisma.planItemLog.delete({ where: { id: existing.id } });
        return res.json({ log: null, deleted: true });
      }
      log = await prisma.planItemLog.update({
        where: { id: existing.id },
        data: {
          minutes: mins,
          testsTaken: testsValue,
          note: noteValue,
        },
        include: { tag: true },
      });
    } else {
      if (mins === 0 && !keepWithZeroMinutes) {
        // چیزی برای ساختن نیست
        return res.json({ log: null, deleted: false });
      }
      log = await prisma.planItemLog.create({
        data: {
          planItemId: id,
          tagId: tagId || null,
          minutes: mins,
          testsTaken: testsValue,
          note: noteValue,
        },
        include: { tag: true },
      });
    }

    res.json({ log });
  } catch (err) {
    next(err);
  }
}

// حذف لاگ per-tag برای یک آیتم درسی
async function deleteItemTagLog(req, res, next) {
  try {
    const { id } = req.params; // شناسه‌ی PlanItem
    const { tagId } = req.body; // tagId که لاگ آن باید حذف شود (null برای «سایر»)

    const item = await prisma.planItem.findFirst({
      where: { id, day: { plan: { studentId: req.user.id } } },
    });
    if (!item) {
      return res.status(404).json({ error: 'آیتم یافت نشد' });
    }

    await prisma.planItemLog.deleteMany({
      where: { planItemId: id, tagId: tagId || null },
    });

    res.json({ message: 'لاگ حذف شد' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createPlan,
  updatePlan,
  getMyPlans,
  getPlansForStudent,
  updateItemStatus,
  updateItemProgress,
  deletePlan,
  setItemTagLog,
  deleteItemTagLog,
};
