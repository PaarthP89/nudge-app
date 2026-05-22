const { normalizeEvent } = require('../../src/services/googleCalendar');

describe('normalizeEvent — timed events', () => {
  it('normalizes a standard timed event', () => {
    const raw = {
      id: 'abc123',
      summary: 'Team standup',
      start: { dateTime: '2026-05-22T09:00:00-07:00' },
      end: { dateTime: '2026-05-22T09:30:00-07:00' },
      status: 'confirmed',
      location: 'Zoom',
      description: 'Daily standup',
      colorId: '2',
      attendees: [
        { email: 'alice@example.com', displayName: 'Alice', self: false },
        { email: 'bob@example.com', self: true }
      ]
    };
    expect(normalizeEvent(raw)).toEqual({
      id: 'abc123',
      title: 'Team standup',
      start: '2026-05-22T09:00:00-07:00',
      end: '2026-05-22T09:30:00-07:00',
      allDay: false,
      location: 'Zoom',
      description: 'Daily standup',
      colorId: '2',
      attendees: [
        { email: 'alice@example.com', displayName: 'Alice', self: false },
        { email: 'bob@example.com', displayName: null, self: true }
      ],
      status: 'confirmed',
      recurringEventId: null
    });
  });

  it('sets allDay false when dateTime is present even if date is also present', () => {
    const raw = {
      id: 'x',
      start: { date: '2026-05-22', dateTime: '2026-05-22T09:00:00Z' },
      end: { dateTime: '2026-05-22T10:00:00Z' }
    };
    expect(normalizeEvent(raw).allDay).toBe(false);
  });
});

describe('normalizeEvent — all-day events', () => {
  it('normalizes a single all-day event', () => {
    const raw = {
      id: 'def456',
      summary: 'Company holiday',
      start: { date: '2026-05-25' },
      end: { date: '2026-05-26' },
      status: 'confirmed'
    };
    const result = normalizeEvent(raw);
    expect(result.allDay).toBe(true);
    expect(result.start).toBe('2026-05-25');
    expect(result.end).toBe('2026-05-26');
    expect(result.attendees).toEqual([]);
  });

  it('normalizes a multi-day all-day event', () => {
    const raw = {
      id: 'ghi',
      summary: 'Conference',
      start: { date: '2026-06-01' },
      end: { date: '2026-06-04' }
    };
    const result = normalizeEvent(raw);
    expect(result.allDay).toBe(true);
    expect(result.start).toBe('2026-06-01');
    expect(result.end).toBe('2026-06-04');
  });
});

describe('normalizeEvent — edge cases', () => {
  it('uses fallback title when summary is absent', () => {
    const raw = {
      id: 'jkl',
      start: { dateTime: '2026-05-22T10:00:00Z' },
      end: { dateTime: '2026-05-22T11:00:00Z' }
    };
    expect(normalizeEvent(raw).title).toBe('(No title)');
  });

  it('handles empty attendees list', () => {
    const raw = {
      id: 'mno',
      summary: 'Solo work',
      start: { dateTime: '2026-05-22T14:00:00Z' },
      end: { dateTime: '2026-05-22T16:00:00Z' }
    };
    expect(normalizeEvent(raw).attendees).toEqual([]);
  });

  it('preserves recurringEventId for recurring instances', () => {
    const raw = {
      id: 'pqr_20260522',
      summary: 'Weekly 1:1',
      start: { dateTime: '2026-05-22T14:00:00Z' },
      end: { dateTime: '2026-05-22T15:00:00Z' },
      recurringEventId: 'pqr'
    };
    expect(normalizeEvent(raw).recurringEventId).toBe('pqr');
  });

  it('sets null for optional fields when absent', () => {
    const raw = {
      id: 'stu',
      summary: 'Minimal event',
      start: { dateTime: '2026-05-22T10:00:00Z' },
      end: { dateTime: '2026-05-22T11:00:00Z' }
    };
    const result = normalizeEvent(raw);
    expect(result.location).toBeNull();
    expect(result.description).toBeNull();
    expect(result.colorId).toBeNull();
    expect(result.recurringEventId).toBeNull();
  });
});
