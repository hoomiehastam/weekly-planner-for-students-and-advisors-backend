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
} = require('../controllers/admin.controller');

// همه‌ی مسیرهای این فایل فقط برای سوپرادمین و بعد از ورود در دسترس هستند
router.use(authenticate, requireRole('SUPERADMIN'));

router.get('/advisors/pending', listPendingAdvisors);
router.post('/advisors/:id/approve', approveAdvisor);
router.post('/advisors/:id/reject', rejectAdvisor);
router.get('/advisors/overview', listAdvisorsOverview);

// مؤسسه‌ها: ساخت دستی (فروش B2B)، فهرست، فعال‌سازی
router.post('/institutes', createInstitute);
router.get('/institutes', listInstitutes);
router.post('/institutes/:id/activate', activateInstitute);

module.exports = router;
