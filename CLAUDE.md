# Nudge: AI-Powered Calendar Assistant

## Project Overview
Nudge is an intelligent scheduling assistant that lets users schedule calendar events through natural language (text or voice). The AI handles conflict detection, slot negotiation, and guest communication — eliminating the friction of manual calendar management.

**Goal:** Reduce time-to-schedule by 80% vs. manual Google Calendar entry. Deployable web app suitable for portfolio demonstration.

**Status:** Phase 2 complete (2026-05-22). All MVP + enhanced UX features working: multi-turn chat, draft accumulation, conflict detection, AI rescheduling suggestions, chat-based delete, calendar query, email invites, event deletion via calendar click, and 30-day persistent sessions.

**Note:** This document is updated regularly as features are completed. Check the Phase checkboxes and timestamps to track progress.

## Tech Stack

### Frontend
- **React (Vite)** — calendar grid, chat UI, voice input
- **Web Speech API** — browser-native speech-to-text for voice input (Phase 4)

### Backend
- **Node.js + Express** — REST API, session management, OAuth proxy
- **express-session** — session management
- **Passport.js** — Google OAuth 2.0 authentication
- **Testing:** Jest + Supertest (106 tests passing)

### AI & External Services
- **Groq SDK (llama-3.3-70b-versatile)** — intent parsing, conflict resolution, rescheduling suggestions (free tier, 30 RPM). Model is configurable via `GROQ_MODEL` env var. Service abstracted as `AIService` — swap provider by editing `src/services/ai.js` only.
- **Google Calendar API v3** — read/write/delete events
- **Gmail API** — send invite emails with "Add to Google Calendar" button
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
- [x] Project setup (repo, frontend/backend structure) — ✓ Complete (2026-05-21)
  - Express backend with auth, calendar, assistant routes
  - React + Vite frontend with Router, placeholder components
  - Jest + Supertest tests scaffolded
  - Google OAuth, Google Calendar API, Groq API, Gmail API wired
- [x] Google Calendar OAuth 2.0 login — ✓ Complete (2026-05-21)
  - Passport Google strategy with offline access + refresh token preservation
  - Scopes: profile, email, Google Calendar, Gmail send
  - Frontend login page tested end-to-end
- [x] Live calendar grid view (month/week, read-only) — ✓ Complete (2026-05-22)
  - Month and week views with day/week/month navigation
  - All-day event strip; timed events with overlap layout
  - Today indicator and today button; today circle in date
- [x] Text-based NL scheduling input (chat interface) — ✓ Complete (2026-05-22)
  - ChatPanel component with message thread, typing indicator, input row
  - Message type system: text | intent | conflict | confirm | deleteConfirm | queryResult
- [x] AI intent parsing (extract: action, title, attendees, time, duration, location) — ✓ Complete (2026-05-22)
  - Groq via `AIService` (`src/services/ai.js`) — provider-agnostic; swap model via `GROQ_MODEL` env var
  - Currently using `llama-3.3-70b-versatile` (upgraded from 8b for reliable instruction-following)
  - Intent schema includes `date_known` and `time_known` booleans; tracked separately so partial info accumulates correctly across turns
  - `parseIntent` catches malformed model output and returns fallback unknown intent (no 500s)
  - `buildIntentReply` covers all 8 combinations of missing/present title/date/time and asks for exactly what's missing; handles delete, query, update actions distinctly
  - Conflict check only runs when `date_known && time_known` (never on midnight placeholders)
  - Confirm card only shown when title + date_known + time_known + confidence >= 0.5
  - Running draft intent (useRef) accumulates fields across turns via `mergeDraft()`; date+time from separate turns are combined when both eventually known
  - Draft cleared only on successful confirm or cancel
  - Context injected as compact `[DRAFT:title="x" datetime=...]` prefix — prevents model from misreading label text as event content
  - System prompt includes concrete action-mapping examples for all 5 action types
  - Keyword override safety net in route: if model returns `unknown` but message contains clear action keyword (delete/schedule/etc.), action is corrected before downstream logic runs
- [x] Conflict detection (query existing events, flag overlaps) — ✓ Complete (2026-05-22)
  - `detectConflicts` pure function in googleCalendar.js; skips all-day events
  - Overlap: `eventStart < intentEnd && eventEnd > intentStart`
  - ConflictCard shown with **Continue anyway** and **Cancel** buttons; Cancel wipes the draft entirely
- [x] Confirmation step before write (show parsed event, allow edit) — ✓ Complete (2026-05-22)
  - ConfirmCard with idle | loading | done | error | cancelled states (only shown when no conflicts)
  - When conflicts exist, ConflictCard handles scheduling directly — no duplicate confirm card
- [x] Create calendar events (write to Google Calendar) — ✓ Complete (2026-05-22)
  - `createEvent` in GoogleCalendarService; infers end time from duration_minutes
  - `POST /api/assistant/confirm` route; returns 201 with normalized event
  - Calendar grid auto-refreshes 500ms after successful scheduling (custom DOM event `nudge:event-created`)
- [x] Persistent login sessions — ✓ Complete (2026-05-22)
  - express-session cookie maxAge: 30 days; rolling: true resets expiry on each request
  - Google refresh_token stored in session; googleapis handles access token auto-refresh per request

## Phase 2: P1 Features (Enhanced UX)
- [x] Delete calendar events — ✓ Complete (2026-05-22)
  - `GoogleCalendarService.deleteEvent()` calls `calendar.events.delete` with `sendUpdates: 'all'`
  - `DELETE /api/calendar/events/:id` route implemented
  - CalendarView: click any event chip/week event → EventDetailModal with title, time, location, attendees + Delete button; modal remounts fresh per event (key prop) so state never bleeds between events
  - Chat-based delete: `/parse` searches calendar when action=delete, returns up to 3 candidates
    - time_known: searches ±30–90 min window; date_known only: searches whole day; title only: searches next 7 days
    - Title-filtered if AI extracted a title; falls back to all timed events in window
    - DeleteConfirmCard shown with event title + time + Delete button per candidate
    - Fires `nudge:event-deleted` and refreshes calendar 500ms after confirm
    - Reply overridden: "Found X — confirm deletion?" or "couldn't find" message
  - Both calendar click and chat delete fire `nudge:event-deleted`; useCalendar listens on both create and delete
- [x] AI rescheduling suggestions — ✓ Complete (2026-05-22)
  - `AIService.suggestSlots(intent, conflicts)` calls Groq to generate 3 alternative time slots as JSON
  - `/parse` route calls `suggestSlots` when conflicts detected; returns `suggestions` in response
  - ConflictCard shows "Try one of these instead:" with clickable slot buttons
  - Picking a suggestion updates draft with new start/end times and shows ConfirmCard
- [x] Guest email invites via Gmail API — ✓ Complete (2026-05-22)
  - `GmailService.sendInvite(to, eventDetails)` sends HTML email via `gmail.users.messages.send`
  - `/confirm` route sends invites to all attendees with `@` in their address after creating event
  - Returns `invitesSent` and `inviteErrors` arrays; ConfirmCard success shows invite count
  - Email includes "Add to Google Calendar" button (Google Calendar template URL, pre-filled with event details)
- [x] Chat history / conversation memory — ✓ Complete (2026-05-22)
  - `AIService.chat(messages, context)` accepts full message history + system prompt
  - `/parse` route accepts `history` array (sanitized: valid roles, ≤10 turns, ≤500 chars each)
  - Uses `chat()` when history provided, `parseIntent()` otherwise
  - Frontend `useChat.js` maintains `historyRef` (capped at 10 turns) and sends with each request
  - Frontend sends local datetime + timezone string with every request (prevents UTC date-shift bug where server clock misidentifies "tomorrow")
  - Abort phrases (nevermind, cancel, stop, forget it, start over, etc.) handled client-side — clears draft + history without hitting the AI API
- [x] Calendar query via chat — ✓ Complete (2026-05-22)
  - "What's on my calendar Sunday?" / "Do I have anything tomorrow?" → action: query
  - `/parse` route fetches events for the day when action=query and date_known; returns `queryResults`
  - QueryResultCard shows each event with title and time range
  - "Nothing on your calendar for X" reply when day is empty

## Phase 3: P2 Features (Polish)
- [ ] Event detail sidebar / click to edit
- [ ] Smart time suggestions (AI finds optimal slots)
- [ ] Meeting prep summaries (pre-event briefing)

## Phase 4: Voice Input
- [ ] Voice input (Web Speech API) — browser-native speech-to-text, no API cost

## API Endpoints (Express)

### Authentication
- `GET /api/auth/google` — Initiate OAuth flow
- `GET /api/auth/google/callback` — OAuth redirect handler
- `GET /api/auth/me` — Get current user profile
- `POST /api/auth/logout` — Destroy session

### Calendar (all require session auth)
- `GET /api/calendar/events` — Fetch events for date range
- `POST /api/calendar/events` — Create event (stub 501)
- `PATCH /api/calendar/events/:id` — Update event (stub 501)
- `DELETE /api/calendar/events/:id` — Delete event
- `GET /api/calendar/freebusy` — Check free/busy slots (stub 501)

### AI Assistant (all require session auth)
- `POST /api/assistant/parse` — Parse NL input → structured intent + conflicts + candidates + queryResults
- `POST /api/assistant/confirm` — Execute confirmed create intent; sends email invites
- `POST /api/assistant/chat` — Alias for /parse (same handler, accepts history)
- `POST /api/assistant/suggest` — Ask AI for open slot suggestions (stub 501)

## Project Structure
```
nudge-app/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── calendar.js
│   │   │   └── assistant.js
│   │   ├── middleware/
│   │   │   └── requireAuth.js
│   │   ├── services/
│   │   │   ├── ai.js           ← provider-agnostic AI service (Groq today, swappable)
│   │   │   ├── googleCalendar.js
│   │   │   └── gmail.js
│   │   └── app.js
│   ├── tests/
│   │   ├── routes/
│   │   │   ├── assistant.test.js
│   │   │   ├── calendar.test.js
│   │   │   └── auth.test.js
│   │   ├── services/
│   │   │   ├── ai.test.js
│   │   │   └── googleCalendar.test.js
│   │   └── setup.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Calendar/
│   │   │   │   ├── CalendarView.jsx
│   │   │   │   └── CalendarView.css
│   │   │   └── Chat/
│   │   │       ├── ChatPanel.jsx
│   │   │       └── ChatPanel.css
│   │   ├── pages/
│   │   ├── hooks/
│   │   │   ├── useCalendar.js
│   │   │   └── useChat.js
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
- AI service is abstracted in `src/services/ai.js` — to swap providers, only that file needs changes
- Currently using `llama-3.3-70b-versatile` via Groq; configurable via `GROQ_MODEL` env var
- Session storage is in-memory for dev; upgrade to Redis if needed for production
- Voice input (Phase 4) is free via Web Speech API but browser-limited; text input is primary
