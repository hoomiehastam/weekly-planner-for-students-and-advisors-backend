const express = require('express');
const router = express.Router();
const { authenticate, requireInstituteManager } = require('../middleware/auth.middleware');
const {
  getInstituteMe,
  listInstituteAdvisors,
  approveMember,
  rejectMember,
} = require('../controllers/institute.controller');

// همه‌ی مسیرهای مدیر مؤسسه — اسکوپ از req.user.instituteId (هرگز از کلاینت)
router.use(authenticate);
router.use(requireInstituteManager);

router.get('/me', getInstituteMe);
router.get('/advisors', listInstituteAdvisors);
router.put('/members/:id/approve', approveMember);
router.put('/members/:id/reject', rejectMember);

module.exports = router;
