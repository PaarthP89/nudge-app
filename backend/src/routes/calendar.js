const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const GoogleCalendarService = require('../services/googleCalendar');

const router = express.Router();

router.use(requireAuth);

router.get('/events', async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query params required' });
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'invalid date format' });
    }
    const { accessToken, refreshToken } = req.user;
    const service = new GoogleCalendarService(accessToken, refreshToken);
    const events = await service.listEvents(startDate, endDate);
    res.json({ events });
  } catch (err) {
    next(err);
  }
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
