-- عکس پروفایل کاربر (data URL اختیاری) + نماینده/سردار مؤسسه (leaderId)
-- هر دو فیلد اختیاری‌اند؛ هیچ داده‌ای تغییر نمی‌کند و rollback ساده است.

-- عکس پروفایل به‌صورت data URL (base64) — مثل imageUrl سؤالات آزمون
ALTER TABLE "User" ADD COLUMN "photoUrl" TEXT;

-- نماینده‌ی مؤسسه: یک عضو مؤسسه که اختیارات مدیر را دارد (role تغییر نمی‌کند)
ALTER TABLE "Institute" ADD COLUMN "leaderId" TEXT;

-- ForeignKey: leaderId → User.id با onDelete: SetNull (اگر سردبیر حذف شد، مؤسسه بی‌سردبیر می‌شود)
ALTER TABLE "Institute" ADD CONSTRAINT "Institute_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Institute_leaderId_idx" ON "Institute"("leaderId");
