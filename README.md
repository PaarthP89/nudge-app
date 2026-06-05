# Nudge — AI-Powered Calendar Assistant

Schedule calendar events through natural language (text or voice). Nudge handles conflict detection, slot negotiation, and guest email invites.

## Stack

- **Frontend:** React (Vite) — deployed on Vercel
- **Backend:** Node.js + Express — deployed on Render
- **AI:** Groq (`llama-3.3-70b-versatile`)
- **Auth:** Google OAuth 2.0 (Calendar + Gmail scopes)

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env   # fill in real values
npm install
npm run dev            # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `localhost:3001`, so no `VITE_API_URL` is needed locally.

---

## Deploying to Production

### 1. Backend — Render

1. Create a new **Web Service** on [Render](https://render.com), pointing at this repo.
2. Set **Root Directory** to `backend`.
3. Render will detect `render.yaml` and auto-populate build/start commands.
4. Add the following **Environment Variables** in the Render dashboard:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `SESSION_SECRET` | random 32-byte string (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `BACKEND_URL` | `https://your-app.onrender.com` |
| `FRONTEND_URL` | `https://your-app.vercel.app` |
| `GROQ_API_KEY` | from console.groq.com |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |

5. Note your Render URL — you'll need it for Google OAuth and the frontend env var.

### 2. Google OAuth — authorized redirect URI

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth client:

- Add `https://your-app.onrender.com/api/auth/google/callback` to **Authorized redirect URIs**
- Add `https://your-app.vercel.app` to **Authorized JavaScript origins**

### 3. Frontend — Vercel

1. Import the repo into [Vercel](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Add the following **Environment Variable** in the Vercel dashboard:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://your-app.onrender.com` |

4. Deploy. Vercel auto-detects Vite; `vercel.json` handles client-side routing.

### 4. Keep the free Render instance warm — UptimeRobot

Render's free tier spins down after 15 minutes of inactivity, causing a ~30s cold start on the next request. Set up a free ping monitor on [UptimeRobot](https://uptimerobot.com):

1. Create a new **HTTP(s)** monitor.
2. URL: `https://your-app.onrender.com/health`
3. Monitoring interval: **5 minutes**
4. The `/health` endpoint returns `{ "status": "ok" }` and keeps the dyno alive.

---

## Running Tests

```bash
cd backend
npm test   # 205 tests
```
