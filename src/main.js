import "./styles.css";
import { sessionsFromCsv } from "./csv.js";
import * as db from "./db.js";
import {
  addPair,
  applyCsvSessions,
  convertIncrement,
  countEntries,
  createDay,
  createEntry,
  createExercise,
  createSession,
  defaultSettings,
  displayToLb,
  formatClock,
  mergeState,
  moveItem,
  normalizeSettings,
  parseImport,
  platesLabel,
  previousPerformance,
  replaceState,
  serializeState,
  suggestTarget,
  todayISO,
  todayPlan,
} from "./logic.js";
import { renderModal, renderView } from "./views.js";

const state = {
  settings: defaultSettings(),
  days: [],
  sessions: [],
  plan: null,
  today: todayISO(),
  route: { name: "today", id: null },
  drafts: {},
  ready: false,
  ui: {
    historyTab: "sessions",
    modal: null,
    pendingDelete: null,
    pendingDayId: null,
    pendingExerciseId: null,
    pendingSessionId: null,
    pendingImport: null,
    pendingCsv: null,
    sheetOpen: false,
    canInstall: false,
    backend: "indexeddb",
  },
};

const timer = {
  running: false,
  endAt: 0,
  duration: 90,
  fired: false,
};

let deferredPrompt = null;
let toastTimer = 0;
let saveTimer = 0;
let deleteTimer = 0;
let lastLogAt = 0;
let audioCtx = null;
let wakeLock = null;

const view = () => document.querySelector("#view");

document.addEventListener("click", onClick);
document.addEventListener("input", onInput);
document.addEventListener("change", onChange);
document.addEventListener("focusout", onBlur);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.ui.modal) closeModal();
});
window.addEventListener("hashchange", () => render());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  state.ui.canInstall = true;
  if (state.route.name === "settings") render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const today = todayISO();
  if (today !== state.today) render();
  if (timer.running) acquireWakeLock();
});
document.querySelector("#file-json").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) readJson(file);
});
document.querySelector("#file-csv").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) readCsv(file);
});

boot();
setInterval(tickTimer, 250);

async function boot() {
  try {
    const loaded = await db.loadAll();
    state.settings = normalizeSettings(loaded.settings);
    state.days = loaded.days || [];
    state.sessions = loaded.sessions || [];
    state.plan = loaded.plan || null;
    state.ui.backend = loaded.backend || "indexeddb";
  } catch (error) {
    toast(error.message || "Could not read saved data");
  }
  timer.duration = state.settings.defaultRestSeconds;
  restoreTimer();
  state.ready = true;
  render();
  registerSw();
}

function render() {
  const main = view();
  const scroll = main?.scrollTop || 0;
  const focusBind = document.activeElement?.dataset?.bind || "";
  const caret = document.activeElement?.selectionStart;
  state.route = parseHash();
  state.today = todayISO();
  prepareDrafts();
  if (main) main.innerHTML = renderView(state);
  if (focusBind && main) {
    const next = main.querySelector(`[data-bind="${CSS.escape(focusBind)}"]`);
    if (next) {
      next.focus();
      if (caret != null && next.setSelectionRange) {
        try { next.setSelectionRange(caret, caret); } catch { /* ignore */ }
      }
    }
  }
  if (main) main.scrollTop = scroll;
  syncChrome();
  const modalRoot = document.querySelector("#modal-root");
  if (modalRoot) modalRoot.innerHTML = renderModal(state);
  updateTimerDom();
}

function prepareDrafts() {
  if (state.route.name !== "today") return;
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  const incrementLb = displayToLb(state.settings.weightIncrement, state.settings.unit) || 0;
  for (const exercise of plan.exercises) {
    if (state.drafts[exercise.id]) continue;
    const previous = previousPerformance(state.sessions, exercise, state.today);
    const suggestion = suggestTarget(exercise, previous?.entries || [], incrementLb);
    let loadLb = suggestion.loadLb;
    if (loadLb == null) loadLb = exercise.baseWeightLb != null ? exercise.baseWeightLb : 0;
    state.drafts[exercise.id] = {
      loadLb,
      reps: suggestion.reps ?? exercise.repMin ?? 5,
      setType: "working",
      note: "",
    };
  }
}

function syncChrome() {
  const name = state.route.name;
  const tab = name === "day" ? "program"
    : (name === "session" || name === "exercise") ? "history"
      : name;
  for (const id of ["today", "program", "history", "settings"]) {
    const link = document.querySelector(`#nav-${id}`);
    if (!link) continue;
    if (tab === id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

async function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el || el.matches("input, textarea, select")) return;
  if (el.dataset.action === "close-modal" && el.classList.contains("modal-back") && event.target.closest(".modal")) {
    return;
  }
  event.preventDefault();
  unlockAudio();
  try {
    await handleAction(el);
  } catch (error) {
    toast(error.message || "Something went wrong");
  }
}

async function handleAction(el) {
  const action = el.dataset.action;
  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (action === "toggle-sheet") {
    state.ui.sheetOpen = !state.ui.sheetOpen;
    updateTimerDom();
    return;
  }
  if (action === "timer-delta") {
    nudgeTimer(Number(el.dataset.delta) || 0);
    return;
  }
  if (action === "timer-toggle") {
    if (timer.running) stopTimer();
    else startRest(timer.duration);
    return;
  }
  if (action === "timer-reset") {
    stopTimer();
    timer.duration = state.settings.defaultRestSeconds;
    timer.fired = false;
    persistTimer();
    updateTimerDom();
    return;
  }
  if (action === "add-day") return addDay();
  if (action === "add-exercise") return addExercise(el.dataset.day);
  if (action === "move-day") return moveDay(Number(el.dataset.index), Number(el.dataset.dir));
  if (action === "move-exercise") return moveExercise(el.dataset.day, Number(el.dataset.index), Number(el.dataset.dir));
  if (action === "pick-day") {
    state.ui.modal = { type: "pick-day" };
    render();
    return;
  }
  if (action === "choose-day") return chooseDay(el.dataset.id);
  if (action === "confirm-choose-day") return chooseDay(state.ui.pendingDayId, true);
  if (action === "step") return stepDraft(el);
  if (action === "add-plate") return addPlate(el);
  if (action === "set-type") return setType(el);
  if (action === "log-set") return logSet(el.dataset.id);
  if (action === "delete-entry") return deleteEntry(el.dataset.session, el.dataset.entry);
  if (action === "mark-done") return askMarkDone();
  if (action === "confirm-mark-done") return markDone();
  if (action === "ask-delete-day") return askDeleteDay(el.dataset.day);
  if (action === "confirm-delete-day") return removeDay(state.ui.pendingDayId);
  if (action === "ask-delete-exercise") return askDeleteExercise(el.dataset.id);
  if (action === "confirm-delete-exercise") return removeExercise(state.ui.pendingExerciseId);
  if (action === "ask-delete-session") return askDeleteSession(el.dataset.session);
  if (action === "confirm-delete-session") return removeSession(state.ui.pendingSessionId);
  if (action === "history-tab") {
    state.ui.historyTab = el.dataset.tab === "exercises" ? "exercises" : "sessions";
    render();
    return;
  }
  if (action === "set-unit") return setUnit(el.dataset.unit);
  if (action === "download") return downloadBackup();
  if (action === "share") return shareBackup();
  if (action === "pick-json") {
    document.querySelector("#file-json").click();
    return;
  }
  if (action === "pick-csv") {
    document.querySelector("#file-csv").click();
    return;
  }
  if (action === "import-merge") return commitJson("merge");
  if (action === "import-replace") return commitJson("replace");
  if (action === "import-csv-confirm") return commitCsv();
  if (action === "clear-data") {
    state.ui.modal = {
      type: "confirm",
      title: "Erase all data on this device?",
      body: "This deletes the program, history, and settings stored in this browser.",
      confirm: "Erase data",
      action: "confirm-clear",
      danger: true,
    };
    render();
    return;
  }
  if (action === "confirm-clear") return eraseAll();
  if (action === "install-app") return installApp();
}

function onInput(event) {
  const target = event.target;
  if (target.dataset.bind) {
    applyBind(target.dataset.bind, target.value);
    scheduleSave();
    return;
  }
  if (target.dataset.field === "weight" || target.dataset.field === "reps" || target.hasAttribute("data-note")) {
    readDraftFromCard(target.dataset.id);
    if (target.dataset.field === "weight") refreshPlates(target.dataset.id);
  }
}

function onChange(event) {
  const target = event.target;
  if (target.dataset.action === "toggle-bw") {
    const found = findExercise(target.dataset.id);
    if (!found) return;
    found.ex.bodyweight = target.checked;
    if (found.ex.bodyweight) found.ex.baseWeightLb = null;
    delete state.drafts[found.ex.id];
    scheduleSave();
    render();
    return;
  }
  if (target.dataset.action === "toggle-base") {
    const found = findExercise(target.dataset.id);
    if (!found) return;
    found.ex.baseWeightLb = target.checked ? (found.ex.baseWeightLb ?? 0) : null;
    delete state.drafts[found.ex.id];
    scheduleSave();
    render();
  }
}

function onBlur(event) {
  if (event.target?.dataset?.bind) persistQuiet();
}

function applyBind(bind, value) {
  if (bind === "day-name" || bind === "day-cardio") {
    const day = state.days.find((item) => item.id === state.route.id);
    if (!day) return;
    if (bind === "day-name") day.name = value.slice(0, 80);
    else day.cardioNote = value.slice(0, 280);
    return;
  }
  if (bind === "increment") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) state.settings.weightIncrement = Math.round(n * 100) / 100;
    return;
  }
  if (bind === "rest") {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    state.settings.defaultRestSeconds = Math.min(600, Math.max(15, Math.round(n)));
    if (!timer.running) timer.duration = state.settings.defaultRestSeconds;
    updateTimerDom();
    return;
  }
  const splitAt = bind.indexOf(":");
  if (splitAt < 0) return;
  const kind = bind.slice(0, splitAt);
  const id = bind.slice(splitAt + 1);
  const found = findExercise(id);
  if (!found) return;
  const ex = found.ex;
  if (kind === "ex-name") ex.name = value.slice(0, 80);
  if (kind === "ex-note") ex.note = value.slice(0, 280);
  if (kind === "ex-superset") ex.superset = value.trim().slice(0, 4);
  if (kind === "ex-sets" && value.trim() !== "") ex.targetSets = clamp(value, 1, 20, ex.targetSets);
  if (kind === "ex-min" && value.trim() !== "") {
    ex.repMin = clamp(value, 1, 100, ex.repMin);
    if (ex.repMax < ex.repMin) {
      ex.repMax = ex.repMin;
      const other = document.querySelector(`[data-bind="${CSS.escape(`ex-max:${id}`)}"]`);
      if (other) other.value = String(ex.repMax);
    }
  }
  if (kind === "ex-max" && value.trim() !== "") {
    ex.repMax = clamp(value, 1, 100, ex.repMax);
    if (ex.repMin > ex.repMax) {
      ex.repMin = ex.repMax;
      const other = document.querySelector(`[data-bind="${CSS.escape(`ex-min:${id}`)}"]`);
      if (other) other.value = String(ex.repMin);
    }
  }
  if (kind === "ex-base") {
    const lb = displayToLb(value, state.settings.unit);
    ex.baseWeightLb = lb == null ? 0 : Math.max(0, lb);
  }
}

async function addDay() {
  const day = createDay("");
  state.days.push(day);
  await db.saveDays(state.days);
  location.hash = `#/day/${encodeURIComponent(day.id)}`;
  requestAnimationFrame(() => document.querySelector("[data-bind='day-name']")?.focus());
}

async function addExercise(dayId) {
  const day = state.days.find((item) => item.id === dayId);
  if (!day) return;
  day.exercises.push(createExercise());
  await db.saveDays(state.days);
  render();
  const inputs = [...document.querySelectorAll("[data-bind^='ex-name:']")];
  inputs[inputs.length - 1]?.focus();
}

async function moveDay(index, dir) {
  state.days = moveItem(state.days, index, dir);
  await db.saveDays(state.days);
  render();
}

async function moveExercise(dayId, index, dir) {
  const day = state.days.find((item) => item.id === dayId);
  if (!day) return;
  day.exercises = moveItem(day.exercises, index, dir);
  await db.saveDays(state.days);
  render();
}

async function chooseDay(dayId, force = false) {
  const day = state.days.find((item) => item.id === dayId);
  if (!day) return;
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  if (!force && plan.session?.entries?.length && plan.session.dayId !== day.id) {
    state.ui.pendingDayId = day.id;
    state.ui.modal = {
      type: "confirm",
      title: `Move today to ${day.name || "this day"}?`,
      body: "Sets already logged stay in today's session.",
      confirm: "Switch day",
      action: "confirm-choose-day",
    };
    render();
    return;
  }
  state.plan = { date: state.today, dayId: day.id };
  if (plan.session) {
    plan.session.dayId = day.id;
    plan.session.dayName = day.name || "";
    await db.saveSession(plan.session);
  }
  state.ui.modal = null;
  state.ui.pendingDayId = null;
  await db.savePlan(state.plan);
  render();
}

function stepDraft(el) {
  const draft = readDraftFromCard(el.dataset.id);
  if (!draft) return;
  const dir = Number(el.dataset.dir) || 0;
  if (el.dataset.field === "load") {
    const stepLb = displayToLb(state.settings.weightIncrement, state.settings.unit) || 0;
    draft.loadLb = Math.max(0, (Number(draft.loadLb) || 0) + dir * stepLb);
  } else {
    draft.reps = Math.max(1, (Number(draft.reps) || 1) + dir);
  }
  render();
}

function addPlate(el) {
  const draft = readDraftFromCard(el.dataset.id);
  if (!draft) return;
  draft.loadLb = Math.max(0, addPair(draft.loadLb || 0, Number(el.dataset.plate), state.settings.unit));
  render();
}

function setType(el) {
  const draft = readDraftFromCard(el.dataset.id);
  if (!draft) return;
  draft.setType = el.dataset.type === "warmup" ? "warmup" : "working";
  render();
}

async function logSet(exId) {
  const now = Date.now();
  if (now - lastLogAt < 350) return;
  const draft = readDraftFromCard(exId);
  if (!draft) return;
  if (!draft.reps || draft.reps < 1) {
    toast("Enter at least 1 rep");
    return;
  }
  lastLogAt = now;
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  const exercise = plan.exercises.find((item) => item.id === exId);
  if (!exercise) return;
  let session = plan.session;
  if (!session) {
    session = createSession({
      date: state.today,
      day: plan.day || { id: null, name: exercise.name || "Workout" },
    });
    state.sessions.push(session);
  }
  session.entries.push(createEntry({
    exercise,
    setType: draft.setType,
    reps: draft.reps,
    loadLb: draft.loadLb,
    bodyweight: !!exercise.bodyweight,
    note: draft.note,
  }));
  if (plan.day) state.plan = { date: state.today, dayId: plan.day.id };
  await db.saveSession(session);
  await db.savePlan(state.plan);
  try { navigator.vibrate?.(15); } catch { /* ignore */ }
  startRest(state.settings.defaultRestSeconds);
  render();
  toast("Set logged");
}

async function deleteEntry(sessionId, entryId) {
  if (state.ui.pendingDelete !== entryId) {
    state.ui.pendingDelete = entryId;
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => {
      if (state.ui.pendingDelete === entryId) {
        state.ui.pendingDelete = null;
        render();
      }
    }, 2500);
    render();
    return;
  }
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  session.entries = session.entries.filter((entry) => entry.id !== entryId);
  state.ui.pendingDelete = null;
  await db.saveSession(session);
  render();
}

function askMarkDone() {
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  if (plan.session) {
    toast("Already logged today");
    return;
  }
  if (!plan.day) return;
  state.ui.modal = {
    type: "confirm",
    title: `Mark ${plan.day.name || "this day"} done?`,
    body: "Tomorrow moves to the next day in the cycle.",
    confirm: "Mark done",
    action: "confirm-mark-done",
  };
  render();
}

async function markDone() {
  const plan = todayPlan(state.days, state.sessions, state.plan, state.today);
  if (!plan.day || plan.session) {
    closeModal();
    return;
  }
  const session = createSession({ date: state.today, day: plan.day });
  state.sessions.push(session);
  state.plan = { date: state.today, dayId: plan.day.id };
  await db.saveSession(session);
  await db.savePlan(state.plan);
  state.ui.modal = null;
  render();
  toast("Day logged");
}

function askDeleteDay(dayId) {
  const day = state.days.find((item) => item.id === dayId);
  if (!day) return;
  state.ui.pendingDayId = dayId;
  state.ui.modal = {
    type: "confirm",
    title: `Delete ${day.name || "this day"}?`,
    body: "Logged sessions stay in History.",
    confirm: "Delete day",
    action: "confirm-delete-day",
    danger: true,
  };
  render();
}

async function removeDay(dayId) {
  state.days = state.days.filter((day) => day.id !== dayId);
  if (state.plan?.dayId === dayId) state.plan = null;
  state.ui.modal = null;
  await db.saveDays(state.days);
  await db.savePlan(state.plan);
  if (state.route.name === "day") location.hash = "#/program";
  else render();
}

function askDeleteExercise(id) {
  const found = findExercise(id);
  if (!found) return;
  state.ui.pendingExerciseId = id;
  state.ui.modal = {
    type: "confirm",
    title: `Remove ${found.ex.name || "this exercise"}?`,
    body: "Past sets stay in History.",
    confirm: "Remove",
    action: "confirm-delete-exercise",
    danger: true,
  };
  render();
}

async function removeExercise(id) {
  const found = findExercise(id);
  if (found) found.day.exercises = found.day.exercises.filter((ex) => ex.id !== id);
  delete state.drafts[id];
  state.ui.modal = null;
  await db.saveDays(state.days);
  render();
}

function askDeleteSession(id) {
  state.ui.pendingSessionId = id;
  state.ui.modal = {
    type: "confirm",
    title: "Delete this session?",
    body: "The cycle uses the last remaining logged day.",
    confirm: "Delete session",
    action: "confirm-delete-session",
    danger: true,
  };
  render();
}

async function removeSession(id) {
  state.sessions = state.sessions.filter((session) => session.id !== id);
  state.ui.modal = null;
  await db.deleteSession(id);
  if (state.route.name === "session") location.hash = "#/history";
  else render();
  toast("Session deleted");
}

function setUnit(unit) {
  if (unit !== "lb" && unit !== "kg") return;
  if (unit === state.settings.unit) return;
  state.settings.weightIncrement = convertIncrement(state.settings.weightIncrement, state.settings.unit, unit);
  state.settings.unit = unit;
  state.settings = normalizeSettings(state.settings);
  scheduleSave();
  render();
}

function downloadBackup() {
  const payload = serializeState(state);
  const json = JSON.stringify(payload, null, 2);
  downloadFile(`kiln-${state.today}.json`, json, "application/json");
  toast("Backup downloaded");
}

async function shareBackup() {
  const payload = serializeState(state);
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], `kiln-${state.today}.json`, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Kiln backup" });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: "Kiln backup", text: json });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  downloadFile(`kiln-${state.today}.json`, json, "application/json");
  toast("Backup downloaded");
}

async function readJson(file) {
  if (file.size > 8_000_000) {
    toast("That file is too large");
    return;
  }
  const parsed = parseImport(await file.text());
  if (!parsed.ok) {
    state.ui.modal = { type: "alert", title: "Can't import", body: parsed.errors.join(" ") };
    render();
    return;
  }
  state.ui.pendingImport = parsed.value;
  state.ui.modal = {
    type: "import-json",
    days: parsed.value.days.length,
    sessions: parsed.value.sessions.length,
    entries: countEntries(parsed.value.sessions),
  };
  render();
}

async function commitJson(mode) {
  const incoming = state.ui.pendingImport;
  if (!incoming) return;
  const next = mode === "replace" ? replaceState(incoming) : mergeState(state, incoming);
  state.settings = next.settings;
  state.days = next.days;
  state.sessions = next.sessions;
  state.drafts = {};
  if (mode === "replace" || !state.days.some((day) => day.id === state.plan?.dayId)) {
    state.plan = null;
  }
  state.ui.pendingImport = null;
  state.ui.modal = null;
  if (!timer.running) timer.duration = state.settings.defaultRestSeconds;
  await db.replaceAll({
    settings: state.settings,
    days: state.days,
    plan: state.plan,
    sessions: state.sessions,
  });
  toast(mode === "replace" ? "Backup replaced local data" : "Backup merged");
  if ((location.hash || "#/today") !== "#/today") location.hash = "#/today";
  else render();
}

async function readCsv(file) {
  if (file.size > 8_000_000) {
    toast("That file is too large");
    return;
  }
  const result = sessionsFromCsv(await file.text(), state.days);
  if (!result.rows.length && result.errors.length) {
    state.ui.modal = { type: "alert", title: "Can't import CSV", body: result.errors.join(" ") };
    render();
    return;
  }
  const preview = applyCsvSessions(state.sessions, result.sessions);
  state.ui.pendingCsv = result.sessions;
  state.ui.modal = {
    type: "import-csv",
    added: preview.added,
    duplicate: preview.duplicate,
    errors: result.errors,
  };
  render();
}

async function commitCsv() {
  if (!state.ui.pendingCsv) return;
  const applied = applyCsvSessions(state.sessions, state.ui.pendingCsv);
  state.sessions = applied.sessions;
  state.ui.pendingCsv = null;
  state.ui.modal = null;
  await db.replaceAll({
    settings: state.settings,
    days: state.days,
    plan: state.plan,
    sessions: state.sessions,
  });
  toast(`Added ${applied.added} sets`);
  if (location.hash !== "#/history") location.hash = "#/history";
  else render();
}

async function eraseAll() {
  const settings = await db.clearAll();
  state.settings = settings;
  state.days = [];
  state.sessions = [];
  state.plan = null;
  state.drafts = {};
  state.ui.modal = null;
  timer.duration = settings.defaultRestSeconds;
  toast("All data erased");
  if (location.hash !== "#/today") location.hash = "#/today";
  else render();
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  state.ui.canInstall = false;
  render();
}

function readDraftFromCard(exId) {
  const draft = state.drafts[exId];
  if (!draft) return null;
  const card = document.querySelector(`[data-ex-card="${CSS.escape(exId)}"]`);
  if (!card) return draft;
  const weight = card.querySelector("[data-field='weight']");
  const reps = card.querySelector("[data-field='reps']");
  const note = card.querySelector("[data-note]");
  if (weight) {
    if (weight.value.trim() === "") draft.loadLb = 0;
    else {
      const lb = displayToLb(weight.value, state.settings.unit);
      if (lb != null && lb >= 0) draft.loadLb = lb;
    }
  }
  if (reps && reps.value !== "") {
    const n = Number(reps.value);
    if (Number.isFinite(n)) draft.reps = Math.max(0, Math.round(n));
  }
  if (note) draft.note = note.value;
  return draft;
}

function refreshPlates(exId) {
  const el = document.querySelector(`[data-plates="${CSS.escape(exId)}"]`);
  const found = findExercise(exId);
  const draft = state.drafts[exId];
  if (!el || !found || found.ex.baseWeightLb == null || !draft) return;
  el.textContent = platesLabel(draft.loadLb || 0, found.ex.baseWeightLb, state.settings.unit);
}

function findExercise(id) {
  for (const day of state.days) {
    const ex = day.exercises.find((item) => item.id === id);
    if (ex) return { day, ex };
  }
  return null;
}

function closeModal() {
  state.ui.modal = null;
  state.ui.pendingImport = null;
  state.ui.pendingCsv = null;
  render();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistQuiet().catch((error) => toast(error.message || "Could not save"));
  }, 120);
}

async function persistQuiet() {
  state.settings = normalizeSettings(state.settings);
  await db.saveSettings(state.settings);
  await db.saveDays(state.days);
  await db.savePlan(state.plan);
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function startRest(seconds) {
  const length = Math.min(900, Math.max(0, Math.round(Number(seconds) || 0)));
  timer.duration = length;
  timer.endAt = Date.now() + length * 1000;
  timer.running = length > 0;
  timer.fired = false;
  persistTimer();
  if (timer.running) acquireWakeLock();
  updateTimerDom();
}

function stopTimer() {
  if (timer.running) {
    timer.duration = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  }
  timer.running = false;
  persistTimer();
  releaseWakeLock();
  updateTimerDom();
}

function nudgeTimer(delta) {
  if (timer.running) {
    timer.endAt += delta * 1000;
    if (timer.endAt < Date.now()) timer.endAt = Date.now();
    timer.duration = Math.min(900, Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)));
  } else {
    timer.duration = Math.min(900, Math.max(0, timer.duration + delta));
    timer.fired = false;
  }
  persistTimer();
  updateTimerDom();
}

function tickTimer() {
  if (timer.running && Date.now() >= timer.endAt) {
    timer.running = false;
    timer.fired = true;
    timer.duration = state.settings.defaultRestSeconds;
    persistTimer();
    releaseWakeLock();
    updateTimerDom();
    finishCue();
    return;
  }
  if (timer.running || state.ui.sheetOpen) updateTimerDom();
}

function finishCue() {
  document.body.classList.add("timer-flash");
  setTimeout(() => document.body.classList.remove("timer-flash"), 1400);
  try { navigator.vibrate?.([180, 90, 180, 90, 360]); } catch { /* ignore */ }
  beep();
  toast("Rest finished");
}

function updateTimerDom() {
  const label = document.querySelector("#timer-label");
  const readout = document.querySelector("#timer-readout");
  const toggle = document.querySelector("#timer-toggle");
  const button = document.querySelector("#timer-btn");
  const sheet = document.querySelector("#sheet");
  const ms = timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.duration * 1000;
  const text = formatClock(ms);
  if (label) {
    label.textContent = timer.fired && !timer.running ? "Rest done" : timer.running ? text : `Rest ${text}`;
  }
  if (readout) readout.textContent = text;
  if (toggle) toggle.textContent = timer.running ? "Stop" : "Start";
  button?.classList.toggle("running", timer.running);
  button?.classList.toggle("done", !!(timer.fired && !timer.running));
  if (sheet) sheet.hidden = !state.ui.sheetOpen;
}

function persistTimer() {
  try {
    sessionStorage.setItem("kiln-timer", JSON.stringify({
      running: timer.running,
      endAt: timer.endAt,
      duration: timer.duration,
      fired: timer.fired,
    }));
  } catch { /* ignore */ }
}

function restoreTimer() {
  try {
    const raw = sessionStorage.getItem("kiln-timer");
    if (!raw) return;
    const saved = JSON.parse(raw);
    timer.duration = Number(saved.duration) || state.settings.defaultRestSeconds;
    timer.endAt = Number(saved.endAt) || 0;
    timer.fired = !!saved.fired;
    timer.running = !!saved.running && timer.endAt > Date.now();
    if (saved.running && !timer.running) timer.fired = true;
    if (timer.running) acquireWakeLock();
  } catch { /* ignore */ }
}

async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch { /* ignore */ }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* ignore */ }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const now = audioCtx.currentTime;
    [0, 0.26].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.22);
    });
  } catch { /* ignore */ }
}

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function parseHash() {
  const raw = (location.hash || "#/today").replace(/^#/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const name = parts[0] || "today";
  const allowed = new Set(["today", "program", "history", "settings", "day", "session", "exercise"]);
  if (!allowed.has(name)) return { name: "today", id: null };
  return { name, id: parts[1] || null };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function registerSw() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          toast("Update ready. Reload to use it.");
        }
      });
    });
  }).catch(() => {});
}
