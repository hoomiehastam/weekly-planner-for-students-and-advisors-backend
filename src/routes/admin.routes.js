const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  listPendingAdvisors,
  approveAdvisor,
  rejectAdvisor,
  listAdvisorsOverview,
  listStudentsOverview,
  deactivateStudent,
  reactivateStudent,
  deleteStudent,
  createInstitute,
  listInstitutes,
  activateInstitute,
  deleteInstitute,
  updateInstituteSubscription,
  assignAdvisorToInstitute,
  assignAdvisorFields,
  deactivateAdvisor,
  reactivateAdvisor,
  deleteAdvisor,
  createUserOtp,
  setInstituteLeader,
} = require('../controllers/admin.controller');
const { validate, schemas } = require('../utils/validators');

// همه‌ی مسیرهای این فایل فقط برای سوپرادمین و بعد از ورود در دسترس هستند
router.use(authenticate, requireRole('SUPERADMIN'));

router.get('/advisors/pending', listPendingAdvisors);
router.post('/advisors/:id/approve', approveAdvisor);
router.post('/advisors/:id/reject', rejectAdvisor);
router.get('/advisors/overview', listAdvisorsOverview);

// تخصیص مشاور به مؤسسه (یا جدا کردنش با instituteId=null)
router.put('/advisors/:id/institute', validate(schemas.assignInstitute), assignAdvisorToInstitute);

// تخصیص/ویرایش رشته‌های تخصص مشاور
router.put('/advisors/:id/fields', validate(schemas.assignAdvisorFields), assignAdvisorFields);

// غیرفعال‌کردن / فعال‌کردن مجدد / حذف مشاور
router.post('/advisors/:id/deactivate', deactivateAdvisor);
router.post('/advisors/:id/reactivate', reactivateAdvisor);
router.delete('/advisors/:id', deleteAdvisor);

// ساخت رمز یک‌بار مصرف (OTP) برای کاربر — وقتی رمزش را فراموش کرده
router.post('/users/:id/otp', validate(schemas.createOtp), createUserOtp);

// ====== مدیریت دانش‌آموزان ======
router.get('/students/overview', listStudentsOverview);
router.post('/students/:id/deactivate', deactivateStudent);
router.post('/students/:id/reactivate', reactivateStudent);
router.delete('/students/:id', deleteStudent);

// تعیین/عزل نماینده (سردار) مؤسسه — body: { leaderId: userId|null }
router.put('/institutes/:id/leader', validate(schemas.setLeader), setInstituteLeader);

// مؤسسه‌ها: ساخت دستی (فروش B2B)، فهرست، فعال‌سازی
router.post('/institutes', createInstitute);
router.get('/institutes', listInstitutes);
router.post('/institutes/:id/activate', activateInstitute);

// حذف مؤسسه — اعضا به مستقل تبدیل می‌شوند (SetNull)
router.delete('/institutes/:id', deleteInstitute);

// تنظیم مدت اشتراک مؤسسه (تاریخ پایان / تعداد روز / وضعیت)
router.put('/institutes/:id/subscription', validate(schemas.updateInstituteSubscription), updateInstituteSubscription);

module.exports = router;
