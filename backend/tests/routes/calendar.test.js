const request = require('supertest');

jest.mock('passport-google-oauth20', () => {
  const Strategy = jest.fn().mockImplementation(() => {
    return { name: 'google', authenticate: jest.fn() };
  });
  return { Strategy };
});

let mockIsAuthenticated = false;

jest.mock('passport', () => {
  const mockPassport = {
    use: jest.fn(),
    initialize: jest.fn(() => (req, res, next) => next()),
    session: jest.fn(() => (req, res, next) => {
      req.isAuthenticated = () => mockIsAuthenticated;
      if (mockIsAuthenticated) {
        req.user = { id: 'user-123', accessToken: 'tok', refreshToken: 'ref', profile: {} };
      }
      next();
    }),
    authenticate: jest.fn(() => (req, res, next) => next()),
    serializeUser: jest.fn(),
    deserializeUser: jest.fn()
  };
  return mockPassport;
});

let mockListEvents = jest.fn();
let mockDeleteEvent = jest.fn();
let mockUpdateEvent = jest.fn();

jest.mock('../../src/services/googleCalendar', () => {
  return jest.fn().mockImplementation(() => ({
    listEvents: mockListEvents,
    deleteEvent: mockDeleteEvent,
    updateEvent: mockUpdateEvent
  }));
});

const app = require('../../src/app');

const VALID_RANGE = 'start=2026-05-01T00:00:00.000Z&end=2026-05-31T23:59:59.000Z';

describe('GET /api/calendar/events — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).get('/api/calendar/events');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/calendar/events — authenticated', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockListEvents.mockReset();
  });

  it('returns 400 when start param is missing', async () => {
    const res = await request(app).get('/api/calendar/events?end=2026-05-31T23:59:59.000Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start and end/);
  });

  it('returns 400 when end param is missing', async () => {
    const res = await request(app).get('/api/calendar/events?start=2026-05-01T00:00:00.000Z');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start and end/);
  });

  it('returns 400 for invalid date values', async () => {
    const res = await request(app).get('/api/calendar/events?start=not-a-date&end=also-not');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid date/);
  });

  it('returns 200 with events array on valid request', async () => {
    const mockEvents = [
      {
        id: '1',
        title: 'Team standup',
        start: '2026-05-22T09:00:00Z',
        end: '2026-05-22T09:30:00Z',
        allDay: false
      }
    ];
    mockListEvents.mockResolvedValue(mockEvents);
    const res = await request(app).get(`/api/calendar/events?${VALID_RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: mockEvents });
  });

  it('returns 200 with empty array when no events in range', async () => {
    mockListEvents.mockResolvedValue([]);
    const res = await request(app).get(`/api/calendar/events?${VALID_RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });

  it('propagates Google API errors through the error handler', async () => {
    mockListEvents.mockRejectedValue(new Error('Google API unreachable'));
    const res = await request(app).get(`/api/calendar/events?${VALID_RANGE}`);
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/calendar/events/:id ──────────────────────────────────────────

describe('DELETE /api/calendar/events/:id — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).delete('/api/calendar/events/ev-123');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/calendar/events/:id — authenticated', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockDeleteEvent.mockReset();
  });

  it('returns 200 with success:true on valid event id', async () => {
    mockDeleteEvent.mockResolvedValue(undefined);
    const res = await request(app).delete('/api/calendar/events/ev-123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('calls deleteEvent with the event id', async () => {
    mockDeleteEvent.mockResolvedValue(undefined);
    await request(app).delete('/api/calendar/events/my-event-id');
    expect(mockDeleteEvent).toHaveBeenCalledWith('my-event-id');
  });

  it('propagates calendar errors to the error handler', async () => {
    mockDeleteEvent.mockRejectedValue(new Error('Event not found'));
    const res = await request(app).delete('/api/calendar/events/ev-999');
    expect(res.status).toBe(500);
  });
});

// ── Stubs ─────────────────────────────────────────────────────────────────────

const STUB_501_ENDPOINTS = [
  { method: 'post', path: '/api/calendar/events' },
];

describe('Calendar stubs — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  STUB_501_ENDPOINTS.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} returns 401`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    });
  });
});

describe('Calendar stubs — authenticated (not yet implemented)', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  STUB_501_ENDPOINTS.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} returns 501`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(501);
    });
  });
});

// ── GET /api/calendar/freebusy ────────────────────────────────────────────────

describe('GET /api/calendar/freebusy — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).get('/api/calendar/freebusy?start=2026-05-26T00:00:00.000Z&end=2026-05-26T23:59:59.000Z');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/calendar/freebusy — authenticated', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockListEvents.mockReset();
  });

  it('returns 400 when start param is missing', async () => {
    const res = await request(app).get('/api/calendar/freebusy?end=2026-05-26T23:59:59.000Z');
    expect(res.status).toBe(400);
  });

  it('returns 400 when end param is missing', async () => {
    const res = await request(app).get('/api/calendar/freebusy?start=2026-05-26T00:00:00.000Z');
    expect(res.status).toBe(400);
  });

  it('returns events for the requested date range', async () => {
    const mockEvents = [
      { id: 'ev1', title: 'Morning sync', start: '2026-05-26T09:00:00Z', end: '2026-05-26T09:30:00Z', allDay: false }
    ];
    mockListEvents.mockResolvedValue(mockEvents);

    const res = await request(app).get(
      '/api/calendar/freebusy?start=2026-05-26T00:00:00.000Z&end=2026-05-26T23:59:59.000Z'
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('ev1');
  });

  it('returns empty events array when calendar is free', async () => {
    mockListEvents.mockResolvedValue([]);

    const res = await request(app).get(
      '/api/calendar/freebusy?start=2026-05-26T00:00:00.000Z&end=2026-05-26T23:59:59.000Z'
    );

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
  });
});

// ── PATCH /api/calendar/events/:id ────────────────────────────────────────────

const UPDATED_EVENT = {
  id: 'ev-123', title: 'Updated Title',
  start: '2026-05-28T10:00:00Z', end: '2026-05-28T11:00:00Z',
  allDay: false, location: null, description: null,
  colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
};

describe('PATCH /api/calendar/events/:id — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).patch('/api/calendar/events/ev-123').send({ summary: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/calendar/events/:id — authenticated', () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockUpdateEvent.mockReset();
  });

  it('returns 200 with updated event on valid patch', async () => {
    mockUpdateEvent.mockResolvedValue(UPDATED_EVENT);
    const res = await request(app)
      .patch('/api/calendar/events/ev-123')
      .send({ summary: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'ev-123', title: 'Updated Title' });
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).patch('/api/calendar/events/ev-123').send({});
    expect(res.status).toBe(400);
  });

  it('calls updateEvent with the correct id and patches', async () => {
    mockUpdateEvent.mockResolvedValue(UPDATED_EVENT);
    await request(app)
      .patch('/api/calendar/events/ev-123')
      .send({ summary: 'New Title' });
    expect(mockUpdateEvent).toHaveBeenCalledWith('ev-123', { summary: 'New Title' });
  });

  it('propagates calendar errors to the error handler', async () => {
    mockUpdateEvent.mockRejectedValue(new Error('Event not found'));
    const res = await request(app)
      .patch('/api/calendar/events/ev-123')
      .send({ summary: 'x' });
    expect(res.status).toBe(500);
  });
});
