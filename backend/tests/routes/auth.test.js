const request = require('supertest');

jest.mock('passport-google-oauth20', () => {
  const Strategy = jest.fn().mockImplementation(() => ({
    name: 'google',
    authenticate: jest.fn()
  }));
  return { Strategy };
});

let mockIsAuthenticated = false;
let mockUser = null;

jest.mock('passport', () => ({
  use: jest.fn(),
  initialize: jest.fn(() => (req, res, next) => next()),
  session: jest.fn(() => (req, res, next) => {
    req.isAuthenticated = () => mockIsAuthenticated;
    req.user = mockUser;
    req.logout = (cb) => { if (cb) cb(null); };
    next();
  }),
  authenticate: jest.fn(() => (req, res, next) => next()),
  serializeUser: jest.fn(),
  deserializeUser: jest.fn()
}));

const app = require('../../src/app');

const testUser = {
  id: 'user-123',
  accessToken: 'tok',
  refreshToken: 'ref',
  profile: {
    displayName: 'Test User',
    emails: [{ value: 'test@example.com' }],
    photos: [{ value: 'https://example.com/photo.jpg' }]
  }
};

beforeEach(() => {
  mockIsAuthenticated = false;
  mockUser = null;
});

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user profile when authenticated', async () => {
    mockIsAuthenticated = true;
    mockUser = testUser;
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'user-123',
      displayName: 'Test User',
      email: 'test@example.com'
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200', async () => {
    mockIsAuthenticated = true;
    mockUser = testUser;
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});
