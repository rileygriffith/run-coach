require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Coaching system prompt ───────────────────────────────────────────────────
// Replace this placeholder with your coaching system prompt.
const COACHING_SYSTEM_PROMPT = `COACHING_SYSTEM_PROMPT_PLACEHOLDER`;
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

// ── Login routes ───────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Running Coach — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d0d0d; color: #e8e8e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #161616; border: 1px solid #2a2a2a; border-radius: 14px;
      padding: 2.5rem 2rem; width: 100%; max-width: 340px;
    }
    h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.25rem; }
    p { color: #888; font-size: 0.85rem; margin-bottom: 1.75rem; }
    label { display: block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #888; margin-bottom: 0.4rem; }
    input {
      width: 100%; background: #1f1f1f; border: 1px solid #2a2a2a; border-radius: 8px;
      color: #e8e8e8; font-size: 0.95rem; padding: 0.65rem 0.875rem;
      outline: none; transition: border-color 0.15s;
    }
    input:focus { border-color: #60a5fa; }
    button {
      margin-top: 1.25rem; width: 100%; background: #60a5fa; color: #000;
      border: none; border-radius: 8px; padding: 0.7rem; font-size: 0.95rem;
      font-weight: 600; cursor: pointer; transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    .error { color: #f87171; font-size: 0.82rem; margin-top: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Running Coach</h1>
    <p>Enter your password to continue.</p>
    <form method="POST" action="/login">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autofocus autocomplete="current-password" />
      <button type="submit">Sign in</button>
      ${req.query.error ? '<p class="error">Incorrect password.</p>' : ''}
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === process.env.APP_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── Protected static files ─────────────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const WORKOUTS_FILE = path.join(__dirname, 'workouts.json');

// ── Strava token management ────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

// ── Activities cache ───────────────────────────────────────────────────────────

let cachedActivities = null;
let activitiesCachedAt = 0;
const ACTIVITIES_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function getStravaToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  if (data.errors) throw new Error(`Strava error: ${JSON.stringify(data.errors)}`);

  cachedToken = data.access_token;
  tokenExpiry = data.expires_at * 1000 - 60_000; // refresh 1 min before expiry
  return cachedToken;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPace(speedMs) {
  if (!speedMs || speedMs <= 0) return 'N/A';
  const secsPerMile = 1609.34 / speedMs;
  const mins = Math.floor(secsPerMile / 60);
  const secs = Math.round(secsPerMile % 60);
  return `${mins}:${String(secs).padStart(2, '0')} min/mi`;
}

function buildRunSummary(runs) {
  return runs
    .map((r) => {
      const distMi = (r.distance / 1609.34).toFixed(2);
      const pace = formatPace(r.average_speed);
      const date = new Date(r.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      return (
        `- ${date}: ${distMi}mi, pace ${pace}` +
        `, HR ${r.average_heartrate ? Math.round(r.average_heartrate) + ' bpm' : 'N/A'}` +
        `, cadence ${r.average_cadence ? Math.round(r.average_cadence) + ' spm' : 'N/A'}` +
        `, power ${r.average_watts ? Math.round(r.average_watts) + 'W' : 'N/A'}` +
        `, elevation gain ${Math.round(r.total_elevation_gain || 0)}ft` +
        `, elapsed time ${Math.floor(r.elapsed_time / 60)}m${r.elapsed_time % 60}s`
      );
    })
    .join('\n');
}

// ── Routes ─────────────────────────────────────────────────────────────────────

async function getActivities() {
  if (cachedActivities && Date.now() - activitiesCachedAt < ACTIVITIES_TTL) {
    return cachedActivities;
  }

  const token = await getStravaToken();
  const after = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 60 * 60; // ~6 months ago

  let page = 1;
  let allActivities = [];
  while (true) {
    const response = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Strava error (${response.status}): ${body}`);
    }

    const page_activities = await response.json();
    if (page_activities.length === 0) break;
    allActivities = allActivities.concat(page_activities);
    if (page_activities.length < 200) break;
    page++;
  }

  const runs = allActivities
    .filter((a) => a.type === 'Run' || a.sport_type === 'Run')
    .map((a) => ({
      name: a.name,
      date: a.start_date_local,
      distance: a.distance,
      elapsed_time: a.elapsed_time,
      average_speed: a.average_speed,
      average_heartrate: a.average_heartrate || null,
      average_cadence: a.average_cadence || null,
      average_watts: a.average_watts || null,
      total_elevation_gain: a.total_elevation_gain || 0,
    }));

  cachedActivities = runs;
  activitiesCachedAt = Date.now();
  return runs;
}

// GET /api/activities — fetch and filter runs from Strava (cached 6h)
app.get('/api/activities', async (_req, res) => {
  try {
    res.json(await getActivities());
  } catch (err) {
    console.error('[/api/activities]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-workout — call Claude to generate 3 workout options
app.post('/api/generate-workout', async (_req, res) => {
  try {
    const runs = await getActivities();
    if (!runs.length) {
      return res.status(400).json({ error: 'No runs found on Strava.' });
    }

    const runSummary = buildRunSummary(runs);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: COACHING_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here are my recent runs:\n${runSummary}\n\n` +
            `All distances and paces must be in miles and min/mi. ` +
            `Based on this training history, generate 3 workout options for my next session. ` +
            `All 3 should represent roughly the same training load and difficulty — they are alternatives to each other, not progressions. ` +
            `Vary the workout type to offer variety (e.g. tempo, intervals, steady-state, fartlek, long run, etc.). ` +
            `For each option provide specific, concrete targets the athlete should hit — exact paces, distances, rep structures, rest intervals, etc. Be precise, not vague.\n\n` +
            `Respond ONLY with valid JSON in exactly this format:\n` +
            `{\n` +
            `  "option_a": { "type": "string", "structure": "string", "target_pace": "string", "rationale": "string" },\n` +
            `  "option_b": { "type": "string", "structure": "string", "target_pace": "string", "rationale": "string" },\n` +
            `  "option_c": { "type": "string", "structure": "string", "target_pace": "string", "rationale": "string" }\n` +
            `}`,
        },
      ],
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude response contained no JSON');
    const workouts = JSON.parse(jsonMatch[0]);

    res.json(workouts);
  } catch (err) {
    console.error('[/api/generate-workout]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/log-workout — append selected workout to local JSON log
app.post('/api/log-workout', async (req, res) => {
  try {
    const { workout } = req.body;
    let log = [];
    if (fs.existsSync(WORKOUTS_FILE)) {
      log = JSON.parse(fs.readFileSync(WORKOUTS_FILE, 'utf8'));
    }
    log.push({ ...workout, logged_at: new Date().toISOString() });
    fs.writeFileSync(WORKOUTS_FILE, JSON.stringify(log, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/log-workout]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Running coach → http://localhost:${PORT}`);
});
