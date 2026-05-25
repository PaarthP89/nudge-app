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

router.patch('/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'at least one field to update is required' });
    }
    const { accessToken, refreshToken } = req.user;
    const service = new GoogleCalendarService(accessToken, refreshToken);
    const event = await service.updateEvent(id, req.body);
    res.json(event);
  } catch (err) {
    next(err);
  }
});

router.delete('/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { accessToken, refreshToken } = req.user;
    const service = new GoogleCalendarService(accessToken, refreshToken);
    await service.deleteEvent(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/freebusy', async (req, res, next) => {
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
    res.json({ events, start, end });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
