// ====== لاگ ممیزی (Audit Log) ======
// هر اکشن مدیریتی با این تابع ردپا می‌گذارد: چه کسی، چه اکشنی، روی چه هدفی،
// چه مقداری از چه مقداری تغییر کرد. نوشتن لاگ هرگز نباید اکشن اصلی را بشکند —
// به همین دلیل خطاها swallow می‌شوند (ولی در stderr چاپ می‌شوند تا قابل ردیابی باشند).

const prisma = require('../config/prisma');

/**
 * ثبت یک ردپای ممیزی
 * @param {object} p
 * @param {string} p.actorId کاربر عامل (سوپرادمین)
 * @param {string} p.action کد اکشن (مثل USER_DEACTIVATE)
 * @param {string} p.targetType نوع هدف (USER / INSTITUTE / DEPOSIT / SETTING / EXAM)
 * @param {string} p.targetId شناسه‌ی هدف
 * @param {object} [p.details] جزئیات — مقادیر before/after و label
 */
async function writeAuditLog({ actorId, action, targetType, targetId, details }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actorId || null,
        action,
        targetType,
        targetId: String(targetId ?? ''),
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    // لاگ ممیزی هرگز نباید اکشن اصلی را بشکند؛ فقط ردیابی کن
    console.error('[audit] failed to write audit log:', err.message);
  }
}

module.exports = { writeAuditLog };
