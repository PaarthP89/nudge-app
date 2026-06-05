const { stripMarkdown, normalizeVocalDate, flattenOptionsToSpeech } = require('../../src/services/speechUtils');

describe('stripMarkdown', () => {
  it('completely sanitizes structural text', () => {
    const input = '**Bold text** and *italic*\n- Bullet one\n- Bullet two\n> A quote\n`code`';
    const result = stripMarkdown(input);

    expect(result).not.toMatch(/\*/);
    expect(result).not.toMatch(/`/);
    expect(result).not.toMatch(/\n/);

    expect(result).toContain('Bold text');
    expect(result).toContain('italic');
    expect(result).toContain('Bullet one');
    expect(result).toContain('Bullet two');
    expect(result).toContain('A quote');
    expect(result).toContain('code');
  });

  it('leaves plain text untouched', () => {
    const input = 'Hello world, how are you?';
    expect(stripMarkdown(input)).toBe('Hello world, how are you?');
  });
});

describe('normalizeVocalDate', () => {
  it('generates human-friendly datetime strings', () => {
    // 2026-06-05T17:00:00.000Z in UTC = Friday, June 5th at 5:00 PM
    const result = normalizeVocalDate('2026-06-05T17:00:00.000Z', 'UTC');

    expect(result).toMatch(/Friday/);
    expect(result).toMatch(/June/);
    expect(result).toMatch(/5th/);
    expect(result).toMatch(/5:00 PM/);
  });

  it('applies ordinal suffix correctly', () => {
    // June 1st, June 2nd, June 3rd, June 21st
    expect(normalizeVocalDate('2026-06-01T12:00:00.000Z', 'UTC')).toMatch(/1st/);
    expect(normalizeVocalDate('2026-06-02T12:00:00.000Z', 'UTC')).toMatch(/2nd/);
    expect(normalizeVocalDate('2026-06-03T12:00:00.000Z', 'UTC')).toMatch(/3rd/);
    expect(normalizeVocalDate('2026-06-21T12:00:00.000Z', 'UTC')).toMatch(/21st/);
    expect(normalizeVocalDate('2026-06-11T12:00:00.000Z', 'UTC')).toMatch(/11th/);
    expect(normalizeVocalDate('2026-06-12T12:00:00.000Z', 'UTC')).toMatch(/12th/);
  });
});

describe('flattenOptionsToSpeech', () => {
  it('verbalizes 3-slot arrays with correct Option numbering', () => {
    const slots = [
      { start_time: '2026-06-05T09:00:00', end_time: '2026-06-05T11:00:00', label: '2 hours free', score: 90 },
      { start_time: '2026-06-05T13:00:00', end_time: '2026-06-05T15:00:00', label: 'after lunch', score: 75 },
      { start_time: '2026-06-05T16:00:00', end_time: '2026-06-05T18:00:00', label: 'afternoon block', score: 60 },
    ];
    const result = flattenOptionsToSpeech(slots, 'slots');

    expect(result).toMatch(/Option one/i);
    expect(result).toMatch(/Option two/i);
    expect(result).toMatch(/option three/i);
    expect(result).toMatch(/Which one works\?/i);
  });

  it('handles a single-slot array gracefully', () => {
    const slots = [
      { start_time: '2026-06-05T09:00:00', end_time: '2026-06-05T10:00:00', label: 'morning block', score: 85 },
    ];
    const result = flattenOptionsToSpeech(slots, 'slots');

    expect(result).toMatch(/one opening/i);
    expect(result).toMatch(/Would you like to go with that\?/i);
  });

  it('handles a two-option array gracefully', () => {
    const slots = [
      { start_time: '2026-06-05T09:00:00', end_time: '2026-06-05T10:00:00', label: 'morning', score: 85 },
      { start_time: '2026-06-05T14:00:00', end_time: '2026-06-05T15:00:00', label: 'afternoon', score: 70 },
    ];
    const result = flattenOptionsToSpeech(slots, 'slots');

    expect(result).toMatch(/Option one/i);
    expect(result).toMatch(/And option two/i);
    expect(result).toMatch(/Which one works\?/i);
  });

  it('handles empty array gracefully', () => {
    const result = flattenOptionsToSpeech([], 'slots');
    expect(result).toMatch(/couldn't find/i);
  });

  it('formats event-type arrays with title and time', () => {
    const events = [
      { summary: 'Team standup', start: { dateTime: '2026-06-05T09:00:00' }, end: { dateTime: '2026-06-05T09:30:00' } },
      { summary: 'Dentist', start: { dateTime: '2026-06-05T14:00:00' }, end: { dateTime: '2026-06-05T15:00:00' } },
    ];
    const result = flattenOptionsToSpeech(events, 'events');

    expect(result).toContain('Team standup');
    expect(result).toContain('Dentist');
    expect(result).toMatch(/Option one/i);
    expect(result).toMatch(/And option two/i);
  });

  it('handles Google Calendar normalized events where start is a plain ISO string', () => {
    // Google Calendar service returns events with start: 'ISO string', not start: { dateTime: '...' }
    const events = [
      { title: 'Team standup', start: '2026-06-05T09:00:00Z', end: '2026-06-05T09:30:00Z' },
      { title: 'Dentist', start: '2026-06-05T14:00:00Z', end: '2026-06-05T15:00:00Z' },
    ];
    const result = flattenOptionsToSpeech(events, 'events', 'UTC');

    expect(result).toContain('Team standup');
    expect(result).toContain('Dentist');
    // Must include date info — not just silently drop it because start isn't an object
    expect(result).toMatch(/Friday/i);   // 2026-06-05 is a Friday
    expect(result).toMatch(/9:00 AM/i);
    expect(result).toMatch(/2:00 PM/i);
  });

  it('disambiguates same-title events with distinct dates and times', () => {
    // All three are titled "workout" but on different days — without date info they are indistinguishable
    const events = [
      { title: 'workout', start_time: '2026-06-02T09:00:00Z' },  // Tuesday
      { title: 'workout', start_time: '2026-06-04T16:00:00Z' },  // Thursday
      { title: 'workout', start_time: '2026-06-05T11:00:00Z' },  // Friday
    ];
    const result = flattenOptionsToSpeech(events, 'events', 'UTC');

    expect(result).toMatch(/Option one/i);
    expect(result).toMatch(/Option two/i);
    expect(result).toMatch(/option three/i);
    // Each option must include a weekday name so the user can distinguish them by ear
    expect(result).toMatch(/Tuesday/i);
    expect(result).toMatch(/Thursday/i);
    expect(result).toMatch(/Friday/i);
    // All options still include the shared title
    const workoutCount = (result.match(/workout/gi) || []).length;
    expect(workoutCount).toBeGreaterThanOrEqual(3);
  });
});
