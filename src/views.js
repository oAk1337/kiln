import { lineChart } from "./chart.js";
import {
  compareSessions,
  esc,
  followingDay,
  displayToLb,
  formatNumber,
  formatPrettyDate,
  formatSet,
  formatWhen,
  lbToDisplay,
  listKnownExercises,
  plateOptions,
  platesLabel,
  previousPerformance,
  progressionPoints,
  suggestionText,
  suggestTarget,
  todayPlan,
} from "./logic.js";

export function renderView(state) {
  if (!state.ready) return `<p class="boot">Loading…</p>`;
  switch (state.route.name) {
    case "program":
      return renderProgram(state);
    case "day":
      return renderDay(state);
    case "history":
      return renderHistory(state);
    case "session":
      return renderSession(state);
    case "exercise":
      return renderExercise(state);
    case "settings":
      return renderSettings(state);
    default:
      return renderToday(state);
  }
}

export function renderModal(state) {
  const modal = state.ui.modal;
  if (!modal) return "";
  if (modal.type === "pick-day") {
    const days = state.days.map((day) => `
      <button type="button" class="choice" data-action="choose-day" data-id="${esc(day.id)}">
        <span>${esc(day.name || "Untitled day")}</span>
        <span class="muted">${day.exercises.length} exercises</span>
      </button>`).join("");
    return backdrop(`<h2>Train a different day</h2><div class="choice-list">${days || `<p>Add a day first.</p>`}</div>${closeRow()}`);
  }
  if (modal.type === "import-json") {
    return backdrop(`
      <h2>Import backup</h2>
      <p>${modal.days} days · ${modal.sessions} sessions · ${modal.entries} sets</p>
      <p class="help">Merge keeps this device's settings and skips sets that share an id. Replace overwrites the program, history, and settings.</p>
      <div class="stack">
        <button type="button" class="btn primary" data-action="import-merge">Merge</button>
        <button type="button" class="btn danger" data-action="import-replace">Replace everything</button>
        ${closeRow()}
      </div>`);
  }
  if (modal.type === "import-csv") {
    const skips = modal.errors?.length
      ? `<p class="help">${modal.errors.length} row${modal.errors.length === 1 ? "" : "s"} skipped. ${esc(modal.errors.slice(0, 3).join(" "))}</p>`
      : "";
    return backdrop(`
      <h2>Import CSV</h2>
      <p>${modal.added} new sets. ${modal.duplicate} already on this device.</p>
      ${skips}
      <div class="stack">
        <button type="button" class="btn primary" data-action="import-csv-confirm" ${modal.added ? "" : "disabled"}>Add sets</button>
        ${closeRow()}
      </div>`);
  }
  if (modal.type === "confirm") {
    return backdrop(`
      <h2>${esc(modal.title)}</h2>
      <p>${esc(modal.body || "")}</p>
      <div class="stack">
        <button type="button" class="btn ${modal.danger ? "danger" : "primary"}" data-action="${esc(modal.action)}">${esc(modal.confirm || "Confirm")}</button>
        ${closeRow()}
      </div>`);
  }
  return backdrop(`
    <h2>${esc(modal.title || "Notice")}</h2>
    <p>${esc(modal.body || "")}</p>
    ${closeRow()}`);
}

function renderToday(state) {
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  const date = formatPrettyDate(state.today, { weekday: "long", month: "short", day: "numeric" });
  if (!state.days.length && !plan.session) {
    return `<section class="screen">
      <p class="date">${esc(date)}</p>
      <div class="empty-hero">
        <p class="kicker">Today</p>
        <h1>No days yet</h1>
        <p>Kiln starts empty. Add the days you repeat and the log stays on this device.</p>
        <a class="btn primary" href="#/program">Build a program</a>
      </div>
    </section>`;
  }
  if (!plan.day && !plan.exercises.length) {
    return `<section class="screen">
      <p class="date">${esc(date)}</p>
      <div class="day-head">
        <div>
          <p class="kicker">${esc(sourceLabel(plan.source))}</p>
          <h1>${esc(plan.session?.dayName || "Workout")}</h1>
        </div>
        <button type="button" class="btn ghost" data-action="pick-day">Change</button>
      </div>
      <div class="empty-hero">
        <p>This day isn't in the program anymore.</p>
        <a class="btn ghost" href="#/history">View history</a>
      </div>
    </section>`;
  }

  const day = plan.day;
  const index = day ? state.days.findIndex((item) => item.id === day.id) : -1;
  const position = index >= 0 ? `Day ${index + 1} of ${state.days.length}` : "Logged today";
  const next = day ? followingDay(state.days, day) : null;
  const cards = plan.exercises.map((exercise, i) => exerciseCard(state, plan, exercise, i)).join("");
  const cardio = day?.cardioNote?.trim()
    ? `<p class="cardio"><span>Cardio</span> ${esc(day.cardioNote.trim())}</p>`
    : "";
  const done = plan.session
    ? `<p class="done-note">Logged today. Delete the session in History if this was the wrong day.</p>`
    : `<button type="button" class="btn ghost wide" data-action="mark-done">Mark day done</button>`;
  const nextHint = next && day && next.id !== day.id
    ? `<p class="next-hint">Up next: ${esc(next.name || "Untitled day")}</p>`
    : "";
  const title = day?.name || plan.session?.dayName || "Workout";

  return `<section class="screen">
    <p class="date">${esc(date)}</p>
    <div class="day-head">
      <div>
        <p class="kicker">${esc(sourceLabel(plan.source))} · ${esc(position)}</p>
        <h1>${esc(title || "Untitled day")}</h1>
      </div>
      <button type="button" class="btn ghost" data-action="pick-day">Change</button>
    </div>
    ${cardio}
    ${cards || `<div class="empty-hero compact"><p>Rest day. Nothing to lift.</p></div>`}
    ${done}
    ${nextHint}
  </section>`;
}

function exerciseCard(state, plan, exercise, index) {
  const unit = state.settings.unit;
  const incrementLb = displayToLb(state.settings.weightIncrement, unit) || 0;
  const previous = previousPerformance(state.sessions, exercise, state.today);
  const suggestion = suggestTarget(exercise, previous?.entries || [], incrementLb);
  const draft = state.drafts[exercise.id] || {
    loadLb: suggestion.loadLb ?? exercise.baseWeightLb ?? 0,
    reps: suggestion.reps ?? exercise.repMin,
    setType: "working",
    note: "",
  };
  const entries = (plan.session?.entries || []).filter((entry) => sameLoose(entry, exercise));
  const workingCount = entries.filter((entry) => entry.setType === "working").length;
  const group = supersetClass(plan.exercises, index);
  const badge = exercise.superset?.trim()
    ? `<p class="kicker">Superset ${esc(exercise.superset.trim())}</p>`
    : (exercise.orphan ? `<p class="kicker">Logged, not in this day</p>` : "");
  const note = exercise.note?.trim() ? `<p class="ex-note">${esc(exercise.note.trim())}</p>` : "";
  const last = previous
    ? `<p class="last">Last ${esc(formatWhen(previous.session.date, state.today))} · ${previous.entries.map((entry) => `${entry.setType === "warmup" ? "WU " : ""}${esc(formatSet(entry, unit))}`).join(" · ")}</p>`
    : `<p class="last">No sessions yet.</p>`;
  const weight = exercise.bodyweight ? "" : stepper({
    id: exercise.id,
    field: "load",
    label: unit,
    value: formatNumber(lbToDisplay(draft.loadLb || 0, unit)),
    decLabel: "Decrease weight",
    incLabel: "Increase weight",
  });
  const reps = stepper({
    id: exercise.id,
    field: "reps",
    label: "reps",
    value: String(draft.reps ?? exercise.repMin ?? 5),
    decLabel: "Decrease reps",
    incLabel: "Increase reps",
    inputmode: "numeric",
  });
  const plates = !exercise.bodyweight && exercise.baseWeightLb != null
    ? `<p class="plates" data-plates="${esc(exercise.id)}">${esc(platesLabel(draft.loadLb || 0, exercise.baseWeightLb, unit))}</p>
       <div class="plate-row" aria-label="Add a pair of plates">
         ${plateOptions(unit).map((plate) => `<button type="button" data-action="add-plate" data-id="${esc(exercise.id)}" data-plate="${plate}">+${formatNumber(plate)}/side</button>`).join("")}
       </div>`
    : "";
  const bw = exercise.bodyweight ? `<p class="bw-pill">Bodyweight</p>` : "";
  const chips = entries.map((entry) => {
    const armed = state.ui.pendingDelete === entry.id;
    const label = `${entry.setType === "warmup" ? "WU " : ""}${formatSet(entry, unit)}${entry.note ? ` · ${entry.note}` : ""}`;
    return `<button type="button" class="chip ${entry.setType === "warmup" ? "warmup" : ""} ${armed ? "armed" : ""}" data-action="delete-entry" data-entry="${esc(entry.id)}" data-session="${esc(plan.session.id)}" data-logged-set>${esc(armed ? "Delete?" : label)}</button>`;
  }).join("");

  return `<article class="card ${group}" data-ex-card="${esc(exercise.id)}">
    <div class="card-top">
      <div>
        ${badge}
        <h2>${esc(exercise.name || "Exercise")}</h2>
      </div>
      <p class="target">${esc(formatTarget(exercise))}</p>
    </div>
    ${note}
    ${last}
    <p class="suggest" data-suggestion>${esc(suggestionText(exercise, suggestion, unit))}</p>
    ${bw}
    <div class="stepper-row">${weight}${reps}</div>
    ${plates}
    <div class="seg" role="group" aria-label="Set type">
      <button type="button" data-action="set-type" data-id="${esc(exercise.id)}" data-type="warmup" aria-pressed="${draft.setType === "warmup"}">Warm-up</button>
      <button type="button" data-action="set-type" data-id="${esc(exercise.id)}" data-type="working" aria-pressed="${draft.setType === "working"}">Working</button>
    </div>
    <label class="note-field">
      <span class="sr-only">Note</span>
      <input data-note data-id="${esc(exercise.id)}" maxlength="280" placeholder="Note (optional)" value="${esc(draft.note || "")}" />
    </label>
    <button type="button" class="btn primary" data-action="log-set" data-id="${esc(exercise.id)}">Log set</button>
    <p class="count">Working sets ${workingCount}/${exercise.targetSets}</p>
    ${chips ? `<div class="logged">${chips}</div>` : ""}
  </article>`;
}

function renderProgram(state) {
  if (!state.days.length) {
    return `<section class="screen">
      <div class="screen-head"><p class="kicker">Program</p><h1>Training cycle</h1></div>
      <div class="empty-hero">
        <p>Add days in the order you repeat them. A rest day can be a day with no exercises.</p>
        <button type="button" class="btn primary" data-action="add-day">Add day</button>
      </div>
    </section>`;
  }
  const items = state.days.map((day, index) => `
    <li class="day-row">
      <a href="#/day/${encodeURIComponent(day.id)}">
        <strong>${esc(day.name || "Untitled day")}</strong>
        <span>${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}${day.cardioNote?.trim() ? " · cardio" : ""}</span>
      </a>
      <div class="icon-btns">
        <button type="button" data-action="move-day" data-dir="-1" data-index="${index}" aria-label="Move ${esc(day.name || "day")} up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="move-day" data-dir="1" data-index="${index}" aria-label="Move ${esc(day.name || "day")} down" ${index === state.days.length - 1 ? "disabled" : ""}>↓</button>
      </div>
    </li>`).join("");
  return `<section class="screen">
    <div class="screen-head">
      <p class="kicker">Program</p>
      <h1>Training cycle</h1>
      <p>Order is the cycle. After you log a day, Tomorrow shows the next one.</p>
    </div>
    <ol class="day-list">${items}</ol>
    <button type="button" class="btn primary wide" data-action="add-day">Add day</button>
  </section>`;
}

function renderDay(state) {
  const day = state.days.find((item) => item.id === state.route.id);
  if (!day) {
    return `<section class="screen"><a class="back" href="#/program">Program</a><div class="empty-hero"><p>That day is gone.</p></div></section>`;
  }
  const exercises = day.exercises.map((ex, index) => renderExerciseEditor(state, day, ex, index)).join("");
  return `<section class="screen">
    <a class="back" href="#/program">Program</a>
    <label class="field">
      <span>Day name</span>
      <input data-bind="day-name" maxlength="80" placeholder="Day name" value="${esc(day.name)}" />
    </label>
    <label class="field">
      <span>Cardio note</span>
      <textarea data-bind="day-cardio" maxlength="280" rows="2" placeholder="Optional. Shown on that day.">${esc(day.cardioNote || "")}</textarea>
    </label>
    ${exercises || `<p class="help">No exercises. Leave it empty to use this as a rest day.</p>`}
    <button type="button" class="btn primary wide" data-action="add-exercise" data-day="${esc(day.id)}">Add exercise</button>
    <button type="button" class="btn danger wide" data-action="ask-delete-day" data-day="${esc(day.id)}">Delete day</button>
  </section>`;
}

function renderExerciseEditor(state, day, ex, index) {
  const unit = state.settings.unit;
  const base = ex.baseWeightLb == null ? "" : formatNumber(lbToDisplay(ex.baseWeightLb, unit));
  return `<article class="card editor">
    <div class="card-top">
      <h2>${esc(ex.name || "Exercise")}</h2>
      <div class="icon-btns">
        <button type="button" data-action="move-exercise" data-day="${esc(day.id)}" data-index="${index}" data-dir="-1" aria-label="Move exercise up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="move-exercise" data-day="${esc(day.id)}" data-index="${index}" data-dir="1" aria-label="Move exercise down" ${index === day.exercises.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-action="ask-delete-exercise" data-id="${esc(ex.id)}" aria-label="Delete exercise">✕</button>
      </div>
    </div>
    <label class="field"><span>Name</span><input data-bind="ex-name:${esc(ex.id)}" maxlength="80" placeholder="Exercise" value="${esc(ex.name)}" /></label>
    <div class="grid3">
      <label class="field"><span>Sets</span><input data-bind="ex-sets:${esc(ex.id)}" inputmode="numeric" value="${ex.targetSets}" /></label>
      <label class="field"><span>Rep min</span><input data-bind="ex-min:${esc(ex.id)}" inputmode="numeric" value="${ex.repMin}" /></label>
      <label class="field"><span>Rep max</span><input data-bind="ex-max:${esc(ex.id)}" inputmode="numeric" value="${ex.repMax}" /></label>
    </div>
    <label class="field"><span>Superset</span><input data-bind="ex-superset:${esc(ex.id)}" maxlength="4" placeholder="Letter, or blank" value="${esc(ex.superset || "")}" /></label>
    <p class="help">Same letter marks a superset. Log each exercise on its own.</p>
    <label class="field"><span>Note</span><input data-bind="ex-note:${esc(ex.id)}" maxlength="280" placeholder="Optional" value="${esc(ex.note || "")}" /></label>
    <label class="check"><input type="checkbox" data-action="toggle-bw" data-id="${esc(ex.id)}" ${ex.bodyweight ? "checked" : ""} /> Bodyweight</label>
    ${ex.bodyweight ? "" : `<label class="check"><input type="checkbox" data-action="toggle-base" data-id="${esc(ex.id)}" ${ex.baseWeightLb != null ? "checked" : ""} /> Base or sled weight</label>`}
    ${!ex.bodyweight && ex.baseWeightLb != null ? `<label class="field"><span>Base weight (${esc(unit)})</span><input data-bind="ex-base:${esc(ex.id)}" inputmode="decimal" value="${esc(base)}" /></label><p class="help">Logged load is the total. Plates per side are (total − base) / 2.</p>` : ""}
  </article>`;
}

function renderHistory(state) {
  const tab = state.ui.historyTab === "exercises" ? "exercises" : "sessions";
  const body = tab === "exercises" ? exerciseIndex(state) : sessionIndex(state);
  return `<section class="screen">
    <div class="screen-head"><p class="kicker">History</p><h1>Log</h1></div>
    <div class="seg" role="group" aria-label="History">
      <button type="button" data-action="history-tab" data-tab="sessions" aria-pressed="${tab === "sessions"}">Sessions</button>
      <button type="button" data-action="history-tab" data-tab="exercises" aria-pressed="${tab === "exercises"}">Exercises</button>
    </div>
    ${body}
  </section>`;
}

function sessionIndex(state) {
  const sessions = [...state.sessions].sort((a, b) => compareSessions(b, a));
  if (!sessions.length) {
    return `<div class="empty-hero compact"><p>No sessions yet. Log a set from Today.</p></div>`;
  }
  return `<ul class="link-list">${sessions.map((session) => {
    const title = sessionTitle(state, session);
    const sets = session.entries?.length || 0;
    return `<li><a href="#/session/${encodeURIComponent(session.id)}">
      <strong>${esc(formatPrettyDate(session.date, { weekday: "short", month: "short", day: "numeric" }))}</strong>
      <span>${esc(title)} · ${sets} set${sets === 1 ? "" : "s"}</span>
    </a></li>`;
  }).join("")}</ul>`;
}

function exerciseIndex(state) {
  const exercises = listKnownExercises(state.days, state.sessions)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (!exercises.length) {
    return `<div class="empty-hero compact"><p>Exercises show up here after you add them or import history.</p></div>`;
  }
  return `<ul class="link-list">${exercises.map((exercise) => {
    const points = progressionPoints(state.sessions, exercise);
    const last = points[points.length - 1];
    const detail = last
      ? `${formatWhen(last.date, state.today)} · ${last.bodyweight ? `BW×${last.reps}` : `${formatNumber(lbToDisplay(last.loadLb, state.settings.unit))} ${state.settings.unit}`}`
      : "No sets yet";
    return `<li><a href="#/exercise/${encodeURIComponent(exercise.id)}">
      <strong>${esc(exercise.name || "Exercise")}</strong>
      <span>${esc(detail)}</span>
    </a></li>`;
  }).join("")}</ul>`;
}

function renderSession(state) {
  const session = state.sessions.find((item) => item.id === state.route.id);
  if (!session) {
    return `<section class="screen"><a class="back" href="#/history">History</a><div class="empty-hero"><p>That session is gone.</p></div></section>`;
  }
  const groups = [];
  for (const entry of session.entries || []) {
    const key = entry.exerciseId || entry.exerciseName;
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, name: entry.exerciseName, id: entry.exerciseId, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  const body = groups.length ? groups.map((group) => `
    <article class="card">
      <div class="card-top">
        <h2>${group.id ? `<a href="#/exercise/${encodeURIComponent(group.id)}">${esc(group.name || "Exercise")}</a>` : esc(group.name || "Exercise")}</h2>
      </div>
      <ul class="set-list">${group.entries.map((entry) => `
        <li>
          <span class="pill ${entry.setType}">${entry.setType === "warmup" ? "WU" : "Work"}</span>
          <span class="set-main">${esc(formatSet(entry, state.settings.unit))}${entry.note ? ` · ${esc(entry.note)}` : ""}</span>
          <button type="button" data-action="delete-entry" data-entry="${esc(entry.id)}" data-session="${esc(session.id)}">${state.ui.pendingDelete === entry.id ? "Delete?" : "Delete"}</button>
        </li>`).join("")}</ul>
    </article>`).join("") : `<div class="empty-hero compact"><p>No sets. The day still counts in the cycle.</p></div>`;
  return `<section class="screen">
    <a class="back" href="#/history">History</a>
    <p class="kicker">${esc(formatPrettyDate(session.date, { weekday: "long", month: "short", day: "numeric" }))}</p>
    <h1>${esc(sessionTitle(state, session))}</h1>
    ${body}
    <button type="button" class="btn danger wide" data-action="ask-delete-session" data-session="${esc(session.id)}">Delete session</button>
  </section>`;
}

function renderExercise(state) {
  const exercise = listKnownExercises(state.days, state.sessions).find((item) => item.id === state.route.id);
  if (!exercise) {
    return `<section class="screen"><a class="back" href="#/history">History</a><div class="empty-hero"><p>No history for that exercise.</p></div></section>`;
  }
  const points = progressionPoints(state.sessions, exercise);
  const unit = state.settings.unit;
  const bodyweight = points.length > 0 && points.every((point) => point.bodyweight);
  const labels = points.map((point) => formatPrettyDate(point.date, { month: "short", day: "numeric" }));
  const series = bodyweight
    ? [{ name: "Top-set reps", color: "#f0a05a", values: points.map((point) => point.reps) }]
    : [
      { name: `Top-set load (${unit})`, color: "#f0a05a", values: points.map((point) => lbToDisplay(point.loadLb, unit) || 0) },
      { name: `Est. 1RM (${unit})`, color: "#9ec1ff", values: points.map((point) => lbToDisplay(point.e1rmLb, unit) || 0) },
    ];
  const chart = points.length ? lineChart({ series, labels }) : "";
  const legend = series.map((item) => `<span><i style="background:${item.color}"></i>${esc(item.name)}</span>`).join("");
  const rows = points.slice().reverse().map((point) => {
    const load = point.bodyweight ? "bodyweight" : `${formatNumber(lbToDisplay(point.loadLb, unit))} ${unit}`;
    const e1 = point.bodyweight ? "—" : `${formatNumber(lbToDisplay(point.e1rmLb, unit))} ${unit}`;
    return `<tr><td>${esc(formatPrettyDate(point.date))}</td><td>${esc(load)} × ${point.reps}</td><td>${esc(e1)}</td></tr>`;
  }).join("");
  const blurb = bodyweight
    ? "Bodyweight sets use 0 load, so this chart follows top-set reps. Estimated 1RM stays at 0."
    : "Top-set load is the heaviest working set. Estimated 1RM uses Epley: load × (1 + reps / 30).";
  return `<section class="screen">
    <a class="back" href="#/history">History</a>
    <p class="kicker">${esc(exercise.dayName || "Exercise")}</p>
    <h1>${esc(exercise.name || "Exercise")}</h1>
    ${points.length ? `<figure class="chart-card">${chart}<div class="legend">${legend}</div><figcaption class="help">${blurb}</figcaption></figure>
      <table class="data">
        <thead><tr><th>Date</th><th>Top set</th><th>Est. 1RM</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<div class="empty-hero compact"><p>Log a working set to start the chart.</p></div>`}
  </section>`;
}

function renderSettings(state) {
  const { settings } = state;
  const install = state.ui.canInstall
    ? `<button type="button" class="btn primary wide" data-action="install-app">Add to Home screen</button>`
    : `<p class="help">In Chrome on Android, open the menu and choose Add to Home screen or Install app. Kiln works offline after that.</p>`;
  const share = typeof navigator !== "undefined" && navigator.share
    ? `<button type="button" class="btn ghost wide" data-action="share">Share backup</button>`
    : "";
  return `<section class="screen">
    <div class="screen-head"><p class="kicker">Settings</p><h1>Kiln</h1>
      <p>Your plan and history stay in this browser. Nothing is uploaded.</p>
    </div>
    <div class="card">
      <p class="field-label">Units</p>
      <div class="seg" role="group" aria-label="Units">
        <button type="button" data-action="set-unit" data-unit="lb" aria-pressed="${settings.unit === "lb"}">lb</button>
        <button type="button" data-action="set-unit" data-unit="kg" aria-pressed="${settings.unit === "kg"}">kg</button>
      </div>
      <label class="field"><span>Weight increment (${esc(settings.unit)})</span>
        <input data-bind="increment" inputmode="decimal" value="${esc(String(settings.weightIncrement))}" />
      </label>
      <p class="help">Used by the weight stepper and by double progression. Default is 5 lb.</p>
      <label class="field"><span>Default rest (seconds)</span>
        <input data-bind="rest" inputmode="numeric" value="${esc(String(settings.defaultRestSeconds))}" />
      </label>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p class="help">JSON is the private way to move a real plan between devices. CSV imports logged sets only.</p>
      <div class="stack">
        <button type="button" class="btn primary wide" data-action="download">Download JSON</button>
        ${share}
        <button type="button" class="btn ghost wide" data-action="pick-json">Import JSON</button>
        <button type="button" class="btn ghost wide" data-action="pick-csv">Import CSV</button>
      </div>
    </div>
    <div class="card">
      <h2>Install</h2>
      ${install}
    </div>
    <div class="card danger-zone">
      <h2>Erase this device</h2>
      <p class="help">Clears the program, history, and settings stored here. An exported file is not deleted.</p>
      <button type="button" class="btn danger wide" data-action="clear-data">Clear all data</button>
    </div>
    <p class="foot">Stored with ${state.ui.backend === "localstorage" ? "localStorage" : "IndexedDB"} · schema 1</p>
  </section>`;
}

function stepper({ id, field, label, value, decLabel, incLabel, inputmode = "decimal" }) {
  const dataField = field === "load" ? "weight" : "reps";
  return `<div class="stepper">
    <button type="button" data-action="step" data-id="${esc(id)}" data-field="${field}" data-dir="-1" aria-label="${esc(decLabel)}">−</button>
    <label>
      <span class="sr-only">${esc(label)}</span>
      <input data-field="${dataField}" data-id="${esc(id)}" inputmode="${inputmode}" value="${esc(value)}" />
      <span class="unit">${esc(label)}</span>
    </label>
    <button type="button" data-action="step" data-id="${esc(id)}" data-field="${field}" data-dir="1" aria-label="${esc(incLabel)}">+</button>
  </div>`;
}

function sessionTitle(state, session) {
  const day = state.days.find((item) => item.id === session.dayId);
  return day?.name || session.dayName || "Workout";
}

function formatTarget(exercise) {
  if (!exercise || exercise.orphan) return "No target";
  const reps = exercise.repMin === exercise.repMax ? `${exercise.repMin}` : `${exercise.repMin}–${exercise.repMax}`;
  return `${exercise.targetSets} × ${reps}`;
}

function sourceLabel(source) {
  if (source === "plan") return "Chosen for today";
  if (source === "session") return "Logged today";
  return "Next in the cycle";
}

function supersetClass(exercises, index) {
  const key = (exercises[index]?.superset || "").trim();
  if (!key) return "";
  const prev = (exercises[index - 1]?.superset || "").trim();
  const next = (exercises[index + 1]?.superset || "").trim();
  const classes = ["superset"];
  if (prev !== key) classes.push("superset-start");
  if (next !== key) classes.push("superset-end");
  return classes.join(" ");
}

function sameLoose(entry, exercise) {
  if (entry.exerciseId && exercise.id && entry.exerciseId === exercise.id) return true;
  if (entry.exerciseId && exercise.id && entry.exerciseId !== exercise.id && !exercise.orphan) return false;
  return (entry.exerciseName || "").trim().toLowerCase() === (exercise.name || "").trim().toLowerCase();
}

function backdrop(inner) {
  return `<div class="modal-back" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
}

function closeRow() {
  return `<button type="button" class="btn ghost wide" data-action="close-modal">Close</button>`;
}
