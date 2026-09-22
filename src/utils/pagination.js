// پشتیبانی اختیاری از pagination از طریق query string:
//   ?page=1&limit=50
// اگر limit ارسال نشود، کل نتایج برمی‌گردد (سازگار با رفتار قبلی / کلاینت‌های فعلی).
// محدودیت حداکثر ۲۰۰ رکورد در هر صفحه.

const MAX_LIMIT = 200;

function getPagination(req) {
  const rawLimit = parseInt(req.query.limit, 10);
  if (!rawLimit || Number.isNaN(rawLimit) || rawLimit < 1) {
    return null;
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, rawLimit);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}

// با وجود pagination، تعداد کل رکوردها و اطلاعات صفحه برای UI برگردانده می‌شود
function paginationMeta(total, pagination) {
  if (!pagination) return { total };
  return {
    total,
    page: pagination.page,
    limit: pagination.limit,
    pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
  };
}

module.exports = { getPagination, paginationMeta, MAX_LIMIT };