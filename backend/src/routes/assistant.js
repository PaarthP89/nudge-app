const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/parse', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/confirm', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/chat', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/suggest', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
