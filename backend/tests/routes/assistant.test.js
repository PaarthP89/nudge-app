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

const app = require('../../src/app');

// ── /chat ─────────────────────────────────────────────────────────────────────

describe('POST /api/assistant/chat — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  it('returns 401', async () => {
    const res = await request(app).post('/api/assistant/chat').send({ message: 'hello' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/assistant/chat — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  it('returns 400 when message field is missing', async () => {
    const res = await request(app).post('/api/assistant/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
  });

  it('returns 400 when message is whitespace only', async () => {
    const res = await request(app).post('/api/assistant/chat').send({ message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/);
  });

  it('returns 400 when message is not a string', async () => {
    const res = await request(app).post('/api/assistant/chat').send({ message: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 200 with a non-empty reply string for valid message', async () => {
    const res = await request(app)
      .post('/api/assistant/chat')
      .send({ message: 'Schedule a team meeting tomorrow at 2pm' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(typeof res.body.reply).toBe('string');
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it('accepts a minimal one-word message', async () => {
    const res = await request(app)
      .post('/api/assistant/chat')
      .send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
  });
});

// ── stubs still at 501 ────────────────────────────────────────────────────────

const STUB_ENDPOINTS = [
  '/api/assistant/parse',
  '/api/assistant/confirm',
  '/api/assistant/suggest'
];

describe('Assistant stubs — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  STUB_ENDPOINTS.forEach(path => {
    it(`POST ${path} returns 401`, async () => {
      const res = await request(app).post(path);
      expect(res.status).toBe(401);
    });
  });
});

describe('Assistant stubs — authenticated (not yet implemented)', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  STUB_ENDPOINTS.forEach(path => {
    it(`POST ${path} returns 501`, async () => {
      const res = await request(app).post(path);
      expect(res.status).toBe(501);
    });
  });
});
