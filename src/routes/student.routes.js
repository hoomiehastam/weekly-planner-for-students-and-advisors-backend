const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  listMyStudents,
  getMyWeeklyGoal,
  setStudentWeeklyGoal,
  getMyAdvisor,
  chooseMyAdvisor,
} = require('../controllers/student.controller');
const {
  listMockExamScores,
  createMockExamScore,
} = require('../controllers/mockExam.controller');

// مشاور: فهرست دانش‌آموزهای خودش (شامل شماره تماس و توضیحات)
router.get('/mine', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), listMyStudents);

// دانش‌آموز: دریافت هدف هفتگی خودش
router.get('/me/weekly-goal', authenticate, requireRole('STUDENT'), getMyWeeklyGoal);

// دانش‌آموز: دریافت اطلاعات مشاور خودش (نام، ایمیل، شماره تماس، توضیحات)
router.get('/me/advisor', authenticate, requireRole('STUDENT'), getMyAdvisor);

// دانش‌آموز: انتخاب مشاور توسط خودش (بعد از تکمیل رشته داخل پنل)
router.post('/me/advisor', authenticate, requireRole('STUDENT'), validate(schemas.chooseAdvisor), chooseMyAdvisor);

// مشاور: تنظیم هدف هفتگی برای یک دانش‌آموز
router.put(
  '/:studentId/weekly-goal',
  authenticate,
  requireRole('ADVISOR', 'SUPERADMIN'),
  validate(schemas.weeklyGoal),
  setStudentWeeklyGoal
);

// ====== نمرات آزمون‌های آزمایشی (MOCK) ======
// دیدن نمرات: خود دانش‌آموز / مشاور متصل / والد متصل
//аче در کنترلر: getAccess)
router.get('/:studentId/mock-exams', authenticate, listMockExamScores);

// ثبت نمره‌ی جدید: فقط خود دانش‌آموز
router.post('/:studentId/mock-exams', authenticate, requireRole('STUDENT'), createMockExamScore);

module.exports = router;
