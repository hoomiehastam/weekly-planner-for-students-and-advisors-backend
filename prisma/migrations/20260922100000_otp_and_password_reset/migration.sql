-- اضافه‌کردن رمز یک‌بار مصرف (OTP) و توکن‌های بازنشانی رمز عبور
-- ۱) فیلدهای OTP روی User
ALTER TABLE "User" ADD COLUMN "otpHash" TEXT;
ALTER TABLE "User" ADD COLUMN "otpExpiresAt" TIMESTAMP(3);

-- ۲) جدول PasswordReset برای بازیابی رمز عبور از طریق ایمیل
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordReset_token_key" ON "PasswordReset"("token");
CREATE INDEX "PasswordReset_email_idx" ON "PasswordReset"("email");
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
