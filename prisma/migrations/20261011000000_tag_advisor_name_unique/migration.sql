-- کلید یکتای (advisorId, name) برای Tag — جلوگیری از تگ تکراری به‌ازای هر مشاور.
-- نکته: اگر ردیف‌های تکراری از قبل موجود باشند، ALTER TABLE شکست می‌خورد؛
-- پس اول تکراری‌ها حذف می‌شوند (جدیدترین نسخه‌ی هر نام می‌ماند).
-- پیوندهای PlanItemTag/PlanItemLog تگِ حذف‌شده به‌صورت cascade پاک می‌شوند؛
-- چون تگِ مانده همان نام را دارد، مشاور می‌تواند دوباره آن را به آیتم وصل کند.

DELETE t1 FROM `Tag` t1
JOIN `Tag` t2
  ON t1.advisorId = t2.advisorId
 AND t1.name = t2.name
 AND t1.id < t2.id;

ALTER TABLE `Tag` ADD UNIQUE INDEX `Tag_advisorId_name_key`(`advisorId`, `name`);
