const prisma = require('../config/prisma');
const { generateUniqueInviteCode, normalizeInviteCode } = require('../utils/inviteCode');
const { getAdvisorRoom } = require('../utils/capacity');
const {
  getReferralSummary, isReferralEnabledForAdvisor, MIN_PERCENT, MAX_PERCENT, PERCENT_CAP, VALID_DAYS,
} = require('../utils/referral');

// ====== لینک دعوت مشاور و لینک دعوت دوست ======
//   مشاور:      یک کد ثابت و چندبارمصرف؛ ثبت‌نام با آن، دانش‌آموز را مستقیم و بدون تأیید به او وصل می‌کند.
//   دانش‌آموز:  کد شخصی برای دوستان؛ دوست به مشاور همین دانش‌آموز وصل می‌شود و تخفیف تصادفی ۵ تا ۱۵٪
//               شهریه‌ی ماهانه (یک سال) به هر دو می‌رسد.

// ---- مشاور ----

async function ensureAdvisorCode(userId) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { advisorInviteCode: true } });
  if (me?.advisorInviteCode) return me.advisorInviteCode;
  const code = await generateUniqueInviteCode(prisma, 'advisorInviteCode');
  await prisma.user.update({ where: { id: userId }, data: { advisorInviteCode: code } });
  return code;
}

async function advisorInviteView(userId) {
  const code = await ensureAdvisorCode(userId);
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, role: true, instituteId: true, maxActiveStudents: true,
      advisorInviteEnabled: true, referralEnabled: true,
      institute: { select: { name: true, referralEnabled: true } },
    },
  });
  const room = await getAdvisorRoom(me);
  const signedUp = await prisma.user.count({ where: { signupSource: 'ADVISOR_LINK', signupInviterId: userId } });
  return {
    code,
    path: `/register?ref=${code}`,
    enabled: me.advisorInviteEnabled,
    referralEnabled: me.referralEnabled,
    // اگر مؤسسه برنامه‌ی تخفیف را خاموش کرده باشد، مشاور نمی‌تواند روشنش کند
    referralLockedByInstitute: !!(me.institute && me.institute.referralEnabled === false),
    signedUpCount: signedUp,
    capacity: { scope: room.scope, max: room.max, count: room.count, full: !room.ok },
  };
}

async function getMyAdvisorInvite(req, res, next) {
  try {
    res.json({ invite: await advisorInviteView(req.user.id) });
  } catch (err) {
    next(err);
  }
}

// body: { enabled?: boolean, referralEnabled?: boolean, regenerate?: boolean }
async function updateMyAdvisorInvite(req, res, next) {
  try {
    const { enabled, referralEnabled, regenerate } = req.body;
    const data = {};
    if (typeof enabled === 'boolean') data.advisorInviteEnabled = enabled;
    if (typeof referralEnabled === 'boolean') data.referralEnabled = referralEnabled;
    if (regenerate === true) data.advisorInviteCode = await generateUniqueInviteCode(prisma, 'advisorInviteCode');
    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: req.user.id }, data });
    }
    res.json({ invite: await advisorInviteView(req.user.id) });
  } catch (err) {
    next(err);
  }
}

// ---- جستجوی عمومی کد (صفحه‌ی ثبت‌نام) ----
// فقط چیزی برمی‌گرداند که برای نمایش «دعوت از طرف …» لازم است؛ کد نامعتبر ۴۰۴.
async function lookupInvite(req, res, next) {
  try {
    const code = normalizeInviteCode(req.params.code);
    if (!code) return res.status(404).json({ error: 'کد دعوت معتبر نیست' });

    const advisor = await prisma.user.findFirst({
      where: { advisorInviteCode: code, advisorInviteEnabled: true, status: 'ACTIVE', role: { in: ['ADVISOR', 'SUPERADMIN'] } },
      select: { id: true, fullName: true, photoUrl: true, institute: { select: { name: true } } },
    });
    if (advisor) {
      return res.json({
        kind: 'ADVISOR',
        inviterName: advisor.fullName,
        advisorName: advisor.fullName,
        photoUrl: advisor.photoUrl || null,
        instituteName: advisor.institute?.name || null,
        referral: false,
      });
    }

    const friend = await prisma.user.findFirst({
      where: { studentInviteCode: code, status: 'ACTIVE', role: 'STUDENT' },
      select: {
        id: true, fullName: true,
        asStudentLinks: {
          where: { status: 'ACTIVE' },
          select: { advisor: { select: { id: true, fullName: true, status: true, advisorInviteEnabled: true, institute: { select: { name: true } } } } },
          take: 1,
        },
      },
    });
    const adv = friend?.asStudentLinks?.[0]?.advisor;
    if (friend && adv && adv.status === 'ACTIVE') {
      return res.json({
        kind: 'FRIEND',
        inviterName: friend.fullName,
        advisorName: adv.fullName,
        instituteName: adv.institute?.name || null,
        referral: await isReferralEnabledForAdvisor(adv.id),
      });
    }

    return res.status(404).json({ error: 'این لینک دعوت معتبر نیست یا غیرفعال شده است' });
  } catch (err) {
    next(err);
  }
}

// ---- تفسیر کد دعوت هنگام ثبت‌نام ----
// برمی‌گرداند null یا { kind: 'ADVISOR'|'FRIEND', advisor, inviter }
//   advisor — مشاوری که دانش‌آموز به او وصل می‌شود (رکورد کامل کاربر برای محاسبه‌ی ظرفیت)
//   inviter — کسی که لینک را داده (مشاور یا دانش‌آموز دعوت‌کننده)
async function resolveInviteCode(code) {
  const advisor = await prisma.user.findFirst({
    where: { advisorInviteCode: code, advisorInviteEnabled: true, status: 'ACTIVE', role: { in: ['ADVISOR', 'SUPERADMIN'] } },
  });
  if (advisor) return { kind: 'ADVISOR', advisor, inviter: advisor };

  const friend = await prisma.user.findFirst({
    where: { studentInviteCode: code, status: 'ACTIVE', role: 'STUDENT' },
    include: { asStudentLinks: { where: { status: 'ACTIVE' }, include: { advisor: true }, take: 1 } },
  });
  const adv = friend?.asStudentLinks?.[0]?.advisor;
  if (friend && adv && adv.status === 'ACTIVE') return { kind: 'FRIEND', advisor: adv, inviter: friend };
  return null;
}

// ---- دانش‌آموز: لینک دعوت دوست + وضعیت تخفیف ----
async function getMyFriendInvite(req, res, next) {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, studentInviteCode: true,
        asStudentLinks: {
          where: { status: 'ACTIVE' },
          select: { advisor: { select: { id: true, fullName: true } } },
          take: 1,
        },
      },
    });
    const advisor = me.asStudentLinks[0]?.advisor || null;
    const summary = await getReferralSummary(req.user.id);
    const base = {
      min: MIN_PERCENT, max: MAX_PERCENT, cap: PERCENT_CAP, validDays: VALID_DAYS,
      summary,
    };

    if (!advisor) {
      return res.json({ ...base, canInvite: false, reason: 'NO_ADVISOR', code: null, path: null });
    }
    const enabled = await isReferralEnabledForAdvisor(advisor.id);
    if (!enabled) {
      return res.json({ ...base, canInvite: false, reason: 'PROGRAM_OFF', code: null, path: null, advisorName: advisor.fullName });
    }

    let code = me.studentInviteCode;
    if (!code) {
      code = await generateUniqueInviteCode(prisma, 'studentInviteCode');
      await prisma.user.update({ where: { id: me.id }, data: { studentInviteCode: code } });
    }
    res.json({
      ...base, canInvite: true, reason: null, code, path: `/register?ref=${code}`, advisorName: advisor.fullName,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  resolveInviteCode,
  getMyAdvisorInvite,
  updateMyAdvisorInvite,
  lookupInvite,
  getMyFriendInvite,
};
