require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const passport = require('passport');

require('./config/passport');

const authRouter = require('./routes/auth');
const calendarRouter = require('./routes/calendar');
const assistantRouter = require('./routes/assistant');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/assistant', assistantRouter);

app.use(errorHandler);

module.exports = app;
