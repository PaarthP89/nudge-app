const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/chat', (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  // Placeholder — Claude intent parsing wired in Objective 5
  res.json({
    reply: "Got it! I'll be able to schedule that for you once AI parsing is wired up."
  });
});

router.post('/parse', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/confirm', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/suggest', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
