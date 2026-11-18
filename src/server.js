require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const tmi = require("tmi.js");
const { createGameLoop } = require("./gameLoop");
const { refreshAccessToken } = require("./twitchAuth");
const { startDevChat } = require("./devChat");
const { openProgressStore } = require("./progress");
const { DATABASE_FILE, OFFLINE_DATABASE_FILE, BOT_MESSAGE_PREFIX } = require("./gameConfig");

const PORT = process.env.PORT || 3000;
// --offline skips Twitch entirely and takes fake chat from the terminal / POST /dev/chat.
const OFFLINE = process.argv.includes("--offline");

// Offline play saves to its own database so fake chatters never touch real profiles.
const store = openProgressStore(path.join(__dirname, "..", OFFLINE ? OFFLINE_DATABASE_FILE : DATABASE_FILE));

// --- Web server (serves the overlay page + pushes live state over WebSocket) ---
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const app = express();
// no-cache = always revalidate, so a reload never runs an outdated overlay file.
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));

const server = http.createServer(app);
const io = new Server(server);

// An open overlay (e.g. an OBS browser source) never reloads on its own: after a
// server restart its socket just reconnects, and stale page code keeps running
// against the new server. Every server start or overlay file change gets a new
// version; the overlay reloads itself when the version it sees changes.
let overlayVersion = Date.now().toString(36);
io.on("connection", (socket) => socket.emit("overlayVersion", overlayVersion));
let versionDebounce = null;
fs.watch(PUBLIC_DIR, () => {
  clearTimeout(versionDebounce);
  versionDebounce = setTimeout(() => {
    overlayVersion = Date.now().toString(36);
    io.emit("overlayVersion", overlayVersion);
  }, 300);
});

// Offline mode exposes an unauthenticated command endpoint, so keep it on localhost.
server.listen(PORT, OFFLINE ? "127.0.0.1" : undefined, () => {
  console.log(`Overlay server running at http://localhost:${PORT}/overlay.html`);
  console.log(`Add that URL as an OBS Browser Source.`);
});

// --- Game loop (phases, timers, round resolution) ---
const game = createGameLoop(io, { fetchAvatar: fetchTwitchAvatar, store, announce });

// --- Twitch chat connection, using the OAuth refresh-token flow ---
let twitchClient = null;

// The bot only posts fight start/end and level-ups — chat is busy enough with commands.
function announce(text) {
  const message = BOT_MESSAGE_PREFIX ? `${BOT_MESSAGE_PREFIX} ${text}` : text;
  if (OFFLINE) {
    console.log(`[chat] ${message}`);
    return;
  }
  twitchClient?.say(process.env.TWITCH_CHANNEL, message).catch((err) => {
    console.error("Failed to post to chat:", err.message ?? err);
  });
}
let currentAccessToken = null;
let currentRefreshToken = process.env.TWITCH_REFRESH_TOKEN;

function handleChatMessage(userId, displayName, message, isMod) {
  const text = message.trim().toLowerCase();
  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ") || null;

  if (command === "!join") {
    game.handleJoin(userId, displayName, arg);
  } else if (["!attack", "!defend", "!taunt", "!fire", "!heal", "!revive"].includes(command)) {
    game.handleAction(userId, command.slice(1), arg);
  } else if (text === "!startbattle") {
    game.handleForceStart(isMod);
  } else if (["!raid", "!endraid", "!raidvote", "!enableraidvote", "!disableraidvote"].includes(text)) {
    game.handleRaidCommand(userId, text, isMod);
  } else if (["!titles", "!title", "!aura"].includes(command)) {
    // The original message keeps a title's capitals; matching ignores case anyway.
    game.handleAwardCommand(userId, displayName, command, message.trim().split(/\s+/).slice(1).join(" ") || null);
  } else if (command === "!leave" || command === "!flee") {
    game.handleLeave(userId);
  } else if (["!pause", "!resume", "!skip", "!endbattle", "!kick", "!boss", "!manualmode", "!automode",
                "!closequeue", "!closegame", "!opengame"].includes(command)) {
    game.handleModCommand(command, arg, isMod);
  }
}

function registerChatHandlers(client) {
  client.on("message", (channel, tags, message, self) => {
    if (self) return; // ignore the bot's own messages

    // Key players by Twitch's stable user ID so renames don't orphan progress;
    // the display name is only for showing on stream and !heal <name> matching.
    handleChatMessage(
      tags["user-id"],
      tags["display-name"] || tags.username,
      message,
      tags.mod || tags.badges?.broadcaster === "1"
    );
  });
}

async function connectToTwitch() {
  const tokenData = await refreshAccessToken({
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    refreshToken: currentRefreshToken
  });

  // Twitch sometimes rotates the refresh token on use — always keep the latest one
  // in memory so subsequent refreshes use it, not the original from .env.
  currentRefreshToken = tokenData.refresh_token;
  currentAccessToken = tokenData.access_token;

  if (twitchClient) {
    await twitchClient.disconnect();
  }

  twitchClient = new tmi.Client({
    options: { debug: false },
    identity: {
      username: process.env.TWITCH_BOT_USERNAME,
      password: `oauth:${tokenData.access_token}`
    },
    channels: [process.env.TWITCH_CHANNEL]
  });

  registerChatHandlers(twitchClient);

  await twitchClient.connect();
  console.log(`Connected to Twitch chat, channel: ${process.env.TWITCH_CHANNEL}`);

  // Refresh a few minutes before the token actually expires, then reconnect
  // with the new access token. expires_in is in seconds.
  const refreshInMs = Math.max((tokenData.expires_in - 300) * 1000, 60000);
  setTimeout(() => {
    connectToTwitch().catch((err) => {
      console.error("Token refresh / reconnect failed:", err.message);
    });
  }, refreshInMs);
}

async function fetchTwitchAvatar(userId) {
  if (!currentAccessToken) return null;
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(userId)}`,
      {
        headers: {
          "Authorization": `Bearer ${currentAccessToken}`,
          "Client-Id": process.env.TWITCH_CLIENT_ID,
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.profile_image_url ?? null;
  } catch {
    return null;
  }
}

if (OFFLINE) {
  startDevChat(app, handleChatMessage, game.getState);
} else {
  connectToTwitch().catch((err) => {
    console.error("Failed to connect to Twitch chat:", err.message);
    console.error("Check your .env values (client id/secret, refresh token, channel).");
  });
}
