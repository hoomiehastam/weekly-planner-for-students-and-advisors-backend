const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { getRandomQuote } = require('../controllers/quote.controller');

router.get('/random', authenticate, requireRole('ADVISOR', 'SUPERADMIN'), getRandomQuote);

module.exports = router;
