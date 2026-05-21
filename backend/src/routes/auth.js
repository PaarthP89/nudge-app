const express = require('express');
const passport = require('passport');
const requireAuth = require('../middleware/requireAuth');
const { SCOPES } = require('../config/passport');

const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: SCOPES }));

router.get(
  '/google/callback',
  passport.authenticate('google', {
    successRedirect: process.env.FRONTEND_URL,
    failureRedirect: `${process.env.FRONTEND_URL}/login`
  })
);

router.get('/me', requireAuth, (req, res) => {
  const { id, profile } = req.user;
  res.json({
    id,
    displayName: profile.displayName,
    email: profile.emails?.[0]?.value,
    photo: profile.photos?.[0]?.value
  });
});

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.status(200).json({ message: 'Logged out' });
    });
  });
});

module.exports = router;
