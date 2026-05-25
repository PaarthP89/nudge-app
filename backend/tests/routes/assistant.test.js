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
  AIService.mockImplementation(() => ({
    parseIntent: parseIntentMock,
    chat: chatMock,
    suggestSlots: suggestSlotsMock
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
