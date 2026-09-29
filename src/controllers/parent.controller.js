const crypto = require('crypto');
const prisma = require('../config/prisma');

// ====== پنل اولیا ======
// والد فقط-خواندنی است: به آمار تجمیعی فرزند دسترسی دارد، نه یادآورها و توضیحات خصوصی.
// اتصال با کد دعوت انجام می‌شود که «دانش‌آموز» از پنل خودش می‌سازد.

const INVITE_TTL_DAYS = 7;
// الفبای بدون ابهام (بدون I,O,0,1) — برای خواندن تلفنی و تایپ آسان
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateInviteCode() {
  return Array.from(crypto.randomBytes(8))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('')
    .slice(0, 8);
}

// فقط نقش STUDENT می‌تواند کد دعوت بسازد
function assertStudent(req, res) {
  if (req.user.role !== 'STUDENT') {
    res.status(403).json({ error: 'فقط دانش‌آموز می‌تواند برای والدش کد دعوت بسازد' });
    return false;
  }
  return true;
}

// ساخت کد دعوت جدید — کدهای قبلیِ استفاده‌نشده باطل نمی‌شوند (همه معتبرند تا انقضا)
async function createParentInvite(req, res, next) {
  try {
    if (!assertStudent(req, res)) return;

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invite = await prisma.parentInvite.create({
      data: { code: generateInviteCode(), studentId: req.user.id, expiresAt },
    });

    res.status(201).json({
      message: 'کد دعوت ساخته شد — به والدت بده تا ثبت‌نام کند',
      invite: { code: invite.code, expiresAt: invite.expiresAt },
    });
  } catch (err) {
    next(err);
  }
}

// کد دعوت فعالِ من (اگر وجود داشته باشد)
async function listMyParentInvites(req, res, next) {
  try {
    if (!assertStudent(req, res)) return;

    const invite = await prisma.parentInvite.findFirst({
      where: { studentId: req.user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ invite: invite ? { code: invite.code, expiresAt: invite.expiresAt } : null });
  } catch (err) {
    next(err);
  }
}

// والد با کد دعوت متصل می‌شود (کاربر والد قبلاً ثبت‌نام کرده باشد)
async function joinAsParent(req, res, next) {
  try {
    if (req.user.role !== 'PARENT') {
      return res.status(403).json({ error: 'این عمل فقط برای حساب والد است' });
    }
    const { code } = req.body;

    const invite = await prisma.parentInvite.findUnique({ where: { code: String(code || '').trim().toUpperCase() } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'کد دعوت نامعتبر یا منقضی است' });
    }

    // یک والد نمی‌تواند دو بار به همان دانش‌آموز وصل شود
    const existing = await prisma.parentLink.findUnique({
      where: { parentId_studentId: { parentId: req.user.id, studentId: invite.studentId } },
    });
    if (existing) {
      return res.status(400).json({ error: 'قبلاً به این دانش‌آموز متصل شده‌ای' });
    }

    // تراکنش: ساخت لینک + مصرف کد
    const student = await prisma.$transaction(async (tx) => {
      await tx.parentLink.create({
        data: { parentId: req.user.id, studentId: invite.studentId },
      });
      await tx.parentInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      return tx.user.findUnique({
        where: { id: invite.studentId },
        select: { id: true, fullName: true },
      });
    });

    res.json({ message: `به «${student?.fullName}» وصل شدی`, child: student });
  } catch (err) {
    next(err);
  }
}

// فرزندان والد
async function listMyChildren(req, res, next) {
  try {
    const links = await prisma.parentLink.findMany({
      where: { parentId: req.user.id },
      include: {
        student: { select: { id: true, fullName: true, photoUrl: true, field: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      children: links.map((l) => ({ ...l.student, linkId: l.id, connectedAt: l.createdAt })),
    });
  } catch (err) {
    next(err);
  }
}

// داشبورد خواندنی والد — فقط تجمیع‌ها؛ یادآورها و bio عمداً برنمی‌گردند
async function getChildSummary(req, res, next) {
  try {
    // والد فقط به فرزندِ متصلِ خودش دسترسی دارد
    const link = await prisma.parentLink.findUnique({
      where: { parentId_studentId: { parentId: req.user.id, studentId: req.params.studentId } },
    });
    if (!link) return res.status(403).json({ error: 'به این دانش‌آموز دسترسی نداری' });

    const studentId = req.params.studentId;
    const plans = await prisma.studyPlan.findMany({
      where: { studentId },
      include: {
        days: { include: { items: { include: { itemLogs: true } } } },
      },
    });

    // آمار تجمیعی — همان منطق پنل دانش‌آموز
    const allItems = plans.flatMap((p) => p.days).flatMap((d) => d.items);
    const done = allItems.filter((i) => i.status === 'DONE').length;
    const logMinutes = allItems.reduce(
      (sum, item) => sum + (item.itemLogs || []).reduce((s, l) => s + (l.minutes || 0), 0),
      0
    );
    const logTests = allItems.reduce(
      (sum, item) => sum + (item.itemLogs || []).reduce((s, l) => s + (l.testsTaken || 0), 0),
      0
    );

    // هدف هفتگی + مشاور
    const [goalLink, advisorLink] = await Promise.all([
      prisma.advisorStudentLink.findFirst({
        where: { studentId, status: { in: ['PENDING', 'ACTIVE', 'REJECTED'] } },
        select: { weeklyGoalMinutes: true },
      }),
      prisma.advisorStudentLink.findFirst({
        where: { studentId, status: 'ACTIVE' },
        include: { advisor: { select: { fullName: true } } },
      }),
    ]);

    // آزمون‌ها — فقط عنوان/زمان/وضعیت و نمره‌ی نهایی
    const exams = await prisma.exam.findMany({
      where: { studentId },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMinutes: true,
        visibleToStudent: true,
        visibleFrom: true,
        submissions: {
          select: { status: true, totalScore: true, maxScore: true, submittedAt: true },
        },
      },
    });

    // اشتراک دانش‌آموز — والد پرداخت‌کننده است و باید بداند تا کی فعال است
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId: studentId },
      select: { status: true, endsAt: true },
    });

    res.json({
      student: { id: studentId, fullName: (await prisma.user.findUnique({ where: { id: studentId }, select: { fullName: true } }))?.fullName },
      advisor: advisorLink?.advisor ? { fullName: advisorLink.advisor.fullName } : null,
      weeklyGoalMinutes: goalLink?.weeklyGoalMinutes || null,
      stats: {
        activePlans: plans.length,
        doneItems: done,
        totalItems: allItems.length,
        totalMinutes: logMinutes,
        totalTests: logTests,
      },
      exams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        scheduledAt: e.scheduledAt,
        submission: e.submissions[0]
          ? { status: e.submissions[0].status, totalScore: e.submissions[0].totalScore, maxScore: e.submissions[0].maxScore }
          : null,
      })),
      subscription,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createParentInvite,
  listMyParentInvites,
  joinAsParent,
  listMyChildren,
  getChildSummary,
};
