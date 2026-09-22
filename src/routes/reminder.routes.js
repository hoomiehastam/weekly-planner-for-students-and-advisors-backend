const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  sendReminder,
  getMyReminders,
  getRemindersForStudent,
  deleteReminder,
} = require('../controllers/reminder.controller');

router.use(authenticate);

// دانش‌آموز: دیدن یادآورهای خودش + حذف آن‌ها
router.get('/mine', requireRole('STUDENT'), getMyReminders);
router.delete('/:id', deleteReminder);

// مشاور: فرستادن، دیدن و حذف یادآورها
router.post('/', requireRole('ADVISOR', 'SUPERADMIN'), validate(schemas.reminder), sendReminder);
router.get('/student/:studentId', requireRole('ADVISOR', 'SUPERADMIN'), getRemindersForStudent);

module.exports = router;
