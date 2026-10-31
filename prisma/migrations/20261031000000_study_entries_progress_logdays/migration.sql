-- ترتیب تگ‌ها، روزِ مطالعه‌ی لاگ‌ها، مطالعه‌ی آزاد، پیشروی دروس و اصلاح انقضای برنامه‌ها

-- AlterTable: PlanItemTag — ترتیب انتخاب تگ (برای «تگ اول»)
ALTER TABLE `PlanItemTag` ADD COLUMN `order` INTEGER NOT NULL DEFAULT 0;

-- AlterTable: PlanItemLog — روزِ مطالعه + علامت «خودکار»
ALTER TABLE `PlanItemLog`
    ADD COLUMN `studyDay` VARCHAR(10) NULL,
    ADD COLUMN `auto` BOOLEAN NOT NULL DEFAULT false;

-- پر کردن روزِ مطالعه‌ی لاگ‌های قدیمی: «آخرین وقوعِ روز هفته‌ی همان بازه، تا روزِ ثبت».
-- (UTC+3:30 تهران؛ DAYOFWEEK: یکشنبه=۱ … شنبه=۷ ← با %7 شنبه=۰ … جمعه=۶ می‌شود.)
UPDATE `PlanItemLog` l
JOIN `PlanItem` i ON i.`id` = l.`planItemId`
JOIN `PlanDay` d ON d.`id` = i.`dayId`
SET l.`studyDay` = DATE_FORMAT(
    DATE_SUB(
        DATE(DATE_ADD(l.`createdAt`, INTERVAL 210 MINUTE)),
        INTERVAL ((DAYOFWEEK(DATE_ADD(l.`createdAt`, INTERVAL 210 MINUTE)) % 7) - d.`dayOfWeek` + 7) % 7 DAY
    ),
    '%Y-%m-%d'
)
WHERE l.`studyDay` IS NULL;

-- اصلاح انقضای برنامه‌های قدیمی: تاریخ پایان باید تا «آخر شبِ همان روز» به وقت تهران معتبر باشد.
-- قبلاً نیمه‌شبِ UTC ذخیره می‌شد (= ۰۳:۳۰ بامداد تهران) و برنامه حدود ۲۴ ساعت زودتر از پایان می‌افتاد.
-- فقط ردیف‌هایی که دقیقاً ۰۰:۰۰:۰۰ UTC هستند (ساخته‌شده توسط کلاینت قدیمی) اصلاح می‌شوند.
UPDATE `StudyPlan`
SET `expiresAt` = DATE_SUB(DATE_ADD(DATE(`expiresAt`), INTERVAL 1 DAY), INTERVAL 210 MINUTE) - INTERVAL 1 SECOND
WHERE `expiresAt` IS NOT NULL
  AND TIME(`expiresAt`) = '00:00:00';

-- همین منطق برای تاریخ شروع: نیمه‌شبِ UTC → ۰۰:۰۰ تهران (۳ ساعت و ۳۰ دقیقه زودتر)
UPDATE `StudyPlan`
SET `startsAt` = DATE_SUB(`startsAt`, INTERVAL 210 MINUTE)
WHERE TIME(`startsAt`) = '00:00:00';

-- CreateTable: StudyEntry
CREATE TABLE `StudyEntry` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(100) NOT NULL,
    `studyDay` VARCHAR(10) NOT NULL,
    `subject` VARCHAR(100) NOT NULL,
    `chapter` VARCHAR(191) NULL,
    `tagName` VARCHAR(60) NULL,
    `startTime` VARCHAR(5) NULL,
    `endTime` VARCHAR(5) NULL,
    `minutes` INTEGER NOT NULL,
    `testsTaken` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StudyEntry_studentId_studyDay_idx`(`studentId`, `studyDay`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: SubjectProgress
CREATE TABLE `SubjectProgress` (
    `id` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(100) NOT NULL,
    `studyDay` VARCHAR(10) NOT NULL,
    `subjectKey` VARCHAR(80) NOT NULL,
    `subject` VARCHAR(100) NOT NULL,
    `position` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubjectProgress_studentId_subjectKey_idx`(`studentId`, `subjectKey`),
    UNIQUE INDEX `SubjectProgress_studentId_studyDay_subjectKey_key`(`studentId`, `studyDay`, `subjectKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StudyEntry` ADD CONSTRAINT `StudyEntry_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SubjectProgress` ADD CONSTRAINT `SubjectProgress_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
