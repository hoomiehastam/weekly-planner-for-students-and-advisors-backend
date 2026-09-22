const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listActiveAdvisors,
  listPublicInstitutes,
  listPendingStudentRequests,
  listActiveStudents,
  acceptStudentRequest,
  rejectStudentRequest,
} = require('../controllers/advisor.controller');

// مسیرهای عمومی (بدون نیاز به ورود) — برای فرم ثبت‌نام
router.get('/', listActiveAdvisors);
router.get('/institutes/public', listPublicInstitutes);

// مسیرهای نیازمند ورود (مشاور)
router.use(authenticate);

// درخواست‌های دانش‌آموزان (PENDING) که منتظر تأیید مشاور هستند
router.get('/me/pending-students', listPendingStudentRequests);
// فهرست دانش‌آموزان فعال (تأییدشده) مشاور
router.get('/me/active-students', listActiveStudents);
// قبول/رد یک درخواست
router.post('/me/requests/:id/accept', acceptStudentRequest);
router.post('/me/requests/:id/reject', rejectStudentRequest);

module.exports = router;
