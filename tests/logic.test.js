import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { lineChart } from "../src/chart.js";
import {
  addPair,
  applyCsvSessions,
  convertIncrement,
  createDay,
  createExercise,
  defaultSettings,
  epley,
  formatClock,
  lbToDisplay,
  mergeState,
  nextDay,
  parseImport,
  platesPerSideLb,
  replaceState,
  resolveToday,
  serializeState,
  suggestTarget,
  suggestionText,
  todayPlan,
} from "../src/logic.js";

const press = {
  id: "ex_example_press",
  name: "Example Press",
  targetSets: 3,
  repMin: 6,
  repMax: 10,
  bodyweight: false,
};

test("double progression adds weight when every top-weight set hits the ceiling", () => {
  const last = [10, 10, 10].map((reps) => ({ setType: "working", reps, loadLb: 100, bodyweight: false }));
  const suggestion = suggestTarget(press, last, 5);
  assert.equal(suggestion.mode, "weight");
  assert.equal(suggestion.loadLb, 105);
  assert.equal(suggestion.reps, 6);
  assert.match(suggestionText(press, suggestion, "lb"), /105 lb × 6/);
});

test("double progression adds a rep when a top-weight set is short", () => {
  const last = [
    { setType: "working", reps: 10, loadLb: 100 },
    { setType: "working", reps: 8, loadLb: 100 },
    { setType: "warmup", reps: 12, loadLb: 45 },
  ];
  const suggestion = suggestTarget(press, last, 5);
  assert.equal(suggestion.mode, "reps");
  assert.equal(suggestion.loadLb, 100);
  assert.equal(suggestion.reps, 9);
});

test("lighter back-off sets do not block a weight increase", () => {
  const last = [
    { setType: "working", reps: 10, loadLb: 100 },
    { setType: "working", reps: 8, loadLb: 80 },
  ];
  const suggestion = suggestTarget(press, last, 5);
  assert.equal(suggestion.mode, "weight");
  assert.equal(suggestion.loadLb, 105);
  assert.equal(suggestion.reps, 6);
});

test("bodyweight progression stays on reps", () => {
  const exercise = { ...press, bodyweight: true, repMin: 8, repMax: 12 };
  const hit = suggestTarget(exercise, [
    { setType: "working", reps: 12, loadLb: 0, bodyweight: true },
  ], 5);
  assert.equal(hit.mode, "top");
  assert.equal(hit.reps, 12);
  const up = suggestTarget(exercise, [
    { setType: "working", reps: 9, loadLb: 0, bodyweight: true },
  ], 5);
  assert.equal(up.mode, "reps");
  assert.equal(up.reps, 10);
  assert.equal(up.loadLb, 0);
});

test("epley, plates, and unit conversion", () => {
  assert.equal(epley(100, 1), 100);
  assert.ok(Math.abs(epley(100, 10) - (100 * (1 + 10 / 30))) < 1e-9);
  assert.equal(epley(0, 10), 0);
  assert.equal(platesPerSideLb(200, 120), 40);
  assert.equal(platesPerSideLb(100, 120), -10);
  assert.equal(addPair(120, 25, "lb"), 170);
  assert.equal(convertIncrement(5, "lb", "kg"), 2.27);
  assert.equal(convertIncrement(2.27, "kg", "lb"), 5);
  assert.equal(lbToDisplay(100, "kg"), 45.36);
});

test("formatClock", () => {
  assert.equal(formatClock(90_000), "1:30");
  assert.equal(formatClock(1000), "0:01");
  assert.equal(formatClock(0), "0:00");
});

test("cycle advances from the last logged day and wraps", () => {
  const days = [
    { id: "a", name: "Day A", exercises: [] },
    { id: "b", name: "Day B", exercises: [] },
    { id: "c", name: "Rest", exercises: [] },
  ];
  assert.equal(nextDay(days, [], "2026-02-02").id, "a");
  const sessions = [{ id: "s1", date: "2026-02-01", dayId: "b", entries: [] }];
  assert.equal(nextDay(days, sessions, "2026-02-02").id, "c");
  assert.equal(nextDay(days, [{ id: "s2", date: "2026-02-01", dayId: "c", entries: [] }], "2026-02-02").id, "a");
  assert.equal(nextDay(days, [{ id: "s3", date: "2026-02-01", dayId: "missing", entries: [] }], "2026-02-02").id, "a");
  const today = resolveToday(days, [{ id: "s4", date: "2026-02-02", dayId: "a", entries: [] }], null, "2026-02-02");
  assert.equal(today.day.id, "a");
  assert.equal(today.source, "session");
});

test("chosen plan overrides the cycle until a session exists", () => {
  const days = [createDay("Day A"), createDay("Day B")];
  const planned = resolveToday(days, [], { date: "2026-02-02", dayId: days[1].id }, "2026-02-02");
  assert.equal(planned.day.id, days[1].id);
  assert.equal(planned.source, "plan");
});

test("merge dedupes entry ids and replace drops local-only data", () => {
  const local = {
    settings: { unit: "kg", weightIncrement: 2.5, defaultRestSeconds: 120 },
    days: [{
      id: "day_example_a",
      name: "Local name",
      cardioNote: "",
      exercises: [
        { ...createExercise(), id: "ex_example_press", name: "Local Press" },
        { ...createExercise(), id: "ex_local_only", name: "Local Only" },
      ],
    }],
    sessions: [{
      id: "ses_example_1",
      date: "2026-01-14",
      dayId: "day_example_a",
      dayName: "Day A",
      entries: [{
        id: "ent_example_2",
        exerciseId: "ex_example_press",
        exerciseName: "Example Press",
        setType: "working",
        reps: 10,
        loadLb: 100,
        bodyweight: false,
        note: "",
      }],
    }],
  };
  const incoming = parseImport(fs.readFileSync(new URL("./fixtures/example.json", import.meta.url), "utf8"));
  assert.equal(incoming.ok, true);
  const merged = mergeState(local, incoming.value);
  assert.equal(merged.settings.unit, "kg");
  assert.equal(merged.days[0].name, "Day A");
  assert.equal(merged.days[0].exercises.some((ex) => ex.id === "ex_local_only"), true);
  assert.equal(merged.days[0].exercises.find((ex) => ex.id === "ex_example_press").name, "Example Press");
  assert.equal(merged.days.some((day) => day.id === "day_example_rest"), true);
  const entries = merged.sessions[0].entries;
  assert.equal(entries.filter((entry) => entry.id === "ent_example_2").length, 1);
  assert.equal(entries.length, 4);
  const replaced = replaceState(incoming.value);
  assert.equal(replaced.settings.unit, "lb");
  assert.equal(replaced.days.length, 2);
  assert.equal(replaced.sessions[0].entries.length, 4);
});

test("serialize round-trips and rejects other schema versions", () => {
  const parsed = parseImport(fs.readFileSync(new URL("./fixtures/example.json", import.meta.url), "utf8"));
  const again = parseImport(JSON.stringify(serializeState(parsed.value, "2026-01-15T12:00:00.000Z")));
  assert.equal(again.ok, true);
  assert.deepEqual(again.value.days, parsed.value.days);
  assert.deepEqual(again.value.sessions, parsed.value.sessions);
  assert.deepEqual(Object.keys(serializeState({ settings: defaultSettings(), days: [], sessions: [] }, "2026-01-01T00:00:00.000Z")), [
    "schemaVersion", "app", "exportedAt", "settings", "days", "sessions",
  ]);
  const bad = parseImport('{"schemaVersion":2,"settings":{},"days":[],"sessions":[]}');
  assert.equal(bad.ok, false);
});

test("today plan suggests the next load from the previous session", () => {
  const parsed = parseImport(fs.readFileSync(new URL("./fixtures/example.json", import.meta.url), "utf8"));
  const plan = todayPlan(parsed.value.days, parsed.value.sessions, null, "2026-01-15");
  assert.equal(plan.day.id, "day_example_rest");
  const only = todayPlan([parsed.value.days[0]], parsed.value.sessions, null, "2026-01-15");
  const suggestion = suggestTarget(
    only.exercises[0],
    parsed.value.sessions[0].entries,
    5,
  );
  assert.equal(suggestion.loadLb, 105);
  assert.equal(suggestion.reps, 6);
});

test("chart draws load and estimated 1RM without a library", () => {
  const svg = lineChart({
    labels: ["Jan 1", "Jan 8"],
    series: [
      { name: "Top-set load", color: "#f0a05a", values: [100, 105] },
      { name: "Est. 1RM", color: "#9ec1ff", values: [133.3, 140] },
    ],
  });
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.match(svg, /<svg/);
});

test("icons are real PNGs at the manifest sizes", () => {
  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./index.html");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const [file, size] of [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/icon-maskable-512.png", 512],
  ]) {
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(buf.readUInt32BE(16), size);
    assert.equal(buf.readUInt32BE(20), size);
  }
});
