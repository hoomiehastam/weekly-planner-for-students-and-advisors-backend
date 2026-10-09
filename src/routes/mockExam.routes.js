const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  updateMockExamScore,
  deleteMockExamScore,
} = require('../controllers/mockExam.controller');

// ویرایش/حذف نمره‌ی آزمون آزمایشی — فقط خود دانش‌آموز
router.put('/:id', authenticate, requireRole('STUDENT'), updateMockExamScore);
router.delete('/:id', authenticate, requireRole('STUDENT'), deleteMockExamScore);

module.exports = router;
