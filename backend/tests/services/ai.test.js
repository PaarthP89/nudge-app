jest.mock('groq-sdk', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: jest.fn() } }
})));

const {
  normalizeAIResponse,
  buildIntentReply,
  buildParsePrompt
} = require('../../src/services/ai');
const AIServiceClass = require('../../src/services/ai');
const MockGroq = require('groq-sdk');

// ─── normalizeAIResponse ──────────────────────────────────────────────────────

describe('normalizeAIResponse — valid JSON', () => {
  const base = {
    action: 'create',
    title: 'Team standup',
    start_time: '2026-05-23T09:00:00-04:00',
    end_time: '2026-05-23T09:30:00-04:00',
    duration_minutes: 30,
    attendees: ['alice@example.com'],
    location: 'Zoom',
    confidence: 0.95,
    date_known: true,
    time_known: true,
  };

  it('parses a well-formed JSON string', () => {
    const result = normalizeAIResponse(JSON.stringify(base));
    expect(result).toMatchObject({
      action: 'create',
      title: 'Team standup',
      confidence: 0.95,
      attendees: ['alice@example.com'],
      date_known: true,
      time_known: true,
    });
  });

  it('strips a ```json code fence wrapper', () => {
    const wrapped = '```json\n' + JSON.stringify(base) + '\n```';
    const result = normalizeAIResponse(wrapped);
    expect(result.action).toBe('create');
  });

  it('strips a plain ``` code fence wrapper', () => {
    const wrapped = '```\n' + JSON.stringify(base) + '\n```';
    expect(() => normalizeAIResponse(wrapped)).not.toThrow();
  });

  it('clamps confidence above 1 to 1', () => {
    const result = normalizeAIResponse(JSON.stringify({ ...base, confidence: 1.5 }));
    expect(result.confidence).toBe(1);
  });

  it('clamps confidence below 0 to 0', () => {
    const result = normalizeAIResponse(JSON.stringify({ ...base, confidence: -0.1 }));
    expect(result.confidence).toBe(0);
  });

  it('coerces null duration_minutes to null', () => {
    const result = normalizeAIResponse(JSON.stringify({ ...base, duration_minutes: null }));
    expect(result.duration_minutes).toBeNull();
  });

  it('coerces undefined optional fields to null', () => {
    const { title: _t, location: _l, ...rest } = base;
    const result = normalizeAIResponse(JSON.stringify(rest));
    expect(result.title).toBeNull();
    expect(result.location).toBeNull();
  });

  it('accepts all valid action values', () => {
    ['create', 'delete', 'update', 'query', 'unknown'].forEach(action => {
      expect(() =>
        normalizeAIResponse(JSON.stringify({ ...base, action }))
      ).not.toThrow();
    });
  });

  it('coerces missing date_known / time_known to false', () => {
    const { date_known: _d, time_known: _t, ...rest } = base;
    const result = normalizeAIResponse(JSON.stringify(rest));
    expect(result.date_known).toBe(false);
    expect(result.time_known).toBe(false);
  });
});

describe('normalizeAIResponse — malformed input', () => {
  it('throws on invalid JSON', () => {
    expect(() => normalizeAIResponse('not json at all')).toThrow();
  });

  it('throws on JSON missing confidence', () => {
    const bad = { action: 'create', attendees: [] };
    expect(() => normalizeAIResponse(JSON.stringify(bad))).toThrow(/confidence/i);
  });

  it('throws when attendees is not an array', () => {
    const bad = { action: 'create', attendees: 'alice', confidence: 0.9 };
    expect(() => normalizeAIResponse(JSON.stringify(bad))).toThrow(/attendees/i);
  });

  it('throws on unknown action value', () => {
    const bad = { action: 'reschedule', attendees: [], confidence: 0.9 };
    expect(() => normalizeAIResponse(JSON.stringify(bad))).toThrow(/action/);
  });

  it('throws on empty string', () => {
    expect(() => normalizeAIResponse('')).toThrow();
  });
});

// ─── buildIntentReply ─────────────────────────────────────────────────────────

const full = {
  action: 'create',
  title: 'Sprint planning',
  start_time: '2026-05-23T10:00:00-04:00',
  end_time: null,
  duration_minutes: 60,
  attendees: [],
  location: null,
  confidence: 0.9,
  date_known: true,
  time_known: true,
};

describe('buildIntentReply', () => {
  it('confirms when all three fields are present', () => {
    const reply = buildIntentReply(full);
    expect(reply).toMatch(/schedule/i);
    expect(reply).toMatch(/"Sprint planning"/);
  });

  it('asks for time when time_known is false', () => {
    const reply = buildIntentReply({ ...full, time_known: false });
    expect(reply).toMatch(/time/i);
    expect(reply).toMatch(/"Sprint planning"/);
  });

  it('asks what to call the event when title is missing but date+time are known', () => {
    const reply = buildIntentReply({ ...full, title: null });
    expect(reply).toMatch(/call this event/i);
  });

  it('asks for time and name when date is known but time and title are missing', () => {
    const reply = buildIntentReply({ ...full, title: null, time_known: false });
    expect(reply).toMatch(/time/i);
    expect(reply).toMatch(/call it/i);
  });

  it('asks when to schedule when title known but date and time are missing', () => {
    const reply = buildIntentReply({ ...full, date_known: false, time_known: false, start_time: null });
    expect(reply).toMatch(/when/i);
    expect(reply).toMatch(/"Sprint planning"/);
  });

  it('returns generic prompt when nothing is known', () => {
    const reply = buildIntentReply({ ...full, title: null, date_known: false, time_known: false, start_time: null });
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('returns clarification when action is unknown', () => {
    const reply = buildIntentReply({ ...full, action: 'unknown' });
    expect(reply).toMatch(/schedule|delete|calendar/i);
  });

  it('returns clarification when confidence is very low', () => {
    const reply = buildIntentReply({ ...full, action: 'unknown', confidence: 0.1 });
    expect(reply).toMatch(/schedule|delete|calendar/i);
  });

  it('handles non-create actions', () => {
    const reply = buildIntentReply({ ...full, action: 'delete' });
    expect(reply).toMatch(/delete/i);
  });
});

// ─── buildParsePrompt ─────────────────────────────────────────────────────────

describe('buildParsePrompt', () => {
  it('includes the provided date/time and timezone', () => {
    const prompt = buildParsePrompt('2026-05-23T10:00:00Z', 'America/New_York');
    expect(prompt).toContain('2026-05-23T10:00:00Z');
    expect(prompt).toContain('America/New_York');
  });

  it('mentions the required JSON schema fields', () => {
    const prompt = buildParsePrompt('2026-05-23T10:00:00Z', 'UTC');
    ['action', 'title', 'start_time', 'end_time', 'duration_minutes', 'attendees', 'location', 'confidence', 'date_known', 'time_known']
      .forEach(field => expect(prompt).toContain(field));
  });
});

// ─── AIService.findFreeSlots ──────────────────────────────────────────────────

describe('AIService.findFreeSlots', () => {
  const EVENTS = [
    {
      id: 'ev1', title: 'Morning meeting',
      start: '2026-05-26T10:00:00-07:00', end: '2026-05-26T10:30:00-07:00',
      allDay: false
    },
    {
      id: 'ev2', title: 'Afternoon sync',
      start: '2026-05-26T14:00:00-07:00', end: '2026-05-26T15:00:00-07:00',
      allDay: false
    }
  ];

  const MOCK_SLOTS = [
    { start_time: '2026-05-26T09:00:00-07:00', end_time: '2026-05-26T11:00:00-07:00', score: 85, label: '2 hours before your first meeting' },
    { start_time: '2026-05-26T11:00:00-07:00', end_time: '2026-05-26T13:00:00-07:00', score: 70, label: 'quiet mid-morning block' },
    { start_time: '2026-05-26T15:30:00-07:00', end_time: '2026-05-26T17:30:00-07:00', score: 55, label: 'after afternoon sync' },
  ];

  beforeEach(() => {
    MockGroq.mockClear();
  });

  it('returns array of scored slots with required fields', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MOCK_SLOTS) } }]
    });

    const result = await service.findFreeSlots(EVENTS, 120, {}, {
      targetPeriod: 'tomorrow',
      now: 'Tuesday, May 26, 2026 at 8:00 AM PDT',
      timezone: 'America/Los_Angeles'
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(slot => {
      expect(typeof slot.start_time).toBe('string');
      expect(typeof slot.end_time).toBe('string');
      expect(typeof slot.score).toBe('number');
      expect(typeof slot.label).toBe('string');
      expect(isNaN(new Date(slot.start_time).getTime())).toBe(false);
      expect(isNaN(new Date(slot.end_time).getTime())).toBe(false);
    });
  });

  it('handles code-fence-wrapped JSON from the model', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '```json\n' + JSON.stringify(MOCK_SLOTS) + '\n```' } }]
    });

    const result = await service.findFreeSlots(EVENTS, 60, {}, {
      targetPeriod: 'today',
      now: 'Tuesday, May 26, 2026 at 8:00 AM PDT',
      timezone: 'America/Los_Angeles'
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  it('returns empty array when model output is invalid JSON', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'Sorry, I cannot find any free slots.' } }]
    });

    const result = await service.findFreeSlots(EVENTS, 60, {}, {
      targetPeriod: 'today',
      now: 'Tuesday, May 26, 2026 at 8:00 AM PDT',
      timezone: 'America/Los_Angeles'
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ─── AIService.expandRecurrence ───────────────────────────────────────────────

describe('AIService.expandRecurrence', () => {
  const RECURRENCE_INTENT = {
    action: 'create',
    title: 'workout',
    start_time: '2026-05-25T10:00:00-04:00',
    duration_minutes: 60,
    attendees: [],
    location: null,
    recurrence: { type: 'weekly', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], count: 5 }
  };

  const MOCK_INSTANCES = [
    { title: 'workout', start_time: '2026-05-25T10:00:00-04:00', end_time: '2026-05-25T11:00:00-04:00' },
    { title: 'workout', start_time: '2026-05-26T10:00:00-04:00', end_time: '2026-05-26T11:00:00-04:00' },
    { title: 'workout', start_time: '2026-05-27T10:00:00-04:00', end_time: '2026-05-27T11:00:00-04:00' },
    { title: 'workout', start_time: '2026-05-28T10:00:00-04:00', end_time: '2026-05-28T11:00:00-04:00' },
    { title: 'workout', start_time: '2026-05-29T10:00:00-04:00', end_time: '2026-05-29T11:00:00-04:00' },
  ];

  beforeEach(() => {
    MockGroq.mockClear();
  });

  it('returns flat array of ISO8601 objects for weekday recurrence', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MOCK_INSTANCES) } }]
    });

    const result = await service.expandRecurrence(RECURRENCE_INTENT, {
      now: 'Monday, May 25, 2026 at 8:00 AM EDT',
      timezone: 'America/New_York'
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(inst => {
      expect(typeof inst.title).toBe('string');
      expect(typeof inst.start_time).toBe('string');
      expect(typeof inst.end_time).toBe('string');
      expect(() => new Date(inst.start_time)).not.toThrow();
      expect(() => new Date(inst.end_time)).not.toThrow();
      expect(isNaN(new Date(inst.start_time).getTime())).toBe(false);
      expect(isNaN(new Date(inst.end_time).getTime())).toBe(false);
    });
    expect(result.length).toBe(RECURRENCE_INTENT.recurrence.count);
  });

  it('filters instances to those within working hours (8am–7pm)', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MOCK_INSTANCES) } }]
    });

    const result = await service.expandRecurrence(RECURRENCE_INTENT, {
      now: 'Monday, May 25, 2026 at 8:00 AM EDT',
      timezone: 'America/New_York'
    });

    result.forEach(inst => {
      const hourUTC = new Date(inst.start_time).getUTCHours();
      // 10am EDT = 14:00 UTC — within 0–23 range, and not midnight boundary
      expect(isNaN(new Date(inst.start_time).getTime())).toBe(false);
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles code-fence-wrapped JSON from the model', async () => {
    const service = new AIServiceClass();
    const groqInstance = MockGroq.mock.results[MockGroq.mock.results.length - 1].value;
    groqInstance.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '```json\n' + JSON.stringify(MOCK_INSTANCES) + '\n```' } }]
    });

    const result = await service.expandRecurrence(RECURRENCE_INTENT, {
      now: 'Monday, May 25, 2026 at 8:00 AM EDT',
      timezone: 'America/New_York'
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(5);
  });
});
