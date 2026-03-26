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
    const isFutureOrToday = dateStr >= todayStr;
    const isUnresolved = unresolvedDates.has(dateStr);
    const hasSession = sessionDates.has(dateStr);
    let cls = 'cal-cell';
    if (hasRun) cls += ' has-run';
    if (isToday) cls += ' today';
    if (isUnresolved) cls += ' unresolved';
    if (hasSession) cls += ' has-session';
    if (isFutureOrToday && !hasSession) cls += ' future-selectable';
    const clickAttr = hasSession
      ? `data-session-date="${dateStr}"`
      : isFutureOrToday ? `data-future-date="${dateStr}"` : '';
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

  // Future empty cells — click to target for generation
  document.querySelectorAll('.cal-cell[data-future-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      targetDate = cell.dataset.futureDate;
      updateGenerateBtn();
      document.querySelector('.generate-section').hidden = false;
      document.getElementById('generate-btn').disabled = false;
      document.getElementById('generate-btn').scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight selected target
      document.querySelectorAll('.cal-cell.target-date').forEach(c => c.classList.remove('target-date'));
      cell.classList.add('target-date');
    });
  });

  // Restore target highlight if it's still a future date
  if (targetDate >= todayStr) {
    document.querySelectorAll(`.cal-cell[data-future-date="${targetDate}"]`).forEach(c => c.classList.add('target-date'));
  }
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

function formatCost(input_tokens, output_tokens) {
  if (!input_tokens) return null;
  const cost = (input_tokens / 1_000_000) * 3 + (output_tokens / 1_000_000) * 15;
  return `$${cost.toFixed(4)} · ${input_tokens.toLocaleString()} in / ${output_tokens} out`;
}

// ── State ─────────────────────────────────────────────────────────────────────

let allRuns = [];
let currentWorkouts = null;
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
let targetDate = localDateStr();

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

async function generateWorkout(soreness = 'none', historyDays = 60) {
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
      body: JSON.stringify({ goal, units: useImperial ? 'miles' : 'km', soreness, date: targetDate, history_days: historyDays }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');

    const { workouts, input_tokens, output_tokens } = data;
    currentWorkouts = workouts;
    renderWorkouts(workouts);

    document.getElementById('cost-display').textContent = formatCost(input_tokens, output_tokens);
    document.getElementById('cost-display').hidden = false;

    document.querySelector('.generate-section').hidden = true;
    document.getElementById('workouts-section').hidden = false;
    document.getElementById('workouts-section').scrollIntoView({ behavior: 'smooth' });
    await renderCalendar(allRuns);
    await checkTodaySession();
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
  const recommended = workouts.recommended || 'option_a';
  const order = [recommended, ...['option_a', 'option_b', 'option_c'].filter(k => k !== recommended)];
  let current = 0;

  function cardHTML(key, index) {
    const w = workouts[key];
    if (!w) return '';
    const isRec = key === recommended;
    return `
      <div class="workout-card ${key}" data-type="${key}" data-index="${index}">
        ${isRec ? '<span class="rec-badge">Recommended</span>' : '<span class="alt-badge">Alternative</span>'}
        <div class="workout-type">${w.type}</div>
        <div class="workout-structure">${(Array.isArray(w.structure) ? w.structure : w.structure.split('\n')).map(s => `<div class="workout-step">${s}</div>`).join('')}</div>
        <div class="workout-pace">Target: ${w.target_pace}</div>
        <div class="workout-rationale">${w.rationale}</div>
        <div class="workout-selected-note">✓ Selected for today</div>
      </div>
    `;
  }

  grid.innerHTML = `
    <div class="carousel">
      <button class="carousel-btn carousel-prev" id="carousel-prev">&#8592;</button>
      <div class="carousel-track" id="carousel-track">
        ${order.map((key, i) => cardHTML(key, i)).join('')}
      </div>
      <button class="carousel-btn carousel-next" id="carousel-next">&#8594;</button>
    </div>
    <div class="carousel-dots" id="carousel-dots">
      ${order.map((_, i) => `<span class="carousel-dot${i === 0 ? ' active' : ''}"></span>`).join('')}
    </div>
  `;

  function goTo(index) {
    current = index;
    const cards = grid.querySelectorAll('.workout-card');
    cards.forEach((c, i) => c.classList.toggle('carousel-active', i === current));
    grid.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === current));
  }

  document.getElementById('carousel-prev').addEventListener('click', () => goTo((current - 1 + order.length) % order.length));
  document.getElementById('carousel-next').addEventListener('click', () => goTo((current + 1) % order.length));

  goTo(0);

  grid.querySelectorAll('.workout-card').forEach((card) => {
    card.addEventListener('click', () => selectWorkout(card.dataset.type));
  });
}

// ── Workout result picker ─────────────────────────────────────────────────────

function isRestDay(workout) {
  return workout && workout.type && workout.type.toLowerCase().includes('rest');
}

const RESULT_DEFAULTS = {
  hit:     'Hit all targets as prescribed.',
  partial: 'Hit some targets but not all.',
  missed:  'Could not hit the prescribed targets.',
};

function resultPickerHTML(currentResult, currentNotes) {
  const active = (val) => currentResult === val ? ' active' : '';
  return `
    <div class="result-picker">
      <span class="result-picker-label">How did it go?</span>
      <div class="result-toggle">
        <button class="result-btn hit${active('hit')}" data-value="hit">✓ Hit targets</button>
        <button class="result-btn partial${active('partial')}" data-value="partial">~ Close</button>
        <button class="result-btn missed${active('missed')}" data-value="missed">✕ Missed</button>
      </div>
      <textarea class="result-notes" placeholder="Add a note…" rows="2">${currentNotes || ''}</textarea>
    </div>
  `;
}

function wireResultPicker(container, date) {
  const textarea = container.querySelector('.result-notes');

  container.querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      container.querySelectorAll('.result-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (textarea && !textarea.value.trim()) {
        textarea.value = RESULT_DEFAULTS[btn.dataset.value] || '';
      }
      await save();
    });
  });

  if (textarea) {
    textarea.addEventListener('click', (e) => e.stopPropagation());
    textarea.addEventListener('blur', save);
  }

  async function save() {
    const activeBtn = container.querySelector('.result-btn.active');
    await fetch('/api/session-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        result: activeBtn ? activeBtn.dataset.value : null,
        notes: textarea ? textarea.value.trim() || null : null,
      }),
    });
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
  if (date === localDateStr()) await checkTodaySession();
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

// ── Generate confirm modal ────────────────────────────────────────────────────

async function openGenerateModal() {
  const modal = document.getElementById('generate-modal');
  // Update modal title to show the target date
  const d = new Date(targetDate + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  document.querySelector('#generate-modal .modal-title').textContent = label;

  modal.hidden = false;
  await loadGeneratePreview();
}

async function loadGeneratePreview() {
  const historyDays = 60;
  const body  = document.getElementById('generate-modal-body');
  const units = useImperial ? 'miles' : 'km';
  const today = localDateStr();

  body.innerHTML = '<div class="state-msg">Loading…</div>';

  try {
    const payload = { units, date: targetDate, today, history_days: historyDays };
    const [estimateRes, previewRes] = await Promise.all([
      fetch('/api/cost-estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      fetch('/api/prompt-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    ]);
    const estimate = await estimateRes.json();
    const preview  = await previewRes.json();

    body.innerHTML = `
      ${targetDate === localDateStr() ? `
      <div class="soreness-section">
        <span class="generate-preview-label">Lower body soreness</span>
        <button id="soreness-toggle-btn" class="soreness-toggle-btn" data-sore="no">No</button>
      </div>` : ''}
      <p class="generate-section-label">Cost estimate</p>
      <div class="generate-preview-meta">
        <div class="generate-preview-row">
          <span class="generate-preview-label">Model</span>
          <span>claude-sonnet-4-6</span>
        </div>
        <div class="generate-preview-row">
          <span class="generate-preview-label">Input tokens</span>
          <span id="preview-input-tokens">${estimate.input_tokens.toLocaleString()}</span>
        </div>
        <div class="generate-preview-row">
          <span class="generate-preview-label">Est. output tokens</span>
          <span>~${estimate.estimated_output_tokens}</span>
        </div>
        <div class="generate-preview-row">
          <span class="generate-preview-label">Est. cost</span>
          <span class="generate-preview-cost" id="preview-cost">~$${estimate.cost.toFixed(4)}</span>
        </div>
      </div>
      <p class="generate-section-label">Prompt context</p>
      <div class="generate-preview-meta">
        ${preview.goal ? `
        <div class="generate-preview-row">
          <span class="generate-preview-label">Goal</span>
          <span class="generate-preview-goal">${preview.goal}</span>
        </div>` : ''}
        <div class="generate-preview-row">
          <span class="generate-preview-label">Training philosophy</span>
          <span>80/20 polarized</span>
        </div>
        <div class="generate-preview-row">
          <span class="generate-preview-label">History window</span>
          <span>${(() => {
            const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return preview.oldest_run && preview.newest_run
              ? `${preview.history_days} days · ${fmt(preview.oldest_run)} – ${fmt(preview.newest_run)} · ${preview.run_count} runs`
              : `${preview.history_days} days`;
          })()}</span>
        </div>
        ${preview.days_since_last_run !== null ? `
        <div class="generate-preview-row">
          <span class="generate-preview-label">Days since last run</span>
          <span>${preview.days_since_last_run === 0 ? 'Today' : preview.days_since_last_run === 1 ? 'Yesterday' : preview.days_since_last_run + ' days ago'}</span>
        </div>` : ''}
        ${preview.last_prescribed ? `
        <div class="generate-preview-row">
          <span class="generate-preview-label">Last prescribed</span>
          <span>${preview.last_prescribed}</span>
        </div>` : ''}
        ${(preview.race_distance || preview.race_date) ? `
        <div class="generate-preview-row">
          <span class="generate-preview-label">Race target</span>
          <span>${[preview.race_distance, preview.race_date ? (() => {
            const d = new Date(preview.race_date + 'T12:00:00');
            const daysOut = Math.round((d - new Date()) / 86400000);
            const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `${label} (${daysOut === 0 ? 'today' : daysOut === 1 ? 'tomorrow' : daysOut + ' days out'})`;
          })() : ''].filter(Boolean).join(' · ')}</span>
        </div>` : ''}
      </div>
      <details class="generate-preview-details">
        <summary>Preview prompt</summary>
        <pre class="prompt-preview">${preview.prompt}</pre>
      </details>
    `;

    const sorenessBtn = body.querySelector('#soreness-toggle-btn');
    const previewEl   = body.querySelector('.prompt-preview');
    const sorenessNote = '\n\nNote: The athlete is reporting lower body soreness today. Take this into account when recommending intensity and workout type.';
    const insertBefore = '\n\nAll distances and paces must be in';
    const basePrompt   = preview.prompt;

    if (sorenessBtn) {
      sorenessBtn.addEventListener('click', () => {
        const isSore = sorenessBtn.dataset.sore === 'yes';
        sorenessBtn.dataset.sore = isSore ? 'no' : 'yes';
        sorenessBtn.textContent = isSore ? 'No' : 'Yes';
        sorenessBtn.classList.toggle('active', !isSore);
        if (previewEl) {
          previewEl.textContent = !isSore
            ? basePrompt.replace(insertBefore, sorenessNote + insertBefore)
            : basePrompt;
        }
      });
    }
  } catch (err) {
    body.innerHTML = `<div class="state-error">Failed to load preview: ${err.message}</div>`;
  }
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
    const options = ['option_a', 'option_b', 'option_c'].map(key => ({ key }));

    const noneChosen = data.selected === 'none';
    body.innerHTML = options.map(({ key }) => {
      const w = data[key];
      const isSelected = data.selected === key;
      const isRec = key === data.recommended;
      const showResult = isSelected && !isRestDay(w);
      return `
        <div class="modal-workout ${isSelected ? 'modal-workout-selected' : ''} modal-workout-selectable" data-key="${key}">
          <div class="modal-workout-header">
            ${isRec
              ? '<span class="rec-badge">Recommended</span>'
              : '<span class="alt-badge">Alternative</span>'}
            ${isSelected ? '<span class="modal-chosen">✓ Chosen</span>' : ''}
          </div>
          <div class="workout-type">${w.type}</div>
          <div class="workout-structure">${(Array.isArray(w.structure) ? w.structure : w.structure.split('\n')).map(s => `<div class="workout-step">${s}</div>`).join('')}</div>
          <div class="workout-pace">Target: ${w.target_pace}</div>
          <div class="workout-rationale">${w.rationale}</div>
          ${showResult ? `<div class="modal-result-inline">${resultPickerHTML(data.result, data.result_notes)}</div>` : ''}
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

    const resultInline = body.querySelector('.modal-result-inline');
    if (resultInline) wireResultPicker(resultInline, date);

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
        localStorage.removeItem('lastWorkouts');
        localStorage.removeItem('selectedWorkout');
        currentWorkouts = null;
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

function updateGenerateBtn() {
  const d = new Date(targetDate + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  document.getElementById('btn-text').textContent = `Generate Workout for ${label}`;
}
updateGenerateBtn();

document.getElementById('generate-btn').addEventListener('click', openGenerateModal);

document.getElementById('generate-modal-close').addEventListener('click', () => {
  document.getElementById('generate-modal').hidden = true;
});
document.getElementById('generate-modal-cancel').addEventListener('click', () => {
  document.getElementById('generate-modal').hidden = true;
});
document.getElementById('generate-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});
document.getElementById('generate-modal-confirm').addEventListener('click', () => {
  const sorenessBtn = document.getElementById('soreness-toggle-btn');
  const soreness = sorenessBtn?.dataset.sore === 'yes' ? 'yes' : 'none';
  const historyDays = 60;
  document.getElementById('generate-modal').hidden = true;
  generateWorkout(soreness, historyDays);
});

// ── Prompt preview (used by generate modal) ───────────────────────────────────

let promptLoaded = false;

// ── User menu ─────────────────────────────────────────────────────────────────

fetch('/api/me').then(r => r.json()).then(({ username }) => {
  document.getElementById('user-menu-username').textContent = username;
});

const userMenuBtn      = document.getElementById('user-menu-btn');
const userMenuDropdown = document.getElementById('user-menu-dropdown');

// ── Settings ──────────────────────────────────────────────────────────────────

const settingsPanel = document.getElementById('settings-panel');
const settingsGroups = ['training', 'credentials', 'account', 'data'];
let activeSettingsSection = null;

function openSettingsSection(section) {
  settingsGroups.forEach(g => {
    document.getElementById(`settings-group-${g}`).hidden = (g !== section);
  });
  settingsPanel.hidden = false;
  activeSettingsSection = section;
}

function closeSettingsPanel() {
  settingsPanel.hidden = true;
  activeSettingsSection = null;
}

document.getElementById('settings-close-btn').addEventListener('click', closeSettingsPanel);

userMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !userMenuDropdown.hidden;
  userMenuDropdown.hidden = open;
  userMenuBtn.setAttribute('aria-expanded', String(!open));
});

document.addEventListener('click', () => {
  userMenuDropdown.hidden = true;
  userMenuBtn.setAttribute('aria-expanded', 'false');
});

document.querySelectorAll('[data-settings]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown.hidden = true;
    userMenuBtn.setAttribute('aria-expanded', 'false');
    const section = btn.dataset.settings.replace('settings-group-', '');
    if (activeSettingsSection === section) {
      closeSettingsPanel();
    } else {
      openSettingsSection(section);
    }
  });
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

  // ── Cross-training input ──────────────────────────────────────────────────
  const crossInput = document.getElementById('cross-training-input');
  crossInput.value = data.cross_training || '';
  let crossTimer;
  crossInput.addEventListener('input', () => {
    clearTimeout(crossTimer);
    crossTimer = setTimeout(() => saveSetting('cross_training', crossInput.value.trim()), 600);
  });

  // ── Injury notes ──────────────────────────────────────────────────────────
  const injuryInput = document.getElementById('injury-notes-input');
  injuryInput.value = data.injury_notes || '';
  let injuryTimer;
  injuryInput.addEventListener('input', () => {
    clearTimeout(injuryTimer);
    injuryTimer = setTimeout(() => saveSetting('injury_notes', injuryInput.value.trim()), 600);
  });

  // ── Race target ───────────────────────────────────────────────────────────
  const raceDistanceInput = document.getElementById('race-distance-input');
  const raceDateInput = document.getElementById('race-date-input');
  raceDistanceInput.value = data.race_distance || '';
  raceDistanceInput.addEventListener('change', () => saveSetting('race_distance', raceDistanceInput.value));

  initDatePicker(raceDateInput, data.race_date || '', (val) => saveSetting('race_date', val));

  // ── Credentials (write-only — never populate values for security) ─────────
  function wireCredential(id, key) {
    const el = document.getElementById(id);
    let t;
    el.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (el.value) saveSetting(key, el.value.trim()); }, 800);
    });
  }
  wireCredential('anthropic-key-input',        'anthropic_api_key');
  wireCredential('strava-client-id-input',     'strava_client_id');
  wireCredential('strava-client-secret-input', 'strava_client_secret');
  wireCredential('strava-refresh-token-input', 'strava_refresh_token');

  // ── Password change ───────────────────────────────────────────────────────
  document.getElementById('change-password-btn').addEventListener('click', async () => {
    const current = document.getElementById('current-password-input').value;
    const next    = document.getElementById('new-password-input').value;
    const msg     = document.getElementById('change-password-msg');
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    const data = await res.json();
    msg.textContent = res.ok ? 'Password updated.' : (data.error || 'Failed.');
    msg.style.color = res.ok ? 'var(--accent)' : 'var(--text-muted)';
    msg.hidden = false;
    if (res.ok) {
      document.getElementById('current-password-input').value = '';
      document.getElementById('new-password-input').value = '';
    }
  });

  // ── Manual sync ───────────────────────────────────────────────────────────
  const syncBtn = document.getElementById('sync-btn');
  const syncMsg = document.getElementById('sync-msg');
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing…';
    syncMsg.hidden = true;
    const res = await fetch('/api/sync', { method: 'POST' });
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync from Strava now';
    syncMsg.textContent = res.ok ? 'Sync complete.' : 'Sync failed — check Strava credentials.';
    syncMsg.style.color = res.ok ? 'var(--accent)' : 'var(--text-muted)';
    syncMsg.hidden = false;
    if (res.ok) loadActivities();
  });
}

// ── Date picker ───────────────────────────────────────────────────────────────

function initDatePicker(input, initialValue, onChange) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let selected = initialValue ? new Date(initialValue + 'T00:00:00') : null;
  let viewing  = selected ? new Date(selected) : new Date();
  viewing.setDate(1);

  input.value = selected ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  input.readOnly = true;
  input.style.cursor = 'pointer';

  const popup = document.createElement('div');
  popup.className = 'datepicker-popup';
  popup.hidden = true;
  document.body.appendChild(popup);

  function render() {
    const today = new Date(); today.setHours(0,0,0,0);
    const y = viewing.getFullYear(), m = viewing.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    let cells = '';
    for (let i = 0; i < firstDay; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const isPast = date < today;
      const isSel  = selected && date.toDateString() === selected.toDateString();
      cells += `<div class="dp-day${isSel ? ' dp-selected' : ''}${isPast ? ' dp-past' : ''}" data-d="${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}">${d}</div>`;
    }

    popup.innerHTML = `
      <div class="dp-header">
        <button class="dp-nav" data-dir="-1">‹</button>
        <span class="dp-month">${MONTHS[m]} ${y}</span>
        <button class="dp-nav" data-dir="1">›</button>
      </div>
      <div class="dp-grid-head">${DAYS.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="dp-grid">${cells}</div>
    `;

    popup.querySelectorAll('.dp-nav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewing.setMonth(viewing.getMonth() + parseInt(btn.dataset.dir));
        render();
      });
    });

    popup.querySelectorAll('.dp-day:not(.dp-past)').forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        selected = new Date(cell.dataset.d + 'T00:00:00');
        input.value = selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        onChange(cell.dataset.d);
        popup.hidden = true;
        render();
      });
    });
  }

  function position() {
    const r = input.getBoundingClientRect();
    popup.style.top  = `${r.bottom + window.scrollY + 4}px`;
    popup.style.left = `${r.left + window.scrollX}px`;
  }

  input.addEventListener('click', (e) => {
    e.stopPropagation();
    render();
    position();
    popup.hidden = !popup.hidden;
  });

  document.addEventListener('click', () => { popup.hidden = true; });
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

    // Show generation cost if available
    const costStr = formatCost(data.session.input_tokens, data.session.output_tokens);
    if (costStr) {
      document.getElementById('cost-display').textContent = costStr;
      document.getElementById('cost-display').hidden = false;
    }

    // Session exists — disable generate regardless of whether a workout was selected yet
    document.getElementById('generate-btn').disabled = true;
    if (data.session.selected) {
      document.getElementById('generate-locked-msg').hidden = false;
    }

    // If a run was completed today but no selection made, show top banner
    if (data.run_completed_today && !data.session.selected) {
      document.getElementById('unresolved-banner').hidden = false;
    }
  } catch (_) { /* non-critical */ }
}

loadSettings();
loadActivities().then(checkTodaySession);
