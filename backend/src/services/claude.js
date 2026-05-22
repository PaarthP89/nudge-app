const Groq = require('groq-sdk');

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

function buildParsePrompt(now, timezone) {
  return `You are a scheduling intent parser for a calendar assistant called Nudge.
Extract scheduling intent from the user's natural language message and return ONLY a valid JSON object — no markdown, no code fences, no explanation.

Current date/time: ${now}
User's timezone: ${timezone}

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
  "time_known": boolean
}

Rules:
- date_known: true ONLY if user explicitly mentioned a specific day/date ("tomorrow", "Friday", "May 23", "next week"). False otherwise.
- time_known: true ONLY if user explicitly mentioned a specific clock time ("at 2pm", "10:30am", "noon", "midnight"). False otherwise.
- start_time: set to the resolved ISO datetime (with timezone offset) when date_known is true. If time_known is false, use midnight (T00:00:00) on that date as a placeholder. Set null if date_known is false.
- end_time: set only when explicitly stated. Include timezone offset.
- confidence: >= 0.8 only when action, title, date_known, and time_known are all true. <= 0.4 when multiple key details are missing.
- Set action to "unknown" if this is not a scheduling request.
- Resolve relative dates ("tomorrow", "next Friday") using the current date/time provided.
- attendees: use email addresses if given, otherwise display names.
- duration_minutes: infer from end_time - start_time if both present, or from an explicit duration like "1 hour".
- Always include the timezone offset in start_time and end_time (e.g. -04:00 for EDT).`;
}

// Strips optional markdown code fences, parses JSON, validates shape.
function normalizeClaudeResponse(rawText) {
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
    action:           parsed.action,
    title:            parsed.title            ?? null,
    start_time:       parsed.start_time       ?? null,
    end_time:         parsed.end_time         ?? null,
    duration_minutes: typeof parsed.duration_minutes === 'number' ? parsed.duration_minutes : null,
    attendees:        parsed.attendees,
    location:         parsed.location         ?? null,
    confidence:       Math.max(0, Math.min(1, parsed.confidence)),
    date_known:       Boolean(parsed.date_known),
    time_known:       Boolean(parsed.time_known),
  };
}

function buildIntentReply(intent) {
  if (intent.action === 'unknown' || intent.confidence < 0.3) {
    return (
      "I'm not sure what you'd like to schedule. " +
      'Try something like: "Schedule a 1-hour meeting with Alice tomorrow at 2pm."'
    );
  }

  if (intent.action === 'create') {
    const hasTitle = Boolean(intent.title);
    const hasDate  = Boolean(intent.date_known);
    const hasTime  = Boolean(intent.time_known);

    if (hasTitle && hasDate && hasTime) {
      return `Got it — I'll schedule "${intent.title}". Checking for conflicts now!`;
    }

    // Build the question based on what's missing
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
    // Nothing known
    return "What would you like to schedule, and when?";
  }

  const title = intent.title ? `"${intent.title}"` : 'that event';
  return `Got it — I'll ${intent.action} ${title}.`;
}

// ─── Service class ────────────────────────────────────────────────────────────

class ClaudeService {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.modelName = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
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
      return normalizeClaudeResponse(rawText);
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

  async generateResponse(intent, conflicts) {
    throw new Error('not implemented');
  }

  async suggestSlots(constraints, existingEvents) {
    throw new Error('not implemented');
  }

  async chat(messages, systemContext) {
    throw new Error('not implemented');
  }
}

module.exports = ClaudeService;
module.exports.buildParsePrompt = buildParsePrompt;
module.exports.normalizeClaudeResponse = normalizeClaudeResponse;
module.exports.buildIntentReply = buildIntentReply;
