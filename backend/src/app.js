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
app.set('trust proxy', 1); // required on Render — proxy terminates TLS, req.secure is otherwise false

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days; rolling resets on each request
  }
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/assistant', assistantRouter);

app.use(errorHandler);

module.exports = app;
