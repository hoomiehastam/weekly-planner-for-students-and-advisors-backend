const prisma = require('../config/prisma');
const { isSubscriptionActive, effectiveAccessInfo, remainingInstituteCapacity, CAPACITY_ERROR } = require('../utils/subscription');

// ====== اشتراک کاربر لاگین‌شده ======
// وضعیت اشتراک فردی + اشتراک مؤسسه (اگر عضو باشد) + دسترسی مؤثر
// مسیر مستثنا از قطع دسترسی است تا کاربرِ بلاک‌شده هم بتواند وضعیتش را ببیند.
async function getMySubscription(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        subscription: true,
        institute: { include: { subscription: true } },
      },
    });

    const info = effectiveAccessInfo(user, {
      userSub: user.subscription,
      instituteSub: user.institute?.subscription || null,
    });

    res.json({
      subscription: user.subscription && {
        status: user.subscription.status,
        endsAt: user.subscription.endsAt,
        tier: user.subscription.tier,
      },
      instituteSubscription: user.institute?.subscription && {
        status: user.institute.subscription.status,
        endsAt: user.institute.subscription.endsAt,
        tier: user.institute.subscription.tier,
        instituteName: user.institute.name,
      },
      access: info,
    });
  } catch (err) {
    next(err);
  }
}

// ====== تنظیم/ویرایش شماره کارت واریز خود کاربر (مشاور مستقل) ======
// body: { cardNumber, shaba?, holderName? }
async function setMyCard(req, res, next) {
  try {
    let { cardNumber, shaba, holderName } = req.body;

    // نرمال‌سازی: حذف فاصله/خط تیره و اعداد فارسی
    const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
    cardNumber = String(cardNumber)
      .replace(/[\s-]/g, '')
      .replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)));
    if (!/^\d{16}$/.test(cardNumber)) {
      return res.status(400).json({ error: 'شماره کارت باید دقیقاً ۱۶ رقم باشد' });
    }

    const settings = await prisma.cardSettings.upsert({
      where: { ownerKind_ownerId: { ownerKind: 'USER', ownerId: req.user.id } },
      create: { ownerKind: 'USER', ownerId: req.user.id, cardNumber, shaba: shaba || null, holderName: holderName || null },
      update: { cardNumber, shaba: shaba || null, holderName: holderName || null },
    });

    res.json({ message: 'شماره کارت ذخیره شد', card: settings });
  } catch (err) {
    next(err);
  }
}

// ====== مشاهده‌ی شماره کارت واریز خودم ======
// هر نقشی که بتواند مقصد پرداخت دیگران باشد (مشاور مستقل، مدیر مؤسسه، سوپرادمین)
// با این اندپوینت کارت فعلی‌اش را می‌بیند و در صورت نیاز ویرایش می‌کند.
async function getMyCard(req, res, next) {
  try {
    const card = await prisma.cardSettings.findFirst({
      where: { ownerKind: 'USER', ownerId: req.user.id },
    });
    res.json({ card: card || null });
  } catch (err) {
    next(err);
  }
}

// ====== زمینه‌ی صفحه‌ی واریز برای کاربر لاگین‌شده ======
// تعیین می‌کند کاربر باید به کارت چه کسی واریز کند و تمدیدِ چه چیزی را می‌خرد:
//   دانش‌آموز با مشاور مستقل      → کارت مشاورش (USER)       → تمدید اشتراک خودش
//   دانش‌آموز با مشاور آموزشگاهی  → کارت مؤسسه (INSTITUTE)   → تمدید اشتراک خودش
//   مشاور آموزشگاهی              → بدون کارت (اشتراکش با مؤسسه است — چیزی برای پرداخت ندارد)
//   مدیر/سردار مؤسسه             → کارت سوپرادمین (SYSTEM)  → تمدید اشتراک کل مؤسسه
//   مشاور مستقل                  → کارت سوپرادمین (SYSTEM)  → تمدید اشتراک خودش
//   سوپرادمین                    → چیزی برای پرداخت ندارد (کارتش را در پنل مدیریت می‌گذارد)
async function getDepositContext(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        subscription: true,
        asStudentLinks: {
          where: { status: { in: ['PENDING', 'ACTIVE'] } },
          select: { advisorId: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // کارت سیستم (سوپرادمین)
    // نکته: ownerKind_ownerId روی ownerId=null (کارت SYSTEM) با findUnique کار نمی‌کند
    // (Prisma مقادیر null در where ترکیبی نمی‌پذیرد) — پس با findFirst می‌گیریم.
    const systemCard = await prisma.cardSettings.findFirst({
      where: { ownerKind: 'SYSTEM' },
    });

    let payee = null; // { kind: 'SYSTEM'|'INSTITUTE'|'USER', card, title, targetKind, targetId, targetTitle }

    // مدیر/سردار مؤسسه → کارت سیستم، مقصد: کل مؤسسه
    const isManager = user.role === 'INSTITUTE_MANAGER' || (await prisma.institute.findFirst({ where: { leaderId: user.id }, select: { id: true } }));
    if (user.role === 'SUPERADMIN') {
      payee = null;
    } else if (isManager && user.instituteId) {
      const inst = await prisma.institute.findUnique({ where: { id: user.instituteId }, select: { id: true, name: true } });
      payee = {
        kind: 'SYSTEM',
        card: systemCard,
        title: 'شماره کارت پلتفرم',
        targetKind: 'INSTITUTE',
        targetId: user.instituteId,
        targetTitle: inst?.name,
      };
    } else if (user.instituteId) {
      // عضو مؤسسه → کارت مؤسسه، مقصد: اشتراک فردی خودش
      const instCard = await prisma.cardSettings.findUnique({
        where: { ownerKind_ownerId: { ownerKind: 'INSTITUTE', ownerId: user.instituteId } },
      });
      const inst = await prisma.institute.findUnique({ where: { id: user.instituteId }, select: { id: true, name: true } });
      payee = {
        kind: 'INSTITUTE',
        card: instCard,
        title: `شماره کارت مؤسسه ${inst?.name || ''}`.trim(),
        targetKind: 'USER',
        targetId: user.id,
        targetTitle: 'اشتراک خودم',
      };
    } else if (user.role === 'STUDENT' && user.asStudentLinks[0]) {
      // دانش‌آموز مستقل → کارت مشاورش، مقصد: اشتراک فردی خودش
      const advisor = await prisma.user.findUnique({
        where: { id: user.asStudentLinks[0].advisorId },
        select: { id: true, fullName: true, instituteId: true },
      });
      if (advisor?.instituteId) {
        // مشاورِ دانش‌آموز آموزشگاهی است → طبق قانون ارتباط، کارت مؤسسه نمایش داده می‌شود
        const instCard = await prisma.cardSettings.findUnique({
          where: { ownerKind_ownerId: { ownerKind: 'INSTITUTE', ownerId: advisor.instituteId } },
        });
        const inst = await prisma.institute.findUnique({ where: { id: advisor.instituteId }, select: { name: true } });
        payee = {
          kind: 'INSTITUTE',
          card: instCard,
          title: `شماره کارت مؤسسه ${inst?.name || ''}`.trim(),
          targetKind: 'USER',
          targetId: user.id,
          targetTitle: 'اشتراک خودم',
        };
      } else {
        const advisorCard = advisor && await prisma.cardSettings.findUnique({
          where: { ownerKind_ownerId: { ownerKind: 'USER', ownerId: advisor.id } },
        });
        payee = {
          kind: 'USER',
          card: advisorCard,
          title: `شماره کارت مشاور (${advisor?.fullName || ''})`.trim(),
          targetKind: 'USER',
          targetId: user.id,
          targetTitle: 'اشتراک خودم',
        };
      }
    } else if (user.role === 'ADVISOR' && user.instituteId) {
      // مشاور آموزشگاهی → اشتراکش با اشتراک مؤسسه برقرار است؛ چیزی برای پرداخت ندارد
      payee = null;
    } else {
      // مشاور مستقل → کارت سیستم، مقصد: اشتراک فردی خودش
      payee = {
        kind: 'SYSTEM',
        card: systemCard,
        title: 'شماره کارت پلتفرم',
        targetKind: 'USER',
        targetId: user.id,
        targetTitle: 'اشتراک خودم',
      };
    }

    res.json({ payee, systemCard });
  } catch (err) {
    next(err);
  }
}

// ====== ثبت رسید واریز ======
// هر کاربر لاگین‌شده‌ای (حتی با اشتراک منقضی) می‌تواند رسید بفرستد.
// body: { targetKind: 'USER'|'INSTITUTE', targetId, receiptImageUrl, amount?, note? }
async function createDeposit(req, res, next) {
  try {
    const { targetKind, targetId, receiptImageUrl, amount, note } = req.body;

    // اعتبارسنجی مقصد و تعیین صاحب کارت (تأییدکننده)
    let ownerId;
    let targetTitle;
    if (targetKind === 'INSTITUTE') {
      const inst = await prisma.institute.findUnique({ where: { id: targetId } });
      if (!inst) return res.status(404).json({ error: 'مؤسسه یافت نشد' });
      // صاحب کارتِ مؤسسه: مدیر رسمی یا سردار تعیین‌شده
      const manager = inst.leaderId
        ? await prisma.user.findUnique({ where: { id: inst.leaderId } })
        : await prisma.user.findFirst({ where: { role: 'INSTITUTE_MANAGER', instituteId: inst.id } });
      if (!manager) return res.status(400).json({ error: 'مدیری برای تأیید واریز این مؤسسه تعیین نشده است' });
      ownerId = manager.id;
      targetTitle = inst.name;
    } else {
      const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
      if (!targetUser) return res.status(404).json({ error: 'کاربر مقصد یافت نشد' });
      targetTitle = targetUser.fullName;
      // مقصد کاربر فردی است → تأییدکننده کیست؟
      if (targetUser.id === req.user.id) {
        // تمدید اشتراک خودم → بر اساس نقشم
        if (req.user.role === 'STUDENT') {
          const link = await prisma.advisorStudentLink.findFirst({
            where: { studentId: req.user.id, status: { in: ['PENDING', 'ACTIVE'] } },
            orderBy: { createdAt: 'desc' },
          });
          if (!link) return res.status(400).json({ error: 'برای تمدید، ابتدا به یک مشاور متصل شوید' });
          const myAdvisor = await prisma.user.findUnique({
            where: { id: link.advisorId },
            select: { instituteId: true },
          });
          if (req.user.instituteId) {
            // دانش‌آموزِ مؤسسه‌ای → کارت مؤسسه را دیده و به آن واریز کرده؛
            // تأیید با نماینده‌ی مؤسسه است (نه مشاور)
            const inst = await prisma.institute.findUnique({ where: { id: req.user.instituteId } });
            const manager = inst?.leaderId
              ? await prisma.user.findUnique({ where: { id: inst.leaderId } })
              : await prisma.user.findFirst({ where: { role: 'INSTITUTE_MANAGER', instituteId: inst.id } });
            if (!manager) return res.status(400).json({ error: 'نماینده‌ای برای تأیید واریز مؤسسه‌ی شما تعیین نشده است' });
            ownerId = manager.id;
          } else if (myAdvisor?.instituteId) {
            // مشاورِ من آموزشگاهی است → کارت مؤسسه‌ی او را دیده‌ام؛ تأیید با نماینده‌ی آن مؤسسه
            const inst = await prisma.institute.findUnique({ where: { id: myAdvisor.instituteId } });
            const manager = inst?.leaderId
              ? await prisma.user.findUnique({ where: { id: inst.leaderId } })
              : await prisma.user.findFirst({ where: { role: 'INSTITUTE_MANAGER', instituteId: inst.id } });
            if (!manager) return res.status(400).json({ error: 'نماینده‌ای برای تأیید واریز مؤسسه تعیین نشده است' });
            ownerId = manager.id;
          } else {
            // مشاور مستقل → خودش تأیید می‌کند
            ownerId = link.advisorId;
          }
        } else {
          // مشاور/مدیر: سوپرادمین تأیید می‌کند
          const superadmin = await prisma.user.findFirst({ where: { role: 'SUPERADMIN', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
          if (!superadmin) return res.status(400).json({ error: 'سوپرادمینی برای تأیید یافت نشد' });
          ownerId = superadmin.id;
        }
      } else if (targetUser.instituteId) {
        // تمدید اشتراک یکی از اعضای مؤسسه‌ی من (مدیر/سردار خودش تعیین می‌کند) —
        // ولی اجازه فقط وقتی که خودم همان مدیر باشم، در approveDeposit هم دوباره چک می‌شود
        ownerId = targetUser.id;
      } else {
        return res.status(400).json({ error: 'مقصد واریز نامعتبر است' });
      }
    }

    const deposit = await prisma.depositRequest.create({
      data: {
        payerId: req.user.id,
        ownerId,
        targetKind,
        targetId,
        receiptImageUrl,
        amount: amount != null ? BigInt(amount) : null,
        note: note || null,
      },
      include: {
        payer: { select: { id: true, fullName: true, role: true } },
      },
    });

    res.status(201).json({
      message: 'رسید واریز ثبت شد و در انتظار تأیید است',
      deposit: { ...serializeDeposit(deposit), targetTitle },
    });
  } catch (err) {
    next(err);
  }
}

// ====== رسیدهایی که من فرستاده‌ام (وضعیت پیگیری) ======
async function listMyDeposits(req, res, next) {
  try {
    const deposits = await prisma.depositRequest.findMany({
      where: { payerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ deposits: await serializeMany(deposits) });
  } catch (err) {
    next(err);
  }
}

// ====== رسیدهایی که باید من تأیید کنم (صف گیرنده) ======
//   مشاور → رسیدهای مقصدِ دانش‌آموزهایش یا خودش (از سمت سوپرادمین)
//   مدیر مؤسسه/سردار → رسیدهای مقصد مؤسسه یا اعضایش
//   سوپرادمین → رسیدهایی که صاحبِ کارت اوست (مشاورهای مستقل، مؤسسه‌ها)
async function listIncomingDeposits(req, res, next) {
  try {
    const deposits = await prisma.depositRequest.findMany({
      where: { ownerId: req.user.id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    res.json({ deposits: await serializeMany(deposits) });
  } catch (err) {
    next(err);
  }
}

// ====== تأیید رسید و تمدید خودکار اشتراک ======
// فقط صاحب کارت (ownerId) حق تأیید دارد. مدت تمدید (روز) دستی تعیین می‌شود و
// اشتراک مقصد از دیرترِ (الان، پایان فعلی) جلو می‌رود — تمدید روی تمدید انباشته می‌شود.
async function approveDeposit(req, res, next) {
  try {
    const { id } = req.params;
    const { days, decisionNote } = req.body;
    if (!days) return res.status(400).json({ error: 'مدت تمدید (روز) الزامی است' });

    const deposit = await prisma.depositRequest.findUnique({ where: { id } });
    if (!deposit) return res.status(404).json({ error: 'رسید یافت نشد' });
    if (deposit.ownerId !== req.user.id) return res.status(403).json({ error: 'فقط گیرنده‌ی پرداخت می‌تواند این رسید را تأیید کند' });
    if (deposit.status !== 'PENDING') return res.status(400).json({ error: 'این رسید قبلاً بررسی شده است' });

    const newEndsAt = await extendSubscription(deposit.targetKind, deposit.targetId, days, `DEPOSIT:${deposit.id}`);

    const updated = await prisma.depositRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedDays: days, decidedAt: new Date(), newEndsAt, decisionNote: decisionNote || null },
    });

    res.json({
      message: `رسید تأیید شد؛ اشتراک ${days} روز تمدید شد`,
      deposit: serializeDeposit(updated),
      newEndsAt,
    });
  } catch (err) {
    next(err);
  }
}

// ====== رد رسید ======
async function rejectDeposit(req, res, next) {
  try {
    const { id } = req.params;
    const { decisionNote } = req.body;

    const deposit = await prisma.depositRequest.findUnique({ where: { id } });
    if (!deposit) return res.status(404).json({ error: 'رسید یافت نشد' });
    if (deposit.ownerId !== req.user.id) return res.status(403).json({ error: 'فقط گیرنده‌ی پرداخت می‌تواند این رسید را رد کند' });
    if (deposit.status !== 'PENDING') return res.status(400).json({ error: 'این رسید قبلاً بررسی شده است' });

    const updated = await prisma.depositRequest.update({
      where: { id },
      data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: decisionNote || null },
    });

    res.json({ message: 'رسید رد شد', deposit: serializeDeposit(updated) });
  } catch (err) {
    next(err);
  }
}

// ====== توابع کمکی ======

// تمدید اشتراک USER یا INSTITUTE از دیرترِ (الان، پایان فعلی) به‌اندازه‌ی days روز.
// رکورد نبود؟ ساخته می‌شود (ACTIVE با همین تاریخ پایان).
async function extendSubscription(targetKind, targetId, days, paymentRef) {
  const base = targetKind === 'INSTITUTE'
    ? await prisma.instituteSubscription.findUnique({ where: { instituteId: targetId } })
    : await prisma.userSubscription.findUnique({ where: { userId: targetId } });

  const currentEnd = base && new Date(base.endsAt).getTime() > Date.now() ? new Date(base.endsAt) : new Date();
  const newEndsAt = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

  const data = { status: 'ACTIVE', endsAt: newEndsAt, lastPaymentRef: paymentRef };
  if (targetKind === 'INSTITUTE') {
    await prisma.instituteSubscription.upsert({
      where: { instituteId: targetId },
      create: { instituteId: targetId, status: 'ACTIVE', startsAt: new Date(), endsAt: newEndsAt, lastPaymentRef: paymentRef },
      update: data,
    });
  } else {
    await prisma.userSubscription.upsert({
      where: { userId: targetId },
      create: { userId: targetId, status: 'ACTIVE', startsAt: new Date(), endsAt: newEndsAt, lastPaymentRef: paymentRef },
      update: data,
    });
  }
  return newEndsAt;
}

// عنوان مقصد تمدید برای نمایش در فهرست‌ها
async function resolveTargetTitle(deposit) {
  try {
    if (deposit.targetKind === 'INSTITUTE') {
      const inst = await prisma.institute.findUnique({ where: { id: deposit.targetId }, select: { name: true } });
      return `مؤسسه ${inst?.name || ''}`.trim();
    }
    const u = await prisma.user.findUnique({ where: { id: deposit.targetId }, select: { fullName: true } });
    return u?.fullName || 'کاربر';
  } catch {
    return null;
  }
}

function serializeDeposit(d) {
  return {
    id: d.id,
    payer: d.payer && { id: d.payer.id, fullName: d.payer.fullName, role: d.payer.role },
    ownerId: d.ownerId,
    targetKind: d.targetKind,
    targetId: d.targetId,
    receiptImageUrl: d.receiptImageUrl,
    amount: d.amount != null ? Number(d.amount) : null,
    note: d.note,
    status: d.status,
    approvedDays: d.approvedDays,
    decidedAt: d.decidedAt,
    newEndsAt: d.newEndsAt,
    decisionNote: d.decisionNote,
    createdAt: d.createdAt,
  };
}

async function serializeMany(deposits) {
  return Promise.all(deposits.map(async (d) => ({
    ...serializeDeposit(d),
    payer: undefined, // payer در فهرست‌ها جدا بارگذاری می‌شود
    targetTitle: await resolveTargetTitle(d),
    payerName: (await prisma.user.findUnique({ where: { id: d.payerId }, select: { fullName: true } }))?.fullName || null,
  })));
}

module.exports = {
  getMySubscription,
  getMyCard,
  setMyCard,
  getDepositContext,
  createDeposit,
  listMyDeposits,
  listIncomingDeposits,
  approveDeposit,
  rejectDeposit,
  CAPACITY_ERROR,
};
