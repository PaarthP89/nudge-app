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
jest.mock('../../src/services/googleCalendar', () => {
  return jest.fn().mockImplementation(() => ({
    listEvents: mockListEvents
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

const STUB_501_ENDPOINTS = [
  { method: 'post', path: '/api/calendar/events' },
  { method: 'patch', path: '/api/calendar/events/123' },
  { method: 'delete', path: '/api/calendar/events/123' },
  { method: 'get', path: '/api/calendar/freebusy' }
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
