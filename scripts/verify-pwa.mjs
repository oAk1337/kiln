import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const pageUrl = `${origin}/kiln/`;
const dist = path.resolve("dist");
const shotDir = "/tmp/kiln-shots";
fs.mkdirSync(shotDir, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/kiln") {
    res.writeHead(302, { Location: "/kiln/" });
    res.end();
    return;
  }
  if (pathname.startsWith("/kiln/")) pathname = pathname.slice("/kiln".length);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const file = path.join(dist, pathname);
  if (!file.startsWith(dist)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const type = mime[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

let page;

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  await run();
  console.log("verify-pwa: ok");
} finally {
  await browser.close();
  server.close();
}

async function run() {
  const built = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  if (!built.includes("./manifest.webmanifest")) throw new Error("manifest link missing");
  if (built.includes('src="/') || built.includes('href="/')) throw new Error("absolute root path in index.html");
  const sw = fs.readFileSync(path.join(dist, "sw.js"), "utf8");
  if (!sw.includes("kiln-") || !sw.includes("addEventListener(\"fetch\"")) throw new Error("service worker missing");
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.webmanifest"), "utf8"));
  if (manifest.display !== "standalone") throw new Error("manifest display");
  if (!manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")) throw new Error("192 icon");
  if (!manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")) throw new Error("512 icon");
  if (!manifest.icons.some((icon) => icon.purpose === "maskable")) throw new Error("maskable icon");

  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => console.error("pageerror", error));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("console", msg.text());
  });

  await page.goto(pageUrl, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Kiln"));
  const manifestCheck = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const response = await fetch(link.href);
    const json = await response.json();
    return { ok: response.ok, type: response.headers.get("content-type"), name: json.name, display: json.display };
  });
  if (!manifestCheck.ok || manifestCheck.name !== "Kiln" || manifestCheck.display !== "standalone") {
    throw new Error(`manifest check failed ${JSON.stringify(manifestCheck)}`);
  }
  if (!manifestCheck.type?.includes("manifest+json") && !manifestCheck.type?.includes("json")) {
    throw new Error(`unexpected manifest type ${manifestCheck.type}`);
  }
  for (const icon of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"]) {
    const status = await page.evaluate(async (href) => {
      const response = await fetch(new URL(href, document.querySelector('link[rel="manifest"]').href));
      const buf = new Uint8Array(await response.arrayBuffer());
      return { ok: response.ok, png: buf[0] === 137 && buf[1] === 80 };
    }, icon);
    if (!status.ok || !status.png) throw new Error(`icon failed ${icon}`);
  }

  await page.waitForFunction(() => navigator.serviceWorker?.ready);
  let controlled = await page.evaluate(() => navigator.serviceWorker.controller != null);
  if (!controlled) {
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction(() => navigator.serviceWorker.controller != null);
  }

  await click("#nav-program");
  await click("[data-action='add-day']");
  await page.waitForSelector("[data-bind='day-name']");
  await page.type("[data-bind='day-name']", "Day A");
  await click("[data-action='add-exercise']");
  await page.waitForSelector("[data-bind^='ex-name']");
  const name = await page.$("[data-bind^='ex-name']");
  await name.click({ clickCount: 3 });
  await name.type("Example Press");
  await click("#nav-today");
  await page.waitForFunction(() => document.body.innerText.includes("Example Press"));
  const weight = await page.$("[data-field='weight']");
  await weight.click({ clickCount: 3 });
  await weight.type("100");
  await click("[data-action='log-set']");
  await page.waitForSelector("[data-logged-set]");
  const logged = await page.$eval("[data-logged-set]", (el) => el.textContent);
  if (!logged.includes("100")) throw new Error(`logged set missing weight: ${logged}`);
  await page.screenshot({ path: path.join(shotDir, "today-logged.png") });

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("Example Press"));

  await page.evaluate(() => {
    window.__downloads = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched() {
      const href = this.href;
      const name = this.download;
      const done = href?.startsWith("blob:")
        ? fetch(href).then((response) => response.text()).then((text) => window.__downloads.push({ name, text }))
        : Promise.resolve();
      return Promise.resolve(original.apply(this, arguments)).then(() => done);
    };
  });
  await click("#nav-settings");
  await page.waitForSelector("[data-action='download']");
  await click("[data-action='download']");
  await page.waitForFunction(() => window.__downloads?.length > 0);
  const exported = await page.evaluate(() => window.__downloads[0].text);
  const backup = JSON.parse(exported);
  if (backup.schemaVersion !== 1 || backup.app !== "kiln") throw new Error("export shape");
  if (!backup.sessions.some((session) => session.entries.some((entry) => entry.loadLb === 100 && entry.exerciseName === "Example Press"))) {
    throw new Error("export missing logged set");
  }
  const backupPath = path.join(shotDir, "round-trip.json");
  fs.writeFileSync(backupPath, exported);

  await click("[data-action='clear-data']");
  await page.waitForSelector("[data-action='confirm-clear']");
  await click("[data-action='confirm-clear']");
  await page.waitForFunction(() => document.body.innerText.includes("No days yet"));

  await click("#nav-settings");
  await upload("#file-json", backupPath, "[data-action='import-merge']");
  await click("[data-action='import-merge']");
  await page.waitForFunction(() => document.body.innerText.includes("Example Press"));
  await page.waitForSelector("[data-logged-set]");

  const yesterday = shift(-1);
  const suggestPath = path.join(shotDir, "suggest.json");
  fs.writeFileSync(suggestPath, JSON.stringify({
    schemaVersion: 1,
    settings: { unit: "lb", weightIncrement: 5, defaultRestSeconds: 90 },
    days: [{
      id: "day_suggest",
      name: "Day A",
      cardioNote: "",
      exercises: [{
        id: "ex_suggest",
        name: "Example Press",
        targetSets: 3,
        repMin: 6,
        repMax: 10,
        note: "",
        superset: "",
        baseWeightLb: null,
        bodyweight: false,
      }],
    }],
    sessions: [{
      id: "ses_suggest",
      date: yesterday,
      dayId: "day_suggest",
      dayName: "Day A",
      entries: [1, 2, 3].map((n) => ({
        id: `ent_suggest_${n}`,
        exerciseId: "ex_suggest",
        exerciseName: "Example Press",
        setType: "working",
        reps: 10,
        loadLb: 100,
        bodyweight: false,
        note: "",
      })),
    }],
  }));
  await click("#nav-settings");
  await click("[data-action='clear-data']");
  await page.waitForSelector("[data-action='confirm-clear']");
  await click("[data-action='confirm-clear']");
  await page.waitForFunction(() => document.body.innerText.includes("No days yet"));
  await click("#nav-settings");
  await upload("#file-json", suggestPath, "[data-action='import-replace']");
  await click("[data-action='import-replace']");
  await page.waitForFunction(() => document.body.innerText.includes("105 lb × 6"));
  await page.screenshot({ path: path.join(shotDir, "suggestion.png") });
  await click("#nav-program");
  await click("a[href^='#/day/']");
  await page.waitForSelector("[data-action='toggle-base']");
  await click("[data-action='toggle-base']");
  await page.waitForSelector("[data-bind^='ex-base']");
  const base = await page.$("[data-bind^='ex-base']");
  await base.click({ clickCount: 3 });
  await base.type("120");
  await click("#nav-today");
  await page.waitForFunction(() => document.body.innerText.includes("Under the"));
  const weightAgain = await page.$("[data-field='weight']");
  await weightAgain.click({ clickCount: 3 });
  await weightAgain.type("200");
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-plates]");
    return el && el.textContent.includes("40") && el.textContent.includes("/side");
  });

  const csvPath = path.join(shotDir, "history.csv");
  fs.writeFileSync(csvPath, [
    "date,day,exercise,set_type,sets,reps,load_lb,notes",
    `${shift(-2)},Day A,Example Press,working,2,8,95,`,
    `${shift(-2)},Day A,Example Raise,working,1,12,bodyweight,`,
  ].join("\n"));
  await click("#nav-settings");
  await upload("#file-csv", csvPath, "[data-action='import-csv-confirm']");
  await click("[data-action='import-csv-confirm']");
  await click("[data-action='history-tab'][data-tab='exercises']");
  await page.waitForFunction(() => document.body.innerText.includes("Example Raise"));

  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Kiln") && document.body.innerText.includes("Example Press"));
  await page.screenshot({ path: path.join(shotDir, "offline.png") });
  const offline = await page.evaluate(() => ({
    controlled: navigator.serviceWorker.controller != null,
    text: document.body.innerText.includes("Example Press"),
  }));
  if (!offline.controlled || !offline.text) throw new Error(`offline failed ${JSON.stringify(offline)}`);
}

async function click(selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (el) => el.click());
}

async function upload(selector, file, ready) {
  const input = await page.waitForSelector(selector);
  await input.uploadFile(file);
  try {
    await page.waitForSelector(ready, { timeout: 1500 });
  } catch {
    await page.$eval(selector, (el) => el.dispatchEvent(new Event("change", { bubbles: true })));
    await page.waitForSelector(ready);
  }
}

function shift(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
