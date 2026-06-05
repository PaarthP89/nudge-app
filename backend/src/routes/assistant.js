const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const AIService = require('../services/ai');
const GoogleCalendarService = require('../services/googleCalendar');
const GmailService = require('../services/gmail');
const { stripMarkdown, normalizeVocalDate, flattenOptionsToSpeech } = require('../services/speechUtils');
const { detectConflicts } = GoogleCalendarService;

const router = express.Router();
router.use(requireAuth);

function parseDayHint(hint, now = new Date()) {
  if (!hint || typeof hint !== 'string') return null;
  const s = hint.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');

  const lower = s.toLowerCase();
  if (lower === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (lower === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const withYear = `${s} ${now.getFullYear()}`;
  let d = new Date(withYear);
  if (!isNaN(d.getTime())) return d;

  d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  const dow = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const idx = dow.indexOf(s.toLowerCase());
  if (idx !== -1) {
    const result = new Date(now);
    result.setHours(0, 0, 0, 0);
    const daysBack = (result.getDay() - idx + 7) % 7;
    result.setDate(result.getDate() - daysBack);
    return result;
  }

  return null;
}

function parseTimeHint(hint, refDate = new Date()) {
  if (!hint) return null;
  // Normalize STT-style "a.m." / "p.m." (with periods) to "am" / "pm"
  const normalized = hint.trim().replace(/\ba\.m\./gi, 'am').replace(/\bp\.m\./gi, 'pm');
  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const mins = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(refDate);
  d.setHours(h, mins, 0, 0);
  return d;
}

function computeUpdatePatches(candidate, intent) {
  const patches = {};

  if (intent.new_title) {
    patches.summary = intent.new_title;
  }

  const candidateStart = new Date(candidate.start);
  const candidateEnd   = new Date(candidate.end);
  const durationMs     = candidateEnd - candidateStart;

  let newStart    = new Date(candidateStart);
  let timeChanged = false;

  if (intent.start_delta_minutes !== null && intent.start_delta_minutes !== undefined) {
    const delta = intent.start_delta_minutes * 60 * 1000;
    newStart    = new Date(newStart.getTime() + delta);
    timeChanged = true;
  } else if (intent.new_date) {
    const destDate = parseDayHint(intent.new_date);
    if (destDate) {
      if (intent.new_time) {
        const destTime = parseTimeHint(intent.new_time, destDate);
        newStart = destTime ?? new Date(
          destDate.getFullYear(), destDate.getMonth(), destDate.getDate(),
          candidateStart.getHours(), candidateStart.getMinutes(), 0, 0
        );
      } else {
        newStart = new Date(
          destDate.getFullYear(), destDate.getMonth(), destDate.getDate(),
          candidateStart.getHours(), candidateStart.getMinutes(), 0, 0
        );
      }
      timeChanged = true;
    }
  } else if (intent.date_known && intent.start_time) {
    const intentStart = new Date(intent.start_time);
    if (intent.time_known && !intent.preserve_time) {
      newStart = intentStart;
    } else {
      newStart = new Date(
        intentStart.getFullYear(), intentStart.getMonth(), intentStart.getDate(),
        candidateStart.getHours(), candidateStart.getMinutes(), 0, 0
      );
    }
    timeChanged = true;
  } else if (intent.new_time) {
    // Time-only change — keep the candidate's date, apply the new time of day
    const destTime = parseTimeHint(intent.new_time, candidateStart);
    if (destTime) {
      newStart = destTime;
      timeChanged = true;
    }
  }

  let newEnd = new Date(newStart.getTime() + durationMs);

  if (intent.duration_delta_minutes !== null && intent.duration_delta_minutes !== undefined) {
    newEnd      = new Date(newEnd.getTime() + intent.duration_delta_minutes * 60 * 1000);
    timeChanged = true;
  }

  if (timeChanged) {
    patches.start = { dateTime: newStart.toISOString() };
    patches.end   = { dateTime: newEnd.toISOString() };
  }

  return patches;
}

function parseFindSlotRange(intent, { now }) {
  if (intent.date_known && intent.start_time) {
    const d = new Date(intent.start_time);
    return {
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0),
      end:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)
    };
  }
  const period = (intent.target_period || '').toLowerCase();
  const clientRef = now ? new Date(now) : null;
  const ref = (clientRef && !isNaN(clientRef.getTime())) ? clientRef : new Date();
  if (period.includes('week')) {
    const monday = new Date(ref);
    const dow = monday.getDay();
    monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }
  const dayStart = new Date(ref);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(ref);
  dayEnd.setHours(23, 59, 59, 999);
  return { start: dayStart, end: dayEnd };
}

function slotsOverlap(slot, ev) {
  return new Date(slot.start_time) < new Date(ev.end) && new Date(slot.end_time) > new Date(ev.start);
}

// ── Voice interceptor helpers ──────────────────────────────────────────────────

const AFFIRMATION_RE = /^(yes|yep|yeah|yup|sure|okay|ok|go ahead|confirm|do it|sounds good|let'?s do it|let'?s go|absolutely|correct|that works|perfect|great|right)[.!]?$/i;

function parseOptionIndex(msg) {
  const lc = msg.toLowerCase().trim();
  const ordinals = {
    one: 0, first: 0, '1': 0,
    two: 1, second: 1, '2': 1,
    three: 2, third: 2, '3': 2,
    four: 3, fourth: 3, '4': 3,
    five: 4, fifth: 4, '5': 4,
  };
  const m = lc.match(/(?:option|number)\s+(one|two|three|four|five|1|2|3|4|5)|the\s+(first|second|third|fourth|fifth)\s+one|^(1|2|3|4|5)$/);
  if (!m) return -1;
  const word = m[1] || m[2] || m[3];
  return ordinals[word] ?? -1;
}

function buildSpeechReply(parseResult, timezone = 'UTC') {
  const { intent, reply, slotOptions, queryResults, candidates, suggestions, updateProposal, batchPlan, conflicts } = parseResult;

  // option_selection types — verbalize as numbered choices
  if (slotOptions?.slots?.length > 0) return flattenOptionsToSpeech(slotOptions.slots, 'slots', timezone);
  if (queryResults?.length > 0) return flattenOptionsToSpeech(queryResults, 'events', timezone);
  if (candidates?.length > 1) return flattenOptionsToSpeech(candidates, 'events', timezone);
  if (suggestions?.length > 0) return flattenOptionsToSpeech(suggestions, 'slots', timezone);

  // binary_affirmation: update — describe the change and ask
  if (updateProposal) {
    const { after, candidate } = updateProposal;
    const title = candidate?.title || after?.title || 'the event';
    if (after?.start) {
      try {
        const newDate = normalizeVocalDate(after.start, timezone);
        return `I'll update ${title} to ${newDate}. Should I go ahead?`;
      } catch (_) {}
    }
    return `Ready to update ${title}. Should I go ahead?`;
  }

  // binary_affirmation: batch — state count and ask
  if (batchPlan) {
    const instances = batchPlan.instances || [];
    const count = instances.length;
    const conflictCount = instances.filter(i => i.conflicts?.length > 0).length;
    const title = instances[0]?.title || 'events';
    if (conflictCount > 0) {
      const cleanCount = count - conflictCount;
      return `Ready to create ${cleanCount} of ${count} ${title} events — ${conflictCount} have conflicts. Should I go ahead?`;
    }
    return `Ready to create ${count} ${title} events. Should I go ahead?`;
  }

  // binary_affirmation: ready create intent with no conflicts — ask a proper question
  if (
    intent?.action === 'create' &&
    intent?.date_known &&
    intent?.time_known &&
    intent?.title &&
    (intent?.confidence || 0) >= 0.5 &&
    !conflicts?.length
  ) {
    if (intent.start_time) {
      try {
        const dateStr = normalizeVocalDate(intent.start_time, timezone);
        return `Got it. I'll schedule ${intent.title} on ${dateStr}. Should I go ahead?`;
      } catch (_) {}
    }
    return `Got it. I'll schedule ${intent.title}. Should I go ahead?`;
  }

  return stripMarkdown(reply);
}

function buildAudioMetadata(parseResult) {
  const { intent, conflicts, slotOptions, queryResults, candidates, updateProposal, batchPlan, suggestions } = parseResult;
  if (slotOptions?.slots?.length > 0 || suggestions?.length > 0 || candidates?.length > 1) {
    return { waitForInput: true, inputExpectation: 'option_selection', clearToListen: true };
  }
  if (candidates?.length === 1 || batchPlan || updateProposal) {
    return { waitForInput: true, inputExpectation: 'binary_affirmation', clearToListen: true };
  }
  if (
    intent?.action === 'create' &&
    intent?.date_known &&
    intent?.time_known &&
    intent?.title &&
    intent?.confidence >= 0.5 &&
    !conflicts?.length
  ) {
    return { waitForInput: true, inputExpectation: 'binary_affirmation', clearToListen: true };
  }
  return { waitForInput: true, inputExpectation: 'open_ended', clearToListen: true };
}

// ── Shared utilities ───────────────────────────────────────────────────────────

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

// ── Core parse logic (no res writing) ─────────────────────────────────────────

async function computeParseResult(req) {
  const forcedIntent = req.body.forcedIntent;
  const candidateId  = req.body.candidateId;

  const service = new AIService();
  let intent;
  let message = '';

  if (forcedIntent && typeof forcedIntent === 'object') {
    intent = forcedIntent;
  } else {
    message = (req.body.message || '').trim();
    const history = validateHistory(req.body.history);

    if (history.length > 0) {
      const messages = [...history, { role: 'user', content: message }];
      intent = await service.chat(messages, getContext(req));
    } else {
      intent = await service.parseIntent(message, getContext(req));
    }
  }

  if (intent.action === 'unknown' && message) {
    const lc = message.toLowerCase();
    if (/\b(delete|remove|cancel|get rid of)\b/.test(lc))        intent.action = 'delete';
    else if (/\b(schedule|book|create|add|set up|plan)\b/.test(lc)) intent.action = 'create';
    else if (/\b(move|reschedule|change|update|shift|push back)\b/.test(lc)) intent.action = 'update';
    else if (/\b(what|show|do i have|check my|look up)\b.*\b(calendar|schedule|today|tomorrow|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lc)) intent.action = 'query';
    else if (/\b(find me|find time|free time|open slot|available|when am i free|fit in)\b/.test(lc)) intent.action = 'find_slot';
    if (intent.action !== 'unknown') intent.confidence = Math.max(intent.confidence, 0.5);
  }

  let reply = AIService.buildIntentReply(intent);
  let conflicts = [];
  let suggestions = [];
  let candidates = [];
  let loopIterations = 0;
  let batchPlan = null;
  let slotOptions = null;
  let updateProposal = null;
  let queryResults = null;

  if (intent.action === 'create' && intent.recurrence) {
    try {
      const expandedInstances = await service.expandRecurrence(intent, getContext(req));
      if (expandedInstances.length > 0) {
        const { accessToken, refreshToken } = req.user;
        const calService = new GoogleCalendarService(accessToken, refreshToken);
        const times = expandedInstances.map(i => new Date(i.start_time).getTime());
        const ends  = expandedInstances.map(i => new Date(i.end_time).getTime());
        const rangeStart = new Date(Math.min(...times));
        const rangeEnd   = new Date(Math.max(...ends));
        const events = await calService.listEvents(rangeStart, rangeEnd);

        const annotated = expandedInstances.map(inst => ({
          ...inst,
          attendees: intent.attendees || [],
          location:  intent.location  || null,
          conflicts: detectConflicts(events, { action: 'create', start_time: inst.start_time, end_time: inst.end_time }),
        }));

        const conflictCount = annotated.filter(i => i.conflicts.length > 0).length;
        const eventLabel = `"${intent.title || 'event'}"`;
        const summary = conflictCount > 0
          ? `${annotated.length} ${eventLabel} events — ${conflictCount} conflict${conflictCount > 1 ? 's' : ''}`
          : `${annotated.length} ${eventLabel} events ready to schedule`;

        batchPlan = { instances: annotated, summary };
        reply = conflictCount > 0
          ? `Found ${conflictCount} conflict${conflictCount > 1 ? 's' : ''}. Review the plan below.`
          : `All ${annotated.length} slots are available! Review and confirm below.`;
      }
    } catch (err) {
      console.error('[assistant] expandRecurrence error:', err.message);
    }
  } else if (intent.action === 'create' && intent.start_time && intent.date_known && intent.time_known) {
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
        let rawSuggestions = await service.suggestSlots(intent, conflicts, {});
        let cleanSuggestions = [];
        let excludeRanges = [];

        while (cleanSuggestions.length === 0 && loopIterations < 2) {
          for (const suggestion of rawSuggestions) {
            const suggestionConflicts = detectConflicts(events, {
              action: 'create',
              start_time: suggestion.start_time,
              end_time: suggestion.end_time,
              duration_minutes: intent.duration_minutes,
            });
            if (suggestionConflicts.length === 0) {
              cleanSuggestions.push(suggestion);
            } else {
              excludeRanges.push({ start: suggestion.start_time, end: suggestion.end_time });
            }
          }
          if (cleanSuggestions.length === 0 && loopIterations < 1) {
            rawSuggestions = await service.suggestSlots(intent, conflicts, { excludeRanges });
            loopIterations++;
          } else {
            break;
          }
        }

        suggestions = cleanSuggestions.length > 0 ? cleanSuggestions : rawSuggestions;
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

  if (intent.action === 'update') {
    try {
      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);
      const titleFilter = intent.title_hint ?? intent.title;

      if (candidateId) {
        try {
          const event = await calService.getEvent(candidateId);
          candidates = [event];
        } catch (e) {
          // fall through to search if fetch fails
        }
      }

      let searchStart, searchEnd;

      const timeHintDate = parseTimeHint(intent.time_hint);
      const dayHintDate  = parseDayHint(intent.day_hint);

      if (candidates.length === 0) {
        if (timeHintDate) {
          searchStart = new Date(timeHintDate.getTime() - 90 * 60 * 1000);
          searchEnd   = new Date(timeHintDate.getTime() + 90 * 60 * 1000);
        } else if (titleFilter && dayHintDate) {
          searchStart = new Date(dayHintDate.getFullYear(), dayHintDate.getMonth(), dayHintDate.getDate(), 0, 0, 0);
          searchEnd   = new Date(dayHintDate.getFullYear(), dayHintDate.getMonth(), dayHintDate.getDate(), 23, 59, 59);
        } else if (titleFilter) {
          searchStart = new Date();
          searchEnd   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        } else if (intent.date_known && intent.start_time) {
          const d = new Date(intent.start_time);
          if (intent.time_known) {
            searchStart = new Date(d.getTime() - 90 * 60 * 1000);
            searchEnd   = new Date(d.getTime() + 90 * 60 * 1000);
          } else {
            searchStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
            searchEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
          }
        }

        if (searchStart && searchEnd) {
          const events = await calService.listEvents(searchStart, searchEnd);
          let matches = events.filter(ev => !ev.allDay);

          if (titleFilter) {
            const needle = titleFilter.toLowerCase();
            const titled = matches.filter(ev =>
              ev.title?.toLowerCase().includes(needle) ||
              needle.includes(ev.title?.toLowerCase() ?? '')
            );
            if (titled.length > 0) matches = titled;
          }

          candidates = matches.slice(0, 3);
        }

        if (candidates.length === 0 && intent.time_hint && intent.date_known && intent.start_time) {
          const timeHintOnDate = parseTimeHint(intent.time_hint, new Date(intent.start_time));
          const altStart = new Date(timeHintOnDate.getTime() - 90 * 60 * 1000);
          const altEnd   = new Date(timeHintOnDate.getTime() + 90 * 60 * 1000);
          const altEvents = await calService.listEvents(altStart, altEnd);
          let altMatches = altEvents.filter(ev => !ev.allDay);
          if (titleFilter) {
            const needle = titleFilter.toLowerCase();
            const titled = altMatches.filter(ev =>
              ev.title?.toLowerCase().includes(needle) ||
              needle.includes(ev.title?.toLowerCase() ?? '')
            );
            if (titled.length > 0) altMatches = titled;
          }
          candidates = altMatches.slice(0, 3);
        }
      }

      if (candidates.length === 0) {
        reply = titleFilter
          ? `I couldn't find an event called "${titleFilter}" in your calendar.`
          : "I couldn't find a matching event in your calendar.";
      } else if (candidates.length === 1) {
        const candidate = candidates[0];
        const patches   = computeUpdatePatches(candidate, intent);

        let updateConflicts = [];
        if (patches.start && patches.end) {
          const windowStart = new Date(patches.start.dateTime);
          const windowEnd   = new Date(patches.end.dateTime);
          const checkEvents = await calService.listEvents(
            new Date(windowStart.getTime() - 5 * 60 * 1000),
            new Date(windowEnd.getTime()   + 5 * 60 * 1000)
          );
          updateConflicts = detectConflicts(
            checkEvents.filter(ev => ev.id !== candidate.id),
            { action: 'create', start_time: patches.start.dateTime, end_time: patches.end.dateTime }
          );
        }

        updateProposal = {
          candidate,
          patches,
          after: {
            id:    candidate.id,
            title: patches.summary        ?? candidate.title,
            start: patches.start?.dateTime ?? candidate.start,
            end:   patches.end?.dateTime   ?? candidate.end,
          },
          conflicts: updateConflicts
        };

        reply = updateConflicts.length > 0
          ? `Found "${candidate.title}" — the new time has a conflict. Update anyway?`
          : `Found "${candidate.title}" — ready to update?`;
      } else {
        reply = `Found ${candidates.length} events with that name — which one would you like to update?`;
      }
    } catch (err) {
      console.error('[assistant] update search error:', err.message);
    }
  }

  if (intent.action === 'find_slot') {
    try {
      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);
      const ctx = getContext(req);
      const { start, end } = parseFindSlotRange(intent, ctx);
      const events = await calService.listEvents(start, end);
      const duration = intent.duration_minutes || 60;
      const rawSlots = await service.findFreeSlots(events, duration, intent.preferences || {}, {
        targetPeriod: intent.target_period || 'today',
        ...ctx
      });
      const validSlots = rawSlots.filter(slot =>
        !events.some(ev => !ev.allDay && slotsOverlap(slot, ev))
      );
      slotOptions = {
        slots: validSlots.slice(0, 3),
        title: intent.title,
        duration,
        attendees: intent.attendees || []
      };
      if (validSlots.length > 0) {
        const n = validSlots.length;
        reply = `Found ${n} option${n > 1 ? 's' : ''} for you:`;
      } else {
        reply = "I couldn't find any free time in that window. Try a different day?";
      }
    } catch (err) {
      console.error('[assistant] findFreeSlots error:', err.message);
      slotOptions = { slots: [], title: intent.title, duration: intent.duration_minutes || 60, attendees: intent.attendees || [] };
      reply = "Couldn't check your calendar for free time. Please try again.";
    }
  }

  if (intent.action === 'query') {
    try {
      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);
      // Default to today when AI doesn't extract a concrete date
      const d = (intent.date_known && intent.start_time) ? new Date(intent.start_time) : new Date();
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

  return { intent, reply, conflicts, suggestions, candidates, queryResults, loopIterations, updateProposal, batchPlan, slotOptions };
}

function handle429(err, res, next) {
  const msg = String(err.message || '');
  const is429 = err.status === 429 || err.statusCode === 429 ||
                msg.includes('429') || msg.toLowerCase().includes('resource_exhausted');
  if (is429) {
    res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
    return true;
  }
  return false;
}

async function runParse(req, res, next) {
  try {
    if (!req.body.forcedIntent) {
      const msg = validateMessage(req, res);
      if (!msg) return;
    }
    const result = await computeParseResult(req);
    res.json(result);
  } catch (err) {
    console.error('[assistant] AI service error:', err.status, err.statusCode, err.message);
    if (!handle429(err, res, next)) next(err);
  }
}

router.post('/parse', runParse);
router.post('/chat', runParse);

// ── POST /api/assistant/voice-parse ───────────────────────────────────────────

// Single-token shortcuts — skip the LLM for unambiguous one-word responses
const QUICK_CONFIRM = new Set(['yes', 'yep', 'yeah', 'sure', 'ok', 'okay', 'confirm', 'correct', 'right', 'great', 'perfect', 'absolutely']);
const QUICK_CANCEL  = new Set(['no', 'nope', 'cancel', 'nevermind']);

function quickClassify(msg) {
  const w = msg.toLowerCase().trim().replace(/[.!?,]+$/, '');
  if (QUICK_CONFIRM.has(w)) return 'confirm';
  if (QUICK_CANCEL.has(w)) return 'cancel';
  return null;
}

const FOLLOWUP_DONE_RE = /^no\b|^(exit|goodbye|bye|done|that'?s\s+(it|all)|i'?m\s+done)\b/i;

router.post('/voice-parse', async (req, res, next) => {
  try {
    const message = validateMessage(req, res);
    if (!message) return;

    const timezone = (typeof req.body.timezone === 'string') ? req.body.timezone : 'UTC';

    // 0. Followup interceptor — fires after a completed action when the bot asked "Is there anything else?"
    if (req.session.voiceAwaitingFollowup) {
      req.session.voiceAwaitingFollowup = false;
      const quick = quickClassify(message);
      if (quick === 'cancel' || FOLLOWUP_DONE_RE.test(message)) {
        return res.json({
          speechReply: "Alright! Have a great day.",
          rawIntent: null,
          audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false, exitLoop: true }
        });
      }
      // else: user has another request — fall through to normal parse
    }

    // 1. Option picker — structured spoken-index pattern; no LLM needed
    const optionIdx = parseOptionIndex(message);
    if (optionIdx !== -1 && req.session.voiceActiveOptions) {
      const { type, items } = req.session.voiceActiveOptions;
      const selected = items[optionIdx];

      if (!selected) {
        return res.json({
          speechReply: `I don't have an option ${optionIdx + 1}. Please try saying option one, two, or three.`,
          rawIntent: null,
          audioMetadata: { waitForInput: true, inputExpectation: 'option_selection', clearToListen: true }
        });
      }

      const { accessToken, refreshToken } = req.user;
      const calService = new GoogleCalendarService(accessToken, refreshToken);

      if (type === 'slots') {
        const slotCtx = req.session.voiceSlotContext || {};
        const intent = {
          action: 'create',
          title: slotCtx.title || 'Event',
          start_time: selected.start_time,
          end_time: selected.end_time,
          duration_minutes: slotCtx.duration || 60,
          attendees: slotCtx.attendees || [],
          location: null,
          confidence: 1.0,
        };
        const event = await calService.createEvent(intent);
        req.session.voiceActiveOptions = null;
        req.session.voiceSlotContext = null;
        req.session.voiceAwaitingFollowup = true;
        return res.json({
          speechReply: `Done! I've scheduled "${event.title}". Is there anything else?`,
          rawIntent: intent,
          audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false }
        });
      }

      if (type === 'suggestions') {
        const baseDraft = req.session.voiceDraftIntent || {};
        const intent = { ...baseDraft, action: 'create', start_time: selected.start_time, end_time: selected.end_time };
        const event = await calService.createEvent(intent);
        req.session.voiceDraftIntent = null;
        req.session.voiceActiveOptions = null;
        req.session.voiceAwaitingFollowup = true;
        return res.json({
          speechReply: `Done! I've scheduled "${event.title}". Is there anything else?`,
          rawIntent: intent,
          audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false }
        });
      }

      if (type === 'update_candidates') {
        const savedIntent = req.session.voiceDraftUpdateIntent;
        if (!savedIntent) {
          req.session.voiceActiveOptions = null;
          return res.json({
            speechReply: "Sorry, I lost track of what you wanted to update. Can you describe the change again?",
            rawIntent: null,
            audioMetadata: { waitForInput: true, inputExpectation: 'open_ended', clearToListen: true }
          });
        }
        // Run the fast-path: forcedIntent + candidateId bypasses AI re-parsing and re-search
        req.body.forcedIntent = savedIntent;
        req.body.candidateId = selected.id;
        const fastResult = await computeParseResult(req);
        delete req.body.forcedIntent;
        delete req.body.candidateId;

        req.session.voiceActiveOptions = null;
        req.session.voiceDraftUpdateIntent = null;
        if (fastResult.updateProposal) {
          req.session.voiceDraftUpdateProposal = fastResult.updateProposal;
        }
        return res.json({
          speechReply: buildSpeechReply(fastResult, timezone),
          rawIntent: fastResult.intent,
          audioMetadata: buildAudioMetadata(fastResult),
        });
      }
    }

    // 2. Pending-state handler — when a draft or option set is waiting for user input,
    //    use the LLM to classify intent (handles any natural-language confirm/cancel).
    //    Quick single-token check first to avoid unnecessary API round-trips.
    const hasPendingDraft = req.session.voiceDraftIntent || req.session.voiceDraftUpdateProposal || req.session.voiceDraftDeleteCandidate;
    const hasPendingState = hasPendingDraft || req.session.voiceActiveOptions;

    if (hasPendingState) {
      const aiService = new AIService();
      let classification = quickClassify(message);
      if (!classification) {
        classification = await aiService.classifyConfirmation(message);
      }

      if (classification === 'confirm' && hasPendingDraft) {
        const { accessToken, refreshToken } = req.user;
        const calService = new GoogleCalendarService(accessToken, refreshToken);

        if (req.session.voiceDraftIntent) {
          const draftIntent = req.session.voiceDraftIntent;
          const event = await calService.createEvent(draftIntent);
          req.session.voiceDraftIntent = null;
          req.session.voiceActiveOptions = null;
          req.session.voiceDraftUpdateProposal = null;
          req.session.voiceAwaitingFollowup = true;
          return res.json({
            speechReply: `Done! I've scheduled "${event.title}". Is there anything else?`,
            rawIntent: draftIntent,
            audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false }
          });
        }

        if (req.session.voiceDraftUpdateProposal) {
          const proposal = req.session.voiceDraftUpdateProposal;
          await calService.updateEvent(proposal.candidate.id, proposal.patches);
          req.session.voiceDraftUpdateProposal = null;
          req.session.voiceActiveOptions = null;
          req.session.voiceDraftIntent = null;
          req.session.voiceDraftUpdateIntent = null;
          req.session.voiceAwaitingFollowup = true;
          return res.json({
            speechReply: `Done! I've updated "${proposal.candidate.title}". Is there anything else?`,
            rawIntent: null,
            audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false }
          });
        }

        if (req.session.voiceDraftDeleteCandidate) {
          const candidate = req.session.voiceDraftDeleteCandidate;
          await calService.deleteEvent(candidate.id);
          req.session.voiceDraftDeleteCandidate = null;
          req.session.voiceActiveOptions = null;
          req.session.voiceDraftIntent = null;
          req.session.voiceAwaitingFollowup = true;
          return res.json({
            speechReply: `Done! I've deleted "${candidate.title}". Is there anything else?`,
            rawIntent: null,
            audioMetadata: { waitForInput: false, inputExpectation: 'none', clearToListen: false }
          });
        }
      }

      if (classification === 'cancel') {
        req.session.voiceDraftIntent = null;
        req.session.voiceActiveOptions = null;
        req.session.voiceSlotContext = null;
        req.session.voiceDraftUpdateProposal = null;
        req.session.voiceDraftUpdateIntent = null;
        req.session.voiceDraftDeleteCandidate = null;
        return res.json({
          speechReply: "Okay, cancelled. What would you like to do?",
          rawIntent: null,
          audioMetadata: { waitForInput: true, inputExpectation: 'open_ended', clearToListen: true, clearHistory: true }
        });
      }

      // 'other' or 'confirm' with no matching draft — treat as a new request.
      // Clear draft so the confirm loop doesn't persist across turns.
      req.session.voiceDraftIntent = null;
      req.session.voiceDraftUpdateProposal = null;
      req.session.voiceDraftUpdateIntent = null;
      req.session.voiceDraftDeleteCandidate = null;
      // voiceActiveOptions left intact — context for normal parse
    }

    // 3. Normal fallthrough — run standard parse logic
    const parseResult = await computeParseResult(req);

    // 4. Store delete candidate for single-event deletion confirmation
    if (parseResult.intent?.action === 'delete' && parseResult.candidates?.length === 1) {
      req.session.voiceDraftDeleteCandidate = parseResult.candidates[0];
    } else {
      req.session.voiceDraftDeleteCandidate = null;
    }

    // 5. Store state for future interceptors on this session
    const intentReady = parseResult.intent?.action === 'create' &&
      parseResult.intent.date_known &&
      parseResult.intent.time_known &&
      parseResult.intent.title &&
      parseResult.intent.confidence >= 0.5 &&
      !parseResult.conflicts?.length &&
      !parseResult.batchPlan;
    req.session.voiceDraftIntent = intentReady ? parseResult.intent : null;

    // Store update proposal for binary affirmation on next "yes"
    req.session.voiceDraftUpdateProposal = parseResult.updateProposal || null;

    if (parseResult.slotOptions?.slots?.length > 0) {
      req.session.voiceActiveOptions = { type: 'slots', items: parseResult.slotOptions.slots };
      req.session.voiceSlotContext = {
        title: parseResult.slotOptions.title,
        duration: parseResult.slotOptions.duration,
        attendees: parseResult.slotOptions.attendees,
      };
    } else if (parseResult.suggestions?.length > 0) {
      req.session.voiceActiveOptions = { type: 'suggestions', items: parseResult.suggestions };
      req.session.voiceSlotContext = null;
    } else if (parseResult.candidates?.length > 1 && parseResult.intent?.action === 'update') {
      req.session.voiceActiveOptions = { type: 'update_candidates', items: parseResult.candidates };
      req.session.voiceDraftUpdateIntent = parseResult.intent;
      req.session.voiceSlotContext = null;
    } else {
      req.session.voiceActiveOptions = null;
      req.session.voiceSlotContext = null;
    }

    // 6. Wrap response in audio-optimized format
    res.json({
      speechReply: buildSpeechReply(parseResult, timezone),
      rawIntent: parseResult.intent,
      audioMetadata: buildAudioMetadata(parseResult),
    });
  } catch (err) {
    console.error('[assistant] voice-parse error:', err.status, err.statusCode, err.message);
    if (!handle429(err, res, next)) next(err);
  }
});

// ── POST /api/assistant/confirm ───────────────────────────────────────────────

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

router.post('/confirm-batch', async (req, res, next) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events array is required and must be non-empty' });
    }

    const { accessToken, refreshToken } = req.user;
    const calService = new GoogleCalendarService(accessToken, refreshToken);
    const results = [];

    for (const event of events) {
      try {
        const created = await calService.createEvent(event);
        results.push({ status: 'created', event: created });
      } catch (err) {
        results.push({ status: 'failed', event, error: err.message });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const failed  = results.filter(r => r.status === 'failed').length;
    const summary = failed === 0
      ? `Created all ${created} events`
      : `Created ${created} of ${events.length} — ${failed} failed`;

    res.json({ results, summary });
  } catch (err) {
    next(err);
  }
});

router.post('/suggest', (req, res) => {
  res.status(501).json({ message: 'not implemented' });
});

module.exports = router;
