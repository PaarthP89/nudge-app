# Nudge: AI-Powered Calendar Assistant

## Project Overview
Nudge is an intelligent scheduling assistant that lets users schedule calendar events through natural language (text or voice). The AI handles conflict detection, slot negotiation, and guest communication — eliminating the friction of manual calendar management.

**Goal:** Reduce time-to-schedule by 80% vs. manual Google Calendar entry. Deployable web app suitable for portfolio demonstration.

**Status:** Phase 2 complete (2026-05-22). Phase 3B complete (2026-05-25). Phase 3D complete (2026-05-25). Phase 3A complete (2026-05-25). All MVP + enhanced UX features working: multi-turn chat, draft accumulation, conflict detection, AI rescheduling suggestions, chat-based delete, calendar query, email invites, event deletion via calendar click, 30-day persistent sessions, natural language event editing, and recurring/batch event scheduling. Phase 3B adds autonomous conflict resolution. Phase 3D adds NL event editing. Phase 3A adds batch scheduling: user says "standup every weekday at 10am" → AI expands recurrence → conflict-checks all instances → BatchPlanCard shows plan with ⚠ badges → single confirm creates all events via `POST /confirm-batch`. 127 tests passing.

**Note:** This document is updated regularly as features are completed. Check the Phase checkboxes and timestamps to track progress.

## Tech Stack

### Frontend
- **React (Vite)** — calendar grid, chat UI, voice input
- **Web Speech API** — browser-native speech-to-text for voice input (Phase 4)

### Backend
- **Node.js + Express** — REST API, session management, OAuth proxy
- **express-session** — session management
- **Passport.js** — Google OAuth 2.0 authentication
- **Testing:** Jest + Supertest (127 tests passing)

### AI & External Services
- **Groq SDK (llama-3.3-70b-versatile)** — intent parsing, conflict resolution, rescheduling suggestions (free tier, 30 RPM). Model is configurable via `GROQ_MODEL` env var. Service abstracted as `AIService` — swap provider by editing `src/services/ai.js` only.
- **Google Calendar API v3** — read/write/delete events
- **Gmail API** — send invite emails with "Add to Google Calendar" button
- **Google OAuth 2.0** — authentication with calendar + Gmail scopes

### Deployment
- Backend: Railway or Render
- Frontend: Vercel

## Development Approach
- **TDD / Test First:** Write tests for backend endpoints and core logic before implementation
- **API-driven:** All frontend interactions go through Express backend; no tokens exposed to frontend
- **Session-based auth:** OAuth tokens stored server-side, refreshed automatically
- **Iterative phases:** Phase 1 (P0 features) → Phase 2 (P1 features) → Phase 3 (P2 features)

---

## Phase 1: Core P0 Features (MVP) ✓ Complete
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

---

## Phase 2: P1 Features (Enhanced UX) ✓ Complete
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

---

## Phase 3: Agentic Scheduling (The Core Upgrade)

**North star:** Nudge stops being a chatbot that creates single events and becomes an agent that reasons about your calendar, executes multi-step plans, and only asks for input when it genuinely needs it. The user states a goal; Nudge figures out how to achieve it.

### What "agentic" means here (implementation philosophy)
- **Current behavior:** user input → parse one intent → wait for user confirmation → write one event
- **Agentic behavior:** user states a goal → Nudge plans N actions → checks all for conflicts autonomously → presents a plan summary → executes on confirmation → reports results
- The user should never have to confirm each event individually when scheduling a batch. One confirmation approves the whole plan.
- Nudge only surfaces conflicts it cannot resolve on its own. If it can find a clean slot, it does — silently.

---

### 3A: Recurring / batch event scheduling ✓ Complete (2026-05-25)
**User story:** "Add a 1-hour workout every weekday next week at 6am" or "Schedule standup Monday through Friday at 9am for the next 3 weeks"

**What Nudge does:**
1. Parses the recurrence pattern from natural language (daily, weekly, specific days, N weeks/months)
2. Expands the pattern into a list of individual event instances with exact datetimes
3. Runs `detectConflicts` on ALL instances in one pass before showing the user anything
4. Presents a **BatchPlanCard** showing: how many events will be created, any conflicts found
5. Conflicted instances show a ⚠ badge; user can "Confirm all" or "Skip conflicted"
6. Single "Confirm all" button creates every event; calendar refreshes once when done
7. Reports: "Created all 5 events" or "Created 4 of 5 — 1 failed"

**What changed:**
- `parseIntent` schema: added `recurrence` field `{ type, days, count, until, interval }` + 2 few-shot examples
- `normalizeAIResponse`: passes through `recurrence` field
- `AIService.expandRecurrence(intent, { now, timezone })` — calls Groq with a lean prompt to expand recurrence into flat `[{title, start_time, end_time}]` array; strips code fences, validates array
- `/parse` route: when `intent.recurrence` is set, calls `expandRecurrence`, fetches events for the full date range in one calendar API call, runs `detectConflicts` on every instance, annotates each with `conflicts`, returns `batchPlan: { instances, summary }`; skips normal single-event conflict path
- `POST /api/assistant/confirm-batch` — accepts `{ events }` array, creates sequentially, returns `{ results, summary }`
- `BatchPlanCard.jsx` — shows instance list with ⚠ conflict badges, "Confirm all N", "Skip X conflicted, confirm Y", Cancel
- `useChat.js`: added `confirmBatch` (POSTs to `/confirm-batch`, fires `nudge:batch-created`, clears draft + history); handles `batchPlan` response (suppresses regular confirm card when batch)
- `useCalendar.js`: listens for `nudge:batch-created` to refresh calendar
- 10 new TDD tests (3 in `ai.test.js`, 7 in `assistant.test.js`); 127 tests total, all passing

---

### 3B: Autonomous conflict resolution loop ✓ Complete (2026-05-25)
**User story:** "Move my 2pm Tuesday meeting to sometime this week" or user picks a slot that's already taken

**What Nudge does — the agentic loop:**
1. Detects a conflict on the requested slot
2. Calls `suggestSlots` to generate alternatives
3. **Immediately runs `detectConflicts` on each suggestion** — before showing the user anything
4. Filters out any suggestions that are also conflicted
5. Shows only clean slots in the ConflictCard
6. If ALL suggestions are conflicted (rare), runs one more round with tighter constraints, then asks the user
7. User never sees a "suggested slot" that also has a conflict

**What changed:**
- `AIService.suggestSlots(intent, conflicts, options = {})` — added `options.excludeRanges`; injected into prompt so second-pass avoids already-known conflicted times
- `/parse` route: validation loop after `suggestSlots`; runs `detectConflicts` on each suggestion; if 0 clean → second call with `{ excludeRanges }`; max 2 `suggestSlots` calls total; graceful fallback to raw suggestions if loop exhausted
- Response now includes `loopIterations` (0–1) for debugging; frontend ignores it
- `ConflictCard` unchanged — it just receives pre-validated clean slots now
- 3 new TDD tests in `tests/routes/assistant.test.js`; 109 tests total, all passing

**This is the core agentic behavior:** Nudge reasons through the problem autonomously and only surfaces it to the user when it's stuck, not at every step.

---

### 3C: Goal-oriented scheduling ("fit this in")
**User story:** "I need a 2-hour deep work block sometime tomorrow" or "Find me time for a 30-minute call with Sarah this week"

**What Nudge does:**
1. Reads the user's calendar for the target period (already possible via `getEvents`)
2. Identifies free windows that match the requested duration
3. Scores slots by quality: prefers mid-morning, avoids back-to-back meetings, respects working hours (8am–7pm default)
4. Presents top 3 options ranked by score with brief reasoning: "9am–11am — 2 hours before your first meeting" 
5. User picks one (or says "the first one") → confirm → create

**AI changes:**
- New `AIService.findFreeSlots(events, duration, preferences)` — takes existing calendar events, returns scored free windows as JSON
- Prompt instructs model to reason about working hours, meeting density, time-of-day preferences
- `/parse` route: when action=`find_slot`, fetch events for target range, call `findFreeSlots`, return `slotOptions` array

**Frontend changes:**
- New `SlotOptionsCard` component: shows 3 ranked options with time + brief label; tapping one populates draft and shows ConfirmCard

---

### 3D: Natural language event editing ✓ Complete (2026-05-25)
**User story:** "Move my dentist appointment to next Thursday at the same time" or "Make my 3pm meeting an hour longer"

**What Nudge does:**
1. Parses action=`update`, finds the event on the calendar (same candidate search logic as delete)
2. Applies the modification: new datetime, new duration, new title, added attendees, or any combination
3. Checks the new slot for conflicts before writing
4. Shows an **EditConfirmCard** with before/after: "Dentist: Tue May 26 10am → Thu May 28 10am — Confirm?"
5. On confirm: calls `calendar.events.patch` (not delete+create — preserves event ID and existing attendees)
6. Sends update notification emails to attendees if time changed (via `sendUpdates: 'all'` on patch)

**What changed:**
- `GoogleCalendarService.updateEvent(eventId, patches)` — `calendar.events.patch` with `sendUpdates: 'all'`
- `PATCH /api/calendar/events/:id` route — implemented (was 501 stub)
- `/parse` route: action=`update` → candidate search (time_hint > title_hint > date fallback) → `computeUpdatePatches` (handles new time, preserve_time, start_delta_minutes, duration_delta_minutes, new_title) → conflict check on new slot (excludes the candidate itself) → `updateProposal` in response
- `parseIntent` prompt: 6 new update examples + 9 new optional fields (title_hint, time_hint, day_hint, new_title, new_date, new_time, preserve_time, duration_delta_minutes, start_delta_minutes)
- `buildIntentReply` for update: "Looking for X on your calendar…" (was "not supported")
- `EditConfirmCard.jsx` — before/after diff with strikethrough, conflict warning, fires `nudge:event-updated`
- `useChat.js`: `confirmUpdate` callback (PATCH + `nudge:event-updated`), handles `updateProposal` → `editConfirm` message
- `useCalendar.js`: listens for `nudge:event-updated` to refresh calendar
- 8 new tests; 117 total, all passing

---

### Phase 3 implementation order
Build in this sequence — each step is independently useful and unblocks the next:

1. ~~**3B first** (conflict loop)~~ ✓ Complete (2026-05-25)
2. ~~**3D next** (event editing)~~ ✓ Complete (2026-05-25)
3. ~~**3A third** (batch scheduling)~~ ✓ Complete (2026-05-25)
4. **3C last** (find free slots) — most novel AI feature, good capstone, depends on solid event reading from prior phases

---

### Phase 3 new API endpoints
- ~~`POST /api/assistant/confirm-batch` — create multiple events, return results array~~ ✓ Complete (2026-05-25)
- `PATCH /api/calendar/events/:id` — update event fields (implements existing stub)

### Phase 3 new frontend components
- ~~`BatchPlanCard` — shows N events to be created, conflict badges, single confirm~~ ✓ Complete (2026-05-25)
- `SlotOptionsCard` — shows ranked free slot options with labels
- ~~`EditConfirmCard` — before/after diff for event updates~~ ✓ Complete (2026-05-25)

### Phase 3 new AIService methods
- ~~`AIService.expandRecurrence(intent)` → `DateTime[]`~~ ✓ Complete (2026-05-25)
- `AIService.findFreeSlots(events, duration, preferences)` → scored slot array
- Updates to `suggestSlots` to accept `excludeRanges` for second-pass conflict avoidance

---


---

## Phase 3 AI Implementation Philosophy

> Read this before implementing ANY Phase 3 feature. This is the difference between building a smart agent and a fancy chatbot.

### The core problem with "dumb" AI implementations

Claude Code tends to implement AI features as simple request-response:
`user input → LLM call → parse JSON → respond`

This produces AI that feels like a form with autocomplete. Phase 3 requires actual agent behavior:
`user states goal → backend reasons autonomously → executes plan → surfaces only what it cannot resolve`

The user should never see the AI "thinking out loud" or asking for clarification it could resolve itself.

### Principle 1: Lean system prompts, rich dynamic context

Keep base system prompts under 400 tokens. Everything specific to the current request (existing events, conflicts, user timezone, current draft) gets injected dynamically into the user turn — not hardcoded into the system prompt. A bloated system prompt degrades reasoning quality on the actual task.

**Pattern:**
```
system: [lean role + output schema + 2-3 few-shot examples]
user: [CONTEXT: dynamic state] [REQUEST: user's actual message]
```

### Principle 2: Few-shot examples are non-negotiable

Every AI method needs 2-3 concrete input/output examples in the system prompt. Without them, the model guesses at edge cases. With them, it handles "delete my thing tomorrow" and "move it to sometime next week" and "add an hour to that meeting" reliably.

Bad prompt: "Extract the action from the user's message."
Good prompt: "Extract the action. Examples: 'delete my 2pm' → action: delete. 'move Tuesday standup to Thursday' → action: update. 'am I free Friday afternoon' → action: query."

### Principle 3: Validation loops happen in the backend, not the frontend

When the AI suggests alternatives, the backend must validate them against real calendar data BEFORE sending to the frontend. The user never sees a "suggested slot" that is also conflicted. This is the core of 3B and applies to 3C as well.

```
// WRONG — dumb implementation
const suggestions = await ai.suggestSlots(intent, conflicts);
return { suggestions }; // might contain conflicted slots

// RIGHT — agentic implementation  
const suggestions = await ai.suggestSlots(intent, conflicts);
const cleanSuggestions = suggestions.filter(s =>
  detectConflicts(events, s).length === 0
);
if (cleanSuggestions.length === 0) {
  // Second pass with excludeRanges — max 2 iterations
  const excludeRanges = suggestions.map(s => ({ start: s.start_time, end: s.end_time }));
  const retry = await ai.suggestSlots(intent, conflicts, { excludeRanges });
  return { suggestions: retry };
}
return { suggestions: cleanSuggestions };
```

### Principle 4: Plan-then-Execute for batch operations (3A)

For recurring/batch events: the AI plans ALL instances first, the backend validates ALL of them, then a single confirmation executes ALL of them. Never confirm one event at a time in a loop.

```
// 3A flow
const instances = await ai.expandRecurrence(intent);       // plan
const validated = instances.map(inst => ({                  // validate all
  ...inst,
  conflicts: detectConflicts(events, inst)
}));
return { batchPlan: validated };                            // single confirm → execute all
```

### Principle 5: Fuzzy candidate matching, not exact ID lookup

For delete and update actions, the user will never say an event ID. They say "my dentist appointment" or "the 2pm Tuesday thing". The candidate search must:
1. Parse whatever time/title hint the AI extracted
2. Search a window (±90 min for time_known, whole day for date_known, next 7 days for title_only)
3. Filter by title similarity if AI extracted a title
4. Return up to 3 candidates for user disambiguation if ambiguous

This logic already exists for delete — 3D (update) must reuse it exactly, not reimplement it.

---

### Prompt templates for each Phase 3 AI method

#### `AIService.suggestSlots(intent, conflicts, options = {})`

```
system:
You are a scheduling assistant. Given a scheduling conflict, suggest 3 alternative time slots.
Return ONLY a JSON array of slot objects: [{"start_time": "ISO8601", "end_time": "ISO8601", "label": "brief human label"}]
Rules: Stay within working hours (8am–7pm). Prefer the same day first, then next 2 days.
{{#if excludeRanges}}Avoid these times: {{excludeRanges}}{{/if}}
Examples:
- Conflict at 2pm Tuesday → suggest: 3pm Tue, 10am Wed, 2pm Wed
- Conflict at 9am → suggest: 10am same day, 9am next day, 11am same day

user:
[INTENT: title="{{title}}" requested={{start}}–{{end}} duration={{duration}}min]
[CONFLICTS: {{conflictSummary}}]
[DATE: today is {{localDatetime}}, timezone {{timezone}}]
Suggest 3 clean alternative slots.
```

#### `AIService.expandRecurrence(intent)`

```
system:
You are a scheduling assistant. Expand a recurring event description into individual event instances.
Return ONLY a JSON array: [{"title": "...", "start_time": "ISO8601", "end_time": "ISO8601"}]
Generate every instance explicitly — no recurrence rules, just the flat list of datetimes.
Examples:
- "workout every weekday next week at 6am for 1 hour" → 5 objects (Mon–Fri)
- "standup Mon/Wed/Fri for 2 weeks at 9am 30min" → 6 objects

user:
[REQUEST: "{{userMessage}}"]
[PARSED: title="{{title}}" recurrence={{recurrenceObject}} duration={{duration}}min]
[DATE: today is {{localDatetime}}, timezone {{timezone}}]
Expand into individual instances.
```

#### `AIService.findFreeSlots(events, duration, preferences)`

```
system:
You are a scheduling assistant. Given a user's calendar events and a requested duration, find the 3 best free time windows.
Return ONLY a JSON array: [{"start_time": "ISO8601", "end_time": "ISO8601", "score": 0–100, "label": "brief reason"}]
Scoring rules (higher = better):
- Mid-morning slots (9am–11am): +30
- Early afternoon (1pm–3pm): +20
- Avoids back-to-back (30+ min buffer before next event): +25
- Within working hours (8am–7pm): required
- Avoids early morning (<8am) or late evening (>7pm): -50

user:
[EVENTS: {{JSON.stringify(eventsForPeriod)}}]
[REQUEST: find {{duration}} min block in {{targetPeriod}}]
[DATE: today is {{localDatetime}}, timezone {{timezone}}]
Return top 3 scored free slots with labels.
```

#### Update intent parsing for 3D (add to existing `parseIntent` system prompt)

Add these examples to the existing few-shot section:
```
"move my dentist to next Thursday at the same time" → action: update, title: "dentist", new_date: "next Thursday", preserve_time: true
"make my 3pm meeting an hour longer" → action: update, time_hint: "3pm", duration_delta: +60
"rename my standup to team sync" → action: update, title_hint: "standup", new_title: "team sync"
"move Tuesday standup to Thursday same time" → action: update, title_hint: "standup", day_hint: "Tuesday", new_date: "Thursday", preserve_time: true
```

---

### Testing philosophy for Phase 3 AI features

AI methods cannot be tested with exact output assertions — the model is non-deterministic. Test the STRUCTURE and CONSTRAINTS instead:

```javascript
// WRONG
expect(result.suggestions[0].start_time).toBe('2026-05-27T09:00:00');

// RIGHT
expect(result.suggestions).toHaveLength(3);
expect(result.suggestions.every(s => s.start_time && s.end_time)).toBe(true);
expect(result.suggestions.every(s => {
  const hour = new Date(s.start_time).getHours();
  return hour >= 8 && hour <= 19; // within working hours
})).toBe(true);
```

For the conflict loop (3B), mock `suggestSlots` to return known conflicted times and assert the backend filters them before responding.

For batch scheduling (3A), mock `expandRecurrence` with a fixed 5-instance array and assert all 5 are conflict-checked before the batch plan is returned.

---
---

## Phase 4: Voice Input
- [ ] Voice input (Web Speech API) — browser-native speech-to-text, no API cost

---

## API Endpoints (Express)

### Authentication
- `GET /api/auth/google` — Initiate OAuth flow
- `GET /api/auth/google/callback` — OAuth redirect handler
- `GET /api/auth/me` — Get current user profile
- `POST /api/auth/logout` — Destroy session

### Calendar (all require session auth)
- `GET /api/calendar/events` — Fetch events for date range
- `POST /api/calendar/events` — Create event (stub 501)
- `PATCH /api/calendar/events/:id` — Update event (implemented in Phase 3D)
- `DELETE /api/calendar/events/:id` — Delete event
- `GET /api/calendar/freebusy` — Check free/busy slots (stub 501)

### AI Assistant (all require session auth)
- `POST /api/assistant/parse` — Parse NL input → structured intent + conflicts + candidates + queryResults
- `POST /api/assistant/confirm` — Execute confirmed create intent; sends email invites
- `POST /api/assistant/confirm-batch` — Execute batch create (Phase 3A)
- `POST /api/assistant/chat` — Alias for /parse (same handler, accepts history)
- `POST /api/assistant/suggest` — Ask AI for open slot suggestions (stub 501 → used in Phase 3C)

---

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

---

## Ground Rules
- **Never push to GitHub.** User handles all pushes.
- **TDD for backend.** Write tests before implementation for routes and services.
- **Proxy all external APIs through Express.** No tokens exposed to frontend.
- **Session-based auth.** OAuth tokens stored server-side, never sent to client.

## Non-Goals (v1.0)
- Multi-user / team calendars
- Mobile-native iOS/Android (web-responsive is sufficient)
- Third-party integrations beyond Google Calendar and Gmail
- Recurring event management via Google's native recurrence rules (Nudge manages its own instances)
- Production billing or infrastructure

## Notes for Implementation
- AI service is abstracted in `src/services/ai.js` — to swap providers, only that file needs changes
- Currently using `llama-3.3-70b-versatile` via Groq; configurable via `GROQ_MODEL` env var
- Session storage is in-memory for dev; upgrade to Redis if needed for production
- Voice input (Phase 4) is free via Web Speech API but browser-limited; text input is primary
- Phase 3 agentic loop max iterations: 2 (conflict resolution), to avoid infinite loops and excessive API calls
