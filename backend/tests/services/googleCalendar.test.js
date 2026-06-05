jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() }))
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        list:   jest.fn().mockResolvedValue({ data: { items: [] } }),
        insert: jest.fn(),
        patch:  jest.fn(),
        delete: jest.fn()
      }
    })
  }
}));

const GoogleCalendarService = require('../../src/services/googleCalendar');
const { normalizeEvent, detectConflicts } = GoogleCalendarService;

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

// ── detectConflicts ────────────────────────────────────────────────────────────

function makeTimedEvent(start, end, id = 'e1') {
  return {
    id, title: 'Existing', start, end, allDay: false,
    location: null, description: null, colorId: null,
    attendees: [], status: 'confirmed', recurringEventId: null
  };
}

describe('detectConflicts', () => {
  const baseIntent = {
    action: 'create',
    start_time: '2026-05-23T09:00:00Z',
    end_time: '2026-05-23T10:00:00Z',
    duration_minutes: 60
  };

  it('returns [] when events list is empty', () => {
    expect(detectConflicts([], baseIntent)).toEqual([]);
  });

  it('returns [] when intent action is not create', () => {
    const event = makeTimedEvent('2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z');
    expect(detectConflicts([event], { ...baseIntent, action: 'query' })).toEqual([]);
  });

  it('returns [] when intent has no start_time', () => {
    const event = makeTimedEvent('2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z');
    expect(detectConflicts([event], { ...baseIntent, start_time: null })).toEqual([]);
  });

  it('detects overlap when event and intent windows intersect', () => {
    const event = makeTimedEvent('2026-05-23T08:30:00Z', '2026-05-23T09:30:00Z');
    expect(detectConflicts([event], baseIntent)).toHaveLength(1);
  });

  it('no conflict when event ends exactly at intent start', () => {
    const event = makeTimedEvent('2026-05-23T08:00:00Z', '2026-05-23T09:00:00Z');
    expect(detectConflicts([event], baseIntent)).toHaveLength(0);
  });

  it('no conflict when event starts exactly at intent end', () => {
    const event = makeTimedEvent('2026-05-23T10:00:00Z', '2026-05-23T11:00:00Z');
    expect(detectConflicts([event], baseIntent)).toHaveLength(0);
  });

  it('detects conflict when event fully contains the intent window', () => {
    const event = makeTimedEvent('2026-05-23T08:00:00Z', '2026-05-23T12:00:00Z');
    expect(detectConflicts([event], baseIntent)).toHaveLength(1);
  });

  it('detects conflict when intent fully contains the event window', () => {
    const event = makeTimedEvent('2026-05-23T09:15:00Z', '2026-05-23T09:45:00Z');
    expect(detectConflicts([event], baseIntent)).toHaveLength(1);
  });

  it('returns multiple conflicting events', () => {
    const events = [
      makeTimedEvent('2026-05-23T09:00:00Z', '2026-05-23T09:30:00Z', 'e1'),
      makeTimedEvent('2026-05-23T09:15:00Z', '2026-05-23T10:15:00Z', 'e2')
    ];
    expect(detectConflicts(events, baseIntent)).toHaveLength(2);
  });

  it('skips all-day events', () => {
    const allDay = { ...makeTimedEvent('2026-05-23', '2026-05-24'), allDay: true };
    expect(detectConflicts([allDay], baseIntent)).toHaveLength(0);
  });

  it('infers end time from duration_minutes when end_time is null', () => {
    const event = makeTimedEvent('2026-05-23T09:30:00Z', '2026-05-23T10:30:00Z');
    const intent = { ...baseIntent, end_time: null, duration_minutes: 60 };
    expect(detectConflicts([event], intent)).toHaveLength(1);
  });

  it('falls back to 60-minute window when both end_time and duration_minutes are absent', () => {
    const event = makeTimedEvent('2026-05-23T09:30:00Z', '2026-05-23T10:30:00Z');
    const intent = { ...baseIntent, end_time: null, duration_minutes: null };
    expect(detectConflicts([event], intent)).toHaveLength(1);
  });
});

// ── GoogleCalendarService.updateEvent ─────────────────────────────────────────

describe('GoogleCalendarService — updateEvent', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  });

  it('calls calendar.events.patch with correct params and sendUpdates: all', async () => {
    const service = new GoogleCalendarService('access-tok', 'refresh-tok');
    const mockPatch = jest.fn().mockResolvedValue({
      data: {
        id: 'event123',
        summary: 'New Title',
        start: { dateTime: '2026-05-28T10:00:00Z' },
        end:   { dateTime: '2026-05-28T11:00:00Z' },
        status: 'confirmed'
      }
    });
    service.calendar = { events: { patch: mockPatch } };

    await service.updateEvent('event123', { summary: 'New Title' });

    expect(mockPatch).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event123',
      resource: { summary: 'New Title' },
      sendUpdates: 'all'
    });
  });

  it('returns a normalized event from the patch response', async () => {
    const service = new GoogleCalendarService('access-tok', 'refresh-tok');
    service.calendar = {
      events: {
        patch: jest.fn().mockResolvedValue({
          data: {
            id: 'event123',
            summary: 'Updated Meeting',
            start: { dateTime: '2026-05-28T10:00:00Z' },
            end:   { dateTime: '2026-05-28T11:00:00Z' },
            status: 'confirmed'
          }
        })
      }
    };

    const result = await service.updateEvent('event123', { summary: 'Updated Meeting' });

    expect(result.id).toBe('event123');
    expect(result.title).toBe('Updated Meeting');
    expect(result.allDay).toBe(false);
  });
});
