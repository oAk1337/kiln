/** Pure training math, dates, and backup merge. No DOM. */

export const SCHEMA_VERSION = 1;
export const LB_PER_KG = 2.2046226218;

export function uid(prefix) {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${id}`;
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

export function formatPrettyDate(iso, options) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return String(iso || "");
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, options || {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatWhen(iso, today) {
  if (!iso) return "";
  if (iso === today) return "Today";
  if (iso === shiftDate(today, -1)) return "Yesterday";
  return formatPrettyDate(iso);
}

export function formatClock(ms) {
  const safe = Math.max(0, Number(ms) || 0);
  const s = safe === 0 ? 0 : Math.ceil(safe / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function formatNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(round2(n));
}

export function defaultSettings() {
  return { unit: "lb", weightIncrement: 5, defaultRestSeconds: 90 };
}

export function lbToDisplay(lb, unit) {
  if (lb == null || Number.isNaN(Number(lb))) return null;
  const v = unit === "kg" ? Number(lb) / LB_PER_KG : Number(lb);
  return round2(v);
}

export function displayToLb(value, unit) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return unit === "kg" ? n * LB_PER_KG : n;
}

export function convertIncrement(increment, fromUnit, toUnit) {
  if (fromUnit === toUnit) return round2(increment);
  const lb = fromUnit === "kg" ? Number(increment) * LB_PER_KG : Number(increment);
  const display = toUnit === "kg" ? lb / LB_PER_KG : lb;
  return round2(display);
}

export function normalizeSettings(input) {
  const base = defaultSettings();
  const unit = input?.unit === "kg" ? "kg" : "lb";
  let weightIncrement = Number(input?.weightIncrement);
  if (!Number.isFinite(weightIncrement) || weightIncrement <= 0) {
    weightIncrement = unit === "kg" ? 2.5 : base.weightIncrement;
  }
  weightIncrement = Math.min(round2(weightIncrement), unit === "kg" ? 50 : 100);
  let defaultRestSeconds = Number(input?.defaultRestSeconds);
  if (!Number.isFinite(defaultRestSeconds)) defaultRestSeconds = base.defaultRestSeconds;
  defaultRestSeconds = Math.min(600, Math.max(15, Math.round(defaultRestSeconds)));
  return { unit, weightIncrement, defaultRestSeconds };
}

export function epley(loadLb, reps) {
  if (loadLb == null || reps == null) return null;
  const load = Number(loadLb);
  const r = Number(reps);
  if (!Number.isFinite(load) || !Number.isFinite(r) || r < 1) return null;
  if (load <= 0) return 0;
  if (r === 1) return load;
  return load * (1 + r / 30);
}

export function platesPerSideLb(totalLb, baseLb) {
  if (baseLb == null || totalLb == null) return null;
  if (!Number.isFinite(Number(totalLb)) || !Number.isFinite(Number(baseLb))) return null;
  return (Number(totalLb) - Number(baseLb)) / 2;
}

export function plateOptions(unit) {
  return unit === "kg" ? [1.25, 2.5, 5, 10, 20] : [2.5, 5, 10, 25, 45];
}

export function addPair(loadLb, plateDisplay, unit) {
  const plateLb = displayToLb(plateDisplay, unit);
  if (plateLb == null) return loadLb;
  return (Number(loadLb) || 0) + plateLb * 2;
}

export function sameExercise(entry, exercise) {
  if (entry?.exerciseId && exercise?.id && entry.exerciseId === exercise.id) return true;
  if (entry?.exerciseId && exercise?.id && entry.exerciseId !== exercise.id) return false;
  const a = (entry?.exerciseName || "").trim().toLowerCase();
  const b = (exercise?.name || "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

export function topSet(entries) {
  const list = (entries || []).filter((e) => e && e.reps != null && Number(e.reps) >= 1);
  const working = list.filter((e) => e.setType === "working");
  const pool = working.length ? working : list;
  if (!pool.length) return null;
  const score = (e) => (e.bodyweight ? 0 : Number(e.loadLb) || 0) * 10000 + (Number(e.reps) || 0);
  return pool.reduce((best, e) => (score(e) > score(best) ? e : best));
}

/**
 * Double progression against the heaviest working weight.
 * Lighter working sets (back-offs) do not block a weight increase.
 * When every set at that weight hit repMax, add `incrementLb` and aim at repMin.
 * Otherwise keep that weight and add one rep, capped at repMax.
 */
export function suggestTarget(exercise, lastEntries, incrementLb) {
  const repMin = clampInt(exercise?.repMin, 1, 100, 5);
  const repMax = Math.max(repMin, clampInt(exercise?.repMax, 1, 100, repMin));
  const working = (lastEntries || []).filter((e) => e.setType === "working");

  if (exercise?.bodyweight) {
    if (!working.length) {
      return { loadLb: 0, reps: repMin, bodyweight: true, mode: "start" };
    }
    const minReps = Math.min(...working.map((e) => Number(e.reps) || 0));
    const allTop = working.every((e) => (Number(e.reps) || 0) >= repMax);
    if (allTop) {
      return { loadLb: 0, reps: repMax, bodyweight: true, mode: "top" };
    }
    return {
      loadLb: 0,
      reps: Math.min(minReps + 1, repMax),
      bodyweight: true,
      mode: "reps",
    };
  }

  const loaded = working.filter((e) => !e.bodyweight && e.loadLb != null && Number.isFinite(Number(e.loadLb)));
  if (!loaded.length) {
    return { loadLb: null, reps: repMin, bodyweight: false, mode: "start" };
  }

  const peak = Math.max(...loaded.map((e) => Number(e.loadLb)));
  const peakSets = loaded.filter((e) => Math.abs(Number(e.loadLb) - peak) <= 0.25);
  const allTop = peakSets.every((e) => (Number(e.reps) || 0) >= repMax);
  if (allTop) {
    return {
      loadLb: peak + (Number(incrementLb) || 0),
      reps: repMin,
      bodyweight: false,
      mode: "weight",
    };
  }
  const minReps = Math.min(...peakSets.map((e) => Number(e.reps) || 0));
  return {
    loadLb: peak,
    reps: Math.min(minReps + 1, repMax),
    bodyweight: false,
    mode: "reps",
  };
}

export function suggestionText(exercise, suggestion, unit) {
  const reps = suggestion?.reps ?? exercise?.repMin ?? 5;
  if (exercise?.bodyweight || suggestion?.bodyweight) {
    if (suggestion?.mode === "top") {
      return `Every working set hit ${exercise.repMax}. Suggested: bodyweight × ${reps}. Raise the rep range to keep progressing.`;
    }
    if (suggestion?.mode === "start") return `No history yet. Aim for ${reps} reps.`;
    return `Suggested: bodyweight × ${reps}`;
  }
  if (suggestion?.mode === "start" || suggestion?.loadLb == null) {
    return `No history yet. Aim for ${reps} reps.`;
  }
  const w = formatNumber(lbToDisplay(suggestion.loadLb, unit));
  if (suggestion.mode === "weight") {
    return `Every working set hit ${exercise.repMax}. Suggested: ${w} ${unit} × ${reps}`;
  }
  return `Suggested: ${w} ${unit} × ${reps}`;
}

export function formatSet(entry, unit) {
  const reps = entry?.reps == null ? "—" : String(entry.reps);
  if (entry?.bodyweight) return `BW×${reps}`;
  const w = formatNumber(lbToDisplay(entry?.loadLb || 0, unit));
  return `${w}×${reps}`;
}

export function platesLabel(totalLb, baseLb, unit) {
  if (baseLb == null) return "";
  const per = platesPerSideLb(totalLb, baseLb);
  const perD = lbToDisplay(per, unit);
  const baseD = lbToDisplay(baseLb, unit);
  if (per < -0.05) return `Under the ${formatNumber(baseD)} ${unit} base`;
  return `${formatNumber(perD)} ${unit}/side · base ${formatNumber(baseD)} ${unit}`;
}

export function createDay(name = "") {
  return { id: uid("day"), name, cardioNote: "", exercises: [] };
}

export function createExercise() {
  return {
    id: uid("ex"),
    name: "",
    targetSets: 3,
    repMin: 5,
    repMax: 8,
    note: "",
    superset: "",
    baseWeightLb: null,
    bodyweight: false,
  };
}

export function createSession({ date, day, createdAt = new Date().toISOString() }) {
  return {
    id: uid("ses"),
    date,
    dayId: day?.id || null,
    dayName: day?.name || "",
    createdAt,
    entries: [],
  };
}

export function createEntry({ exercise, setType, reps, loadLb, bodyweight, note }) {
  return {
    id: uid("ent"),
    exerciseId: exercise?.id || null,
    exerciseName: (exercise?.name || "").trim() || "Exercise",
    setType: setType === "warmup" ? "warmup" : "working",
    reps: reps == null ? null : Number(reps),
    loadLb: bodyweight ? 0 : Number(loadLb) || 0,
    bodyweight: !!bodyweight,
    note: (note || "").trim(),
    loggedAt: new Date().toISOString(),
  };
}

export function moveItem(list, index, dir) {
  const next = list.slice();
  const j = index + dir;
  if (j < 0 || j >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(j, 0, item);
  return next;
}

export function nextDay(days, sessions, today) {
  if (!days?.length) return null;
  const prior = (sessions || [])
    .filter((s) => s.dayId && s.date && s.date < today)
    .sort(compareSessions);
  if (!prior.length) return days[0];
  const last = prior[prior.length - 1];
  const idx = days.findIndex((d) => d.id === last.dayId);
  if (idx < 0) return days[0];
  return days[(idx + 1) % days.length];
}

export function todayPlan(days, sessions, plan, today) {
  const resolved = resolveToday(days, sessions, plan, today);
  const exercises = (resolved.day?.exercises || []).map((ex) => ({ ...ex }));
  if (resolved.session) {
    for (const entry of resolved.session.entries || []) {
      if (exercises.some((ex) => sameExercise(entry, ex))) continue;
      exercises.push({
        id: entry.exerciseId || `extra-${(entry.exerciseName || "exercise").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: entry.exerciseName || "Exercise",
        targetSets: 1,
        repMin: 5,
        repMax: 8,
        note: "",
        superset: "",
        baseWeightLb: null,
        bodyweight: !!entry.bodyweight,
        orphan: true,
      });
    }
  }
  return { ...resolved, exercises };
}

export function resolveToday(days, sessions, plan, today) {
  const todays = (sessions || [])
    .filter((s) => s.date === today)
    .sort(compareSessions);
  const current = todays[todays.length - 1] || null;
  if (current?.dayId) {
    const day = days.find((d) => d.id === current.dayId);
    if (day) return { day, session: current, source: "session" };
  }
  if (current) {
    return { day: null, session: current, source: "session-orphan" };
  }
  if (plan && plan.date === today) {
    const planned = days.find((d) => d.id === plan.dayId);
    if (planned) return { day: planned, session: null, source: "plan" };
  }
  return { day: nextDay(days, sessions, today), session: null, source: "cycle" };
}

export function followingDay(days, day) {
  if (!day || !days?.length) return null;
  const idx = days.findIndex((d) => d.id === day.id);
  if (idx < 0) return null;
  return days[(idx + 1) % days.length];
}

export function previousPerformance(sessions, exercise, today) {
  const candidates = (sessions || [])
    .filter((s) => s.date && s.date < today)
    .sort((a, b) => compareSessions(b, a));
  for (const session of candidates) {
    const entries = (session.entries || []).filter((e) => sameExercise(e, exercise));
    if (entries.length) return { session, entries };
  }
  return null;
}

export function progressionPoints(sessions, exercise) {
  const points = [];
  const sorted = [...(sessions || [])].sort(compareSessions);
  for (const session of sorted) {
    const entries = (session.entries || []).filter((e) => sameExercise(e, exercise));
    if (!entries.length) continue;
    const top = topSet(entries);
    if (!top) continue;
    const loadLb = top.bodyweight ? 0 : Number(top.loadLb) || 0;
    points.push({
      date: session.date,
      sessionId: session.id,
      loadLb,
      reps: Number(top.reps) || 0,
      bodyweight: !!top.bodyweight,
      e1rmLb: top.bodyweight ? 0 : epley(loadLb, top.reps),
    });
  }
  return points;
}

export function listKnownExercises(days, sessions) {
  const map = new Map();
  for (const day of days || []) {
    for (const ex of day.exercises || []) {
      map.set(ex.id, { ...ex, dayName: day.name || "" });
    }
  }
  for (const session of sessions || []) {
    for (const entry of session.entries || []) {
      const key = entry.exerciseId || `name:${(entry.exerciseName || "").toLowerCase()}`;
      if (map.has(key)) continue;
      map.set(key, {
        id: entry.exerciseId || key,
        name: entry.exerciseName || "Exercise",
        bodyweight: !!entry.bodyweight,
        dayName: session.dayName || "",
        targetSets: 1,
        repMin: 5,
        repMax: 8,
        note: "",
        superset: "",
        baseWeightLb: null,
      });
    }
  }
  return [...map.values()];
}

export function findExercise(days, sessions, id) {
  if (!id) return null;
  for (const day of days || []) {
    const ex = (day.exercises || []).find((e) => e.id === id);
    if (ex) return { ...ex, dayName: day.name || "" };
  }
  for (const session of sessions || []) {
    const entry = (session.entries || []).find((e) => e.exerciseId === id || `name:${(e.exerciseName || "").toLowerCase()}` === id);
    if (entry) {
      return {
        id: entry.exerciseId || id,
        name: entry.exerciseName || "Exercise",
        bodyweight: !!entry.bodyweight,
        dayName: session.dayName || "",
        targetSets: 1,
        repMin: 5,
        repMax: 8,
        note: "",
        superset: "",
        baseWeightLb: null,
      };
    }
  }
  return null;
}

export function compareSessions(a, b) {
  const byDate = String(a.date || "").localeCompare(String(b.date || ""));
  if (byDate) return byDate;
  const byCreated = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  if (byCreated) return byCreated;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function countEntries(sessions) {
  return (sessions || []).reduce((n, s) => n + (s.entries?.length || 0), 0);
}

export function serializeState({ settings, days, sessions }, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: "kiln",
    exportedAt,
    settings: normalizeSettings(settings),
    days: (days || []).map(normalizeDay),
    sessions: [...(sessions || [])].sort(compareSessions).map(normalizeSession),
  };
}

export function parseImport(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ["File is not valid JSON."] };
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Backup must be a JSON object."] };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`Unsupported schemaVersion (${data.schemaVersion ?? "missing"}). This app reads schemaVersion ${SCHEMA_VERSION}.`],
    };
  }
  const errors = [];
  if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
    errors.push("Missing settings object.");
  }
  if (!Array.isArray(data.days)) errors.push("Missing days array.");
  if (!Array.isArray(data.sessions)) errors.push("Missing sessions array.");
  if (errors.length) return { ok: false, errors };

  try {
    const settings = normalizeSettings(data.settings);
    const days = data.days.map((day, i) => coerceDay(day, i));
    const sessions = data.sessions.map((session, i) => coerceSession(session, i));
    return { ok: true, errors: [], value: { settings, days, sessions } };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

export function mergeState(local, incoming) {
  return {
    settings: normalizeSettings(local.settings),
    days: mergeDays(local.days || [], incoming.days || []),
    sessions: mergeSessions(local.sessions || [], incoming.sessions || []),
  };
}

export function replaceState(incoming) {
  return {
    settings: normalizeSettings(incoming.settings),
    days: (incoming.days || []).map(normalizeDay),
    sessions: (incoming.sessions || []).map(normalizeSession),
  };
}

export function applyCsvSessions(localSessions, csvSessions) {
  const sessions = (localSessions || []).map((s) => ({
    ...s,
    entries: (s.entries || []).map((e) => ({ ...e })),
  }));
  let added = 0;
  let duplicate = 0;
  for (const incoming of csvSessions || []) {
    const host = sessions.find((s) =>
      s.date === incoming.date
      && (s.dayName || "").trim().toLowerCase() === (incoming.dayName || "").trim().toLowerCase()
    );
    if (!host) {
      sessions.push(incoming);
      added += incoming.entries.length;
      continue;
    }
    const seen = new Set(host.entries.map((e) => e.id));
    for (const entry of incoming.entries) {
      if (seen.has(entry.id)) {
        duplicate += 1;
      } else {
        host.entries.push(entry);
        seen.add(entry.id);
        added += 1;
      }
    }
  }
  return { sessions, added, duplicate };
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function mergeDays(localDays, incomingDays) {
  const map = new Map(localDays.map((day) => [day.id, normalizeDay(day)]));
  const order = localDays.map((day) => day.id);
  for (const raw of incomingDays) {
    const day = normalizeDay(raw);
    if (!map.has(day.id)) {
      map.set(day.id, day);
      order.push(day.id);
      continue;
    }
    const current = map.get(day.id);
    current.name = day.name;
    current.cardioNote = day.cardioNote;
    const exMap = new Map(current.exercises.map((ex) => [ex.id, ex]));
    const exOrder = current.exercises.map((ex) => ex.id);
    for (const ex of day.exercises) {
      if (!exOrder.includes(ex.id)) exOrder.push(ex.id);
      exMap.set(ex.id, ex);
    }
    current.exercises = exOrder.map((id) => exMap.get(id));
  }
  return order.map((id) => map.get(id));
}

function mergeSessions(localSessions, incomingSessions) {
  const map = new Map(localSessions.map((session) => [session.id, normalizeSession(session)]));
  for (const raw of incomingSessions) {
    const session = normalizeSession(raw);
    if (!map.has(session.id)) {
      map.set(session.id, session);
      continue;
    }
    const current = map.get(session.id);
    const seen = new Set(current.entries.map((e) => e.id));
    for (const entry of session.entries) {
      if (!seen.has(entry.id)) {
        current.entries.push(entry);
        seen.add(entry.id);
      }
    }
  }
  return [...map.values()];
}

function normalizeDay(day) {
  return {
    id: String(day.id),
    name: String(day.name ?? ""),
    cardioNote: String(day.cardioNote ?? ""),
    exercises: (day.exercises || []).map(normalizeExercise),
  };
}

function normalizeExercise(ex) {
  const repMin = clampInt(ex.repMin, 1, 100, 5);
  const repMax = Math.max(repMin, clampInt(ex.repMax, 1, 100, repMin));
  let baseWeightLb = null;
  if (ex.baseWeightLb != null && ex.baseWeightLb !== "") {
    const n = Number(ex.baseWeightLb);
    if (Number.isFinite(n) && n >= 0) baseWeightLb = n;
  }
  return {
    id: String(ex.id),
    name: String(ex.name ?? ""),
    targetSets: clampInt(ex.targetSets, 1, 20, 3),
    repMin,
    repMax,
    note: String(ex.note ?? ""),
    superset: String(ex.superset ?? "").trim().slice(0, 4),
    baseWeightLb: ex.bodyweight ? null : baseWeightLb,
    bodyweight: !!ex.bodyweight,
  };
}

function normalizeSession(session) {
  return {
    id: String(session.id),
    date: String(session.date),
    dayId: session.dayId ? String(session.dayId) : null,
    dayName: String(session.dayName ?? ""),
    createdAt: session.createdAt ? String(session.createdAt) : null,
    entries: (session.entries || []).map(normalizeEntry),
  };
}

function normalizeEntry(entry) {
  const bodyweight = !!entry.bodyweight;
  let reps = null;
  if (entry.reps != null && entry.reps !== "") {
    const n = Number(entry.reps);
    if (Number.isFinite(n)) reps = Math.max(0, Math.round(n));
  }
  return {
    id: String(entry.id),
    exerciseId: entry.exerciseId ? String(entry.exerciseId) : null,
    exerciseName: String(entry.exerciseName ?? ""),
    setType: entry.setType === "warmup" ? "warmup" : "working",
    reps,
    loadLb: bodyweight ? 0 : Math.max(0, Number(entry.loadLb) || 0),
    bodyweight,
    note: String(entry.note ?? ""),
    loggedAt: entry.loggedAt ? String(entry.loggedAt) : null,
  };
}

function coerceDay(day, index) {
  if (!day || typeof day !== "object") throw new Error(`Day ${index + 1} is not an object.`);
  if (!day.id) throw new Error(`Day ${index + 1} is missing id.`);
  if (day.name == null) throw new Error(`Day ${day.id} is missing name.`);
  if (day.exercises != null && !Array.isArray(day.exercises)) {
    throw new Error(`Day ${day.id} exercises must be an array.`);
  }
  const normalized = normalizeDay({ ...day, exercises: day.exercises || [] });
  normalized.exercises.forEach((ex, i) => {
    if (!ex.id) throw new Error(`Exercise ${i + 1} on ${day.id} is missing id.`);
  });
  (day.exercises || []).forEach((ex, i) => {
    if (!ex || typeof ex !== "object") throw new Error(`Exercise ${i + 1} on ${day.id} is not an object.`);
    if (!ex.id) throw new Error(`Exercise ${i + 1} on ${day.id} is missing id.`);
    if (ex.name == null) throw new Error(`Exercise ${ex.id} is missing name.`);
  });
  return normalized;
}

function coerceSession(session, index) {
  if (!session || typeof session !== "object") throw new Error(`Session ${index + 1} is not an object.`);
  if (!session.id) throw new Error(`Session ${index + 1} is missing id.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ""))) {
    throw new Error(`Session ${session.id} needs a YYYY-MM-DD date.`);
  }
  if (session.entries != null && !Array.isArray(session.entries)) {
    throw new Error(`Session ${session.id} entries must be an array.`);
  }
  (session.entries || []).forEach((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`Entry ${i + 1} in ${session.id} is not an object.`);
    if (!entry.id) throw new Error(`Entry ${i + 1} in ${session.id} is missing id.`);
    if (!entry.exerciseName) throw new Error(`Entry ${entry.id} is missing exerciseName.`);
    if (entry.setType !== "warmup" && entry.setType !== "working") {
      throw new Error(`Entry ${entry.id} setType must be warmup or working.`);
    }
  });
  return normalizeSession(session);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
