-- ۱) اضافه‌شدن حالت SUSPENDED به UserStatus
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- ۲) جدول AdvisorField — رشته‌های تخصص مشاور (چندتا)
CREATE TABLE "AdvisorField" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" "Field" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdvisorField_userId_field_key" ON "AdvisorField"("userId", "field");
CREATE INDEX "AdvisorField_userId_idx" ON "AdvisorField"("userId");
CREATE INDEX "AdvisorField_field_idx" ON "AdvisorField"("field");

ALTER TABLE "AdvisorField" ADD CONSTRAINT "AdvisorField_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ۳) مهاجرت داده‌های موجود: مشاورانی که field دارند، به AdvisorField منتقل می‌شوند
--    (برای مشاورانی که field SET شده، یک رکورد AdvisorField ساخته می‌شود)
INSERT INTO "AdvisorField" ("id", "userId", "field")
SELECT
    gen_random_uuid()::text,
    id,
    field
FROM "User"
WHERE role = 'ADVISOR' AND field IS NOT NULL
ON CONFLICT ("userId", "field") DO NOTHING;
