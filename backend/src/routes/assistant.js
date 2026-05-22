const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const ClaudeService = require('../services/claude');
const GoogleCalendarService = require('../services/googleCalendar');
const { detectConflicts } = GoogleCalendarService;

const router = express.Router();
router.use(requireAuth);

const MAX_MESSAGE_LEN = 1000;

function getContext() {
  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

function validateMessage(req, res) {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return null;
  }
  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ error: `message must be ${MAX_MESSAGE_LEN} characters or fewer` });
    return null;
  }
  return message.trim();
}

async function runParse(req, res, next) {
  try {
    const message = validateMessage(req, res);
    if (!message) return;

    const service = new ClaudeService();
    const intent = await service.parseIntent(message, getContext());
    const reply = ClaudeService.buildIntentReply(intent);

    let conflicts = [];
    if (intent.action === 'create' && intent.start_time) {
      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);
      const windowStart = new Date(intent.start_time);
      const windowEnd = intent.end_time
        ? new Date(intent.end_time)
        : new Date(windowStart.getTime() + (intent.duration_minutes ?? 60) * 60 * 1000);
      const events = await calService.listEvents(windowStart, windowEnd);
      conflicts = detectConflicts(events, intent);
    }

    res.json({ intent, reply, conflicts });
  } catch (err) {
    console.error('[assistant] Gemini error:', err.status, err.statusCode, err.message);
    const msg = String(err.message || '');
    const is429 = err.status === 429 || err.statusCode === 429 ||
                  msg.includes('429') || msg.toLowerCase().includes('resource_exhausted');
    if (is429) {
      return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
    }
    next(err);
  }
}

router.post('/parse', runParse);
router.post('/chat', runParse);

router.post('/confirm', async (req, res, next) => {
  try {
    const { intent } = req.body;
    if (!intent || intent.action !== 'create' || !intent.start_time) {
      return res.status(400).json({ error: 'valid create intent with start_time required' });
    }
    const { accessToken, refreshToken } = req.user;
    const calService = new GoogleCalendarService(accessToken, refreshToken);
    const event = await calService.createEvent(intent);
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
});

router.post('/suggest', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
