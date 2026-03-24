// ── Utilities ─────────────────────────────────────────────────────────────────

let useImperial = true;

function formatPace(speedMs) {
  if (!speedMs || speedMs <= 0) return '—';
  if (useImperial) {
    const secsPerMile = 1609.34 / speedMs;
    const mins = Math.floor(secsPerMile / 60);
    const secs = Math.round(secsPerMile % 60);
    return `${mins}:${String(secs).padStart(2, '0')} /mi`;
  }
  const secsPerKm = 1000 / speedMs;
  const mins = Math.floor(secsPerKm / 60);
  const secs = Math.round(secsPerKm % 60);
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

function formatDistance(meters) {
  if (useImperial) return (meters / 1609.34).toFixed(2);
  return (meters / 1000).toFixed(2);
}

function unitLabel() {
  return useImperial ? 'mi' : 'km';
}

function buildMonthGrid(year, month, runDates, todayStr, unresolvedDates = new Set(), sessionDates = new Set()) {
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    .map((d) => `<div class="cal-day-label">${d}</div>`)
    .join('');

  const blanks = Array.from({ length: firstDay }, () => '<div class="cal-cell empty"></div>').join('');

  const cells = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hasRun = runDates.has(dateStr);
    const isToday = dateStr === todayStr;
    const isUnresolved = unresolvedDates.has(dateStr);
    const hasSession = sessionDates.has(dateStr);
    let cls = 'cal-cell';
    if (hasRun) cls += ' has-run';
    if (isToday) cls += ' today';
    if (isUnresolved) cls += ' unresolved';
    if (hasSession) cls += ' has-session';
    const clickAttr = hasSession ? `data-session-date="${dateStr}"` : '';
    return `<div class="${cls}" ${clickAttr}><span class="cal-day-num">${d}</span>${hasRun ? '<span class="cal-dot"></span>' : ''}</div>`;
  }).join('');

  return `
    <div class="cal-month">
      <div class="cal-month-label">${monthName}</div>
      <div class="cal-grid">
        ${dayLabels}
        ${blanks}
        ${cells}
      </div>
    </div>
  `;
}

async function renderCalendar(runs) {
  const runDates = new Set(runs.map((r) => r.date.slice(0, 10)));
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const curYear = today.getFullYear();
  const curMonth = today.getMonth();
  const prevDate = new Date(curYear, curMonth - 1, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth();

  let unresolvedDates = new Set();
  let sessionDates = new Set();
  try {
    const [unresolvedRes, sessionRes] = await Promise.all([
      fetch('/api/unresolved-sessions'),
      fetch('/api/session-dates'),
    ]);
    unresolvedDates = new Set((await unresolvedRes.json()).dates);
    sessionDates = new Set((await sessionRes.json()).dates);
  } catch (_) {}

  document.getElementById('calendar').innerHTML = `
    <div class="cal-months-row">
      ${buildMonthGrid(prevYear, prevMonth, runDates, todayStr, unresolvedDates, sessionDates)}
      ${buildMonthGrid(curYear, curMonth, runDates, todayStr, unresolvedDates, sessionDates)}
    </div>
  `;

  document.querySelectorAll('.cal-cell[data-session-date]').forEach((cell) => {
    cell.addEventListener('click', () => openSessionModal(cell.dataset.sessionDate));
  });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// ── State ─────────────────────────────────────────────────────────────────────

let allRuns = [];
let currentWorkouts = null;

// ── Run cards ─────────────────────────────────────────────────────────────────

async function loadActivities() {
  const grid = document.getElementById('runs-grid');
  grid.innerHTML = '<div class="state-msg">Loading your runs…</div>';

  try {
    const res = await fetch('/api/activities');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Unknown error');
    if (!data.length) {
      grid.innerHTML = '<div class="state-msg">No runs found on Strava yet.</div>';
      return;
    }

    allRuns = data;

    // Clear saved workouts if a new run has appeared since they were generated
    const saved = localStorage.getItem('lastWorkouts');
    if (saved) {
      try {
        const { latestRun } = JSON.parse(saved);
        if (latestRun && data.length && data[0].date !== latestRun) {
          localStorage.removeItem('lastWorkouts');
          localStorage.removeItem('selectedWorkout');
        }
      } catch (_) { localStorage.removeItem('lastWorkouts'); }
    }

    renderCalendar(data);
    const recent = data.slice(0, 5);

    grid.innerHTML = recent.map((run) => `
      <div class="run-card">
        <div class="run-date">${formatDate(run.date)}</div>
        <div>
          <span class="run-distance">${formatDistance(run.distance)}</span>
          <span class="run-unit">${unitLabel()}</span>
        </div>
        <div class="run-stats">
          <div>
            <div class="stat-label">Pace</div>
            <div class="stat-value">${formatPace(run.average_speed)}</div>
          </div>
          <div>
            <div class="stat-label">Time</div>
            <div class="stat-value">${formatElapsed(run.elapsed_time)}</div>
          </div>
          <div>
            <div class="stat-label">Avg HR</div>
            <div class="stat-value">${run.average_heartrate ? Math.round(run.average_heartrate) + ' bpm' : '—'}</div>
          </div>
          <div>
            <div class="stat-label">Elev</div>
            <div class="stat-value">${run.total_elevation_gain ? Math.round(run.total_elevation_gain) + 'm' : '—'}</div>
          </div>
        </div>
      </div>
    `).join('');

    document.getElementById('generate-btn').disabled = false;
  } catch (err) {
    grid.innerHTML = `<div class="state-error">Failed to load activities: ${err.message}</div>`;
  }
}

// ── Generate workouts ─────────────────────────────────────────────────────────

async function generateWorkout() {
  const btn        = document.getElementById('generate-btn');
  const btnText    = document.getElementById('btn-text');
  const btnLoading = document.getElementById('btn-loading');

  btn.disabled = true;
  btnText.hidden = true;
  btnLoading.hidden = false;

  document.getElementById('workouts-section').hidden = true;

  try {
    const goal = localStorage.getItem('userGoal') || '';
    const res = await fetch('/api/generate-workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, units: useImperial ? 'miles' : 'km' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');

    const { workouts, cost, input_tokens, output_tokens } = data;
    currentWorkouts = workouts;
    localStorage.setItem('lastWorkouts', JSON.stringify({
      workouts,
      latestRun: allRuns.length ? allRuns[0].date : null,
    }));
    renderWorkouts(workouts);

    document.getElementById('cost-display').textContent =
      `$${cost.toFixed(4)} · ${input_tokens} in / ${output_tokens} out`;
    document.getElementById('cost-display').hidden = false;

    document.getElementById('workouts-section').hidden = false;
    document.getElementById('workouts-section').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert('Failed to generate workout: ' + err.message);
  } finally {
    btn.disabled = false;
    btnText.hidden = false;
    btnLoading.hidden = true;
  }
}

function renderWorkouts(workouts) {
  const grid = document.getElementById('workouts-grid');

  const options = [
    { key: 'option_a', label: 'Option A' },
    { key: 'option_b', label: 'Option B' },
    { key: 'option_c', label: 'Option C' },
  ];

  grid.innerHTML = options.map(({ key, label }) => {
    const w = workouts[key];
    if (!w) return '';
    return `
      <div class="workout-card ${key}" data-type="${key}">
        <span class="badge">${label}</span>
        <div class="workout-type">${w.type}</div>
        <div class="workout-structure">${w.structure}</div>
        <div class="workout-pace">Target: ${w.target_pace}</div>
        <div class="workout-rationale">${w.rationale}</div>
        <div class="workout-selected-note">✓ Selected for today</div>
      </div>
    `;
  }).join('');

  // Attach click handlers
  grid.querySelectorAll('.workout-card').forEach((card) => {
    card.addEventListener('click', () => selectWorkout(card.dataset.type));
  });

  // Restore previous selection
  const prev = localStorage.getItem('selectedWorkout');
  if (prev) {
    const prevCard = document.querySelector(`[data-type="${prev}"]`);
    if (prevCard) prevCard.classList.add('selected');
  }
}

// ── Select workout ────────────────────────────────────────────────────────────

async function selectWorkoutForDate(type, date) {
  await fetch('/api/select-workout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected: type, date }),
  });
  promptLoaded = false;
  document.getElementById('unresolved-banner').hidden = true;
  renderCalendar(allRuns);
}

async function selectWorkout(type) {
  document.querySelectorAll('.workout-card').forEach((c) => c.classList.remove('selected'));
  const selected = document.querySelector(`[data-type="${type}"]`);
  if (selected) selected.classList.add('selected');
  localStorage.setItem('selectedWorkout', type);

  await fetch('/api/select-workout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected: type }),
  });

  promptLoaded = false;
  document.getElementById('generate-btn').disabled = true;
  document.getElementById('generate-locked-msg').hidden = false;
  document.getElementById('unresolved-banner').hidden = true;
}

// ── Session modal ─────────────────────────────────────────────────────────────

async function openSessionModal(date) {
  const modal = document.getElementById('session-modal');
  const title = document.getElementById('session-modal-date');
  const body  = document.getElementById('session-modal-body');

  title.textContent = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  body.innerHTML = '<div class="state-msg">Loading…</div>';
  modal.hidden = false;

  try {
    const res = await fetch(`/api/session/${date}`);
    const data = await res.json();
    const options = [
      { key: 'option_a', label: 'Option A' },
      { key: 'option_b', label: 'Option B' },
      { key: 'option_c', label: 'Option C' },
    ];

    const noneChosen = data.selected === 'none';
    body.innerHTML = options.map(({ key, label }) => {
      const w = data[key];
      const isSelected = data.selected === key;
      return `
        <div class="modal-workout ${isSelected ? 'modal-workout-selected' : ''} modal-workout-selectable" data-key="${key}">
          <div class="modal-workout-header">
            <span class="badge">${label}</span>
            ${isSelected ? '<span class="modal-chosen">✓ Chosen</span>' : ''}
          </div>
          <div class="workout-type">${w.type}</div>
          <div class="workout-structure">${w.structure}</div>
          <div class="workout-pace">Target: ${w.target_pace}</div>
          <div class="workout-rationale">${w.rationale}</div>
        </div>
      `;
    }).join('') + `
      <button id="modal-none-btn" class="modal-none-btn ${noneChosen ? 'modal-none-chosen' : ''}" data-key="none">
        ${noneChosen ? '✓ Did something else' : 'None of the above — did something else'}
      </button>
    `;

    body.querySelectorAll('.modal-workout-selectable').forEach((card) => {
      card.addEventListener('click', async () => {
        await selectWorkoutForDate(card.dataset.key, date);
        modal.hidden = true;
      });
    });
    document.getElementById('modal-none-btn').addEventListener('click', async () => {
      if (noneChosen) return; // already selected, no-op
      await selectWorkoutForDate('none', date);
      modal.hidden = true;
    });

    // Action footer (outside scrollable body)
    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    const footer = document.getElementById('session-modal-footer');
    footer.innerHTML = `
      ${date === today ? '<button class="modal-action-btn modal-regenerate-btn">↺ Regenerate</button>' : ''}
      <button class="modal-action-btn modal-delete-btn">Delete session</button>
    `;

    if (date === today) {
      footer.querySelector('.modal-regenerate-btn').addEventListener('click', async () => {
        modal.hidden = true;
        await generateWorkout();
        renderCalendar(allRuns);
      });
    }
    footer.querySelector('.modal-delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete this session? This cannot be undone.')) return;
      await fetch(`/api/session/${date}`, { method: 'DELETE' });
      promptLoaded = false;
      if (date === today) {
        document.getElementById('generate-btn').disabled = false;
        document.getElementById('generate-locked-msg').hidden = true;
        document.getElementById('workouts-section').hidden = true;
        document.querySelector('.generate-section').hidden = false;
      }
      modal.hidden = true;
      renderCalendar(allRuns);
    });
  } catch (err) {
    body.innerHTML = `<div class="state-error">${err.message}</div>`;
  }
}

document.getElementById('session-modal-close').addEventListener('click', () => {
  document.getElementById('session-modal').hidden = true;
});

document.getElementById('session-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

const todayLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
document.getElementById('btn-text').textContent = `Generate Workout for ${todayLabel}`;

document.getElementById('generate-btn').addEventListener('click', generateWorkout);

const saved = localStorage.getItem('lastWorkouts');
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    if (!parsed.workouts) throw new Error('stale format');
    currentWorkouts = parsed.workouts;
    renderWorkouts(currentWorkouts);
    document.getElementById('workouts-section').hidden = false;
    document.querySelector('.generate-section').hidden = true;
  } catch (_) { localStorage.removeItem('lastWorkouts'); }
}

// ── Prompt preview ────────────────────────────────────────────────────────────

const promptPreviewBtn = document.getElementById('prompt-preview-btn');
const promptPreviewEl  = document.getElementById('prompt-preview');
let promptLoaded = false;

promptPreviewBtn.addEventListener('click', async () => {
  const open = !promptPreviewEl.hidden;
  if (open) {
    promptPreviewEl.hidden = true;
    promptPreviewBtn.textContent = '▶ Preview prompt';
    return;
  }
  promptPreviewBtn.textContent = '▼ Preview prompt';
  if (!promptLoaded) {
    promptPreviewEl.textContent = 'Loading…';
    promptPreviewEl.hidden = false;
    try {
      const res = await fetch('/api/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: useImperial ? 'miles' : 'km' }),
      });
      const data = await res.json();
      promptPreviewEl.textContent = data.prompt;
      promptLoaded = true;
    } catch (err) {
      promptPreviewEl.textContent = 'Failed to load preview: ' + err.message;
    }
  } else {
    promptPreviewEl.hidden = false;
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

const settingsPanel = document.getElementById('settings-panel');

document.getElementById('settings-btn').addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

async function saveSetting(key, value) {
  promptLoaded = false;
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

async function loadSettings() {
  const res  = await fetch('/api/settings');
  const data = await res.json();

  // ── Goal input ───────────────────────────────────────────────────────────
  const goalInput = document.getElementById('goal-input');
  goalInput.value = data.goal || '';
  let goalTimer;
  goalInput.addEventListener('input', () => {
    clearTimeout(goalTimer);
    goalTimer = setTimeout(() => saveSetting('goal', goalInput.value.trim()), 600);
  });
}

// ── Unit toggle ───────────────────────────────────────────────────────────────

document.getElementById('unit-km').addEventListener('click', () => {
  useImperial = false;
  promptLoaded = false;
  document.getElementById('unit-km').classList.add('active');
  document.getElementById('unit-mi').classList.remove('active');
  if (allRuns.length) loadActivities();
});

document.getElementById('unit-mi').addEventListener('click', () => {
  useImperial = true;
  promptLoaded = false;
  document.getElementById('unit-mi').classList.add('active');
  document.getElementById('unit-km').classList.remove('active');
  if (allRuns.length) loadActivities();
});

async function checkTodaySession() {
  try {
    const res = await fetch('/api/today-session');
    const data = await res.json();
    if (!data.session) return;

    // Show workouts section with today's session
    currentWorkouts = data.session;
    renderWorkouts(data.session);
    document.getElementById('workouts-section').hidden = false;
    document.querySelector('.generate-section').hidden = true;

    // Restore DB-persisted selection (overrides localStorage)
    if (data.session.selected) {
      document.querySelectorAll('.workout-card').forEach((c) => c.classList.remove('selected'));
      const card = document.querySelector(`[data-type="${data.session.selected}"]`);
      if (card) card.classList.add('selected');
      localStorage.setItem('selectedWorkout', data.session.selected);
    }

    // Lock generate button once a selection exists for today
    if (data.session.selected) {
      document.getElementById('generate-btn').disabled = true;
      document.getElementById('generate-locked-msg').hidden = false;
    }

    // If a run was completed today but no selection made, show top banner
    if (data.run_completed_today && !data.session.selected) {
      document.getElementById('unresolved-banner').hidden = false;
    }
  } catch (_) { /* non-critical */ }
}

loadSettings();
loadActivities();
checkTodaySession();
