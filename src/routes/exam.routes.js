const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  createExam,
  updateExam,
  deleteExam,
  getExamsForStudent,
  getMyExams,
  startExam,
  saveAnswer,
  submitExam,
  getExamReview,
  getExamSubmissions,
  gradeSubmission,
} = require('../controllers/exam.controller');

router.use(authenticate);

// ====== مسیرهای مشاور ======
router.post('/', requireRole('ADVISOR', 'SUPERADMIN'), createExam);
router.put('/:id', requireRole('ADVISOR', 'SUPERADMIN'), updateExam);
router.delete('/:id', requireRole('ADVISOR', 'SUPERADMIN'), deleteExam);
router.get('/student/:studentId', requireRole('ADVISOR', 'SUPERADMIN'), getExamsForStudent);
router.get('/:examId/submissions', requireRole('ADVISOR', 'SUPERADMIN'), getExamSubmissions);
router.put('/submissions/:id/grade', requireRole('ADVISOR', 'SUPERADMIN'), gradeSubmission);

// ====== مسیرهای دانش‌آموز ======
router.get('/mine', requireRole('STUDENT'), getMyExams);
router.post('/:id/start', requireRole('STUDENT'), startExam);
router.post('/submissions/:id/save', requireRole('STUDENT'), validate(schemas.saveAnswer), saveAnswer);
router.post('/submissions/:id/submit', requireRole('STUDENT'), submitExam);
// مرور پاسخ‌ها پس از ارسال (گزینه‌ی صحیح + نمره‌ی هر سؤال)
router.get('/:id/review', requireRole('STUDENT'), getExamReview);

module.exports = router;
