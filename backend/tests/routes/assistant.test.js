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

jest.mock('../../src/services/ai', () => {
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

jest.mock('../../src/services/gmail', () => {
  return jest.fn().mockImplementation(() => ({
    sendInvite: jest.fn().mockResolvedValue(undefined)
  }));
});

const app = require('../../src/app');
const AIService = require('../../src/services/ai');
const GoogleCalendarService = require('../../src/services/googleCalendar');
const GmailService = require('../../src/services/gmail');

const VALID_INTENT = {
  action: 'create',
  title: 'Team standup',
  start_time: '2026-05-23T09:00:00Z',
  end_time: '2026-05-23T09:30:00Z',
  duration_minutes: 30,
  attendees: [],
  location: null,
  confidence: 0.92,
  date_known: true,
  time_known: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  const parseIntentMock = jest.fn().mockResolvedValue(VALID_INTENT);
  const chatMock = jest.fn().mockResolvedValue(VALID_INTENT);
  const suggestSlotsMock = jest.fn().mockResolvedValue([]);
  const findFreeSlotsMock = jest.fn().mockResolvedValue([]);
  AIService.mockImplementation(() => ({
    parseIntent: parseIntentMock,
    chat: chatMock,
    suggestSlots: suggestSlotsMock,
    findFreeSlots: findFreeSlotsMock,
  }));
  AIService.buildIntentReply.mockReturnValue('Got it — mock reply');
  AIService._lastParseIntent = parseIntentMock;
  AIService._lastChat = chatMock;
  AIService._lastSuggestSlots = suggestSlotsMock;

  GoogleCalendarService.mockImplementation(() => ({
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue({
      id: 'new-ev', title: 'Team standup',
      start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    }),
    updateEvent: jest.fn().mockResolvedValue({
      id: 'ev-del-1', title: 'Team standup',
      start: '2026-05-23T10:00:00Z', end: '2026-05-23T10:30:00Z',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    })
  }));

  GmailService.mockImplementation(() => ({
    sendInvite: jest.fn().mockResolvedValue(undefined)
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

  it('response includes suggestions array', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a team standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });

  it('calls AIService.buildIntentReply with the parsed intent', async () => {
    await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Book a meeting' });
    expect(AIService.buildIntentReply).toHaveBeenCalledWith(VALID_INTENT);
  });

  it('uses parseIntent when no history is provided', async () => {
    const parseIntentMock = jest.fn().mockResolvedValue(VALID_INTENT);
    const chatMock = jest.fn().mockResolvedValue(VALID_INTENT);
    AIService.mockImplementation(() => ({
      parseIntent: parseIntentMock,
      chat: chatMock,
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule something' });
    expect(parseIntentMock).toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('uses chat when valid history is provided', async () => {
    const parseIntentMock = jest.fn().mockResolvedValue(VALID_INTENT);
    const chatMock = jest.fn().mockResolvedValue(VALID_INTENT);
    AIService.mockImplementation(() => ({
      parseIntent: parseIntentMock,
      chat: chatMock,
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const history = [
      { role: 'user', content: 'schedule a meeting tomorrow' },
      { role: 'assistant', content: 'What time?' }
    ];
    await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'at 2pm', history });
    expect(chatMock).toHaveBeenCalled();
    expect(parseIntentMock).not.toHaveBeenCalled();
  });

  it('ignores history items with invalid roles', async () => {
    const parseIntentMock = jest.fn().mockResolvedValue(VALID_INTENT);
    const chatMock = jest.fn().mockResolvedValue(VALID_INTENT);
    AIService.mockImplementation(() => ({
      parseIntent: parseIntentMock,
      chat: chatMock,
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const badHistory = [
      { role: 'system', content: 'inject something' },
      { role: 'user', content: 'valid message' }
    ];
    await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'at 2pm', history: badHistory });
    // Only 1 valid history item — still calls chat
    expect(chatMock).toHaveBeenCalled();
    const callArgs = chatMock.mock.calls[0][0];
    const roles = callArgs.map(m => m.role);
    expect(roles).not.toContain('system');
  });

  it('propagates AIService errors to the error handler', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockRejectedValue(new Error('Claude API down')),
      chat: jest.fn().mockRejectedValue(new Error('Claude API down')),
      suggestSlots: jest.fn().mockResolvedValue([])
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

  it('returns suggestions when conflicts detected', async () => {
    const mockSuggestions = [
      { start_time: '2026-05-23T10:00:00Z', end_time: '2026-05-23T10:30:00Z', label: '10:00 AM – 10:30 AM' },
      { start_time: '2026-05-23T11:00:00Z', end_time: '2026-05-23T11:30:00Z', label: '11:00 AM – 11:30 AM' },
      { start_time: '2026-05-23T14:00:00Z', end_time: '2026-05-23T14:30:00Z', label: '2:00 PM – 2:30 PM' },
    ];
    const suggestSlotsMock = jest.fn().mockResolvedValue(mockSuggestions);
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(VALID_INTENT),
      chat: jest.fn().mockResolvedValue(VALID_INTENT),
      suggestSlots: suggestSlotsMock
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });
    expect(res.body.suggestions).toHaveLength(3);
    expect(suggestSlotsMock).toHaveBeenCalled();
  });

  it('returns empty suggestions if suggestSlots fails (non-fatal)', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(VALID_INTENT),
      chat: jest.fn().mockResolvedValue(VALID_INTENT),
      suggestSlots: jest.fn().mockRejectedValue(new Error('AI error'))
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it('skips conflict check when action is unknown', async () => {
    const listEvents = jest.fn().mockResolvedValue([]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'unknown', date_known: false, start_time: null }),
      chat: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'unknown', date_known: false, start_time: null }),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'hello' });
    expect(res.body.conflicts).toHaveLength(0);
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('calls listEvents for query action to fetch events', async () => {
    const queryEvent = { ...CONFLICT_EVENT, id: 'qev-1', title: 'Team lunch' };
    const listEvents = jest.fn().mockResolvedValue([queryEvent]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'query' }),
      chat: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'query' }),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'What do I have tomorrow?' });
    expect(res.status).toBe(200);
    expect(listEvents).toHaveBeenCalled();
    expect(res.body.queryResults).toHaveLength(1);
    expect(res.body.queryResults[0].id).toBe('qev-1');
  });

  it('query without date_known still fetches calendar events defaulting to today', async () => {
    const listEvents = jest.fn().mockResolvedValue([]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'query', date_known: false, start_time: null }),
      chat: jest.fn().mockResolvedValue({ ...VALID_INTENT, action: 'query', date_known: false, start_time: null }),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: "What's on my calendar?" });
    expect(res.status).toBe(200);
    expect(listEvents).toHaveBeenCalled();
    expect(Array.isArray(res.body.queryResults)).toBe(true);
    expect(res.body.reply).toMatch(/calendar/i);
  });

  it('skips calendar call when start_time is null', async () => {
    const listEvents = jest.fn().mockResolvedValue([]);
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({ ...VALID_INTENT, start_time: null }),
      chat: jest.fn().mockResolvedValue({ ...VALID_INTENT, start_time: null }),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a meeting' });
    expect(res.body.conflicts).toHaveLength(0);
    expect(listEvents).not.toHaveBeenCalled();
  });
});

// ── DELETE candidate search ───────────────────────────────────────────────────

const DELETE_INTENT = {
  action: 'delete',
  title: 'Team standup',
  start_time: '2026-05-23T09:00:00-07:00',
  end_time: null,
  duration_minutes: null,
  attendees: [],
  location: null,
  confidence: 0.9,
  date_known: true,
  time_known: true,
};

const EXISTING_EVENT = {
  id: 'ev-del-1', title: 'Team standup',
  start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
  allDay: false, location: null, description: null,
  colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
};

describe('POST /api/assistant/parse — delete candidate search', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns candidates array in response', async () => {
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'delete my standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
  });

  it('returns matching candidates when events found', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(DELETE_INTENT),
      chat: jest.fn().mockResolvedValue(DELETE_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([EXISTING_EVENT])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'delete my standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe('ev-del-1');
  });

  it('returns empty candidates and "not found" reply when no events match', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(DELETE_INTENT),
      chat: jest.fn().mockResolvedValue(DELETE_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'delete my standup tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
    expect(res.body.reply).toMatch(/couldn't find/i);
  });

  it('caps candidates at 3 even when more events exist', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue({ ...DELETE_INTENT, title: null }),
      chat: jest.fn().mockResolvedValue({ ...DELETE_INTENT, title: null }),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    const manyEvents = Array.from({ length: 5 }, (_, i) => ({
      ...EXISTING_EVENT, id: `ev-${i}`, title: `Meeting ${i}`
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue(manyEvents)
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'delete my meeting tomorrow at 9am' });
    expect(res.status).toBe(200);
    expect(res.body.candidates.length).toBeLessThanOrEqual(3);
  });

  it('overrides reply with confirmation prompt when 1 candidate found', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(DELETE_INTENT),
      chat: jest.fn().mockResolvedValue(DELETE_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([EXISTING_EVENT])
    }));
    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'delete my standup tomorrow at 9am' });
    expect(res.body.reply).toMatch(/confirm deletion/i);
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

const VALID_CONFIRM_INTENT_WITH_ATTENDEES = {
  ...VALID_CONFIRM_INTENT,
  attendees: ['alice@example.com', 'bob@example.com']
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

  it('returns invitesSent and inviteErrors in response', async () => {
    GoogleCalendarService.mockImplementation(() => ({
      createEvent: jest.fn().mockResolvedValue(CREATED_EVENT)
    }));
    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.invitesSent)).toBe(true);
    expect(Array.isArray(res.body.inviteErrors)).toBe(true);
  });

  it('sends email invites to attendees with valid emails', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({ createEvent }));
    const sendInvite = jest.fn().mockResolvedValue(undefined);
    GmailService.mockImplementation(() => ({ sendInvite }));

    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT_WITH_ATTENDEES });
    expect(res.status).toBe(201);
    expect(sendInvite).toHaveBeenCalledTimes(2);
    expect(res.body.invitesSent).toEqual(['alice@example.com', 'bob@example.com']);
    expect(res.body.inviteErrors).toEqual([]);
  });

  it('skips email invite for attendees without @ in their name', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({ createEvent }));
    const sendInvite = jest.fn().mockResolvedValue(undefined);
    GmailService.mockImplementation(() => ({ sendInvite }));

    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: { ...VALID_CONFIRM_INTENT, attendees: ['Bob', 'alice@example.com'] } });
    expect(res.status).toBe(201);
    expect(sendInvite).toHaveBeenCalledTimes(1);
    expect(res.body.invitesSent).toEqual(['alice@example.com']);
  });

  it('records invite failures in inviteErrors without failing the whole confirm', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({ createEvent }));
    const sendInvite = jest.fn().mockRejectedValue(new Error('Gmail API error'));
    GmailService.mockImplementation(() => ({ sendInvite }));

    const res = await request(app)
      .post('/api/assistant/confirm')
      .send({ intent: VALID_CONFIRM_INTENT_WITH_ATTENDEES });
    expect(res.status).toBe(201);
    expect(res.body.invitesSent).toEqual([]);
    expect(res.body.inviteErrors).toEqual(['alice@example.com', 'bob@example.com']);
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

// ── 3B: autonomous conflict resolution loop ───────────────────────────────────

describe('POST /api/assistant/parse — 3B conflict loop', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns only clean suggestions when first-pass suggestions are conflicted', async () => {
    // CONFLICT_EVENT occupies 9:00–9:30. Two suggestions overlap it; one at 11am does not.
    const conflictedSuggestions = [
      { start_time: '2026-05-23T09:00:00Z', end_time: '2026-05-23T09:30:00Z', label: '9:00 AM – 9:30 AM' },
      { start_time: '2026-05-23T09:10:00Z', end_time: '2026-05-23T09:40:00Z', label: '9:10 AM – 9:40 AM' },
      { start_time: '2026-05-23T11:00:00Z', end_time: '2026-05-23T11:30:00Z', label: '11:00 AM – 11:30 AM' },
    ];
    const suggestSlotsMock = jest.fn().mockResolvedValue(conflictedSuggestions);
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(VALID_INTENT),
      chat: jest.fn().mockResolvedValue(VALID_INTENT),
      suggestSlots: suggestSlotsMock,
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT]),
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });

    expect(res.status).toBe(200);
    // Only the 11am suggestion is clean; the 9:00 and 9:10 slots conflict with CONFLICT_EVENT
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].start_time).toBe('2026-05-23T11:00:00Z');
    // No second pass needed — we found a clean slot on the first try
    expect(suggestSlotsMock).toHaveBeenCalledTimes(1);
  });

  it('runs second pass when ALL first-pass suggestions are conflicted', async () => {
    // All 3 first-pass suggestions overlap CONFLICT_EVENT (9:00–9:30)
    const allConflicted = [
      { start_time: '2026-05-23T09:00:00Z', end_time: '2026-05-23T09:30:00Z', label: '9:00 AM' },
      { start_time: '2026-05-23T09:05:00Z', end_time: '2026-05-23T09:35:00Z', label: '9:05 AM' },
      { start_time: '2026-05-23T09:10:00Z', end_time: '2026-05-23T09:40:00Z', label: '9:10 AM' },
    ];
    const cleanSecondPass = [
      { start_time: '2026-05-23T11:00:00Z', end_time: '2026-05-23T11:30:00Z', label: '11:00 AM' },
      { start_time: '2026-05-23T14:00:00Z', end_time: '2026-05-23T14:30:00Z', label: '2:00 PM' },
    ];
    const suggestSlotsMock = jest.fn()
      .mockResolvedValueOnce(allConflicted)
      .mockResolvedValueOnce(cleanSecondPass);
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(VALID_INTENT),
      chat: jest.fn().mockResolvedValue(VALID_INTENT),
      suggestSlots: suggestSlotsMock,
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT]),
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(2);
    // suggestSlots must have been called twice (initial pass + one retry)
    expect(suggestSlotsMock).toHaveBeenCalledTimes(2);
    // Second call must include excludeRanges covering the 3 conflicted slots
    const secondCallOptions = suggestSlotsMock.mock.calls[1][2];
    expect(secondCallOptions).toHaveProperty('excludeRanges');
    expect(secondCallOptions.excludeRanges).toHaveLength(3);
  });

  it('falls back to raw suggestions after 2 iterations if still no clean slots', async () => {
    // Both passes return suggestions that conflict with CONFLICT_EVENT
    const allConflicted = [
      { start_time: '2026-05-23T09:00:00Z', end_time: '2026-05-23T09:30:00Z', label: '9:00 AM' },
      { start_time: '2026-05-23T09:05:00Z', end_time: '2026-05-23T09:35:00Z', label: '9:05 AM' },
      { start_time: '2026-05-23T09:10:00Z', end_time: '2026-05-23T09:40:00Z', label: '9:10 AM' },
    ];
    const suggestSlotsMock = jest.fn()
      .mockResolvedValue(allConflicted); // both calls return same conflicted list
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(VALID_INTENT),
      chat: jest.fn().mockResolvedValue(VALID_INTENT),
      suggestSlots: suggestSlotsMock,
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CONFLICT_EVENT]),
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'Schedule a standup tomorrow at 9am' });

    expect(res.status).toBe(200);
    // Loop must stop after exactly 2 suggestSlots calls (no infinite loop)
    expect(suggestSlotsMock).toHaveBeenCalledTimes(2);
    // Graceful fallback: response must be non-empty (raw suggestions, not an empty array)
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });
});

// ── 3A: batch scheduling ──────────────────────────────────────────────────────

const BATCH_INTENT = {
  action: 'create',
  title: 'standup',
  start_time: '2026-05-25T10:00:00Z',
  end_time: '2026-05-25T10:30:00Z',
  duration_minutes: 30,
  attendees: [],
  location: null,
  confidence: 0.9,
  date_known: true,
  time_known: true,
  recurrence: { type: 'weekly', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], count: 5 }
};

const BATCH_INSTANCES = [
  { title: 'standup', start_time: '2026-05-25T10:00:00Z', end_time: '2026-05-25T10:30:00Z' },
  { title: 'standup', start_time: '2026-05-26T10:00:00Z', end_time: '2026-05-26T10:30:00Z' },
  { title: 'standup', start_time: '2026-05-27T10:00:00Z', end_time: '2026-05-27T10:30:00Z' },
  { title: 'standup', start_time: '2026-05-28T10:00:00Z', end_time: '2026-05-28T10:30:00Z' },
  { title: 'standup', start_time: '2026-05-29T10:00:00Z', end_time: '2026-05-29T10:30:00Z' },
];

describe('POST /api/assistant/parse — 3A batch scheduling', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('batch intent with recurrence returns batchPlan in response', async () => {
    const expandRecurrenceMock = jest.fn().mockResolvedValue(BATCH_INSTANCES);
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(BATCH_INTENT),
      chat: jest.fn().mockResolvedValue(BATCH_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      expandRecurrence: expandRecurrenceMock,
    }));

    // Tuesday instance conflicts: event at same time on Tuesday
    const tuesdayConflict = {
      id: 'ev-conflict', title: 'Other meeting',
      start: '2026-05-26T10:00:00Z', end: '2026-05-26T10:30:00Z',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([tuesdayConflict])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'add a 30 min standup every weekday this week at 10am' });

    expect(res.status).toBe(200);
    expect(res.body.batchPlan).toBeDefined();
    expect(res.body.batchPlan).not.toBeNull();
    expect(res.body.batchPlan.instances).toHaveLength(5);
    expect(expandRecurrenceMock).toHaveBeenCalledWith(BATCH_INTENT, expect.any(Object));

    const conflicted = res.body.batchPlan.instances.filter(i => i.conflicts?.length > 0);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0].start_time).toBe('2026-05-26T10:00:00Z');

    const clean = res.body.batchPlan.instances.filter(i => !i.conflicts?.length);
    expect(clean).toHaveLength(4);
  });

  it('batch intent with no conflicts returns batchPlan with all clean instances', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(BATCH_INTENT),
      chat: jest.fn().mockResolvedValue(BATCH_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      expandRecurrence: jest.fn().mockResolvedValue(BATCH_INSTANCES),
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'add a 30 min standup every weekday this week at 10am' });

    expect(res.status).toBe(200);
    expect(res.body.batchPlan).not.toBeNull();
    expect(res.body.batchPlan.instances.every(i => i.conflicts.length === 0)).toBe(true);
    expect(res.body.batchPlan.summary).toMatch(/5/);
  });
});

describe('POST /api/assistant/confirm-batch — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  const BATCH_EVENTS = [
    { title: 'standup', start_time: '2026-05-25T10:00:00Z', end_time: '2026-05-25T10:30:00Z' },
    { title: 'standup', start_time: '2026-05-26T10:00:00Z', end_time: '2026-05-26T10:30:00Z' },
    { title: 'standup', start_time: '2026-05-27T10:00:00Z', end_time: '2026-05-27T10:30:00Z' },
  ];

  it('returns 401 when unauthenticated', async () => {
    mockIsAuthenticated = false;
    const res = await request(app)
      .post('/api/assistant/confirm-batch')
      .send({ events: BATCH_EVENTS });
    expect(res.status).toBe(401);
  });

  it('returns 400 when events array is missing', async () => {
    const res = await request(app)
      .post('/api/assistant/confirm-batch')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/events/);
  });

  it('returns 400 when events array is empty', async () => {
    const res = await request(app)
      .post('/api/assistant/confirm-batch')
      .send({ events: [] });
    expect(res.status).toBe(400);
  });

  it('creates all events and returns summary when all succeed', async () => {
    const createdBase = { allDay: false, location: null, description: null, colorId: null, attendees: [], status: 'confirmed', recurringEventId: null };
    const createEvent = jest.fn()
      .mockResolvedValueOnce({ id: 'ev-1', title: 'standup', start: '2026-05-25T10:00:00Z', end: '2026-05-25T10:30:00Z', ...createdBase })
      .mockResolvedValueOnce({ id: 'ev-2', title: 'standup', start: '2026-05-26T10:00:00Z', end: '2026-05-26T10:30:00Z', ...createdBase })
      .mockResolvedValueOnce({ id: 'ev-3', title: 'standup', start: '2026-05-27T10:00:00Z', end: '2026-05-27T10:30:00Z', ...createdBase });
    GoogleCalendarService.mockImplementation(() => ({ createEvent }));

    const res = await request(app)
      .post('/api/assistant/confirm-batch')
      .send({ events: BATCH_EVENTS });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results.every(r => r.status === 'created')).toBe(true);
    expect(res.body.summary).toMatch(/Created all 3/);
  });

  it('handles partial failures and returns accurate summary', async () => {
    const createdBase = { allDay: false, location: null, description: null, colorId: null, attendees: [], status: 'confirmed', recurringEventId: null };
    const createEvent = jest.fn()
      .mockResolvedValueOnce({ id: 'ev-1', title: 'standup', start: '2026-05-25T10:00:00Z', end: '2026-05-25T10:30:00Z', ...createdBase })
      .mockRejectedValueOnce(new Error('Calendar API error'));
    GoogleCalendarService.mockImplementation(() => ({ createEvent }));

    const res = await request(app)
      .post('/api/assistant/confirm-batch')
      .send({ events: BATCH_EVENTS.slice(0, 2) });

    expect(res.status).toBe(200);
    expect(res.body.results.filter(r => r.status === 'created')).toHaveLength(1);
    expect(res.body.results.filter(r => r.status === 'failed')).toHaveLength(1);
    expect(res.body.summary).toMatch(/Created 1 of 2/);
  });
});

// ── 3D: event editing ─────────────────────────────────────────────────────────

const UPDATE_INTENT = {
  action: 'update',
  title: null,
  title_hint: 'standup',
  time_hint: '9am',
  day_hint: null,
  new_title: null,
  new_date: null,
  new_time: null,
  preserve_time: false,
  duration_delta_minutes: null,
  start_delta_minutes: null,
  start_time: '2026-05-23T09:00:00-07:00',
  end_time: null,
  duration_minutes: 30,
  attendees: [],
  location: null,
  confidence: 0.9,
  date_known: true,
  time_known: true,
};

describe('POST /api/assistant/parse — 3D event editing', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('action=update with 1 candidate returns updateProposal with before and after', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(UPDATE_INTENT),
      chat: jest.fn().mockResolvedValue(UPDATE_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([EXISTING_EVENT])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'move my standup to 10am' });

    expect(res.status).toBe(200);
    expect(res.body.updateProposal).toBeDefined();
    expect(res.body.updateProposal).not.toBeNull();
    expect(res.body.updateProposal.candidate).toMatchObject({ id: 'ev-del-1' });
    expect(res.body.updateProposal.after).toBeDefined();
    expect(res.body.updateProposal.conflicts).toBeDefined();
  });

  it('action=update with 0 candidates returns not-found message and null updateProposal', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(UPDATE_INTENT),
      chat: jest.fn().mockResolvedValue(UPDATE_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'move my standup to 10am' });

    expect(res.status).toBe(200);
    expect(res.body.updateProposal).toBeNull();
    expect(res.body.reply).toMatch(/couldn't find/i);
  });

  it('action=update with time_hint and date_known finds event on the specified date (not just today)', async () => {
    // Regression: parseTimeHint was using today's date, so "move my event tomorrow at 1pm"
    // searched today's 1pm window and found nothing when the event was tomorrow.
    const UPDATE_INTENT_TOMORROW = {
      ...UPDATE_INTENT,
      time_hint: '1pm',
      date_known: true,
      time_known: true,
      start_time: '2026-05-26T13:00:00-07:00', // tomorrow 1pm
    };
    const TOMORROW_EVENT = {
      id: 'ev-tomorrow', title: 'standup',
      start: '2026-05-26T13:00:00-07:00', end: '2026-05-26T13:30:00-07:00',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(UPDATE_INTENT_TOMORROW),
      chat: jest.fn().mockResolvedValue(UPDATE_INTENT_TOMORROW),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    // First listEvents call (today's 1pm window) returns nothing;
    // second call (tomorrow's 1pm window, fallback) and third (conflict check) return the event.
    const listEvents = jest.fn()
      .mockResolvedValueOnce([])         // today search: empty
      .mockResolvedValue([TOMORROW_EVENT]); // fallback search + conflict check
    GoogleCalendarService.mockImplementation(() => ({ listEvents }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'move my event tomorrow at 1pm' });

    expect(res.status).toBe(200);
    expect(res.body.updateProposal).toBeDefined();
    expect(res.body.updateProposal).not.toBeNull();
    expect(res.body.updateProposal.candidate.id).toBe('ev-tomorrow');
  });

  it('action=update with time change runs conflict check on new slot', async () => {
    const updateIntentNewTime = {
      ...UPDATE_INTENT,
      start_time: '2026-05-23T10:00:00-07:00', // new desired time: 10am
    };
    const CONFLICT_AT_10AM = {
      id: 'ev-conflict-10', title: 'Another meeting',
      start: '2026-05-23T10:00:00-07:00', end: '2026-05-23T10:30:00-07:00',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };

    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(updateIntentNewTime),
      chat: jest.fn().mockResolvedValue(updateIntentNewTime),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([EXISTING_EVENT, CONFLICT_AT_10AM])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'move my standup to 10am' });

    expect(res.status).toBe(200);
    expect(res.body.updateProposal).toBeDefined();
    expect(res.body.updateProposal).not.toBeNull();
    expect(res.body.updateProposal.conflicts).toBeDefined();
    expect(res.body.updateProposal.conflicts.length).toBeGreaterThan(0);
  });

  it('moves the june-6th workout to june 8th — not the june-5th one', async () => {
    // Regression: "reschedule my workout on june 6th to june 8th" must
    // (a) only find the june-6th event, (b) produce patches that land on june 8th.
    const WORKOUT_JUN5 = {
      id: 'workout-jun5', title: 'workout',
      start: '2026-06-05T14:00:00-07:00', end: '2026-06-05T15:00:00-07:00',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };
    const WORKOUT_JUN6 = {
      id: 'workout-jun6', title: 'workout',
      start: '2026-06-06T14:00:00-07:00', end: '2026-06-06T15:00:00-07:00',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };

    const moveIntent = {
      action: 'update',
      title: 'workout',
      title_hint: 'workout',
      time_hint: null,
      day_hint: 'june 6th',
      new_title: null,
      new_date: 'june 8th',
      new_time: null,
      preserve_time: true,
      duration_delta_minutes: null,
      start_delta_minutes: null,
      // start_time intentionally points to the source date — the bug scenario
      start_time: '2026-06-06T14:00:00-07:00',
      end_time: null,
      duration_minutes: 60,
      attendees: [],
      location: null,
      confidence: 0.92,
      date_known: true,
      time_known: false,
      recurrence: null,
      target_period: null,
      preferences: null,
    };

    const listEventsMock = jest.fn();
    // First call: search june-6th window only → returns only june-6th workout
    listEventsMock.mockResolvedValueOnce([WORKOUT_JUN6]);
    // Subsequent calls: conflict check for the new slot
    listEventsMock.mockResolvedValue([]);

    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(moveIntent),
      chat: jest.fn().mockResolvedValue(moveIntent),
      suggestSlots: jest.fn().mockResolvedValue([])
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: listEventsMock
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'can you reschedule my workout on june 6th to be on june 8th instead?' });

    expect(res.status).toBe(200);

    // Must find exactly the june-6th workout, not both
    expect(res.body.updateProposal).toBeDefined();
    expect(res.body.updateProposal).not.toBeNull();
    expect(res.body.updateProposal.candidate.id).toBe('workout-jun6');

    // Patches must move the event to june 8th
    const newStart = new Date(res.body.updateProposal.after.start);
    expect(newStart.getDate()).toBe(8);
    expect(newStart.getMonth()).toBe(5); // 0-indexed: June = 5

    // june-5th workout must not be touched
    expect(res.body.candidates.every(c => c.id !== 'workout-jun5')).toBe(true);
  });
});

// ── 3C: find_slot (goal-oriented scheduling) ──────────────────────────────────

const FIND_SLOT_INTENT = {
  action: 'find_slot',
  title: 'deep work',
  start_time: '2026-05-26T00:00:00-07:00',
  end_time: null,
  duration_minutes: 120,
  attendees: [],
  location: null,
  confidence: 0.9,
  date_known: true,
  time_known: false,
  target_period: 'tomorrow',
  preferences: { avoid_back_to_back: true, preferred_time: 'morning' },
  recurrence: null,
};

const MOCK_FREE_SLOTS = [
  { start_time: '2026-05-26T09:00:00-07:00', end_time: '2026-05-26T11:00:00-07:00', score: 85, label: '2 hours before your first meeting' },
  { start_time: '2026-05-26T13:00:00-07:00', end_time: '2026-05-26T15:00:00-07:00', score: 70, label: 'quiet early afternoon' },
  { start_time: '2026-05-26T15:30:00-07:00', end_time: '2026-05-26T17:30:00-07:00', score: 50, label: 'late afternoon' },
];

describe('POST /api/assistant/parse — 3C find_slot', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('action=find_slot returns slotOptions in response', async () => {
    const findFreeSlotsMock = jest.fn().mockResolvedValue(MOCK_FREE_SLOTS);
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      chat: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      findFreeSlots: findFreeSlotsMock,
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'find me a 2-hour deep work block tomorrow' });

    expect(res.status).toBe(200);
    expect(res.body.slotOptions).toBeDefined();
    expect(res.body.slotOptions).not.toBeNull();
    expect(Array.isArray(res.body.slotOptions.slots)).toBe(true);
    expect(res.body.slotOptions.slots.length).toBeLessThanOrEqual(3);
    expect(res.body.slotOptions.title).toBe('deep work');
    expect(res.body.slotOptions.duration).toBe(120);
    expect(findFreeSlotsMock).toHaveBeenCalled();
  });

  it('find_slot filters slots that overlap existing events', async () => {
    const CALENDAR_EVENT = {
      id: 'ev-busy', title: 'Morning meeting',
      start: '2026-05-26T09:00:00-07:00', end: '2026-05-26T11:00:00-07:00',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    };
    // AI returns 2 slots: one overlaps CALENDAR_EVENT, one is clean
    const SLOTS_WITH_OVERLAP = [
      { start_time: '2026-05-26T09:00:00-07:00', end_time: '2026-05-26T11:00:00-07:00', score: 90, label: 'conflicts with morning meeting' },
      { start_time: '2026-05-26T13:00:00-07:00', end_time: '2026-05-26T15:00:00-07:00', score: 70, label: 'clean afternoon slot' },
    ];
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      chat: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      findFreeSlots: jest.fn().mockResolvedValue(SLOTS_WITH_OVERLAP),
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([CALENDAR_EVENT])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'find me a 2-hour block tomorrow' });

    expect(res.status).toBe(200);
    expect(res.body.slotOptions.slots).toHaveLength(1);
    expect(res.body.slotOptions.slots[0].label).toBe('clean afternoon slot');
  });

  it('find_slot returns empty slots array gracefully when AI finds nothing', async () => {
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      chat: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      findFreeSlots: jest.fn().mockResolvedValue([]),
    }));
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([])
    }));

    const res = await request(app)
      .post('/api/assistant/parse')
      .send({ message: 'find me time this week' });

    expect(res.status).toBe(200);
    expect(res.body.slotOptions).toBeDefined();
    expect(res.body.slotOptions.slots).toHaveLength(0);
  });
});

// ── Phase 4: voice-parse ──────────────────────────────────────────────────────

describe('POST /api/assistant/voice-parse — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).post('/api/assistant/voice-parse').send({ message: 'hello' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assistant/voice-parse — Phase 4 interceptors and fallthrough', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('Binary interceptor skips LLM and confirms active draft', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent,
    }));

    // Step 1: seed the session draft via a standard parse
    const agent = request.agent(app);
    await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'Schedule team standup tomorrow at 9am' });

    // Step 2: swap mock so we can prove Groq is NOT called on the second request
    const parseIntentSpy = jest.fn();
    AIService.mockImplementation(() => ({
      parseIntent: parseIntentSpy,
      chat: parseIntentSpy,
      suggestSlots: jest.fn().mockResolvedValue([]),
    }));
    // Keep createEvent wired for the confirm path
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent,
    }));

    const res = await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'Yes' });

    expect(res.status).toBe(200);
    expect(parseIntentSpy).not.toHaveBeenCalled();
    expect(createEvent).toHaveBeenCalled();
    expect(typeof res.body.speechReply).toBe('string');
    expect(res.body.speechReply.length).toBeGreaterThan(0);
    expect(res.body.audioMetadata.waitForInput).toBe(false);
    expect(res.body.audioMetadata.inputExpectation).toBe('none');
  });

  it('Option picker resolves cached slot options and creates event', async () => {
    const createEvent = jest.fn().mockResolvedValue(CREATED_EVENT);
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent,
    }));
    AIService.mockImplementation(() => ({
      parseIntent: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      chat: jest.fn().mockResolvedValue(FIND_SLOT_INTENT),
      suggestSlots: jest.fn().mockResolvedValue([]),
      findFreeSlots: jest.fn().mockResolvedValue(MOCK_FREE_SLOTS),
    }));

    const agent = request.agent(app);

    // Step 1: trigger find_slot to populate session active options
    await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'Find me a 2-hour deep work block tomorrow' });

    // Step 2: pick option two by spoken index
    const res = await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'Option two' });

    expect(res.status).toBe(200);
    expect(createEvent).toHaveBeenCalled();
    expect(typeof res.body.speechReply).toBe('string');
    // voice reply must be free of markdown formatting symbols
    expect(res.body.speechReply).not.toMatch(/\*\*/);
    expect(res.body.speechReply).not.toMatch(/\n/);
    expect(res.body.audioMetadata.waitForInput).toBe(false);
  });

  it('Negation interceptor clears pending draft and does not create event', async () => {
    const createEvent = jest.fn().mockResolvedValue({
      id: 'ev-neg', title: 'Team standup',
      start: '2026-05-23T09:00:00Z', end: '2026-05-23T09:30:00Z',
      allDay: false, location: null, description: null,
      colorId: null, attendees: [], status: 'confirmed', recurringEventId: null
    });
    GoogleCalendarService.mockImplementation(() => ({
      listEvents: jest.fn().mockResolvedValue([]),
      createEvent,
    }));

    const agent = request.agent(app);

    // Step 1: seed the session with a pending draft
    await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'Schedule team standup tomorrow at 9am' });

    // Step 2: cancel via negation word
    const res = await agent
      .post('/api/assistant/voice-parse')
      .send({ message: 'No' });

    expect(res.status).toBe(200);
    expect(createEvent).not.toHaveBeenCalled();
    expect(res.body.speechReply).toMatch(/cancel/i);
    expect(res.body.audioMetadata.inputExpectation).toBe('open_ended');
    expect(res.body.audioMetadata.clearToListen).toBe(true);
  });

  it('Standard fallthrough generates correct audio flags with zero markdown', async () => {
    // VALID_INTENT from beforeEach: action=create, date_known+time_known, no conflicts → binary_affirmation
    const res = await request(app)
      .post('/api/assistant/voice-parse')
      .send({ message: 'Schedule a team standup tomorrow at 9am' });

    expect(res.status).toBe(200);
    expect(typeof res.body.speechReply).toBe('string');
    expect(res.body.rawIntent).toBeDefined();
    expect(res.body.audioMetadata).toBeDefined();
    expect(typeof res.body.audioMetadata.waitForInput).toBe('boolean');
    expect(typeof res.body.audioMetadata.inputExpectation).toBe('string');
    expect(typeof res.body.audioMetadata.clearToListen).toBe('boolean');
    expect(res.body.audioMetadata.waitForInput).toBe(true);
    expect(res.body.audioMetadata.inputExpectation).toBe('binary_affirmation');
    // speechReply must contain no markdown
    expect(res.body.speechReply).not.toMatch(/\*\*/);
    expect(res.body.speechReply).not.toMatch(/\n/);
  });
});
