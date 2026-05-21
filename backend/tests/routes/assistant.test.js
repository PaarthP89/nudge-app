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

const ASSISTANT_ENDPOINTS = [
  { method: 'post', path: '/api/assistant/parse' },
  { method: 'post', path: '/api/assistant/confirm' },
  { method: 'post', path: '/api/assistant/chat' },
  { method: 'post', path: '/api/assistant/suggest' }
];

describe('Assistant routes — unauthenticated', () => {
  beforeEach(() => { mockIsAuthenticated = false; });

  ASSISTANT_ENDPOINTS.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} returns 401`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    });
  });
});

describe('Assistant routes — authenticated', () => {
  beforeEach(() => { mockIsAuthenticated = true; });

  ASSISTANT_ENDPOINTS.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} returns 501`, async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(501);
    });
  });
});
