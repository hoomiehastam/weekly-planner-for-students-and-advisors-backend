const express = require('express');
const router = express.Router();
const { authenticate, requireInstituteManager } = require('../middleware/auth.middleware');
const {
  getInstituteMe,
  listInstituteAdvisors,
  listInstituteStudents,
  approveMember,
  rejectMember,
  removeMember,
  assignStudentAdvisor,
} = require('../controllers/institute.controller');

// همه‌ی مسیرهای مدیر مؤسسه — اسکوپ از req.user.instituteId (هرگز از کلاینت)
router.use(authenticate);
router.use(requireInstituteManager);

router.get('/me', getInstituteMe);
router.get('/advisors', listInstituteAdvisors);
router.get('/students', listInstituteStudents);
router.put('/members/:id/approve', approveMember);
router.put('/members/:id/reject', rejectMember);
router.delete('/members/:id', removeMember);
// انتخاب/تغییر مشاور یک دانش‌آموز مؤسسه توسط مدیر — body: { advisorId }
router.put('/students/:id/advisor', assignStudentAdvisor);

module.exports = router;
