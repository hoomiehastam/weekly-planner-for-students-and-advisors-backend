const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { validate, schemas } = require('../utils/validators');
const {
  createParentInvite,
  listMyParentInvites,
  joinAsParent,
  listMyChildren,
  getChildSummary,
} = require('../controllers/parent.controller');

// همه‌ی مسیرها نیازمند ورود هستند؛ نقش داخل کنترلرها چک می‌شود
router.use(authenticate);

// --- دانش‌آموز: کد دعوت والد ---
router.post('/invites', createParentInvite);
router.get('/invites/mine', listMyParentInvites);

// --- والد: اتصال با کد و فرزندان ---
router.post('/join', validate(schemas.parentJoin), joinAsParent);
router.get('/children', listMyChildren);
router.get('/children/:studentId/summary', getChildSummary);

module.exports = router;
