# Nudge: AI-Powered Calendar Assistant

## Project Overview
Nudge is an intelligent scheduling assistant that lets users schedule calendar events through natural language (text or voice). The AI handles conflict detection, slot negotiation, and guest communication — eliminating the friction of manual calendar management.

**Goal:** Reduce time-to-schedule by 80% vs. manual Google Calendar entry. Deployable web app suitable for portfolio demonstration.

**Status:** Phase 4 complete + post-launch bug fixes (2026-06-05). All phases done: MVP, enhanced UX, agentic scheduling, and hands-free voice mode. 205 tests passing. Full feature list: multi-turn chat, draft accumulation, conflict detection, AI rescheduling suggestions, chat-based delete, calendar query, email invites, event deletion via calendar click, 30-day persistent sessions, natural language event editing, recurring/batch event scheduling, autonomous conflict resolution, goal-oriented free-slot finding, hands-free voice mode with continuous STT/TTS loop and session interceptors. Voice agent confirmed working end-to-end: create, delete, update, and post-action exit flow.

**Note:** This document is updated regularly as features are completed. Check the Phase checkboxes and timestamps to track progress.

## Tech Stack

### Frontend
- **React (Vite)** — calendar grid, chat UI, voice input
- **IBM Plex Sans** — typography via Google Fonts; applied globally in `index.css`
- **Web Speech API** — browser-native STT (`SpeechRecognition`) and TTS (`speechSynthesis`) for hands-free loop (Phase 4)

### Backend
- **Node.js + Express** — REST API, session management, OAuth proxy
- **express-session** — session management & server-side conversation state cache
- **Passport.js** — Google OAuth 2.0 authentication
- **Testing:** Jest + Supertest (205 tests passing)

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
- **Iterative phases:** Phase 1 (P0 features) → Phase 2 (P1 features) → Phase 3 (P2 features) → Phase 4 (Hands-free Voice)

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
  - Message type system: text | intent | conflict | confirm | deleteConfirm | queryResult | editConfirm | batchPlan | slotOptions | updateDisambig
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
  - System prompt includes concrete action-mapping examples for all 6 action types (create, delete, update, query, find_slot, unknown)
  - Keyword override safety net in route: if model returns `unknown` but message contains clear action keyword (delete/schedule/find me/free time/etc.), action is corrected before downstream logic runs
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
  - `/parse` route fetches events for the day when action=query; defaults to today when AI doesn't extract a concrete date (prevents "Let me check your calendar…" with no results)
  - QueryResultCard shows each event with title and time range
  - "Nothing on your calendar for X" reply when day is empty

---

## Phase 3: Agentic Scheduling (The Core Upgrade) ✓ Complete

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

**This is the core agentic behavior:** Nudge reasons through the problem autonomously and only surfaces it to the user when it's stuck, not at every step.

---

### 3C: Goal-oriented scheduling ("fit this in") ✓ Complete (2026-05-25)
**User story:** "I need a 2-hour deep work block sometime tomorrow" or "Find me time for a 30-minute call with Sarah this week"

**What Nudge does:**
1. Reads the user's calendar for the target period (already possible via `getEvents`)
2. Identifies free windows that match the requested duration
3. Scores slots by quality: prefers mid-morning, avoids back-to-back meetings, respects working hours (8am–7pm default)
4. Presents top 3 options ranked by score with brief reasoning: "9am–11am — 2 hours before your first meeting"
5. User clicks one → event scheduled immediately (no second confirm step)
6. Email invites sent if attendees were specified

**What changed:**
- `parseIntent` schema: added `find_slot` action, `target_period` string, `preferences` object `{ avoid_back_to_back, preferred_time }`; 3 new few-shot examples
- `normalizeAIResponse`: `find_slot` added to valid actions; passes through `target_period` and `preferences`
- `buildIntentReply` for `find_slot`: "Looking for a free X-minute window [period]…"
- `AIService.findFreeSlots(events, duration, preferences, { targetPeriod, now, timezone })` — calls Groq with scored slot prompt; strips code fences; returns `[{start_time, end_time, score, label}]`; returns `[]` on invalid JSON (non-fatal)
- `GET /api/calendar/freebusy` — implemented (was 501 stub); accepts `start`/`end` ISO params, returns `{ events, start, end }`
- `/parse` route: `find_slot` handler — `parseFindSlotRange(intent, ctx)` converts `target_period`/`date_known` to a day range; fetches events; calls `findFreeSlots`; validates all returned slots against real calendar (filters AI-hallucinated overlaps); returns `slotOptions: { slots, title, duration, attendees }`; keyword safety net for "find me / free time / open slot / when am I free"
- `SlotOptionsCard.jsx` — shows title + attendees header, up to 3 slot buttons each with date+time and reasoning label; selecting a slot fires `POST /api/assistant/confirm` directly (no second confirm step); handles idle/loading/done/error/cancelled states
- `useChat.js`: `confirmSlot(slot, slotOptions)` builds create intent from slot + metadata, calls `confirmEvent`, clears draft + history; handles `slotOptions` response → `slotOptions` message type

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

**What changed (initial implementation, 2026-05-25):**
- `GoogleCalendarService.updateEvent(eventId, patches)` — `calendar.events.patch` with `sendUpdates: 'all'`
- `PATCH /api/calendar/events/:id` route — implemented (was 501 stub)
- `/parse` route: action=`update` → candidate search (time_hint > title_hint > date fallback) → `computeUpdatePatches` (handles new time, preserve_time, start_delta_minutes, duration_delta_minutes, new_title) → conflict check on new slot (excludes the candidate itself) → `updateProposal` in response
- `parseIntent` prompt: 6 new update examples + 9 new optional fields (title_hint, time_hint, day_hint, new_title, new_date, new_time, preserve_time, duration_delta_minutes, start_delta_minutes)
- `buildIntentReply` for update: "Looking for X on your calendar…" (was "not supported")
- `EditConfirmCard.jsx` — before/after diff with strikethrough, conflict warning, fires `nudge:event-updated`
- `useChat.js`: `confirmUpdate` callback (PATCH + `nudge:event-updated`), handles `updateProposal` → `editConfirm` message
- `useCalendar.js`: listens for `nudge:event-updated` to refresh calendar

**Precision fix (2026-06-04) — same-name events on different dates:**
- **Bug:** "move my workout on June 6th to June 8th" was finding both a June 5th and June 6th workout (title-only search searched 7 days) and then patching the wrong date because `computeUpdatePatches` used `intent.start_time` (which was the source date) instead of `intent.new_date`.
- `parseDayHint(hint, now)` helper in `assistant.js` — converts natural-language day references ("June 6th", "Monday", ISO strings) to a `Date`; strips ordinal suffixes; handles named days of week
- `/parse` candidate search: when both `titleFilter` and `day_hint` are present, `parseDayHint(intent.day_hint)` narrows the search to that single day (00:00–23:59), not the default 7-day window
- `computeUpdatePatches`: now handles `intent.new_date` via `parseDayHint` + `parseTimeHint` first, before falling back to `intent.start_time`; preserves the original time of day when `preserve_time: true`
- `GoogleCalendarService.getEvent(eventId)` — new method; fetches a single event by ID using `calendar.events.get`
- `forcedIntent` + `candidateId` fast paths in `runParse()`: frontend can re-submit a stored intent with a pinned event ID, skipping AI re-parsing and re-searching entirely
- `UpdateCandidateCard` in `ChatPanel.jsx` — shown when multiple candidates found for an update; user picks the right event; fires `selectUpdateCandidate` with the chosen event + stored intent
- `updateDisambig` message type — emitted by `useChat.js` when `candidates.length > 0 && !updateProposal`
- `selectUpdateCandidate` in `useChat.js` — posts `{ forcedIntent, candidateId }` to `/parse`; handles `updateProposal` response
- Delete candidate time display fixed: now shows full date+time (not just time) so same-name events on different days are distinguishable

---

### Phase 3 new API endpoints
- ~~`POST /api/assistant/confirm-batch` — create multiple events, return results array~~ ✓ Complete (2026-05-25)
- ~~`PATCH /api/calendar/events/:id` — update event fields~~ ✓ Complete (2026-05-25)
- ~~`GET /api/calendar/freebusy` — returns events for a date range (was 501 stub)~~ ✓ Complete (2026-05-25)

### Phase 3 new frontend components
- ~~`BatchPlanCard` — shows N events to be created, conflict badges, single confirm~~ ✓ Complete (2026-05-25)
- ~~`SlotOptionsCard` — shows ranked free slot options with labels; single click schedules~~ ✓ Complete (2026-05-25)
- ~~`EditConfirmCard` — before/after diff for event updates~~ ✓ Complete (2026-05-25)

### Phase 3 new AIService methods
- ~~`AIService.expandRecurrence(intent)` → `DateTime[]`~~ ✓ Complete (2026-05-25)
- ~~`AIService.findFreeSlots(events, duration, preferences)` → scored slot array~~ ✓ Complete (2026-05-25)
- ~~Updates to `suggestSlots` to accept `excludeRanges` for second-pass conflict avoidance~~ ✓ Complete (2026-05-25)

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

```javascript
// WRONG — dumb implementation
const suggestions = await ai.suggestSlots(intent, conflicts);
return { suggestions }; // might contain conflicted slots

// RIGHT — agentic implementation
const suggestions = await ai.suggestSlots(intent, conflicts);
const cleanSuggestions = suggestions.filter(s => detectConflicts(events, s).length === 0);
if (cleanSuggestions.length === 0) {
  const excludeRanges = suggestions.map(s => ({ start: s.start_time, end: s.end_time }));
  const retry = await ai.suggestSlots(intent, conflicts, { excludeRanges });
  return { suggestions: retry };
}
return { suggestions: cleanSuggestions };
```

### Principle 4: Plan-then-Execute for batch operations (3A)

For recurring/batch events: the AI plans ALL instances first, the backend validates ALL of them, then a single confirmation executes ALL of them. Never confirm one event at a time in a loop.

```javascript
const instances = await ai.expandRecurrence(intent);
const validated = instances.map(inst => ({
  ...inst,
  conflicts: detectConflicts(events, inst)
}));
return { batchPlan: validated }; // single confirm → execute all
```

### Principle 5: Fuzzy candidate matching, not exact ID lookup

For delete and update actions, the user will never say an event ID. They say "my dentist appointment" or "the 2pm Tuesday thing". The candidate search must:
1. Parse whatever time/title hint the AI extracted
2. Search a window (±90 min for time_known, whole day for date_known, next 7 days for title_only)
3. Filter by title similarity if AI extracted a title
4. Return up to 3 candidates for user disambiguation if ambiguous

This logic already exists for delete — 3D (update) reuses it exactly.

---

## Frontend Design Overhaul (2026-06-04)

Full visual redesign of the app shell, calendar, chat panel, and login page.

**App shell (`HomePage.jsx` + `App.css`):**
- New top nav bar: Nudge logo mark, "Calendar" tab, "New Event" button (focuses chat input), bell + account icon buttons, mic button to launch voice mode
- Layout uses `.app-shell` / `.app-body` / `.app-sidebar` / `.app-main` CSS classes from `App.css` instead of inline styles
- Global reset + IBM Plex Sans font applied via new `index.css` (imported in `main.jsx`)

**Calendar (`CalendarView.jsx` + `CalendarView.css`):**
- Color palette shifted to IBM Carbon Blue (#0f62fe) + neutral grays (#313333, #7a7b7b, #efeded)
- Toolbar reordered: period label now appears first (left), then nav controls, then view toggle
- Floating action button (FAB) added bottom-right; clicking it focuses the chat input
- Event chips, today circle, week-view events all updated to new palette

**Chat panel (`ChatPanel.jsx` + `ChatPanel.css`):**
- New header: avatar circle + "Nudge AI" title + green "ACTIVE PARTNER" status dot
- Quick chips row added above input: "Schedule meeting", "Today's Brief", "Reschedule…" — clicking fills the input textarea
- Input styling: square corners, focus shows 2px blue border
- All color tokens updated to match app palette

**Login page (`LoginPage.jsx`):**
- Redesigned as a centered card: Nudge logo mark, tagline, full-width "Sign in with Google" button

---

## Phase 4: Voice Mode & Hands-Free Conversational Pipeline ✓ Complete

- [x] 4A: Speech Cleanup Service (`speechUtils.js`) — ✓ Complete (2026-06-04)
- [x] 4B: Session interceptors for binary confirmations and multi-option selection — ✓ Complete (2026-06-04)
- [x] 4C: `POST /api/assistant/voice-parse` pipeline with vocal conversion — ✓ Complete (2026-06-04)
- [x] 4D: `VoiceMode.jsx` UI with continuous STT/TTS loop — ✓ Complete (2026-06-04)

### Architectural Goal

Enable a 100% hands-free "driving mode" experience using free client-side STT (Speech-to-Text) and TTS (Text-to-Speech) brokered by an enhanced backend audio orchestration lifecycle. The user must be able to complete complex loops (Create → Detect Conflict → Pick Suggestion → Confirm) or (Query → Update → Verify) purely through natural speech turns without touching or looking at the device.

### Voice Response Optimization Philosophy

The existing `/api/assistant/parse` endpoint is optimized for screen layouts (it returns markdown text, cards, and UI schema states). For Voice Mode, the backend provides a parallel audio-first processing pipeline:

1. **Zero Markdown:** Exclude all bold, bullet points, emojis, and inline markdown symbols before generating the vocal string so synthesis engines do not read formatting code aloud.
2. **Implicit Disambiguation:** Translate structural lists (free slot options, query results, candidates) into clean verbalized choices: "I found three openings tomorrow: Option one is at 9 AM, option two is at 1 PM, and option three is at 4 PM. Which one works?"
3. **Audio State Flagging:** Every voice response returns explicit conversational flags (`waitForInput`, `inputExpectation`, `clearToListen`) so the client knows exactly when to play audio cue tones and re-open the microphone.

---

### 4A: Speech Cleanup Service ✓ Complete (2026-06-04)

`src/services/speechUtils.js` — pure utility, zero `require()` statements.

**Exports:**
- `stripMarkdown(text)` — strips `**bold**`, `*italic*`, bullet prefixes, blockquotes, inline code, collapses newlines to ", "
- `normalizeVocalDate(isoString, timezone)` — uses `Intl.DateTimeFormat.formatToParts()` for timezone-aware output like "Friday, June 5th at 5:00 PM"
- `flattenOptionsToSpeech(optionsArray, type)` — type is `'slots'` or `'events'`; produces "I found three openings. Option one is at 9 AM. Option two is at 1 PM. And option three is at 4 PM. Which one works?"

**Implementation notes:**
- `getOrdinal(n)` handles 11th/12th/13th edge cases correctly
- `extractTime(isoString)` extracts hour/minute from ISO string, formats as "9 AM" or "2:30 PM"
- Tests use UTC timezone so 17:00 UTC = 5:00 PM exactly (avoiding EDT offset ambiguity)
- 9 tests in `tests/services/speechUtils.test.js`

---

### 4B+4C: `POST /api/assistant/voice-parse` ✓ Complete (2026-06-04)

Dedicated audio wrapper route. Shares `computeParseResult(req)` with `/parse` — all core logic lives in one place.

**Request/response:**
```json
// Request
{ "message": "...", "history": [...], "timezone": "America/New_York", "localDatetime": "..." }

// Response
{
  "speechReply": "Got it — I'll schedule workout. Should I go ahead?",
  "rawIntent": { ... },
  "audioMetadata": { "waitForInput": true, "inputExpectation": "binary_affirmation", "clearToListen": true }
}
```

**Interceptor chain (runs before Groq):**

1. **Binary affirmation interceptor** (`AFFIRMATION_RE`) — when `req.session.voiceDraftIntent` is set and user says "yes / yep / sure / go ahead / confirm / do it / etc.", skips Groq entirely, calls `createEvent`, clears session state, returns `waitForInput: false, inputExpectation: 'none'`

2. **Negation interceptor** (`NEGATION_RE`) — when `req.session.voiceDraftIntent` or `req.session.voiceActiveOptions` is set and user says "no / nope / cancel / forget it / never mind / scratch that / abort", clears all session state, returns "Okay, I've cancelled that. What else can I help you with?" with `open_ended` metadata

3. **Option picker interceptor** (`parseOptionIndex`) — when `req.session.voiceActiveOptions` is set and user says "option one/two/three / the first one / 2 / etc.", resolves to the cached slot or suggestion at that index, creates the event, clears session state

4. **Normal fallthrough** — calls `computeParseResult(req)`, stores resulting intent/options in session for next interceptor pass, builds vocal response via `buildSpeechReply` and `buildAudioMetadata`

**Session state stored:**
- `req.session.voiceDraftIntent` — complete create intent ready to confirm; set when action=create + date_known + time_known + title + confidence >= 0.5 + no conflicts + no batchPlan
- `req.session.voiceActiveOptions` — `{ type: 'slots'|'suggestions', items: [...] }` — set when slotOptions or suggestions returned
- `req.session.voiceSlotContext` — `{ title, duration, attendees }` — stored alongside slot options so option picker can build the create intent

**`buildAudioMetadata` logic:**
- slotOptions/suggestions/multiple candidates → `option_selection`
- single candidate / batchPlan / updateProposal / ready create intent with no conflicts → `binary_affirmation`
- everything else → `open_ended`

**`buildSpeechReply` priority:**
- slotOptions → `flattenOptionsToSpeech(slots, 'slots')`
- queryResults → `flattenOptionsToSpeech(queryResults, 'events')`
- multiple candidates → `flattenOptionsToSpeech(candidates, 'events')`
- suggestions → `flattenOptionsToSpeech(suggestions, 'slots')`
- fallback → `stripMarkdown(reply)`

**Tests:** 4 tests in the Phase 4 describe block of `assistant.test.js` — binary interceptor, option picker, negation interceptor, standard fallthrough. All use `request.agent(app)` for cookie-persistent multi-step flows.

---

### 4D: `VoiceMode.jsx` ✓ Complete (2026-06-04)

Full-screen dark overlay driving dashboard at `src/components/Voice/VoiceMode.jsx`.

**UI:**
- Status ring (200px circle) with state-driven animations: IBM Carbon Blue pulse (listening), amber spinning arc on `::before` (thinking), green pulse (speaking), gray (idle/done), red (error)
- Live transcript display (italic, 20px) updates in real time during speech
- Last reply card (dark background, left blue border) persists until next reply
- Stop FAB (red circle, bottom-right) visible during active states
- Start/Retry/Start Again button when idle

**Loop architecture:**

```
startLoop()
  → startListening()                   # continuous SpeechRecognition, 1.5s silence timer
  → [user speaks, 1.5s silence fires]
  → recognition.stop() → onend fires
  → sendToBackend(accumulatedFinal)     # POST /api/assistant/voice-parse with history
  → speakAndContinue(speechReply)       # SpeechSynthesisUtterance + fallback timer
  → afterSpeak()                        # playPing() → startListening() again
```

**Key implementation details:**

- `recognition.continuous = true` — Chrome stays open across natural speech pauses instead of stopping on 0.5s silence
- **1.5s silence timer** — resets on every `onresult` event; fires `recognition.stop()` after 1.5s of quiet; `onend` then submits `accumulatedFinal`
- **15s max listen cap** — `maxListenTimer` force-stops after 15s to prevent infinite mic hold
- `accumulatedFinal` — accumulates all `isFinal` segments across the continuous session so mid-sentence pauses don't truncate the message
- **TTS fallback timer** — `setTimeout(afterSpeak, Math.max(2500, text.length * 65))` guards against Chrome's intermittent `utter.onend` failure; `afterSpeakCalled` boolean ensures only the first of (onend, onerror, fallback) takes effect
- **`voiceHistoryRef`** — `useRef([])` accumulates `{role, content}` pairs (capped at 20 entries = 10 turns), sent with every request so AI has multi-turn context; cleared on `stopLoop()`
- **Web Audio ping** — 880Hz oscillator, 150ms, plays immediately before `startListening()` to signal mic re-opening
- `loopActiveRef` — master kill switch checked at every async boundary; `stopLoop()` sets it false and clears history
- All three loop functions (`startListening`, `sendToBackend`, `speakAndContinue`) use `function` declarations (JS hoisting) to safely cross-reference each other without `useCallback` circular deps

---

### Phase 4 bug fixes (2026-06-04)

**Multi-turn context loss** — `sendToBackend` was not sending `history`. Fixed: `voiceHistoryRef` accumulates turns and sends with every request. History cleared on `stopLoop()`.

**Premature STT stop** — `continuous: false` stopped on ~0.5s silence. Fixed: switched to `continuous: true` with 1.5s silence timer pattern described above.

**TTS `onend` not firing** — Chrome intermittently skips `SpeechSynthesisUtterance.onend`. Fixed: fallback timer + `afterSpeakCalled` guard.

**No cancellation handling** — user had no way to say "no" to reject a pending confirmation. Fixed: `NEGATION_RE` interceptor in `voice-parse` clears session state and returns a cancellation reply with `open_ended` metadata so the loop continues.

**Query returning no results** — when AI sets `date_known: false` for "what's on my calendar today?" (non-deterministic), the old route guard `intent.date_known && intent.start_time` skipped the calendar fetch entirely, returning "Let me check your calendar…" with no results. Fixed: removed guard, always fetch, default to today when no date extracted.

### Post-launch voice bug fixes (2026-06-05)

**Brittle regex confirm/cancel** — `AFFIRMATION_RE`/`NEGATION_RE` failed on multi-word phrases like "yes yes" or "no, cancel". Fixed: replaced with LLM-based `classifyConfirmation(message)` (`AIService`) + `quickClassify()` single-token fast-path. Both paths return 'confirm', 'cancel', or 'other'.

**Voice loop exiting after completed task** — `afterSpeak` was stopping the loop on `waitForInput: false`. Fixed: loop always continues; exits only on `EXIT_RE` phrase or new `exitLoop: true` audioMetadata flag.

**"No" after task completion restarted intent parser** — saying "no" after "Is there anything else?" fell through to `computeParseResult`, returning the default "I can help you schedule…" reply. Fixed: `voiceAwaitingFollowup` session flag set after every completion; new interceptor (step 0) catches "no"/"exit"/"goodbye" and returns `exitLoop: true` + farewell. Frontend calls `stopLoop(); onClose?.()` on `exitLoop`.

**`parseDayHint` ignoring "today"/"tomorrow"** — returning `null` for these strings caused day-scoped update candidate searches to fall back to a 7-day window. Fixed: explicit handling at the top of `parseDayHint`.

**`computeUpdatePatches` missing `new_time`-only branch** — "move my workout to 3pm" (no new date, just a new time) produced empty patches and updated nothing. Fixed: `else if (intent.new_time)` branch applies `parseTimeHint(intent.new_time, candidateStart)` to change the time while preserving the event's date.

**STT "p.m."/"a.m." format not recognized** — Chrome STT transcribes spoken "1 PM" as "1:00 p.m." (with periods). `parseTimeHint` regex matched only `am|pm`. Fixed: normalize `a.m.`/`p.m.` to `am`/`pm` before matching.

**Voice delete confirmation loop** — after the bot said "Found X — Confirm deletion?", saying "yes" re-ran the entire delete search and asked again indefinitely. Root cause: `voiceDraftDeleteCandidate` session key did not exist; delete was the only action with `binary_affirmation` metadata that stored nothing in session. `hasPendingDraft` was always false for delete, so the pending-state handler never fired and "yes" fell through to the AI. Fixed: store `voiceDraftDeleteCandidate` when action=delete and exactly 1 candidate is found; pending-state handler calls `deleteEvent(candidate.id)` on confirm and sets `voiceAwaitingFollowup`.

---

### Phase 4 API

#### `POST /api/assistant/voice-parse`

**Backend routing flow:**
```
[Incoming Voice Request]
   │
   ├──> 0. Followup interceptor (voiceAwaitingFollowup + "no"/"exit" → exitLoop: true)
   ├──> 1. Option picker interceptor (parseOptionIndex + voiceActiveOptions)
   ├──> 2. Pending-state handler (classifyConfirmation LLM + quickClassify fast-path)
   │        confirm + voiceDraftIntent         → createEvent, voiceAwaitingFollowup=true
   │        confirm + voiceDraftUpdateProposal → updateEvent, voiceAwaitingFollowup=true
   │        confirm + voiceDraftDeleteCandidate → deleteEvent, voiceAwaitingFollowup=true
   │        cancel  → clear all state, clearHistory: true
   │        other   → clear draft, fall through
   ├──> 3. Normal fallthrough via computeParseResult(req)
   ├──> 4. Store session state:
   │        voiceDraftIntent          (create, ready)
   │        voiceDraftUpdateProposal  (update with 1 candidate)
   │        voiceDraftDeleteCandidate (delete with 1 candidate)
   │        voiceActiveOptions        (slots | suggestions | update_candidates)
   │        voiceAwaitingFollowup     (set by all completion paths)
   └──> 5. Build vocal response (buildSpeechReply + buildAudioMetadata)
```

**Response:**
```json
{
  "speechReply": "Okay, an event tomorrow called workout at 5 PM. Should I go ahead?",
  "rawIntent": { ... },
  "audioMetadata": {
    "waitForInput": true,
    "inputExpectation": "binary_affirmation",
    "clearToListen": true
  }
}
```

`inputExpectation` values: `"binary_affirmation"` | `"option_selection"` | `"open_ended"` | `"none"`

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
- `PATCH /api/calendar/events/:id` — Update event (Phase 3D)
- `DELETE /api/calendar/events/:id` — Delete event
- `GET /api/calendar/freebusy` — Fetch events for a date range; accepts `start`/`end` ISO params, returns `{ events, start, end }` (Phase 3C)

### AI Assistant (all require session auth)
- `POST /api/assistant/parse` — Parse NL input → `{ intent, reply, conflicts, suggestions, candidates, queryResults, updateProposal, batchPlan, slotOptions, loopIterations }`
- `POST /api/assistant/voice-parse` — Audio-first voice pipeline; returns `{ speechReply, rawIntent, audioMetadata }` (Phase 4)
- `POST /api/assistant/confirm` — Execute confirmed create intent; sends email invites; returns `{ event, invitesSent, inviteErrors }`
- `POST /api/assistant/confirm-batch` — Execute batch create (Phase 3A); returns `{ results, summary }`
- `POST /api/assistant/chat` — Alias for /parse (same handler, accepts history)
- `POST /api/assistant/suggest` — stub 501 (not used; 3C's find_slot goes through /parse)

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
│   │   │   ├── ai.js               ← provider-agnostic AI service (Groq today, swappable)
│   │   │   ├── googleCalendar.js
│   │   │   ├── gmail.js
│   │   │   └── speechUtils.js      ← Voice TTS string normalizer (Phase 4A)
│   │   └── app.js
│   ├── tests/
│   │   ├── routes/
│   │   │   ├── assistant.test.js
│   │   │   ├── calendar.test.js
│   │   │   └── auth.test.js
│   │   ├── services/
│   │   │   ├── ai.test.js
│   │   │   ├── speechUtils.test.js
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
│   │   │   ├── Chat/
│   │   │   │   ├── ChatPanel.jsx
│   │   │   │   ├── ChatPanel.css
│   │   │   │   ├── BatchPlanCard.jsx
│   │   │   │   ├── EditConfirmCard.jsx
│   │   │   │   └── SlotOptionsCard.jsx
│   │   │   └── Voice/
│   │   │       ├── VoiceMode.jsx       ← Hands-free driving dashboard (Phase 4D)
│   │   │       └── VoiceMode.css
│   │   ├── pages/
│   │   ├── hooks/
│   │   │   ├── useCalendar.js
│   │   │   └── useChat.js
│   │   ├── App.jsx
│   │   ├── App.css                 ← app shell layout (nav, sidebar, main)
│   │   └── index.css               ← global reset + IBM Plex Sans font
│   ├── index.html                  ← IBM Plex Sans Google Fonts link
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
- Voice input (Phase 4) requires Chrome or Edge (Web Speech API); text input is primary
- Phase 3 agentic loop max iterations: 2 (conflict resolution), to avoid infinite loops and excessive API calls
- `find_slot` (3C) is handled by the existing `/parse` endpoint, not `/suggest`; `/suggest` remains a 501 stub
- `parseFindSlotRange` in `assistant.js` uses a NaN guard when parsing `now` — the client sends a human-readable locale string ("Friday, May 26, 2026 at 8:09 PM PDT") that `new Date()` cannot reliably parse in Node.js; falls back to server time
- **Hook ordering gotcha in `useChat.js`:** `confirmSlot` must be declared AFTER `confirmEvent` because it closes over it. `const` is not hoisted — placing `confirmSlot` before `confirmEvent` causes a temporal dead zone crash that breaks the entire chat panel on load
- **`parseDayHint` in `assistant.js`:** converts human-readable day strings ("June 6th", "Monday", ISO dates) to a `Date`; strips ordinal suffixes (`6th` → `6`); handles named weekdays by finding the most recent past occurrence. Used to narrow update candidate search to a single day when `day_hint` is present alongside a title filter.
- **`forcedIntent` / `candidateId` fast paths in `/parse`:** when the frontend already knows which intent and which event to update (after user disambiguation via `UpdateCandidateCard`), it sends `{ forcedIntent, candidateId }` — the backend skips AI parsing and event search entirely, fetching the event by ID via `getEvent()` and computing patches immediately.
- **`computeParseResult(req)` is shared:** both `/parse` and `/voice-parse` call this function; the voice route wraps the result in `{ speechReply, rawIntent, audioMetadata }` while `/parse` returns the raw result directly.
- **`action === 'query'` always fetches calendar:** the route no longer gates on `date_known`; when the AI omits a date, it defaults to today. This prevents the "Let me check your calendar…" with no results bug caused by non-deterministic `date_known: false` outputs.
- **Voice `continuous: true` + silence timer pattern:** `recognition.continuous = true` keeps the mic open; a 1500ms `setTimeout` fires `recognition.stop()` after speech goes quiet; `recognition.onend` then submits the accumulated transcript. `accumulatedFinal` collects all `isFinal` segments so pauses mid-sentence don't truncate. A 15s `maxListenTimer` caps each session.
- **TTS fallback timer in `speakAndContinue`:** `setTimeout(afterSpeak, Math.max(2500, text.length * 65))` as insurance against Chrome's intermittent `utter.onend` non-fire. `afterSpeakCalled` boolean prevents double-execution.
- **`classifyConfirmation` in `AIService`:** lean LLM call (max_tokens: 5, temperature: 0) returning exactly "CONFIRM", "CANCEL", or "OTHER". `quickClassify()` fast-path skips it for single-token words. Used by pending-state handler in `voice-parse`.
- **`voiceAwaitingFollowup` session flag:** set after every completed action (create/update/slot pick). Interceptor 0 in `voice-parse` catches "no"/"exit"/"goodbye" etc. and returns `exitLoop: true` + farewell; otherwise falls through to normal parse. Frontend calls `stopLoop(); onClose?.()` on `exitLoop`.
- **`parseTimeHint` STT normalization:** strips `a.m.`/`p.m.` periods before regex match, so Chrome STT's "1:00 p.m." format parses correctly as 1pm.
- **`parseDayHint` handles "today"/"tomorrow"/"yesterday":** checked at the top of the function before the generic date parser, so day-hint candidate searches correctly scope to a single day.
- **`computeUpdatePatches` `new_time`-only branch:** `else if (intent.new_time)` applies `parseTimeHint(intent.new_time, candidateStart)` to change the time of day while keeping the candidate's existing date. Handles "move my workout to 3pm" with no date change.
- **`voiceDraftDeleteCandidate` session key:** stored when action=delete returns exactly 1 candidate. Pending-state handler calls `calService.deleteEvent(candidate.id)` on confirm. All clear paths (cancel, other, followup interceptor) null it out. Without this, voice delete confirmation was an infinite loop — "yes" re-ran the search and asked again.
