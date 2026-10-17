-- AlterTable: جدا کردن نام درس، فصل و بخش در هر بازه‌ی برنامه
-- ستون subject همان «نام درس» می‌ماند؛ داده‌های قبلی دست‌نخورده‌اند.
ALTER TABLE `PlanItem`
    ADD COLUMN `chapter` VARCHAR(191) NULL,
    ADD COLUMN `section` VARCHAR(191) NULL;
