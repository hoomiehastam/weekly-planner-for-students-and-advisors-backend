-- ۱) اضافه‌شدن enum رشته‌ی تحصیلی
CREATE TYPE "Field" AS ENUM ('HUMANITIES', 'MATH_PHYSICS', 'EXPERIMENTAL');

-- ۲) اضافه‌شدن enum وضعیت اتصال مشاور ↔ دانش‌آموز
CREATE TYPE "AdvisorLinkStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- ۳) اضافه‌شدن فیلد field به User (اختیاری)
ALTER TABLE "User" ADD COLUMN "field" "Field";

-- ۴) اضافه‌شدن فیلد status به AdvisorStudentLink
--    همه‌ی link های فعلی را به‌صورت ACTIVE تنظیم می‌کنیم چون قبلاً بدون نیاز به تأیید ساخته شده‌اند
--    و از نظر منطقی فعال هستند.
ALTER TABLE "AdvisorStudentLink" ADD COLUMN "status" "AdvisorLinkStatus" NOT NULL DEFAULT 'ACTIVE';
