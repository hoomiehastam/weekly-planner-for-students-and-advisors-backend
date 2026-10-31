// ابزار تاریخ به وقت تهران.
// ایران از ۱۴۰۱ ساعت تابستانی ندارد و همیشه UTC+3:30 است؛ پس یک ثابت کافی و ایمن است.
// همه‌ی مرزهای «شروع و پایان روز» برنامه‌ها با همین تابع‌ها ساخته می‌شوند تا
//   - برنامه‌ای که «تا فلان روز» تنظیم شده تا آخرِ شبِ همان روز (۲۳:۵۹:۵۹) فعال بماند؛
//   - برنامه‌ای که «از فلان روز» شروع می‌شود از ۰۰:۰۰ همان روز دیده شود (نه ۰۳:۳۰).

const TEHRAN_OFFSET_MIN = 210; // +03:30
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const pad = (n) => String(n).padStart(2, '0');

// «YYYY-MM-DD» را از ورودی بیرون می‌کشد؛ ورودی می‌تواند «2026-11-05» یا
// ISO مثل «2026-11-05T00:00:00.000Z» (که کلاینت قدیمی می‌فرستاد) یا Date باشد.
// برای ISO و رشته‌ها، همان بخش تاریخِ نوشته‌شده ملاک است (همان روزی که مشاور انتخاب کرده).
function parseDateParts(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const t = new Date(value.getTime() + TEHRAN_OFFSET_MIN * MIN);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // اعتبار تقویمی (مثلاً ۳۱ فروردین‌ماه میلادی نامعتبر نباشد؛ ۳۰ فوریه نامعتبر است)
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

// لحظه‌ی ۰۰:۰۰:۰۰.۰۰۰ تهران در آن روز
function startOfTehranDay(value) {
  const p = parseDateParts(value);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0) - TEHRAN_OFFSET_MIN * MIN);
}

// لحظه‌ی ۲۳:۵۹:۵۹.۹۹۹ تهران در آن روز
function endOfTehranDay(value) {
  const p = parseDateParts(value);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 23, 59, 59, 999) - TEHRAN_OFFSET_MIN * MIN);
}

// «YYYY-MM-DD» تقویم تهران برای یک لحظه
function tehranDayKey(date = new Date()) {
  const p = parseDateParts(date instanceof Date ? date : new Date(date));
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
}

// ایندکس روز هفته (شنبه=۰ ... جمعه=۶) برای یک «YYYY-MM-DD»
function weekdayIndexOfKey(key) {
  const p = parseDateParts(key);
  if (!p) return null;
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // یکشنبه=۰
  return (js + 1) % 7;
}

function addDaysToKey(key, n) {
  const p = parseDateParts(key);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// «کدام تاریخ» برای یک بازه‌ی برنامه؟
// هر بازه به یک روز هفته (dayOfWeek) وصل است؛ ساعتی که دانش‌آموز برای آن ثبت می‌کند باید
// به همان روز برود، نه به روزی که الان در آن است. قاعده:
//   ۱) آخرین وقوعِ آن روز هفته که از امروز جلوتر نباشد و قبل از شروع برنامه نباشد
//   ۲) اگر چنین روزی نیست (برنامه تازه شروع شده و روز مورد نظر هنوز نرسیده): اولین وقوع بعد از شروع،
//      ولی هیچ‌وقت آینده‌ی امروز نمی‌شود (سقف = امروز)
function resolveStudyDay({ startsAt, dayOfWeek, now = new Date() }) {
  const today = tehranDayKey(now);
  const todayIdx = weekdayIndexOfKey(today);
  const diff = (todayIdx - dayOfWeek + 7) % 7;
  const candidate = addDaysToKey(today, -diff);
  const startKey = startsAt ? tehranDayKey(new Date(startsAt)) : null;
  if (!startKey || candidate >= startKey) return candidate;
  const startIdx = weekdayIndexOfKey(startKey);
  const first = addDaysToKey(startKey, (dayOfWeek - startIdx + 7) % 7);
  return first > today ? today : first;
}

module.exports = {
  TEHRAN_OFFSET_MIN,
  parseDateParts,
  startOfTehranDay,
  endOfTehranDay,
  tehranDayKey,
  weekdayIndexOfKey,
  addDaysToKey,
  resolveStudyDay,
};
