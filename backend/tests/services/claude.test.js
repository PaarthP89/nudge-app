const {
  normalizeClaudeResponse,
  buildIntentReply,
  buildParsePrompt
} = require('../../src/services/claude');

// ─── normalizeClaudeResponse ──────────────────────────────────────────────────

describe('normalizeClaudeResponse — valid JSON', () => {
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
    const result = normalizeClaudeResponse(JSON.stringify(base));
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
    const result = normalizeClaudeResponse(wrapped);
    expect(result.action).toBe('create');
  });

  it('strips a plain ``` code fence wrapper', () => {
    const wrapped = '```\n' + JSON.stringify(base) + '\n```';
    expect(() => normalizeClaudeResponse(wrapped)).not.toThrow();
  });

  it('clamps confidence above 1 to 1', () => {
    const result = normalizeClaudeResponse(JSON.stringify({ ...base, confidence: 1.5 }));
    expect(result.confidence).toBe(1);
  });

  it('clamps confidence below 0 to 0', () => {
    const result = normalizeClaudeResponse(JSON.stringify({ ...base, confidence: -0.1 }));
    expect(result.confidence).toBe(0);
  });

  it('coerces null duration_minutes to null', () => {
    const result = normalizeClaudeResponse(JSON.stringify({ ...base, duration_minutes: null }));
    expect(result.duration_minutes).toBeNull();
  });

  it('coerces undefined optional fields to null', () => {
    const { title: _t, location: _l, ...rest } = base;
    const result = normalizeClaudeResponse(JSON.stringify(rest));
    expect(result.title).toBeNull();
    expect(result.location).toBeNull();
  });

  it('accepts all valid action values', () => {
    ['create', 'delete', 'update', 'query', 'unknown'].forEach(action => {
      expect(() =>
        normalizeClaudeResponse(JSON.stringify({ ...base, action }))
      ).not.toThrow();
    });
  });

  it('coerces missing date_known / time_known to false', () => {
    const { date_known: _d, time_known: _t, ...rest } = base;
    const result = normalizeClaudeResponse(JSON.stringify(rest));
    expect(result.date_known).toBe(false);
    expect(result.time_known).toBe(false);
  });
});

describe('normalizeClaudeResponse — malformed input', () => {
  it('throws on invalid JSON', () => {
    expect(() => normalizeClaudeResponse('not json at all')).toThrow();
  });

  it('throws on JSON missing confidence', () => {
    const bad = { action: 'create', attendees: [] };
    expect(() => normalizeClaudeResponse(JSON.stringify(bad))).toThrow(/confidence/i);
  });

  it('throws when attendees is not an array', () => {
    const bad = { action: 'create', attendees: 'alice', confidence: 0.9 };
    expect(() => normalizeClaudeResponse(JSON.stringify(bad))).toThrow(/attendees/i);
  });

  it('throws on unknown action value', () => {
    const bad = { action: 'reschedule', attendees: [], confidence: 0.9 };
    expect(() => normalizeClaudeResponse(JSON.stringify(bad))).toThrow(/action/);
  });

  it('throws on empty string', () => {
    expect(() => normalizeClaudeResponse('')).toThrow();
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
    expect(reply).toMatch(/not sure/i);
  });

  it('returns clarification when confidence is very low', () => {
    const reply = buildIntentReply({ ...full, action: 'unknown', confidence: 0.1 });
    expect(reply).toMatch(/not sure/i);
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
