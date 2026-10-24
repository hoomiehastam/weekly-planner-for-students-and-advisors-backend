const crypto = require('crypto');

// ====== کد دعوت (مشاور → دانش‌آموز، دانش‌آموز → دوست) ======
// ۸ کاراکتر از الفبایی بدون حروف/ارقام مبهم (بدون I و O و 0 و 1)؛
// برای خواندن، گفتن و تایپ دستی ساده است و حدس‌زدنش عملاً ممکن نیست (۳۲^۸ حالت).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateInviteCode(length = CODE_LENGTH) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

// کد یکتا برای یک ستون (advisorInviteCode یا studentInviteCode) می‌سازد
async function generateUniqueInviteCode(prisma, column) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInviteCode();
    const clash = await prisma.user.findFirst({ where: { [column]: code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error('ساخت کد دعوت ناموفق بود؛ دوباره تلاش کن');
}

// ورودی کاربر را به شکل استاندارد (حروف بزرگ، بدون فاصله) درمی‌آورد؛ نامعتبر → null
function normalizeInviteCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return null;
  return code;
}

module.exports = { generateInviteCode, generateUniqueInviteCode, normalizeInviteCode, ALPHABET, CODE_LENGTH };
