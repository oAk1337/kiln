/** CSV history import. Column names are exact; order may vary. */

import { stableId } from "./hash.js";

export const CSV_COLUMNS = [
  "date",
  "day",
  "exercise",
  "set_type",
  "sets",
  "reps",
  "load_lb",
  "notes",
];

export function parseCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!clean.trim()) return { rows: [], errors: ["CSV is empty."] };
  const table = parseTable(clean);
  if (!table.length) return { rows: [], errors: ["CSV is empty."] };
  const header = table[0].map((cell) => cell.trim());
  const missing = CSV_COLUMNS.filter((col) => !header.includes(col));
  const extra = header.filter((col) => !CSV_COLUMNS.includes(col));
  if (missing.length || extra.length || header.length !== CSV_COLUMNS.length) {
    return {
      rows: [],
      errors: [`Header must be exactly: ${CSV_COLUMNS.join(",")}`],
    };
  }
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = [];
  const errors = [];
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    if (line.every((cell) => cell.trim() === "")) continue;
    const get = (key) => (line[idx[key]] ?? "").trim();
    const date = get("date");
    const day = get("day");
    const exercise = get("exercise");
    const setTypeRaw = get("set_type").toLowerCase();
    const setsRaw = get("sets");
    const repsRaw = get("reps");
    const loadRaw = get("load_lb");
    const notes = (line[idx.notes] ?? "").trim();
    const lineNo = r + 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate(date)) {
      errors.push(`Row ${lineNo}: date must be YYYY-MM-DD.`);
      continue;
    }
    if (!day) {
      errors.push(`Row ${lineNo}: day is required.`);
      continue;
    }
    if (!exercise) {
      errors.push(`Row ${lineNo}: exercise is required.`);
      continue;
    }
    let setType = null;
    if (setTypeRaw === "working" || setTypeRaw === "work") setType = "working";
    else if (["warmup", "warm-up", "warm_up", "wu"].includes(setTypeRaw)) setType = "warmup";
    else {
      errors.push(`Row ${lineNo}: set_type must be working or warmup.`);
      continue;
    }
    const sets = Number(setsRaw);
    if (!Number.isInteger(sets) || sets < 1 || sets > 50) {
      errors.push(`Row ${lineNo}: sets must be a whole number from 1 to 50.`);
      continue;
    }
    let reps = null;
    if (repsRaw !== "") {
      const n = Number(repsRaw);
      if (!Number.isInteger(n) || n < 0 || n > 500) {
        errors.push(`Row ${lineNo}: reps must be a whole number or blank.`);
        continue;
      }
      reps = n;
    }
    let bodyweight = false;
    let loadLb = 0;
    if (loadRaw === "") {
      loadLb = 0;
    } else if (/^(bodyweight|bw)$/i.test(loadRaw)) {
      bodyweight = true;
      loadLb = 0;
    } else {
      const n = Number(loadRaw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`Row ${lineNo}: load_lb must be a number or bodyweight.`);
        continue;
      }
      loadLb = n;
    }
    rows.push({
      line: lineNo,
      date,
      day,
      exercise,
      setType,
      sets,
      reps,
      loadLb,
      bodyweight,
      notes,
    });
  }
  return { rows, errors };
}

export function sessionsFromCsv(text, days = []) {
  const parsed = parseCsv(text);
  if (parsed.errors.length && parsed.rows.length === 0 && parsed.errors[0].startsWith("Header")) {
    return { sessions: [], errors: parsed.errors, rows: [] };
  }
  const grouped = new Map();
  for (const row of parsed.rows) {
    const key = `${row.date}\u001f${row.day.trim().toLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const sessions = [];
  for (const rows of grouped.values()) {
    const first = rows[0];
    const day = (days || []).find((d) => (d.name || "").trim().toLowerCase() === first.day.trim().toLowerCase());
    const entries = [];
    for (const row of rows) {
      const exercise = (day?.exercises || []).find((ex) =>
        (ex.name || "").trim().toLowerCase() === row.exercise.trim().toLowerCase()
      );
      for (let i = 0; i < row.sets; i++) {
        entries.push({
          id: stableId("csv", [
            row.date,
            row.day,
            row.exercise,
            row.setType,
            row.line,
            i,
            row.reps,
            row.loadLb,
            row.bodyweight,
            row.notes,
          ]),
          exerciseId: exercise?.id || null,
          exerciseName: row.exercise,
          setType: row.setType,
          reps: row.reps,
          loadLb: row.bodyweight ? 0 : row.loadLb,
          bodyweight: row.bodyweight,
          note: row.notes,
          loggedAt: null,
        });
      }
    }
    sessions.push({
      id: stableId("csvses", [first.date, first.day.trim().toLowerCase()]),
      date: first.date,
      dayId: day?.id || null,
      dayName: day?.name || first.day,
      createdAt: `${first.date}T12:00:00.000Z`,
      entries,
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { sessions, errors: parsed.errors, rows: parsed.rows };
}

function parseTable(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function isRealDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
