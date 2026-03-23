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

function buildMonthGrid(year, month, runDates, todayStr) {
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
    let cls = 'cal-cell';
    if (hasRun) cls += ' has-run';
    if (isToday) cls += ' today';
    return `<div class="${cls}"><span class="cal-day-num">${d}</span>${hasRun ? '<span class="cal-dot"></span>' : ''}</div>`;
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

function renderCalendar(runs) {
  const runDates = new Set(runs.map((r) => r.date.slice(0, 10)));
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const curYear = today.getFullYear();
  const curMonth = today.getMonth();
  const prevDate = new Date(curYear, curMonth - 1, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth();

  document.getElementById('calendar').innerHTML = `
    <div class="cal-months-row">
      ${buildMonthGrid(prevYear, prevMonth, runDates, todayStr)}
      ${buildMonthGrid(curYear, curMonth, runDates, todayStr)}
    </div>
  `;
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
    document.querySelector('.generate-section').hidden = !!localStorage.getItem('lastWorkouts');
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
  document.getElementById('confirmed-section').hidden = true;

  try {
    const res = await fetch('/api/generate-workout', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');

    currentWorkouts = data;
    localStorage.setItem('lastWorkouts', JSON.stringify({
      workouts: data,
      latestRun: allRuns.length ? allRuns[0].date : null,
    }));
    renderWorkouts(data);
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

function selectWorkout(type) {
  document.querySelectorAll('.workout-card').forEach((c) => c.classList.remove('selected'));
  const selected = document.querySelector(`[data-type="${type}"]`);
  if (selected) selected.classList.add('selected');
  localStorage.setItem('selectedWorkout', type);
}

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

document.getElementById('unit-km').addEventListener('click', () => {
  useImperial = false;
  document.getElementById('unit-km').classList.add('active');
  document.getElementById('unit-mi').classList.remove('active');
  if (allRuns.length) loadActivities();
});

document.getElementById('unit-mi').addEventListener('click', () => {
  useImperial = true;
  document.getElementById('unit-mi').classList.add('active');
  document.getElementById('unit-km').classList.remove('active');
  if (allRuns.length) loadActivities();
});

loadActivities();
