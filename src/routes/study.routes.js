const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const c = require('../controllers/study.controller');

router.use(authenticate);

// دانش‌آموز: تگ‌های قابل انتخاب + مطالعه‌ی آزاد (ساخت/ویرایش/حذف/فهرست)
router.get('/tags', requireRole('STUDENT'), c.listMyTags);
router.get('/entries/mine', requireRole('STUDENT'), c.listMyEntries);
router.post('/entries', requireRole('STUDENT'), c.createEntry);
router.put('/entries/:id', requireRole('STUDENT'), c.updateEntry);
router.delete('/entries/:id', requireRole('STUDENT'), c.deleteEntry);

// دانش‌آموز: ثبت و دیدن پیشروی دروس
router.put('/progress', requireRole('STUDENT'), c.saveProgress);
router.get('/progress/mine', requireRole('STUDENT'), c.listMyProgress);

// خود دانش‌آموز / مشاور متصل / والد متصل (دسترسی در کنترلر با getStudentAccess چک می‌شود)
router.get('/entries/student/:studentId', c.listEntriesForStudent);
router.get('/progress/student/:studentId', c.listProgressForStudent);

module.exports = router;
