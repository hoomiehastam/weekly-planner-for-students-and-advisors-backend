const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { getSummary, markSeen } = require('../controllers/notification.controller');

router.use(authenticate, requireRole('STUDENT'));

router.get('/summary', getSummary);
router.post('/mark-seen', markSeen);

module.exports = router;
