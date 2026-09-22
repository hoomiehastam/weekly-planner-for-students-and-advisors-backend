-- اضافه‌کردن فیلد mustChangePassword به User
-- وقتی سوپرادمین OTP می‌سازد: mustChangePassword=true می‌شود
-- کاربر باید رمز جدید تعیین کند تا این فیلد false شود
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
