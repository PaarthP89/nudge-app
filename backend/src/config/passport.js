const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send'
];

const users = new Map();

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL}/api/auth/google/callback`
  },
  (accessToken, refreshToken, profile, done) => {
    const existing = users.get(profile.id);
    const user = {
      id: profile.id,
      accessToken,
      refreshToken: refreshToken || existing?.refreshToken,
      profile
    };
    users.set(profile.id, user);
    return done(null, user);
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = users.get(id);
  if (!user) return done(new Error('User not found'));
  done(null, user);
});

module.exports = { SCOPES };
