const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/events', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.post('/events', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.patch('/events/:id', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.delete('/events/:id', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

router.get('/freebusy', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
