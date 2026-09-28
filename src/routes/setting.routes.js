const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const {
  getKonkurDate,
  setKonkurDate,
} = require('../controllers/setting.controller');

// خواندن تاریخ کنکور عمومی است (لندینگ بدون ورود آن را نشان می‌دهد)
router.get('/konkur-date', getKonkurDate);

// فقط سوپرادمین اجازه‌ی تعیین/تغییر تاریخ کنکور را دارد
router.put('/konkur-date', authenticate, requireRole('SUPERADMIN'), setKonkurDate);

module.exports = router;
