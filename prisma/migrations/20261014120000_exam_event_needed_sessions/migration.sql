-- AlterTable
-- تخمین دانش‌آموز از تعداد بازه‌ی مطالعه‌ی لازم برای این امتحان/پرسش.
-- nullable و بدون default تا ردیف‌های موجود دست‌نخورده بمانند (یعنی «نظری نداده»).
ALTER TABLE `StudentExamEvent` ADD COLUMN `neededSessions` INTEGER NULL;
