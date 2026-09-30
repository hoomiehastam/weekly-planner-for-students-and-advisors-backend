-- ====== تعمیر دیتابیس: پاک‌سازی ردیف‌های یتیم + قیدهای خارجی ======
--
-- چرا این فایل کنار repair-orphans.js هست؟
-- روی بعضی هاست‌های اشتراکی (cPanel) موتور Prisma با خطای
--   PANIC: timer has gone away
-- از کار می‌افتد، پس اسکریپت جاوااسکریپتی قابل اجرا نیست. این فایل همان کار را
-- با SQL خالص انجام می‌دهد و هیچ وابستگی‌ای به Node/Prisma ندارد.
--
-- روش استفاده: phpMyAdmin → دیتابیس → زبانهٔ SQL → محتوای این فایل را اجرا کنید.
--
-- هشدار: بخش ۱ داده حذف می‌کند (فقط ردیف‌هایی که به کاربر/مؤسسهٔ ناموجود اشاره
-- می‌کنند، یعنی دادهٔ بی‌معنا). قبلش بکاپ بگیرید.
-- بخش ۲ اگر دیتابیس بزرگ است می‌تواند طول بکشد.

-- ---------------------------------------------------------------
-- بخش ۱: پاک‌سازی ردیف‌های یتیم (idempotent)
-- ترتیب از بچه به والد است.
-- ---------------------------------------------------------------

-- ★ مهم‌ترین یکی: لینک مشاور↔دانش‌آموز. همین باعث خطای
--   Inconsistent query result: Field student is required to return data
-- در فهرست دانش‌آموزان/مشاوران می‌شد.
DELETE l FROM `AdvisorStudentLink` l
LEFT JOIN `User` s ON s.`id` = l.`studentId`
LEFT JOIN `User` a ON a.`id` = l.`advisorId`
WHERE s.`id` IS NULL OR a.`id` IS NULL;

-- زنجیرهٔ آزمون: پاسخ ← ارسال/سؤال ← آزمون
DELETE a FROM `ExamAnswer` a
LEFT JOIN `ExamSubmission` s ON s.`id` = a.`submissionId`
LEFT JOIN `ExamQuestion` q ON q.`id` = a.`questionId`
WHERE s.`id` IS NULL OR q.`id` IS NULL;

DELETE s FROM `ExamSubmission` s
LEFT JOIN `Exam` e ON e.`id` = s.`examId`
LEFT JOIN `User` u ON u.`id` = s.`studentId`
WHERE e.`id` IS NULL OR u.`id` IS NULL;

DELETE q FROM `ExamQuestion` q
LEFT JOIN `Exam` e ON e.`id` = q.`examId`
WHERE e.`id` IS NULL;

DELETE e FROM `Exam` e
LEFT JOIN `User` st ON st.`id` = e.`studentId`
LEFT JOIN `User` ad ON ad.`id` = e.`advisorId`
WHERE st.`id` IS NULL OR ad.`id` IS NULL;

-- زنجیرهٔ برنامه: لاگ/تگ آیتم ← آیتم ← روز ← برنامه
DELETE l FROM `PlanItemLog` l
LEFT JOIN `PlanItem` i ON i.`id` = l.`planItemId`
WHERE i.`id` IS NULL;

DELETE t FROM `PlanItemTag` t
LEFT JOIN `PlanItem` i ON i.`id` = t.`itemId`
LEFT JOIN `Tag` g ON g.`id` = t.`tagId`
WHERE i.`id` IS NULL OR g.`id` IS NULL;

DELETE i FROM `PlanItem` i
LEFT JOIN `PlanDay` d ON d.`id` = i.`dayId`
WHERE d.`id` IS NULL;

DELETE d FROM `PlanDay` d
LEFT JOIN `StudyPlan` p ON p.`id` = d.`planId`
WHERE p.`id` IS NULL;

DELETE p FROM `StudyPlan` p
LEFT JOIN `User` st ON st.`id` = p.`studentId`
LEFT JOIN `User` ad ON ad.`id` = p.`advisorId`
WHERE st.`id` IS NULL OR ad.`id` IS NULL;

-- بقیهٔ وابسته‌ها
DELETE r FROM `Reminder` r
LEFT JOIN `User` st ON st.`id` = r.`studentId`
LEFT JOIN `User` ad ON ad.`id` = r.`advisorId`
WHERE st.`id` IS NULL OR ad.`id` IS NULL;

DELETE g FROM `Tag` g
LEFT JOIN `User` a ON a.`id` = g.`advisorId`
WHERE g.`advisorId` IS NOT NULL AND a.`id` IS NULL;

DELETE f FROM `AdvisorField` f
LEFT JOIN `User` u ON u.`id` = f.`userId`
WHERE u.`id` IS NULL;

DELETE p FROM `ParentLink` p
LEFT JOIN `User` s ON s.`id` = p.`studentId`
LEFT JOIN `User` pa ON pa.`id` = p.`parentId`
WHERE s.`id` IS NULL OR pa.`id` IS NULL;

DELETE i FROM `ParentInvite` i
LEFT JOIN `User` s ON s.`id` = i.`studentId`
WHERE s.`id` IS NULL;

DELETE b FROM `UserSubscription` b
LEFT JOIN `User` u ON u.`id` = b.`userId`
WHERE u.`id` IS NULL;

DELETE d FROM `DepositRequest` d
LEFT JOIN `User` p ON p.`id` = d.`payerId`
LEFT JOIN `User` o ON o.`id` = d.`ownerId`
WHERE p.`id` IS NULL OR o.`id` IS NULL;

DELETE r FROM `PasswordReset` r
LEFT JOIN `User` u ON u.`id` = r.`userId`
WHERE r.`userId` IS NOT NULL AND u.`id` IS NULL;

DELETE b FROM `InstituteSubscription` b
LEFT JOIN `Institute` i ON i.`id` = b.`instituteId`
WHERE i.`id` IS NULL;

DELETE a FROM `AuditLog` a
LEFT JOIN `User` u ON u.`id` = a.`actorId`
WHERE a.`actorId` IS NOT NULL AND u.`id` IS NULL;

-- ---------------------------------------------------------------
-- بخش ۲: بررسی نتیجه
-- همهٔ عددها باید ۰ باشند. اگر AdvisorStudentLink عدد دیگری داد، یعنی هنوز
-- یتیمی مانده و علت اصلی پابرجاست.
-- ---------------------------------------------------------------
SELECT 'AdvisorStudentLink' AS tbl, COUNT(*) AS orphans
FROM `AdvisorStudentLink` l
LEFT JOIN `User` s ON s.`id` = l.`studentId`
WHERE s.`id` IS NULL
UNION ALL
SELECT 'StudyPlan', COUNT(*) FROM `StudyPlan` p
LEFT JOIN `User` u ON u.`id` = p.`studentId`
WHERE u.`id` IS NULL
UNION ALL
SELECT 'ExamSubmission', COUNT(*) FROM `ExamSubmission` s
LEFT JOIN `User` u ON u.`id` = s.`studentId`
WHERE u.`id` IS NULL
UNION ALL
SELECT 'Reminder', COUNT(*) FROM `Reminder` r
LEFT JOIN `User` u ON u.`id` = r.`studentId`
WHERE u.`id` IS NULL
UNION ALL
SELECT 'UserSubscription', COUNT(*) FROM `UserSubscription` b
LEFT JOIN `User` u ON u.`id` = b.`userId`
WHERE u.`id` IS NULL;

-- ---------------------------------------------------------------
-- بخش ۳: قیدهای خارجی گمشده
--
-- گام ۱: این SELECT را اجرا کنید و نتیجه را ببینید.
-- گام ۲: اگر `AdvisorStudentLink` در نتیجه نبود (یا DELETE_RULE چیزی جز CASCADE
--         بود)، یکی از دو ALTER زیر را اجرا کنید تا این دست‌دادهٔ کثیف
--         دیگر ساخته نشود.
--
-- توجه: اگر قید از قبل وجود دارد و DELETE_RULE اشتباه است، اول DROP و بعد ADD
--       را با هم اجرا کنید. اجرای ADD روی قید موجود با خطا متوقف می‌شود.
-- ---------------------------------------------------------------

-- گام ۱ — وضعیت فعلی قیدها:
SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, rc.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 AND rc.TABLE_NAME = kcu.TABLE_NAME
WHERE kcu.TABLE_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME IN ('AdvisorStudentLink', 'StudyPlan', 'Exam', 'Reminder',
                         'UserSubscription', 'ParentLink', 'User', 'Institute')
ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME;

-- گام ۲a — اگر قید اصلاً وجود ندارد:
ALTER TABLE `AdvisorStudentLink`
  ADD CONSTRAINT `AdvisorStudentLink_studentId_fkey` FOREIGN KEY (`studentId`)
    REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `AdvisorStudentLink_advisorId_fkey` FOREIGN KEY (`advisorId`)
    REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- گام ۲b — اگر قید هست ولی DELETE_RULE اشتباه است (SET NULL به‌جای CASCADE):
-- ALTER TABLE `AdvisorStudentLink` DROP FOREIGN KEY `AdvisorStudentLink_studentId_fkey`;
-- ALTER TABLE `AdvisorStudentLink` DROP FOREIGN KEY `AdvisorStudentLink_advisorId_fkey`;
-- ... بعد دوباره گام ۲a را اجرا کنید.
