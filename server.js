require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const path       = require('path');
const Database   = require('better-sqlite3');
const Anthropic  = require('@anthropic-ai/sdk');

// ── Database ───────────────────────────────────────────────────────────────────

const dataDir = path.join(__dirname, 'data');
require('fs').mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'coach.db'));
// Add workout_type column to existing DBs that predate this migration
try { db.exec('ALTER TABLE runs ADD COLUMN workout_type TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE workout_sessions ADD COLUMN recommended TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE workout_sessions ADD COLUMN input_tokens INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE workout_sessions ADD COLUMN output_tokens INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE workout_sessions ADD COLUMN result TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE workout_sessions ADD COLUMN result_notes TEXT'); } catch (_) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT,
    date                 TEXT,
    distance             REAL,
    elapsed_time         INTEGER,
    average_speed        REAL,
    average_heartrate    REAL,
    average_cadence      REAL,
    average_watts        REAL,
    total_elevation_gain REAL,
    sport_type           TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS workout_sessions (
    date       TEXT PRIMARY KEY,
    option_a   TEXT,
    option_b   TEXT,
    option_c   TEXT,
    selected   TEXT,
    created_at TEXT
  );
`);

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ── Coaching system prompt ─────────────────────────────────────────────────────

const COACHING_PROMPT = `You are an experienced running coach who adapts to each athlete's goals — whether that's building a base, getting faster, training for a race, or simply running consistently. You follow the 80/20 polarized training method: approximately 80% of training at low intensity (easy, conversational pace, Zone 1-2) and 20% at high intensity (Zone 4-5), avoiding the gray zone in between. Always give precise, concrete targets based on the athlete's recent performance data and stated goal. If a goal is provided, let it shape the type and specificity of the workouts you prescribe.`;


// ── Express setup ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ── Auth ───────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

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
  const activePassword = getSetting('app_password', '') || process.env.APP_PASSWORD;
  if (req.body.password === activePassword) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

function getAnthropicClient() {
  const key = getSetting('anthropic_api_key', '') || process.env.ANTHROPIC_API_KEY;
  return new Anthropic({ apiKey: key });
}

// ── Strava token ───────────────────────────────────────────────────────────────

let cachedToken  = null;
let tokenExpiry  = 0;

function getStravaCreds() {
  return {
    clientId:     getSetting('strava_client_id',     '') || process.env.STRAVA_CLIENT_ID,
    clientSecret: getSetting('strava_client_secret', '') || process.env.STRAVA_CLIENT_SECRET,
    refreshToken: getSetting('strava_refresh_token', '') || process.env.STRAVA_REFRESH_TOKEN,
  };
}

async function getStravaToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const { clientId, clientSecret, refreshToken } = getStravaCreds();
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (data.errors) throw new Error(`Strava error: ${JSON.stringify(data.errors)}`);
  cachedToken = data.access_token;
  tokenExpiry = data.expires_at * 1000 - 60_000;
  return cachedToken;
}

// ── Strava sync ────────────────────────────────────────────────────────────────

const RUN_TYPES  = ['Run', 'TrailRun', 'VirtualRun', 'Treadmill'];
const SYNC_TTL   = 60 * 60 * 1000; // 1 hour

async function syncFromStrava() {
  const lastSynced = parseInt(getSetting('last_synced_at', '0'));
  if (Date.now() - lastSynced < SYNC_TTL) return;

  const token  = await getStravaToken();
  const latest = db.prepare('SELECT date FROM runs ORDER BY date DESC LIMIT 1').get();
  const after  = latest
    ? Math.floor(new Date(latest.date).getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 60 * 60;

  let page = 1, fetched = [];
  while (true) {
    const response = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error(`Strava error (${response.status}): ${await response.text()}`);
    const activities = await response.json();
    if (!activities.length) break;
    fetched = fetched.concat(activities.filter(a => RUN_TYPES.includes(a.sport_type || a.type)));
    if (activities.length < 200) break;
    page++;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO runs
      (id, name, date, distance, elapsed_time, average_speed,
       average_heartrate, average_cadence, average_watts, total_elevation_gain, sport_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(runs => {
    for (const a of runs) insert.run(
      a.id, a.name, a.start_date_local, a.distance, a.elapsed_time,
      a.average_speed, a.average_heartrate || null, a.average_cadence || null,
      a.average_watts || null, a.total_elevation_gain || 0, a.sport_type || a.type
    );
  })(fetched);

  setSetting('last_synced_at', Date.now().toString());
  console.log(`[sync] ${fetched.length} new run(s) added to DB`);
}

function getRunsFromDB() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return db.prepare('SELECT * FROM runs WHERE date > ? ORDER BY date DESC')
    .all(sixMonthsAgo.toISOString());
}

async function getActivities() {
  await syncFromStrava();
  return getRunsFromDB();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildRunSummary(runs, sessionMap = {}) {
  return runs.map(r => {
    const distMi = (r.distance / 1609.34).toFixed(2);
    const secsPerMile = 1609.34 / r.average_speed;
    const mins = Math.floor(secsPerMile / 60);
    const secs = Math.round(secsPerMile % 60);
    const pace = r.average_speed > 0
      ? `${mins}:${String(secs).padStart(2, '0')} min/mi`
      : 'N/A';
    const date = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const entry = sessionMap[r.date.slice(0, 10)];
    const resultLabel = entry?.result === 'hit'    ? 'hit targets'
                      : entry?.result === 'partial' ? 'hit some targets'
                      : entry?.result === 'missed'  ? 'missed targets'
                      : null;
    const resultStr = resultLabel
      ? ` — ${resultLabel}${entry.result_notes ? `: ${entry.result_notes}` : ''}`
      : '';
    return (
      `- ${date}: ${distMi}mi, pace ${pace}` +
      `, HR ${r.average_heartrate ? Math.round(r.average_heartrate) + ' bpm' : 'N/A'}` +
      `, cadence ${r.average_cadence ? Math.round(r.average_cadence) + ' spm' : 'N/A'}` +
      `, power ${r.average_watts ? Math.round(r.average_watts) + 'W' : 'N/A'}` +
      `, elevation gain ${Math.round(r.total_elevation_gain || 0)}ft` +
      `, elapsed ${Math.floor(r.elapsed_time / 60)}m${r.elapsed_time % 60}s` +
      (entry ? `, workout: ${entry.type}${entry.target_pace && entry.target_pace !== 'N/A' ? ` at ${entry.target_pace}` : ''}${resultStr}` : '')
    );
  }).join('\n');
}

function buildPromptContent(runs, units = 'miles', soreness = 'none', targetDate = null, clientToday = null) {
  const goal = getSetting('goal', '');

  // Build date → workout entry map from sessions with a selection
  const sessions = db.prepare('SELECT date, option_a, option_b, option_c, recommended, selected, result, result_notes FROM workout_sessions').all();
  const sessionMap = {};
  for (const s of sessions) {
    const key = s.selected || s.recommended;
    if (key && s[key]) {
      try {
        const w = JSON.parse(s[key]);
        sessionMap[s.date] = { type: w.type, target_pace: w.target_pace, result: s.result, result_notes: s.result_notes };
      } catch (_) {}
    }
  }

  const runSummary = runs.length ? buildRunSummary(runs, sessionMap) : '(no runs found)';
  const unitInstruction = units === 'miles'
    ? 'All distances and paces must be in miles and min/mi.'
    : 'All distances and paces must be in kilometers and min/km.';
  const crossTraining = getSetting('cross_training', '');
  const injuryNotes   = getSetting('injury_notes',   '');
  const raceDistance  = getSetting('race_distance',  '');
  const raceDate      = getSetting('race_date',      '');

  const goalSection = goal
    ? `\n\n━━━ ATHLETE'S CURRENT GOAL ━━━\n${goal}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';
  const crossTrainingSection = crossTraining
    ? `\n\n━━━ CROSS-TRAINING CONTEXT ━━━\n${crossTraining}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';
  const raceSection = (raceDistance && raceDate)
    ? `\n\n━━━ UPCOMING RACE ━━━\n${raceDistance} on ${raceDate}\n━━━━━━━━━━━━━━━━━━━━━\n`
    : raceDistance
    ? `\n\n━━━ UPCOMING RACE ━━━\n${raceDistance} (date TBD)\n━━━━━━━━━━━━━━━━━━━━━\n`
    : '';
  const injurySection = injuryNotes
    ? `\n\n━━━ INJURY / HEALTH NOTES ━━━\n${injuryNotes}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';
  const sorenessSection = soreness === 'yes'
    ? `\n\nNote: The athlete is reporting lower body soreness today. Take this into account when recommending intensity and workout type.`
    : '';
  const today = clientToday || localDateStr();
  const workoutDate = targetDate || today;
  const workoutDateFormatted = new Date(workoutDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const daysAhead = targetDate && targetDate > today
    ? Math.round((new Date(targetDate) - new Date(today)) / 86400000)
    : 0;
  const futureDateSection = daysAhead > 0
    ? `\n\nNote: This workout is being planned ${daysAhead} day${daysAhead > 1 ? 's' : ''} in advance (for ${targetDate}). The athlete will have had time to recover from any recent fatigue — do not recommend rest based solely on recent training load.`
    : '';

  return (
    `You are generating this workout for ${workoutDateFormatted}.\n\nHere are my recent runs:\n${runSummary}${goalSection}${raceSection}${crossTrainingSection}${injurySection}${sorenessSection}${futureDateSection}\n\n` +
    `${unitInstruction} ` +
    `Based on this training history, generate one recommended option for the athlete's next session, plus two alternatives. ` +
    `If the training load, recovery signals, or reported soreness suggest the athlete needs rest, recommend a rest day. ` +
    `Alternatives can differ in intensity, duration, or type — choose what would genuinely serve the athlete best. ` +
    `For each workout provide specific, concrete targets — exact paces, distances, rep structures, rest intervals. Be precise, not vague.\n\n` +
    `Respond ONLY with valid JSON in exactly this format:\n` +
    `{\n` +
    `  "recommended": "option_a",\n` +
    `  "option_a": { "type": "string", "structure": ["step 1", "step 2", "...one string per distinct phase or segment"], "target_pace": "string", "rationale": "2 sentences max" },\n` +
    `  "option_b": { "type": "string", "structure": ["step 1", "step 2", "...one string per distinct phase or segment"], "target_pace": "string", "rationale": "2 sentences max" },\n` +
    `  "option_c": { "type": "string", "structure": ["step 1", "step 2", "...one string per distinct phase or segment"], "target_pace": "string", "rationale": "2 sentences max" }\n` +
    `}`
  );
}

// ── Settings API ───────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  const INTERNAL_KEYS = ['last_synced_at'];
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => { if (!INTERNAL_KEYS.includes(r.key)) s[r.key] = r.value; });
  res.json(s);
});

app.post('/api/settings', (req, res) => {
  const ALLOWED = ['goal', 'cross_training', 'injury_notes', 'race_distance', 'race_date',
                   'anthropic_api_key', 'strava_client_id', 'strava_client_secret', 'strava_refresh_token'];
  const { key, value } = req.body;
  if (!ALLOWED.includes(key)) return res.status(400).json({ error: 'Invalid setting key' });
  setSetting(key, value);
  // Invalidate Strava token cache if credentials changed
  if (['strava_client_id', 'strava_client_secret', 'strava_refresh_token'].includes(key)) {
    cachedToken = null; tokenExpiry = 0;
  }
  res.json({ ok: true });
});

app.post('/api/change-password', (req, res) => {
  const { current, next } = req.body;
  const active = getSetting('app_password', '') || process.env.APP_PASSWORD;
  if (current !== active) return res.status(401).json({ error: 'Current password incorrect' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  setSetting('app_password', next);
  res.json({ ok: true });
});

app.post('/api/sync', async (_req, res) => {
  try {
    setSetting('last_synced_at', '0'); // reset TTL to force sync
    await syncFromStrava();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Activities API ─────────────────────────────────────────────────────────────

app.get('/api/activities', async (_req, res) => {
  try {
    res.json(await getActivities());
  } catch (err) {
    console.error('[/api/activities]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Cost estimate ──────────────────────────────────────────────────────────────

app.post('/api/cost-estimate', async (req, res) => {
  try {
    const runs = await getActivities();
    const { units = 'miles', date, today } = req.body || {};
    const promptContent = buildPromptContent(runs, units, 'none', date || localDateStr(), today || null);
    const { input_tokens } = await getAnthropicClient().messages.countTokens({
      model: 'claude-sonnet-4-6',
      system: COACHING_PROMPT,
      messages: [{ role: 'user', content: promptContent }],
    });
    const estimatedOutput = 400;
    const cost = (input_tokens / 1_000_000) * 3 + (estimatedOutput / 1_000_000) * 15;
    res.json({ input_tokens, estimated_output_tokens: estimatedOutput, cost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Prompt preview ─────────────────────────────────────────────────────────────

app.post('/api/prompt-preview', async (req, res) => {
  try {
    const runs = await getActivities();
    const { units = 'miles', date, today } = req.body || {};
    const systemPrompt = COACHING_PROMPT;
    const userContent = buildPromptContent(runs, units, 'none', date || localDateStr(), today || null);
    res.json({
      prompt: `[System prompt]\n${systemPrompt}\n\n[User message]\n${userContent}`,
      run_count: runs.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate workout ───────────────────────────────────────────────────────────

app.post('/api/generate-workout', async (req, res) => {
  try {
    const runs = await getActivities();
    if (!runs.length) return res.status(400).json({ error: 'No runs found on Strava.' });

    const { units = 'miles', soreness = 'none', date } = req.body || {};
    const sessionDate = date || localDateStr();
    const message = await getAnthropicClient().messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     COACHING_PROMPT,
      messages:   [{ role: 'user', content: buildPromptContent(runs, units, soreness, sessionDate) }],
    });

    const text      = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude response contained no JSON');
    const workouts = JSON.parse(jsonMatch[0]);

    const { input_tokens, output_tokens } = message.usage;
    const cost = (input_tokens / 1_000_000) * 3 + (output_tokens / 1_000_000) * 15;
    db.prepare(`
      INSERT OR REPLACE INTO workout_sessions (date, option_a, option_b, option_c, recommended, selected, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(sessionDate, JSON.stringify(workouts.option_a), JSON.stringify(workouts.option_b), JSON.stringify(workouts.option_c), workouts.recommended || 'option_a', input_tokens, output_tokens, new Date().toISOString());

    res.json({ workouts, cost, input_tokens, output_tokens });
  } catch (err) {
    console.error('[/api/generate-workout]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Today's session ────────────────────────────────────────────────────────────

app.get('/api/today-session', (_req, res) => {
  const today = localDateStr();
  const session = db.prepare('SELECT * FROM workout_sessions WHERE date = ?').get(today);
  if (!session) return res.json({ session: null });
  // Check if a run was completed today
  const todayRun = db.prepare("SELECT id FROM runs WHERE date LIKE ? LIMIT 1").get(`${today}%`);
  res.json({
    session: {
      option_a: JSON.parse(session.option_a),
      option_b: JSON.parse(session.option_b),
      option_c: JSON.parse(session.option_c),
      recommended: session.recommended || 'option_a',
      selected: session.selected,
      result: session.result || null,
      result_notes: session.result_notes || null,
      input_tokens: session.input_tokens,
      output_tokens: session.output_tokens,
    },
    run_completed_today: !!todayRun,
  });
});

app.post('/api/select-workout', (req, res) => {
  const { selected, date } = req.body;
  if (!['option_a', 'option_b', 'option_c', 'none'].includes(selected)) {
    return res.status(400).json({ error: 'Invalid selection' });
  }
  const targetDate = date || localDateStr();
  const result = db.prepare('UPDATE workout_sessions SET selected = ? WHERE date = ?').run(selected, targetDate);
  if (result.changes === 0) return res.status(404).json({ error: 'No session for that date' });

  // Tag the run(s) on that date with the workout type
  const session = db.prepare('SELECT * FROM workout_sessions WHERE date = ?').get(targetDate);
  if (session && session[selected]) {
    const workout = JSON.parse(session[selected]);
    db.prepare("UPDATE runs SET workout_type = ? WHERE date LIKE ?").run(workout.type, `${targetDate}%`);
  }

  res.json({ ok: true });
});

app.post('/api/session-result', (req, res) => {
  const { date, result, notes } = req.body;
  if (result !== null && !['hit', 'partial', 'missed'].includes(result)) {
    return res.status(400).json({ error: 'Invalid result' });
  }
  const targetDate = date || localDateStr();
  const r = db.prepare('UPDATE workout_sessions SET result = ?, result_notes = ? WHERE date = ?').run(result, notes ?? null, targetDate);
  if (r.changes === 0) return res.status(404).json({ error: 'No session for that date' });
  res.json({ ok: true });
});

// ── Session lookup ─────────────────────────────────────────────────────────────

app.get('/api/session-dates', (_req, res) => {
  const rows = db.prepare('SELECT date FROM workout_sessions').all();
  res.json({ dates: rows.map(r => r.date) });
});

app.get('/api/session/:date', (req, res) => {
  const session = db.prepare('SELECT * FROM workout_sessions WHERE date = ?').get(req.params.date);
  if (!session) return res.status(404).json({ error: 'No session for that date' });
  res.json({
    date: session.date,
    option_a: JSON.parse(session.option_a),
    option_b: JSON.parse(session.option_b),
    option_c: JSON.parse(session.option_c),
    recommended: session.recommended || 'option_a',
    selected: session.selected,
    result: session.result || null,
    result_notes: session.result_notes || null,
    input_tokens: session.input_tokens,
    output_tokens: session.output_tokens,
  });
});

// ── Delete session ─────────────────────────────────────────────────────────────

app.delete('/api/session/:date', (req, res) => {
  const { date } = req.params;
  // Also clear the workout_type from any runs on that date
  db.prepare("UPDATE runs SET workout_type = NULL WHERE date LIKE ?").run(`${date}%`);
  const result = db.prepare('DELETE FROM workout_sessions WHERE date = ?').run(date);
  if (result.changes === 0) return res.status(404).json({ error: 'No session for that date' });
  res.json({ ok: true });
});

// ── Unresolved sessions (run completed but no workout selected) ────────────────

app.get('/api/unresolved-sessions', (_req, res) => {
  // Sessions where a run exists on that date but no selection was made
  const sessions = db.prepare('SELECT date FROM workout_sessions WHERE selected IS NULL').all();
  const unresolved = sessions
    .filter(s => db.prepare("SELECT id FROM runs WHERE date LIKE ? LIMIT 1").get(`${s.date}%`))
    .map(s => s.date);
  res.json({ dates: unresolved });
});

// ── Raw activity debug ─────────────────────────────────────────────────────────

app.get('/api/raw-activity', async (_req, res) => {
  try {
    const token    = await getStravaToken();
    const response = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1',
      { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    res.json(data[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running coach → http://localhost:${PORT}`));
