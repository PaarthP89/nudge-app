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
    confidence: 0.95
  };

  it('parses a well-formed JSON string', () => {
    const result = normalizeClaudeResponse(JSON.stringify(base));
    expect(result).toMatchObject({
      action: 'create',
      title: 'Team standup',
      confidence: 0.95,
      attendees: ['alice@example.com']
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
});

describe('normalizeClaudeResponse — malformed input', () => {
  it('throws on invalid JSON', () => {
    expect(() => normalizeClaudeResponse('not json at all')).toThrow();
  });

  it('throws on JSON missing confidence', () => {
    const bad = { action: 'create', attendees: [] };
    expect(() => normalizeClaudeResponse(JSON.stringify(bad))).toThrow(/confidence/);
  });

  it('throws when attendees is not an array', () => {
    const bad = { action: 'create', attendees: 'alice', confidence: 0.9 };
    expect(() => normalizeClaudeResponse(JSON.stringify(bad))).toThrow(/attendees/);
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

const highConfidentIntent = {
  action: 'create',
  title: 'Sprint planning',
  start_time: '2026-05-23T10:00:00Z',
  end_time: null,
  duration_minutes: 60,
  attendees: [],
  location: null,
  confidence: 0.9
};

describe('buildIntentReply', () => {
  it('returns a confirmation string for high-confidence create intent', () => {
    const reply = buildIntentReply(highConfidentIntent);
    expect(typeof reply).toBe('string');
    expect(reply).toMatch(/schedule/i);
    expect(reply).toMatch(/"Sprint planning"/);
  });

  it('uses the action verb for non-create actions', () => {
    const reply = buildIntentReply({ ...highConfidentIntent, action: 'delete' });
    expect(reply).toMatch(/delete/i);
  });

  it('returns clarification request when confidence < 0.5', () => {
    const reply = buildIntentReply({ ...highConfidentIntent, confidence: 0.4 });
    expect(reply).toMatch(/not quite sure/i);
    expect(reply).toMatch(/more specific/i);
  });

  it('returns clarification request when action is unknown', () => {
    const reply = buildIntentReply({ ...highConfidentIntent, action: 'unknown', confidence: 0.9 });
    expect(reply).toMatch(/not quite sure/i);
  });

  it('handles null title gracefully', () => {
    const reply = buildIntentReply({ ...highConfidentIntent, title: null });
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
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
    ['action', 'title', 'start_time', 'end_time', 'duration_minutes', 'attendees', 'location', 'confidence']
      .forEach(field => expect(prompt).toContain(field));
  });
});
