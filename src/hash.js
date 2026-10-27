/** Stable non-cryptographic id so re-importing the same CSV row dedupes. */

export function stableId(prefix, parts) {
  const text = parts.map((part) => String(part ?? "")).join("\u001f");
  return `${prefix}_${fnv(text)}${fnv([...text].reverse().join(""))}`;
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
