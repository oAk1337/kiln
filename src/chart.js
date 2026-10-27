/** Inline SVG progression chart. No chart library. */

export function lineChart({ series, labels }) {
  const usable = (series || []).filter((s) => s && s.values?.length);
  if (!usable.length || !labels?.length) return "";
  const w = 360;
  const h = 208;
  const pad = { l: 46, r: 14, t: 16, b: 32 };
  const values = usable.flatMap((s) => s.values.map((v) => Number(v) || 0));
  const maxV = Math.max(...values, 0);
  const yMax = maxV <= 0 ? 1 : maxV * 1.12;
  const n = labels.length;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xAt = (i) => (n === 1 ? pad.l + innerW / 2 : pad.l + (innerW * i) / (n - 1));
  const yAt = (v) => pad.t + innerH - ((Number(v) || 0) / yMax) * innerH;

  const grid = [0, 0.5, 1].map((t) => {
    const value = yMax * t;
    const y = yAt(value);
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${w - pad.r}" y2="${y.toFixed(1)}" class="chart-grid"></line>
      <text x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-axis">${fmt(value)}</text>`;
  }).join("");

  const labelIdx = n <= 3 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const xLabels = labelIdx.map((i) => {
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    const x = i === 0 ? pad.l : i === n - 1 ? w - pad.r : xAt(i);
    return `<text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="${anchor}" class="chart-axis">${escapeXml(labels[i])}</text>`;
  }).join("");

  const lines = usable.map((s) => {
    const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
    const dots = s.values.map((v, i) =>
      `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="3.5" fill="${s.color}"></circle>`
    ).join("");
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-hidden="true">
    ${grid}
    ${lines}
    ${xLabels}
  </svg>`;
}

function fmt(n) {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 10) / 10;
  return String(rounded);
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}
