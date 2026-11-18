// Manual start, !closegame / !opengame, !closequeue (mocked timers, in-memory DB).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const cfg = require(P + "gameConfig");

// Each check registers its own test, so every result is reported separately.
const check = (label, ok) => test(label, () => assert.ok(ok, label));
const store = openProgressStore(":memory:");
const chat = [];
let state;
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store, announce: (m) => chat.push(m) });
const join = (n, c = "mage") => game.handleJoin(`id-${n}`, n, c);
const mod = (cmd, arg = null) => game.handleModCommand(cmd, arg, true);
const tick = (s) => mock.timers.tick(s * 1000);
const ids = () => Object.keys(state.fight?.players ?? {});
// Plays rounds with everyone attacking until the phase changes to one of `phases`.
function playUntil(phases, maxTicks = 6000) {
  for (let i = 0; i < maxTicks && !phases.includes(state.phase); i++) {
    for (const p of Object.values(state.fight?.players ?? {})) p.hp = p.maxHp; // test-only: never wipe
    if (state.phase === "input") for (const id of ids()) game.handleAction(id, "attack");
    mock.timers.tick(250);
  }
}

// --- Manual start ---
mod("!manualmode");
join("Ann", "tank");
tick(120);
check("manual mode: the lobby doesn't count down", state.phase === "lobby" && state.manualStart);
game.handleRaidCommand("id-m", "!raid", true);
tick(120);
check("manual mode: a raid lobby waits too", state.phase === "lobby" && state.mode === "raid");
game.handleRaidCommand("id-m", "!endraid", true);
game.handleForceStart(true);
check("!startbattle starts it", state.phase === "input");
mod("!endbattle");
mod("!skip");
check("the next lobby still waits", state.phase === "lobby" && state.manualStart);
join("Ann", "tank");
mod("!automode");
check(`!automode starts the countdown in an open lobby (${state.countdownSecondsLeft}s)`, !state.manualStart && state.countdownSecondsLeft === cfg.LOBBY_JOIN_SECONDS);
tick(cfg.LOBBY_JOIN_SECONDS + 1);
check("...and the battle starts on its own", state.phase === "input");
mod("!endbattle"); mod("!skip");

// --- !closegame in a lobby closes now ---
join("Ann", "tank");
join("Bob");
mod("!closegame");
check("!closegame in a lobby closes the game now", state.phase === "closed" && state.joinedUsers.length === 0);
join("Cat");
tick(120);
check("closed: !join is ignored and nothing starts", state.phase === "closed" && state.joinedUsers.length === 0 && state.queue.length === 0);
check("closed state carries the leaderboard for the overlay", Array.isArray(state.leaderboard));
mod("!opengame");
check("!opengame opens a fresh lobby", state.phase === "lobby" && !state.lastCall);
join("Cat");
check("joins work again", state.joinedUsers.includes("id-Cat"));

// --- !closegame mid-fight: the fight plays out, the queue is cleared, then closed ---
mod("!skip");
join("Dan"); join("Eve");
mod("!closegame");
check("!closegame mid-fight clears the queue and blocks joins", state.queue.length === 0 && state.lastCall && state.phase !== "closed");
join("Fay");
check("...new joins are ignored", state.queue.length === 0);
playUntil(["ended"]);
check(`the battle finishes normally (${state.fightResults?.outcome})`, state.fightResults?.outcome === "win");
tick(cfg.ENDED_PAUSE_SECONDS + 1);
check("after the results screen: closed, not a new lobby", state.phase === "closed");
mod("!opengame");

// --- !closequeue: queued players still play, then it closes ---
for (let i = 1; i <= 10; i++) join(`P${i}`);
join("Q1"); join("Q2");
check("party full: two queued", state.queue.length === 2);
mod("!closequeue");
join("Late");
check("!closequeue: new joins are refused", state.queue.length === 2 && state.lastCall);
join("Q1", "tank");
check("...but a queued viewer can still switch class", state.queue.find(q => q.userId === "id-Q1").classId === "tank");
game.handleRaidCommand("id-P1", "!enableraidvote", true);
game.handleRaidCommand("id-P1", "!raidvote", false);
check("raid votes are off during last call", state.raidVote.votes === 0);
mod("!skip");
mod("!kick", "P1"); mod("!kick", "P2"); mod("!kick", "P3"); // free three slots
playUntil(["results"]);
playUntil(["input"]);
check(`the queue drains into the fight mid-battle (${ids().filter(id => /Q/.test(id)).length} queued players in)`, ids().includes("id-Q1") && ids().includes("id-Q2"));
playUntil(["ended"]);
tick(cfg.ENDED_PAUSE_SECONDS + 1);
check("queue empty + battle done: the game is closed", state.phase === "closed");

// --- Last call carries a remaining queue into one more lobby ---
mod("!opengame");
for (let i = 1; i <= 10; i++) join(`R${i}`);
join("S1"); join("S2");
mod("!skip"); // 10 fighting, 2 queued
mod("!closequeue");
mod("!endbattle"); // no slots ever freed
tick(cfg.ENDED_PAUSE_SECONDS + 1);
check("the queued players get one more lobby", state.phase === "lobby" && state.joinedUsers.length === 2 && state.lastCall);
join("Nope");
check("still no new joins in that lobby", state.joinedUsers.length === 2);
game.handleLeave("id-S1"); game.handleLeave("id-S2");
check("everyone leaving a last-call lobby closes the game", state.phase === "closed");

// --- !opengame during last call cancels it ---
mod("!opengame");
join("Ann"); mod("!skip");
mod("!closequeue");
mod("!opengame");
join("Zed");
check("!opengame mid-fight cancels last call: joins queue again", !state.lastCall && state.queue.some(q => q.userId === "id-Zed"));

// --- Server can start closed ---
cfg.GAME_OPEN_ON_START = false;
delete require.cache[require.resolve(P + "gameLoop")];
let s2;
require(P + "gameLoop").createGameLoop({ on() {}, emit(_, s) { s2 = s; } }, { store });
check("GAME_OPEN_ON_START false: the server starts closed", s2.phase === "closed");
