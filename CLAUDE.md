# Nudge: AI-Powered Calendar Assistant

## Project Overview
Nudge is an intelligent scheduling assistant that lets users schedule calendar events through natural language (text or voice). The AI handles conflict detection, slot negotiation, and guest communication — eliminating the friction of manual calendar management.

**Goal:** Reduce time-to-schedule by 80% vs. manual Google Calendar entry. Deployable web app suitable for portfolio demonstration.

**Status:** Google OAuth login complete (2026-05-21), implementing Phase 1 features.

**Note:** This document is updated regularly as features are completed. Check the Phase checkboxes and timestamps to track progress.

## Tech Stack

### Frontend
- **React (Vite)** — calendar grid, chat UI, voice input
- **Web Speech API** — browser-native speech-to-text for voice input

### Backend
- **Node.js + Express** — REST API, session management, OAuth proxy
- **express-session** — session management
- **Passport.js** — Google OAuth 2.0 authentication
- **Testing:** Jest, Supertest, or similar for API tests

### AI & External Services
- **Claude API (claude-sonnet-4)** — intent parsing, conflict resolution, rescheduling suggestions
- **Google Calendar API v3** — read/write events
- **Gmail API** — send invite emails
- **Google OAuth 2.0** — authentication with calendar + Gmail scopes

### Deployment (Later)
- Backend: Railway or Render
- Frontend: Vercel

## Development Approach
- **TDD / Test First:** Write tests for backend endpoints and core logic before implementation
- **API-driven:** All frontend interactions go through Express backend; no tokens exposed to frontend
- **Session-based auth:** OAuth tokens stored server-side, refreshed automatically
- **Iterative phases:** Phase 1 (P0 features) → Phase 2 (P1 features) → Phase 3 (P2 features)

## Phase 1: Core P0 Features (MVP)
- [x] Project setup (repo, frontend/backend structure) — ✓ Scaffolding complete (2026-05-21)
  - Express backend with auth, calendar, assistant routes
  - React + Vite frontend with Router, placeholder components
  - Jest + Supertest tests (21 passing)
  - Google OAuth, Google Calendar API, Claude API, Gmail API wired
- [x] Google Calendar OAuth 2.0 login — ✓ Complete (2026-05-21)
  - Passport Google strategy with offline access + refresh token preservation
  - Scopes: profile, email, Google Calendar, Gmail send
  - Frontend login page tested end-to-end
- [ ] Live calendar grid view (month/week, read-only initially)
- [ ] Text-based NL scheduling input (chat interface)
- [ ] AI intent parsing (extract: action, title, attendees, time, duration, location)
- [ ] Conflict detection (query existing events, flag overlaps)
- [ ] Confirmation step before write (show parsed event, allow edit)
- [ ] Create/delete calendar events (write to Google Calendar)

## Phase 2: P1 Features (Enhanced UX)
- [ ] AI rescheduling suggestions (if conflict, suggest alternatives)
- [ ] Guest email invites via Gmail API
- [ ] Voice input (Web Speech API)
- [ ] Chat history / conversation memory (multi-turn context)

## Phase 3: P2 Features (Polish)
- [ ] Event detail sidebar / click to edit
- [ ] Smart time suggestions (AI finds optimal slots)
- [ ] Meeting prep summaries (pre-event briefing)

## API Endpoints (Express)

### Authentication
- `GET /api/auth/google` — Initiate OAuth flow
- `GET /api/auth/google/callback` — OAuth redirect handler
- `GET /api/auth/me` — Get current user profile
- `POST /api/auth/logout` — Destroy session

### Calendar (all require session auth)
- `GET /api/calendar/events` — Fetch events for date range
- `POST /api/calendar/events` — Create event
- `PATCH /api/calendar/events/:id` — Update event
- `DELETE /api/calendar/events/:id` — Delete event
- `GET /api/calendar/freebusy` — Check free/busy slots

### AI Assistant (all require session auth)
- `POST /api/assistant/parse` — Parse NL input → structured intent
- `POST /api/assistant/confirm` — Execute confirmed intent
- `POST /api/assistant/chat` — Multi-turn conversation
- `POST /api/assistant/suggest` — Ask AI for open slot suggestions

## Project Structure (TBD)
```
nudge-app/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── calendar.js
│   │   │   └── assistant.js
│   │   ├── middleware/
│   │   ├── services/
│   │   │   ├── googleCalendar.js
│   │   │   ├── gmail.js
│   │   │   └── claude.js
│   │   ├── utils/
│   │   └── app.js
│   ├── tests/
│   │   ├── routes/
│   │   ├── services/
│   │   └── setup.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Calendar/
│   │   │   ├── Chat/
│   │   │   └── VoiceInput/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── docs/
│   └── nudge-prd.docx
└── CLAUDE.md
```

## Ground Rules
- **Never push to GitHub.** User handles all pushes.
- **TDD for backend.** Write tests before implementation for routes and services.
- **Proxy all external APIs through Express.** No tokens exposed to frontend.
- **Session-based auth.** OAuth tokens stored server-side, never sent to client.

## Non-Goals (v1.0)
- Multi-user / team calendars
- Mobile-native iOS/Android (web-responsive is sufficient)
- Third-party integrations beyond Google Calendar and Gmail
- Recurring event management via NL
- Production billing or infrastructure

## Notes for Implementation
- Use Claude API for robust intent parsing, conflict resolution, and suggestion generation
- Start with in-memory session storage for dev; upgrade to Redis if needed
- Plan for graceful conflict handling: detection → AI-generated alternatives → user confirmation
- Voice input is free (Web Speech API) but limited; text input is primary
