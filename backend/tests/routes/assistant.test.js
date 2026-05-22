const request = require('supertest');

jest.mock('passport-google-oauth20', () => {
  const Strategy = jest.fn().mockImplementation(() => ({
    name: 'google', authenticate: jest.fn()
  }));
  return { Strategy };
});

let mockIsAuthenticated = false;

jest.mock('passport', () => ({
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
}));

// Mock ClaudeService — factory runs at hoist time so we attach mocks to the class itself
jest.mock('../../src/services/claude', () => {
  const MockService = jest.fn();
  MockService.buildIntentReply = jest.fn();
  return MockService;
});

jest.mock('../../src/services/googleCalendar', () => {
  const MockCalendar = jest.fn();
  const { detectConflicts } = jest.requireActual('../../src/services/googleCalendar');
  MockCalendar.detectConflicts = detectConflicts;
  return MockCalendar;
});

const app = require('../../src/app');
const ClaudeService = require('../../src/services/claude');
const GoogleCalendarService = require('../../src/services/googleCalendar');

const VALID_INTENT = {
  action: 'create',
  title: 'Team standup',
  start_time: '2026-05-23T09:00:00Z',
  end_time: '2026-05-23T09:30:00Z',
  duration_minutes: 30,
  attendees: [],
  location: null,
  confidence: 0.92
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default mock implementations
  const parseIntentMock = jest.fn().mockResolvedValue(VALID_INTENT);
  ClaudeService.mockImplementation(() => ({ parseIntent: parseIntentMock }));
  ClaudeService.buildIntentReply.mockReturnValue('Got it — mock reply');
  ClaudeService._lastParseIntent = parseIntentMock;

  GoogleCalendarService.mockImplementation(() => ({
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue({
      id: 'new-ev', title: 'Team standup',
      start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    })
  }));
});

// ── POST /api/assistant/parse ─────────────────────────────────────────────────

describe('POST /api/assistant/parse — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).post('/api/assistant/parse').send({ message: 'hello' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assistant/parse — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/api/assistant/parse').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
  });

  it('returns 400 when message is whitespace only', async () => {
    const res = await request(app).post('/api/assistant/parse').send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is not a string', async () => {
    const res = await request(app).post('/api/assistant/parse').send({ message: 123 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message exceeds 1000 characters', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'a'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1000/);
  });

  it('returns 200 with intent and reply on valid message', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a team standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body.intent).toMatchObject({ action: 'create', confidence: 0.92 });
    expect(res.body.reply).toBe('Got it — mock reply');
  });

  it('calls ClaudeService.buildIntentReply with the parsed intent', async () => {
    await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Book a meeting' });
    expect(ClaudeService.buildIntentReply).toHaveBeenCalledWith(VALID_INTENT);
  });

  it('propagates ClaudeService errors to the error handler', async () => {
    ClaudeService.mockImplementation(() => ({
      parseIntent: jest.fn().mockRejectedValue(new Error('Claude API down'))
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule something' });
    expect(res.status).toBe(500);
  });
});

// ── POST /api/assistant/chat ──────────────────────────────────────────────────

describe('POST /api/assistant/chat — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).post('/api/assistant/chat').send({ message: 'hello' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assistant/chat — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/api/assistant/chat').send({});
    expect(res.status).toBe(400);
  });

  it('returns 200 with intent and reply on valid message', async () => {
    const res = await request(app)
      .post('/api/assistant/chat')
      .send({ message: 'Schedule a call with Bob at 3pm' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('intent');
    expect(res.body).toHaveProperty('reply');
  });
});

// ── Stubs ─────────────────────────────────────────────────────────────────────

describe('Assistant stubs — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('POST /api/assistant/suggest returns 401', async () => {
    const res = await request(app).post('/api/assistant/suggest');
    expect(res.status).toBe(401);
  });
});

describe('Assistant stubs — authenticated (not yet implemented)', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('POST /api/assistant/suggest returns 501', async () => {
    const res = await request(app).post('/api/assistant/suggest');
    expect(res.status).toBe(501);
  });
});

// ── Conflict detection ────────────────────────────────────────────────────────

const CONFLICT_EVENT = {
  id: 'ev1', title: 'Existing meeting',
  start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
  allDay: false, location: null, description: null,
  colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
};

describe('POST /api/assistant/parse — conflict detection', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('includes conflicts array in response', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('conflicts');
    expect(Array.isArray(res.body.conflicts)).toBe(true);
  });

  it('returns empty conflicts when calendar has no overlapping events', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });
    expect(res.body.conflicts).toHaveLength(0);
  });

  it('returns conflicts when calendar has overlapping events', async () => {
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].id).toBe('ev1');
  });

  it('skips calendar call when action is not create', async () => {
    const listEvents = jest.fn().mockResolvedValue([]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    ClaudeService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({
        ...VALID_INTENT, action: 'query'
      })
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'What is on my calendar tomorrow?' });
    expect(res.body.conflicts).toHaveLength(0);
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('skips calendar call when start_time is null', async () => {
    const listEvents = jest.fn().mockResolvedValue([]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    ClaudeService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({
        ...VALID_INTENT, start_time: null
      })
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a meeting' });
    expect(res.body.conflicts).toHaveLength(0);
    expect(listEvents).not.toHaveBeenCalled();
  });
});

// ── POST /api/assistant/confirm ───────────────────────────────────────────────

const VALID_CONFIRM_INTENT = {
  action: 'create',
  title: 'Team standup',
  start_time: '2026-05-23T09:00:00Z',
  end_time: '2026-05-23T09:30:00Z',
  duration_minutes: 30,
  attendees: [],
  location: null,
  confidence: 0.92
};

const CREATED_EVENT = {
  id: 'new-ev', title: 'Team standup',
  start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
  allDay: false, location: null, description: null,
  colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
};

describe('POST /api/assistant/confirm — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).post('/api/assistant/confirm').send({ intent: VALID_CONFIRM_INTENT });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assistant/confirm — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns 400 when intent is missing', async () => {
    const res = await request(app).post('/api/assistant/confirm').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/intent/);
  });

  it('returns 400 when intent action is not create', async () => {
    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: { ...VALID_CONFIRM_INTENT, action: 'delete' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when intent has no start_time', async () => {
    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: { ...VALID_CONFIRM_INTENT, start_time: null } });
    expect(res.status).toBe(400);
  });

  it('returns 201 with created event on valid intent', async () => {
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn().mockResolvedValue(CREATED_EVENT)
    }));
    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT });
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ id: 'new-ev', title: 'Team standup' });
  });

  it('calls createEvent with the intent', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent
    }));
    await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT });
    expect(createEvent).toHaveBeenCalledWith(VALID_CONFIRM_INTENT);
  });

  it('propagates calendar errors to the error handler', async () => {
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn().mockRejectedValue(new Error('Calendar API down'))
    }));
    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT });
    expect(res.status).toBe(500);
  });
});
