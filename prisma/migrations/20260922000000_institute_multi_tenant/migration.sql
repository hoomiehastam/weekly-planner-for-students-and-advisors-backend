-- مولتی-تننسی: مؤسسه‌ی آموزشی + عضویت اختیاری کاربران + اشتراک ماهانه‌ی مؤسسه
-- invariant: null روی User.instituteId یعنی کاربر مستقل

-- ۱) نقش جدید مدیر مؤسسه
ALTER TYPE "UserRole" ADD VALUE 'INSTITUTE_MANAGER';

-- ۲) جدول مؤسسه
CREATE TABLE "Institute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- کد دعوت یکتا: ثبت‌نام با این کد → عضویت + تأیید توسط مدیر مؤسسه
    "code" TEXT NOT NULL,
    -- مؤسسه هم مثل مشاور توسط سوپرادمین تأیید می‌شود
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institute_pkey" PRIMARY KEY ("id")
);

-- ۳) اشتراک ماهانه‌ی مؤسسه (خود مؤسسه پرداخت می‌کند، نه اعضا)
CREATE TABLE "InstituteSubscription" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    -- TRIAL | ACTIVE | GRACE | EXPIRED
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    -- ردپای پرداخت/تمدید دستی (درگاه بانکی + ویرایش سوپرادمین)
    "lastPaymentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstituteSubscription_pkey" PRIMARY KEY ("id")
);

-- ۴) عضویت اختیاری کاربر در مؤسسه — null یعنی مستقل
ALTER TABLE "User" ADD COLUMN "instituteId" TEXT;

-- CreateIndex
CREATE INDEX "User_instituteId_idx" ON "User"("instituteId");

-- CreateIndex
CREATE UNIQUE INDEX "Institute_code_key" ON "Institute"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InstituteSubscription_instituteId_key" ON "InstituteSubscription"("instituteId");

-- CreateIndex
CREATE INDEX "InstituteSubscription_instituteId_idx" ON "InstituteSubscription"("instituteId");

-- AddForeignKey
ALTER TABLE "InstituteSubscription" ADD CONSTRAINT "InstituteSubscription_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- حذف مؤسسه هرگز اعضا را حذف نمی‌کند — فقط عضویت null می‌شود
ALTER TABLE "User" ADD CONSTRAINT "User_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
