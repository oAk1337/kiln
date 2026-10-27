import assert from "node:assert/strict";
import test from "node:test";
import { sessionsFromCsv } from "../src/csv.js";
import { applyCsvSessions, countEntries } from "../src/logic.js";

const header = "date,day,exercise,set_type,sets,reps,load_lb,notes";

test("expands identical sets and maps bodyweight", () => {
  const csv = [
    header,
    "2026-02-01,Day A,Example Press,working,3,8,100,",
    "2026-02-01,Day A,Example Press,warmup,2,,45,easy",
    "2026-02-01,Day A,Example Raise,working,2,12,bodyweight,\"felt \"\"fine\"\", kept form\"",
  ].join("\n");
  const days = [{
    id: "day_a",
    name: "Day A",
    exercises: [{ id: "ex_press", name: "Example Press" }],
  }];
  const first = sessionsFromCsv(csv, days);
  assert.equal(first.errors.length, 0);
  assert.equal(first.sessions.length, 1);
  assert.equal(first.sessions[0].dayId, "day_a");
  assert.equal(first.sessions[0].entries.length, 7);
  const press = first.sessions[0].entries.filter((entry) => entry.exerciseName === "Example Press" && entry.setType === "working");
  assert.equal(press.length, 3);
  assert.equal(press[0].exerciseId, "ex_press");
  assert.equal(press[0].loadLb, 100);
  assert.equal(press[0].reps, 8);
  const warmup = first.sessions[0].entries.find((entry) => entry.setType === "warmup");
  assert.equal(warmup.reps, null);
  const bw = first.sessions[0].entries.find((entry) => entry.bodyweight);
  assert.equal(bw.loadLb, 0);
  assert.equal(bw.reps, 12);
  assert.equal(bw.note, "felt \"fine\", kept form");

  const applied = applyCsvSessions([], first.sessions);
  assert.equal(applied.added, 7);
  const again = applyCsvSessions(applied.sessions, sessionsFromCsv(csv, days).sessions);
  assert.equal(again.added, 0);
  assert.equal(again.duplicate, 7);
  assert.equal(countEntries(again.sessions), 7);
});

test("csv merges into an existing session with the same date and day", () => {
  const csv = `${header}\n2026-03-01,Day A,Example Press,working,1,5,50,`;
  const incoming = sessionsFromCsv(csv, []).sessions;
  const local = [{
    id: "manual",
    date: "2026-03-01",
    dayId: null,
    dayName: "day a",
    entries: [],
  }];
  const applied = applyCsvSessions(local, incoming);
  assert.equal(applied.sessions.length, 1);
  assert.equal(applied.sessions[0].id, "manual");
  assert.equal(applied.added, 1);
});

test("rejects a header that is not the exact column set", () => {
  const bad = sessionsFromCsv("date,day,exercise,set_type,sets,reps,load_lb,notes,extra\n", []);
  assert.equal(bad.sessions.length, 0);
  assert.match(bad.errors[0], /Header must be exactly/);
  const row = sessionsFromCsv(`${header}\n2026-02-31,Day A,Example Press,working,1,5,50,\n`, []);
  assert.equal(row.sessions.length, 0);
  assert.match(row.errors[0], /date/);
});
