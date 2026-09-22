const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
  createInstitute,
  listInstitutes,
  activateInstitute,
  deleteInstitute,
  updateInstituteSubscription,
  assignAdvisorToInstitute,
  createUserOtp,
} = require('../controllers/admin.controller');
const { validate, schemas } = require('../utils/validators');

// همه‌ی مسیرهای این فایل فقط برای سوپرادمین و بعد از ورود در دسترس هستند
router.use(authenticate, requireRole('SUPERADMIN'));

router.get('/advisors/pending', listPendingAdvisors);
router.post('/advisors/:id/approve', approveAdvisor);
router.post('/advisors/:id/reject', rejectAdvisor);
router.get('/advisors/overview', listAdvisorsOverview);

// تخصیص مشاور به مؤسسه‌ی خاص (یا جدا کردنش با instituteId=null)
router.put('/advisors/:id/institute', validate(schemas.assignInstitute), assignAdvisorToInstitute);

// ساخت رمز یک‌بار مصرف (OTP) برای کاربر — وقتی رمزش را فراموش کرده
router.post('/users/:id/otp', validate(schemas.createOtp), createUserOtp);

// مؤسسه‌ها: ساخت دستی (فروش B2B)، فهرست، فعال‌سازی
router.post('/institutes', createInstitute);
router.get('/institutes', listInstitutes);
router.post('/institutes/:id/activate', activateInstitute);

// حذف مؤسسه — اعضا به مستقل تبدیل می‌شوند (SetNull)
router.delete('/institutes/:id', deleteInstitute);

// تنظیم مدت اشتراک مؤسسه (تاریخ پایان / تعداد روز / وضعیت)
router.put('/institutes/:id/subscription', validate(schemas.updateInstituteSubscription), updateInstituteSubscription);

module.exports = router;
