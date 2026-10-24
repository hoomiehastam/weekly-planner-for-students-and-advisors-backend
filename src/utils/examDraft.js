// ====== ساخت پیش‌نویس برنامه از بازه‌ی امتحان‌های دانش‌آموز ======
// ورودی: امتحان‌ها/پرسش‌هایی که دانش‌آموز ثبت کرده (dueAt + تخمین neededSessions) و یک بازه‌ی تاریخ.
// خروجی: برای هر هفته‌ی شمسی (شنبه تا جمعه) که حداقل یک بلوک مطالعه دارد، داده‌ی یک برنامه‌ی
// هفتگی با ساختار همان createPlan (days → items). تابع «خالص» است (بدون دیتابیس) تا تست‌پذیر بماند.
//
// قواعد چینش:
//   - هر امتحان به تعداد neededSessions بلوک می‌گیرد (اگر دانش‌آموز تخمین نداده: یک بلوک).
//   - بلوک‌ها در روزهای «قبل از امتحان» و داخل بازه چیده می‌شوند؛ نزدیک‌ترین روزها اول،
//     و اگر بلوک‌ها از روزهای موجود بیشتر بود، دوباره از نزدیک‌ترین روز ادامه می‌یابد.
//   - هر روز چند بلوک پشت‌سرهم با فاصله‌ی کوتاه: اول عصر (۱۶:۰۰ به بعد)، بعد صبح؛ همپوشانی ندارند.
//   - امتحانی که هیچ روزی قبل از آن در بازه نیست، با هشدار کنار گذاشته می‌شود.

const DAY_MS = 24 * 60 * 60 * 1000;
// ایران از ۱۴۰۱ ساعت تابستانی ندارد؛ اختلاف ثابت ۳:۳۰
const TEHRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;

const MAX_BACK_DAYS = 10; // حداکثر چند روز مانده به امتحان بلوک بگذاریم
const MAX_RANGE_DAYS = 70; // حداکثر طول بازه (۱۰ هفته)
const MIN_SESSION_MINUTES = 30;
const MAX_SESSION_MINUTES = 240;
const GAP_MINUTES = 15;
const EVENING_START = 16 * 60; // ۱۶:۰۰
const EVENING_LIMIT = 23 * 60 + 30; // پایان بلوک‌های عصر حداکثر ۲۳:۳۰
const MORNING_START = 8 * 60; // ۰۸:۰۰

// شماره‌ی روز (از epoch) به وقت تهران
function tehranDayIndex(date) {
  return Math.floor((new Date(date).getTime() + TEHRAN_OFFSET_MS) / DAY_MS);
}

// ۰=شنبه … ۶=جمعه
function persianWeekday(dayIndex) {
  // روز ۰ epoch (۱۹۷۰-۰۱-۰۱) پنجشنبه بود
  const jsDow = new Date(dayIndex * DAY_MS).getUTCDay(); // ۰=یکشنبه
  return (jsDow + 1) % 7;
}

// لحظه‌ی شروع روز (نیمه‌شب تهران) به‌صورت Date
function dayIndexToDate(dayIndex) {
  return new Date(dayIndex * DAY_MS - TEHRAN_OFFSET_MS);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function minutesToHHMM(total) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// بلوک‌های ممکن در یک روز: اول عصر، بعد صبح
function buildDaySlots(sessionMinutes) {
  const step = sessionMinutes + GAP_MINUTES;
  const slots = [];
  for (let s = EVENING_START; s + sessionMinutes <= EVENING_LIMIT; s += step) slots.push(s);
  for (let s = MORNING_START; s + sessionMinutes <= EVENING_START - GAP_MINUTES; s += step) slots.push(s);
  return slots;
}

/**
 * @param {object} p
 * @param {Array<{id,title,subject?,kind?,note?,dueAt,neededSessions?}>} p.events
 * @param {string|Date} p.from  اول بازه (شامل)
 * @param {string|Date} p.to    آخر بازه (شامل)
 * @param {number} [p.sessionMinutes=90]
 * @param {string|null} [p.defaultTagId]  برچسب «آمادگی امتحان» (اگر وجود دارد)
 * @returns {{ weeks: Array, warnings: string[], eventCount: number }}
 */
function buildExamDrafts({ events, from, to, sessionMinutes = 90, defaultTagId = null }) {
  const warnings = [];
  const fromIdx = tehranDayIndex(from);
  const toIdx = tehranDayIndex(to);
  if (Number.isNaN(fromIdx) || Number.isNaN(toIdx)) throw new Error('بازه‌ی تاریخ نامعتبر است');
  if (toIdx < fromIdx) throw new Error('پایان بازه نمی‌تواند قبل از شروع آن باشد');
  if (toIdx - fromIdx + 1 > MAX_RANGE_DAYS) {
    throw new Error('بازه‌ی انتخابی بیش از ۱۰ هفته است؛ آن را کوتاه‌تر کن');
  }
  if (!Number.isInteger(sessionMinutes) || sessionMinutes < MIN_SESSION_MINUTES || sessionMinutes > MAX_SESSION_MINUTES) {
    throw new Error('طول هر بلوک باید بین ۳۰ تا ۲۴۰ دقیقه باشد');
  }

  const slots = buildDaySlots(sessionMinutes);
  const inRange = (events || [])
    .map((e) => ({ ...e, dueIdx: tehranDayIndex(e.dueAt) }))
    .filter((e) => e.dueIdx >= fromIdx && e.dueIdx <= toIdx)
    .sort((a, b) => a.dueIdx - b.dueIdx || String(a.id).localeCompare(String(b.id)));

  // dayIdx → [{ event, sessionNo, total }]
  const perDay = new Map();
  let usedEvents = 0;

  for (const ev of inRange) {
    const total = Math.max(1, ev.neededSessions || 1);
    const backDays = Math.min(ev.dueIdx - fromIdx, MAX_BACK_DAYS);
    if (backDays < 1) {
      warnings.push(`برای «${ev.title}» روزی قبل از امتحان در بازه نیست؛ بازه را زودتر شروع کن`);
      continue;
    }
    usedEvents += 1;
    for (let s = 0; s < total; s += 1) {
      const dayIdx = ev.dueIdx - 1 - (s % backDays);
      if (!perDay.has(dayIdx)) perDay.set(dayIdx, []);
      perDay.get(dayIdx).push({ event: ev, sessionNo: s + 1, total });
    }
  }

  // هفته‌ها: شناسه‌ی هفته = روز شنبه‌ی آن هفته
  const weeksMap = new Map();
  let dropped = 0;
  for (const dayIdx of [...perDay.keys()].sort((a, b) => a - b)) {
    const entries = perDay.get(dayIdx);
    const weekStart = dayIdx - persianWeekday(dayIdx);
    if (!weeksMap.has(weekStart)) weeksMap.set(weekStart, new Map());
    const dow = persianWeekday(dayIdx);

    const items = [];
    entries.forEach((entry, k) => {
      if (k >= slots.length) {
        dropped += 1;
        return;
      }
      const start = slots[k];
      const { event: ev, sessionNo, total } = entry;
      const noteText = ev.note ? ` — ${String(ev.note).trim()}` : '';
      items.push({
        subject: String(ev.subject || ev.title).slice(0, 190),
        description: `آمادگی برای «${ev.title}»${noteText} (بلوک ${sessionNo} از ${total})`,
        startTime: minutesToHHMM(start),
        endTime: minutesToHHMM(start + sessionMinutes),
        tags: defaultTagId ? [defaultTagId] : [],
      });
    });
    items.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
    items.forEach((it, i) => { it.order = i; });
    weeksMap.get(weekStart).set(dow, items);
  }
  if (dropped > 0) {
    warnings.push(`${dropped} بلوک جا نشد (در یک روز بیش از حد بلوک جمع شده بود)؛ بازه یا طول بلوک را عوض کن`);
  }

  const weekStarts = [...weeksMap.keys()].sort((a, b) => a - b);
  const weeks = weekStarts.map((ws, i) => {
    const days = [...weeksMap.get(ws).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayOfWeek, items]) => ({ dayOfWeek, items }));
    const weekEvents = inRange.filter((e) => e.dueIdx >= ws && e.dueIdx < ws + 7 + MAX_BACK_DAYS
      && days.some((d) => d.items.some((it) => it.description.includes(`«${e.title}»`))));
    return {
      index: i + 1,
      total: weekStarts.length,
      startsAt: dayIndexToDate(ws),
      expiresAt: new Date(dayIndexToDate(ws + 7).getTime() - 1),
      days,
      sessionCount: days.reduce((n, d) => n + d.items.length, 0),
      eventTitles: [...new Set(weekEvents.map((e) => e.title))],
    };
  });

  return { weeks, warnings, eventCount: usedEvents };
}

module.exports = {
  buildExamDrafts,
  tehranDayIndex,
  persianWeekday,
  buildDaySlots,
  MAX_RANGE_DAYS,
  MIN_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
};
