const Groq = require('groq-sdk');

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

function buildParsePrompt(now, timezone) {
  return `You are an intent parser for Nudge, an AI calendar assistant. Your job is to classify what the user wants to do with their calendar and extract the relevant details. Return ONLY a valid JSON object — no markdown, no code fences, no explanation.

Current date/time: ${now}
User's timezone: ${timezone}

Valid actions:
- "create"  — user wants to schedule, add, or book a new event
- "delete"  — user wants to remove, cancel, or delete an existing event
- "update"  — user wants to move, reschedule, or change an existing event
- "query"   — user wants to know what is on their calendar
- "unknown" — message has nothing to do with calendar management

Return this exact JSON schema (all fields required):
{
  "action": "create" | "delete" | "update" | "query" | "unknown",
  "title": string | null,
  "start_time": ISO 8601 datetime string with timezone offset | null,
  "end_time": ISO 8601 datetime string with timezone offset | null,
  "duration_minutes": number | null,
  "attendees": string[],
  "location": string | null,
  "confidence": number between 0.0 and 1.0,
  "date_known": boolean,
  "time_known": boolean,
  "recurrence": null | { "type": "daily" | "weekly" | "custom", "days": string[], "count": number | null, "until": string | null, "interval": number }
}
- recurrence: set for recurring/repeating create events; null for all other events.
- recurrence.days: specific days of week (e.g. ["Monday","Wednesday","Friday"]); empty array for daily.
- recurrence.count: total number of instances (e.g. 5 for a work week); null if not specified.

For update action, also include these fields (omit or null for other actions):
{
  "title_hint": string | null,
  "time_hint": string | null,
  "day_hint": string | null,
  "new_title": string | null,
  "new_date": string | null,
  "new_time": string | null,
  "preserve_time": boolean,
  "duration_delta_minutes": number | null,
  "start_delta_minutes": number | null
}
- title_hint: fuzzy title of the event to find on the calendar (different from new_title)
- time_hint: current time of the event to find, e.g. "3pm" (used for candidate search)
- day_hint: current day of the event to find, e.g. "Tuesday" (used for candidate search)
- new_title: replacement title when renaming
- preserve_time: true when moving to a new date but keeping the same time of day
- duration_delta_minutes: minutes to add (positive) or remove (negative) from the event duration
- start_delta_minutes: minutes to shift the start time forward (positive) or backward (negative)

Rules:
- date_known: true ONLY if user explicitly mentioned a specific day/date ("tomorrow", "Sunday", "May 23", "next week"). False otherwise.
- time_known: true ONLY if user explicitly mentioned a specific clock time ("at 2pm", "10:30am", "noon"). False otherwise.
- start_time: set to the resolved ISO datetime (with timezone offset) when date_known is true. If time_known is false, use midnight (T00:00:00) on that date as a placeholder. Set null if date_known is false.
- end_time: set only when explicitly stated. Include timezone offset.
- confidence for "create": >= 0.8 requires title + date_known + time_known. <= 0.4 when multiple details are missing.
- confidence for "delete" / "update": >= 0.75 when date_known && time_known are both true (title is NOT required — time alone identifies the event). >= 0.5 when only date or title is known.
- confidence for "query": >= 0.75 when a date or time range is mentioned. >= 0.5 when query is general.
- Set action to "unknown" ONLY when the message has absolutely nothing to do with calendar management (e.g. "what is 2+2", "tell me a joke").
- Resolve relative dates ("tomorrow", "next Friday", "Sunday") using the current date/time provided above.
- attendees: use email addresses if given, otherwise display names.
- duration_minutes: infer from end_time - start_time if both present, or from an explicit duration like "1 hour".
- Always include the timezone offset in start_time and end_time (e.g. -07:00 for PDT).

Action mapping examples — natural language varies widely, map it correctly:
- "can you delete my meeting tomorrow?" → action: "delete"
- "remove the 2:30pm call on Sunday" → action: "delete"
- "cancel my standup Friday at 9am" → action: "delete"
- "get rid of the dentist appointment" → action: "delete"
- "what's on my calendar Sunday?" → action: "query"
- "do I have anything tomorrow afternoon?" → action: "query"
- "show me my Friday schedule" → action: "query"
- "what do I have this week?" → action: "query"
- "move my 3pm to 4pm tomorrow" → action: "update", time_hint: "3pm", start_delta_minutes: 60
- "reschedule the standup to next Tuesday" → action: "update", title_hint: "standup", new_date: "next Tuesday"
- "move my dentist to next Thursday at the same time" → action: "update", title_hint: "dentist", new_date: "next Thursday", preserve_time: true
- "make my 3pm meeting an hour longer" → action: "update", time_hint: "3pm", duration_delta_minutes: 60
- "rename my standup to team sync" → action: "update", title_hint: "standup", new_title: "team sync"
- "push my 2pm back an hour" → action: "update", time_hint: "2pm", start_delta_minutes: 60
- "book a 1-hour call with Alice next Monday at noon" → action: "create"
- "schedule a dentist appointment Thursday at 9am" → action: "create"
- "set up a team lunch Friday at 12:30" → action: "create"
- "workout every weekday next week at 6am for 1 hour" → action: "create", title: "workout", recurrence: {"type":"weekly","days":["Monday","Tuesday","Wednesday","Thursday","Friday"],"count":5,"until":null,"interval":1}
- "standup Mon/Wed/Fri for 2 weeks at 9am 30min" → action: "create", title: "standup", recurrence: {"type":"custom","days":["Monday","Wednesday","Friday"],"count":6,"until":null,"interval":1}`;
}

// Strips optional markdown code fences, parses JSON, validates shape.
function normalizeAIResponse(rawText) {
  let text = rawText.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  const parsed = JSON.parse(text); // throws SyntaxError on invalid JSON

  if (typeof parsed.confidence !== 'number') {
    throw new Error('AI response missing numeric confidence field');
  }
  if (!Array.isArray(parsed.attendees)) {
    throw new Error('AI response attendees must be an array');
  }
  const VALID_ACTIONS = ['create', 'delete', 'update', 'query', 'unknown'];
  if (!VALID_ACTIONS.includes(parsed.action)) {
    throw new Error(`Unexpected action value: ${parsed.action}`);
  }

  return {
    action:                 parsed.action,
    title:                  parsed.title            ?? null,
    start_time:             parsed.start_time       ?? null,
    end_time:               parsed.end_time         ?? null,
    duration_minutes:       typeof parsed.duration_minutes === 'number' ? parsed.duration_minutes : null,
    attendees:              parsed.attendees,
    location:               parsed.location         ?? null,
    confidence:             Math.max(0, Math.min(1, parsed.confidence)),
    date_known:             Boolean(parsed.date_known),
    time_known:             Boolean(parsed.time_known),
    recurrence:             parsed.recurrence       ?? null,
    title_hint:             parsed.title_hint             ?? null,
    time_hint:              parsed.time_hint              ?? null,
    day_hint:               parsed.day_hint               ?? null,
    new_title:              parsed.new_title              ?? null,
    new_date:               parsed.new_date               ?? null,
    new_time:               parsed.new_time               ?? null,
    preserve_time:          Boolean(parsed.preserve_time),
    duration_delta_minutes: typeof parsed.duration_delta_minutes === 'number' ? parsed.duration_delta_minutes : null,
    start_delta_minutes:    typeof parsed.start_delta_minutes    === 'number' ? parsed.start_delta_minutes    : null,
  };
}

function buildIntentReply(intent) {
  // For non-create actions a lower confidence bar is fine — even partial info lets us search.
  const unknownThreshold = intent.action === 'create' ? 0.3 : 0.2;
  if (intent.action === 'unknown' || intent.confidence < unknownThreshold) {
    return (
      "I can help you schedule, delete, or look up calendar events. " +
      'Try: "Schedule a meeting tomorrow at 2pm" or "Delete my 3pm standup on Friday."'
    );
  }

  if (intent.action === 'create') {
    const hasTitle = Boolean(intent.title);
    const hasDate  = Boolean(intent.date_known);
    const hasTime  = Boolean(intent.time_known);

    if (hasTitle && hasDate && hasTime) {
      return `Got it — I'll schedule "${intent.title}". Checking for conflicts now!`;
    }

    if (hasDate && hasTime && !hasTitle) {
      const d = new Date(intent.start_time);
      const when = d.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
      return `${when} — what should I call this event?`;
    }
    if (hasDate && !hasTime && hasTitle) {
      const d = new Date(intent.start_time);
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return `Got "${intent.title}" on ${dateStr} — what time should it be?`;
    }
    if (hasDate && !hasTime && !hasTitle) {
      const d = new Date(intent.start_time);
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return `${dateStr} — what time should it be, and what should I call it?`;
    }
    if (!hasDate && hasTime && hasTitle) {
      return `Got "${intent.title}" — what date?`;
    }
    if (!hasDate && hasTime && !hasTitle) {
      return "What date, and what should I call the event?";
    }
    if (!hasDate && !hasTime && hasTitle) {
      return `Got "${intent.title}" — when should I schedule it?`;
    }
    return "What would you like to schedule, and when?";
  }

  if (intent.action === 'update') {
    const hint = intent.title_hint ?? intent.title;
    if (hint) return `Looking for "${hint}" on your calendar…`;
    return "Looking for that event on your calendar…";
  }

  if (intent.action === 'query') {
    if (intent.date_known && intent.start_time) {
      const d = new Date(intent.start_time);
      const dateStr = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      return `Let me check your calendar for ${dateStr}…`;
    }
    return "Let me check your calendar…";
  }

  const title = intent.title ? `"${intent.title}"` : 'that event';
  return `Got it — I'll ${intent.action} ${title}.`;
}

// ─── Service class ────────────────────────────────────────────────────────────

class AIService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  async parseIntent(userInput, { now, timezone }) {
    const completion = await this.groq.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: buildParsePrompt(now, timezone) },
        { role: 'user', content: userInput }
      ],
      temperature: 0,
      max_tokens: 512
    });
    const rawText = completion.choices[0].message.content;
    try {
      return normalizeAIResponse(rawText);
    } catch (err) {
      if (err instanceof SyntaxError || err.message?.startsWith('AI response')) {
        return {
          action: 'unknown', title: null, start_time: null, end_time: null,
          duration_minutes: null, attendees: [], location: null, confidence: 0,
          date_known: false, time_known: false,
        };
      }
      throw err;
    }
  }

  async suggestSlots(intent, conflicts, options = {}) {
    const conflictDescriptions = conflicts.map(c => {
      const s = new Date(c.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const e = new Date(c.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `"${c.title}" (${s}–${e})`;
    }).join(', ');

    const duration = intent.duration_minutes || 60;
    const intentDate = new Date(intent.start_time);
    const dateStr = intentDate.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    const offsetMatch = intent.start_time.match(/([+-]\d{2}:\d{2})$/);
    const offset = offsetMatch ? offsetMatch[1] : 'Z';

    const systemPrompt = `You are a scheduling assistant. Return ONLY a valid JSON array of exactly 3 alternative time slot objects. No markdown, no explanation.
Each object must have exactly these fields: { "start_time": "ISO 8601 string with timezone offset ${offset}", "end_time": "ISO 8601 string with same offset", "label": "human-readable range like '2:00 PM – 3:00 PM'" }
Stay within working hours: 8am–7pm only. Prefer the same day first, then next 2 days.`;

    const excludeNote = options.excludeRanges && options.excludeRanges.length > 0
      ? `\nAlso avoid these times (already checked, also conflicted): ${options.excludeRanges.map(r => `${r.start}–${r.end}`).join(', ')}`
      : '';

    const userMsg = `I want to schedule a ${duration}-minute event on ${dateStr}.
These times are taken: ${conflictDescriptions}${excludeNote}
Suggest 3 other time slots on the same day, avoiding those conflicts.`;

    const completion = await this.groq.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      temperature: 0.3,
      max_tokens: 400
    });

    const rawText = completion.choices[0].message.content;
    let text = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, 3)
      .filter(s => s && s.start_time && s.end_time)
      .map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        label: s.label || new Date(s.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }));
  }

  async expandRecurrence(intent, { now = '', timezone = 'UTC' } = {}) {
    const systemPrompt = `You are a scheduling assistant. Expand a recurring event into individual instances.
Return ONLY a valid JSON array with no other text:
[{"title": "string", "start_time": "ISO8601 with timezone offset", "end_time": "ISO8601 with timezone offset"}]

Generate every instance as an explicit datetime — no recurrence rules, just the flat list.
Use the provided timezone. Do not skip any instances.

Examples:
- "5 weekday workouts at 6am for 1 hour" → 5 objects Mon–Fri each 06:00–07:00 with correct dates
- "standup Mon/Wed/Fri 2 weeks at 9am 30min" → 6 objects each 09:00–09:30 with correct dates`;

    const userMsg = `[INTENT: title="${intent.title || 'event'}" recurrence=${JSON.stringify(intent.recurrence)} duration=${intent.duration_minutes || 60}min]
[DATE: today is ${now}, timezone ${timezone}]
Expand into all individual instances.`;

    const completion = await this.groq.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      temperature: 0,
      max_tokens: 1024
    });

    const rawText = completion.choices[0].message.content;
    let text = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(inst => inst && inst.start_time && inst.end_time)
      .map(inst => ({
        title: inst.title || intent.title || 'event',
        start_time: inst.start_time,
        end_time: inst.end_time,
      }));
  }

  async chat(messages, { now, timezone }) {
    const completion = await this.groq.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: buildParsePrompt(now, timezone) },
        ...messages
      ],
      temperature: 0,
      max_tokens: 512
    });
    const rawText = completion.choices[0].message.content;
    try {
      return normalizeAIResponse(rawText);
    } catch (err) {
      if (err instanceof SyntaxError || err.message?.startsWith('AI response')) {
        return {
          action: 'unknown', title: null, start_time: null, end_time: null,
          duration_minutes: null, attendees: [], location: null, confidence: 0,
          date_known: false, time_known: false,
        };
      }
      throw err;
    }
  }
}

module.exports = AIService;
module.exports.buildParsePrompt = buildParsePrompt;
module.exports.normalizeAIResponse = normalizeAIResponse;
module.exports.buildIntentReply = buildIntentReply;
