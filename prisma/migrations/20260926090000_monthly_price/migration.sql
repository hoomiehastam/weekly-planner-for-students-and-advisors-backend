-- قیمت‌گذاری اشتراک ماهانه (تومان) برای کاربر، مؤسسه و کارت واریز.
-- همه‌ی فیلدها اختیاری‌اند؛ null یعنی قیمت خاصی تعیین نشده (مدت تمدید دستی تعیین می‌شود).

-- مبلغ ماهانه‌ی اشتراک هر کاربر (دانش‌آموز/مشاور) — توسط سوپرادمین
ALTER TABLE "User" ADD COLUMN "monthlyPrice" INTEGER;

-- مبلغ ماهانه‌ی اشتراک مؤسسه — توسط سوپرادمین
ALTER TABLE "Institute" ADD COLUMN "monthlyPrice" INTEGER;

-- مبلغ ماهانه‌ی مرتبط با هر کارت واریز (برای نمایش در صفحه‌ی واریز و مودال تأیید رسید)
ALTER TABLE "CardSettings" ADD COLUMN "monthlyPrice" INTEGER;
