const readline = require("readline");
const express = require("express");

// Fake users get a stable "dev-" ID so they can't collide with real numeric Twitch IDs.
function devUser(name) {
  return { userId: `dev-${name.toLowerCase()}`, displayName: name };
}

/**
 * Offline stand-in for Twitch chat. Commands arrive either as lines on stdin
 * ("JonEFive !join") or as POST /dev/chat {"user":"JonEFive","message":"!join"}.
 * Every dev user counts as a mod so !startbattle works.
 */
function startDevChat(app, onMessage, getState) {
  app.post("/dev/chat", express.json(), (req, res) => {
    const { user, message } = req.body ?? {};
    if (typeof user !== "string" || !user.trim() || typeof message !== "string") {
      return res.status(400).json({ error: 'expected JSON {"user": "...", "message": "..."}' });
    }
    const { userId, displayName } = devUser(user.trim());
    onMessage(userId, displayName, message, true);
    res.json({ ok: true });
  });

  app.get("/dev/state", (req, res) => res.json(getState()));

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const match = line.trim().match(/^(\S+)\s+(.+)$/);
    if (!match) {
      console.log("Usage: <name> <message>   e.g.  JonEFive !join");
      return;
    }
    const { userId, displayName } = devUser(match[1]);
    onMessage(userId, displayName, match[2], true);
  });

  console.log("OFFLINE MODE: Twitch chat disabled.");
  console.log("  Type '<name> <message>' here (e.g. 'JonEFive !join'),");
  console.log("  or POST /dev/chat {\"user\": \"JonEFive\", \"message\": \"!join\"}.");
  console.log("  GET /dev/state returns the latest broadcast state.");
}

module.exports = { startDevChat };
