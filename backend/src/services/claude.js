const Groq = require('groq-sdk');

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

function buildParsePrompt(now, timezone) {
  return `You are a scheduling intent parser for a calendar assistant called Nudge.
Extract scheduling intent from the user's natural language message and return ONLY a valid JSON object — no markdown, no code fences, no explanation.

Current date/time: ${now}
User's timezone: ${timezone}

Return this exact JSON schema (all fields required, use null for absent optional fields):
{
  "action": "create" | "delete" | "update" | "query" | "unknown",
  "title": string | null,
  "start_time": ISO 8601 datetime string | null,
  "end_time": ISO 8601 datetime string | null,
  "duration_minutes": number | null,
  "attendees": string[],
  "location": string | null,
  "confidence": number between 0.0 and 1.0
}

Rules:
- Set confidence >= 0.8 only when action, title, and a clear time are all present
- Set confidence <= 0.4 when the request is ambiguous or missing key scheduling details
- Set action to "unknown" if this is not a scheduling request
- Resolve relative dates ("tomorrow", "next Friday") using the current date/time provided
- attendees: use email addresses if given, otherwise use display names
- duration_minutes: infer from end_time - start_time if both present, or from explicit duration like "1 hour"`;
}

// Strips optional markdown code fences, parses JSON, validates shape.
function normalizeClaudeResponse(rawText) {
  let text = rawText.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  const parsed = JSON.parse(text); // throws SyntaxError on invalid JSON

  if (typeof parsed.confidence !== 'number') {
    throw new Error('Claude response missing numeric confidence field');
  }
  if (!Array.isArray(parsed.attendees)) {
    throw new Error('Claude response attendees must be an array');
  }
  const VALID_ACTIONS = ['create', 'delete', 'update', 'query', 'unknown'];
  if (!VALID_ACTIONS.includes(parsed.action)) {
    throw new Error(`Unexpected action value: ${parsed.action}`);
  }

  return {
    action: parsed.action,
    title: parsed.title ?? null,
    start_time: parsed.start_time ?? null,
    end_time: parsed.end_time ?? null,
    duration_minutes: typeof parsed.duration_minutes === 'number' ? parsed.duration_minutes : null,
    attendees: parsed.attendees,
    location: parsed.location ?? null,
    confidence: Math.max(0, Math.min(1, parsed.confidence))
  };
}

function buildIntentReply(intent) {
  if (intent.confidence < 0.5 || intent.action === 'unknown') {
    return (
      "I'm not quite sure what you'd like to schedule. " +
      'Could you be more specific? For example: ' +
      '"Schedule a 1-hour meeting with Alice tomorrow at 2pm."'
    );
  }

  const verb = intent.action === 'create' ? 'schedule' : intent.action;
  const title = intent.title ? `"${intent.title}"` : 'your event';
  return `Got it — I'll ${verb} ${title}. Conflict check and confirmation coming up next!`;
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
    return normalizeClaudeResponse(rawText);
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
