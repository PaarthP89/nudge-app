const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const AIService = require('../services/ai');
const GoogleCalendarService = require('../services/googleCalendar');
const GmailService = require('../services/gmail');
const { detectConflicts } = GoogleCalendarService;

const router = express.Router();
router.use(requireAuth);

const MAX_MESSAGE_LEN = 1000;

function getContext(req) {
  const now = typeof req.body.now === 'string' ? req.body.now : new Date().toISOString();
  const timezone = typeof req.body.timezone === 'string' ? req.body.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { now, timezone };
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

function validateHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m =>
      m && typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0
    )
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));
}

async function runParse(req, res, next) {
  try {
    const message = validateMessage(req, res);
    if (!message) return;

    const history = validateHistory(req.body.history);
    const service = new AIService();

    let intent;
    if (history.length > 0) {
      const messages = [...history, { role: 'user', content: message }];
      intent = await service.chat(messages, getContext(req));
    } else {
      intent = await service.parseIntent(message, getContext(req));
    }

    // If the model returned 'unknown' but the raw message has an unambiguous action keyword,
    // override the action so the downstream search blocks can run.
    if (intent.action === 'unknown') {
      const lc = message.toLowerCase();
      if (/\b(delete|remove|cancel|get rid of)\b/.test(lc))        intent.action = 'delete';
      else if (/\b(schedule|book|create|add|set up|plan)\b/.test(lc)) intent.action = 'create';
      else if (/\b(move|reschedule|change|update|shift|push back)\b/.test(lc)) intent.action = 'update';
      else if (/\b(what|show|do i have|check my|look up)\b.*\b(calendar|schedule|today|tomorrow|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lc)) intent.action = 'query';
      if (intent.action !== 'unknown') intent.confidence = Math.max(intent.confidence, 0.5);
    }

    let reply = AIService.buildIntentReply(intent);

    let conflicts = [];
    let suggestions = [];
    let candidates = [];

    if (intent.action === 'create' && intent.start_time && intent.date_known && intent.time_known) {
      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);
      const windowStart = new Date(intent.start_time);
      const windowEnd = intent.end_time
        ? new Date(intent.end_time)
        : new Date(windowStart.getTime() + (intent.duration_minutes ?? 60) * 60 * 1000);
      const events = await calService.listEvents(windowStart, windowEnd);
      conflicts = detectConflicts(events, intent);

      if (conflicts.length > 0) {
        try {
          suggestions = await service.suggestSlots(intent, conflicts);
        } catch (err) {
          console.error('[assistant] suggestSlots error:', err.message);
        }
      }
    }

    if (intent.action === 'delete') {
      try {
        const { accessToken, refreshToken } = req.user;
        const calService = new GoogleCalendarService(accessToken, refreshToken);

        let searchStart, searchEnd;

        if (intent.date_known && intent.start_time) {
          const d = new Date(intent.start_time);
          if (intent.time_known) {
            searchStart = new Date(d.getTime() - 30 * 60 * 1000);
            searchEnd   = new Date(d.getTime() + 90 * 60 * 1000);
          } else {
            searchStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
            searchEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
          }
        } else if (intent.title) {
          searchStart = new Date();
          searchEnd   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        if (searchStart && searchEnd) {
          const events = await calService.listEvents(searchStart, searchEnd);
          let matches = events.filter(ev => !ev.allDay);

          if (intent.title) {
            const needle = intent.title.toLowerCase();
            const titled = matches.filter(ev =>
              ev.title?.toLowerCase().includes(needle) ||
              needle.includes(ev.title?.toLowerCase() ?? '')
            );
            if (titled.length > 0) matches = titled;
          }

          candidates = matches.slice(0, 3);
        }

        if (candidates.length === 1) {
          reply = `Found "${candidates[0].title}" — confirm deletion?`;
        } else if (candidates.length > 1) {
          reply = `Found ${candidates.length} events in that window — which one should I delete?`;
        } else {
          reply = intent.title
            ? `I couldn't find an event called "${intent.title}" in your calendar.`
            : "I couldn't find a matching event in your calendar.";
        }
      } catch (err) {
        console.error('[assistant] delete search error:', err.message);
      }
    }

    let queryResults = null;

    if (intent.action === 'query' && intent.date_known && intent.start_time) {
      try {
        const { accessToken, refreshToken } = req.user;
        const calService = new GoogleCalendarService(accessToken, refreshToken);
        const d = new Date(intent.start_time);
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        const events = await calService.listEvents(dayStart, dayEnd);
        queryResults = events;
        if (events.length === 0) {
          reply = `Nothing on your calendar for ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}.`;
        } else {
          reply = `Here's what's on your calendar for ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}:`;
        }
      } catch (err) {
        console.error('[assistant] query error:', err.message);
      }
    }

    res.json({ intent, reply, conflicts, suggestions, candidates, queryResults });
  } catch (err) {
    console.error('[assistant] AI service error:', err.status, err.statusCode, err.message);
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

    const emailAttendees = (intent.attendees || []).filter(a => a.includes('@'));
    const invitesSent = [];
    const inviteErrors = [];

    if (emailAttendees.length > 0) {
      const gmailService = new GmailService(accessToken, refreshToken);
      for (const email of emailAttendees) {
        try {
          await gmailService.sendInvite(email, {
            title: event.title,
            start: event.start,
            end: event.end,
            location: event.location
          });
          invitesSent.push(email);
        } catch (err) {
          console.error('[assistant] invite error for', email, err.message);
          inviteErrors.push(email);
        }
      }
    }

    res.status(201).json({ event, invitesSent, inviteErrors });
  } catch (err) {
    next(err);
  }
});

router.post('/suggest', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
