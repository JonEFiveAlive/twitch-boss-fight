// Captures the overlay with headless Chromium so visual changes can be checked
// without OBS. One-time setup: `npm install`, then `npx playwright install chromium`.
//
//   npm run screenshot                                  -> screenshots/overlay.png
//   npm run screenshot -- --frames 6 --interval 300     -> screenshots/overlay-00.png ...
//   npm run screenshot -- --base http://localhost:3999 --round "JonEFive !taunt" "Melody !fire"
//
// --round needs a server started with --offline: it waits for an input phase, sends
// each "<user> <message>" through /dev/chat, saves overlay-locked.png, then captures
// frames from the start of the resolution animation. Everything after --round is
// treated as a command.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const opts = { base: "http://localhost:3000", out: "screenshots/overlay", frames: null, interval: null, wait: 1000, round: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--frames") opts.frames = Number(argv[++i]);
    else if (arg === "--interval") opts.interval = Number(argv[++i]);
    else if (arg === "--wait") opts.wait = Number(argv[++i]);
    else if (arg === "--round") { opts.round = argv.slice(i + 1); break; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  // A round's animation runs ~3s, so round mode defaults to a burst of frames.
  opts.frames ??= opts.round ? 14 : 1;
  opts.interval ??= opts.round ? 250 : 300;
  return opts;
}

async function getState(base) {
  const res = await fetch(`${base}/dev/state`);
  if (!res.ok) throw new Error(`${base}/dev/state returned ${res.status} — is the server running with --offline?`);
  return res.json();
}

async function waitForState(base, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(await getState(base))) return;
    await sleep(100);
  }
  throw new Error("Timed out waiting for the game to reach the expected phase");
}

async function captureFrames(page, out, frames, interval) {
  for (let i = 0; i < frames; i++) {
    const file = frames === 1 ? `${out}.png` : `${out}-${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: file });
    console.log(file);
    if (i < frames - 1) await sleep(interval);
  }
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  // channel "chromium" uses the full Chromium build rather than the separate
  // headless-shell download.
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (err) => console.log(`[overlay error] ${err.message}`));
    // The browser must be connected before a round resolves: a client that connects
    // afterwards only receives the final state, not the animation.
    await page.goto(`${opts.base}/overlay.html`, { waitUntil: "networkidle" });

    if (!opts.round) {
      await sleep(opts.wait);
      await captureFrames(page, opts.out, opts.frames, opts.interval);
      return;
    }

    await waitForState(opts.base, (s) => s.phase === "input" && s.countdownSecondsLeft >= 8);
    for (const command of opts.round) {
      const [user, ...words] = command.split(" ");
      await fetch(`${opts.base}/dev/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, message: words.join(" ") })
      });
    }
    await sleep(600);
    await page.screenshot({ path: `${opts.out}-locked.png` });
    console.log(`${opts.out}-locked.png`);

    await waitForState(opts.base, (s) => s.phase === "results");
    await captureFrames(page, opts.out, opts.frames, opts.interval);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
