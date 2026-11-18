// Stream controls through the real game loop (mocked timers, in-memory DB):
// !leave/!flee, !kick, !pause/!resume, !skip, !endbattle.
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
const join = (n, c) => game.handleJoin(`id-${n}`, n, c);
const mod = (cmd, arg = null) => game.handleModCommand(cmd, arg, true);
const tick = (s) => mock.timers.tick(s * 1000);
const toPhase = (p, max = 600) => { for (let i = 0; i < max && state.phase !== p; i++) mock.timers.tick(250); };
const ids = () => Object.keys(state.fight?.players ?? {});

// --- Lobby: leave, kick, pause ---
join("Ann", "tank"); join("Bob", "mage"); join("Cat", "cleric");
game.handleLeave("id-Bob");
check("!leave in the lobby drops out", !state.joinedUsers.includes("id-Bob") && state.joinedUsers.length === 2);
game.handleModCommand("!kick", "cat", false);
check("non-mods can't !kick", state.joinedUsers.includes("id-Cat"));
mod("!kick", "2"); // lobby slot 2 = Cat
check("!kick by lobby slot", !state.joinedUsers.includes("id-Cat"));
join("Cat", "cleric");
check("a kicked viewer can't rejoin this lobby", !state.joinedUsers.includes("id-Cat"));
game.handleLeave("id-Ann");
check(`an emptied skirmish lobby stops its countdown (${state.countdownSecondsLeft}s)`, state.countdownSecondsLeft === cfg.LOBBY_JOIN_SECONDS);
tick(30);
check("...and doesn't start an empty fight", state.phase === "lobby");

join("Ann", "tank"); join("Bob", "mage");
mod("!pause");
const before = state.countdownSecondsLeft;
tick(60);
check(`!pause freezes the lobby countdown (${before} -> ${state.countdownSecondsLeft}), paused flag sent`, state.countdownSecondsLeft === before && state.paused && state.phase === "lobby");
mod("!resume");
tick(3);
check("!resume lets it run again", state.countdownSecondsLeft === before - 3 && !state.paused);

// --- !skip starts the battle; leave/kick mid-fight; queue fill ---
mod("!pause");
mod("!skip");
check("!skip starts the battle and lifts the pause", state.phase === "input" && !state.paused);
join("Cat", "cleric");
check("the kick lasts until the next lobby (no queueing either)", !state.queue.some(q => q.userId === "id-Cat"));
join("Dan", "mage"); join("Eve", "tank");
check("late joiners queue", state.queue.length === 2);
game.handleLeave("id-Eve");
check("!leave from the queue", state.queue.length === 1);

game.handleAction("id-Ann", "attack");
game.handleLeave("id-Bob");
check(`!flee mid-fight removes the player; with everyone else locked the round hurries (${state.countdownSecondsLeft}s)`,
  !ids().includes("id-Bob") && state.countdownSecondsLeft <= 5);
toPhase("results");
check(`the round log notes it: "${state.log[0]}"`, /Bob fled/.test(state.log[0]));
toPhase("input");
check("the queued player takes the freed slot", ids().includes("id-Dan"));

mod("!pause");
const inputLeft = state.countdownSecondsLeft;
tick(40);
check("!pause holds an input round", state.phase === "input" && state.countdownSecondsLeft === inputLeft);
game.handleAction("id-Ann", "defend");
check("players can still lock in while paused", state.pendingActions["id-Ann"] === "defend");
mod("!resume");
mod("!skip");
check("!skip during input resolves the round now", state.phase === "results");

// --- !endbattle keeps earned XP ---
toPhase("input");
const roundsPlayed = state.fight.round - 1;
mod("!endbattle");
const fr = state.fightResults;
check(`!endbattle -> results screen with outcome "${fr?.outcome}" after ${fr?.rounds} rounds`, state.phase === "ended" && fr.outcome === "ended" && fr.rounds === roundsPlayed);
const bob = fr.players.find(p => p.userId === "id-Bob");
check(`players keep their XP (Ann +${fr.players.find(p => p.userId === "id-Ann").xpEarned}), the fled Bob too (+${bob?.xpEarned}, not finished)`,
  fr.players.every(p => p.xpEarned === p.roundsActive * cfg.XP_PER_ACTIVE_ROUND) && bob && !bob.finished);
check("no loot on a called-off battle", fr.players.every(p => !p.drop));
check("chat hears about it", chat.some(m => /called off/.test(m)));
mod("!skip");
check("!skip on the results screen opens the next lobby", state.phase === "lobby");
join("Cat", "cleric");
check("a kicked viewer can join again next lobby", state.joinedUsers.includes("id-Cat"));

// --- Everyone leaves mid-fight: the battle is called off ---
mod("!skip");
for (const id of state.joinedUsers.slice()) game.handleLeave(id);
for (const id of ids()) game.handleLeave(id);
check(`everyone fleeing ends the battle ("${state.fightResults?.outcome}")`, state.phase === "ended" && state.fightResults.outcome === "ended");
mod("!skip");

// --- Raids: kick a raider, leave during intermission, !endbattle = !endraid ---
game.handleRaidCommand("id-x", "!raid", true);
for (const [n, c] of [["Ann", "tank"], ["Bob", "mage"], ["Cat", "cleric"], ["Dan", "mage"]]) join(n, c);
mod("!skip");
mod("!kick", "@dan");
check("!kick removes a raider from the fight", !ids().includes("id-Dan"));
// win battle 1 quickly by draining the boss
state.fight.players; // (state is a snapshot; reach the live fight through a round)
for (let i = 0; i < 4000 && state.phase !== "intermission" && state.phase !== "ended"; i++) {
  // test-only: state.fight.players is the live object; keep the raiders topped up so battle 1 is won
  for (const p of Object.values(state.fight?.players ?? {})) p.hp = p.maxHp;
  if (state.phase === "input") for (const id of ids()) if (state.fight.players[id].alive) game.handleAction(id, id === "id-Cat" ? "heal" : "attack");
  mock.timers.tick(500);
}
check(`raid battle 1 done -> ${state.phase}`, state.phase === "intermission");
game.handleLeave("id-Bob");
mod("!pause");
tick(60);
check("!pause holds the intermission", state.phase === "intermission" && state.paused);
mod("!skip");
check("battle 2 starts without the raider who left", state.phase === "input" && state.raid.stage === 2 && !ids().includes("id-Bob") && ids().length === 2);
mod("!endbattle");
const rr = state.raidResults;
check(`!endbattle in a raid ends it: ${rr?.outcome}, ${rr?.chests} chest(s)`, state.phase === "ended" && rr.outcome === "ended" && rr.chests === 1);
const items = Object.fromEntries(rr.players.map(p => [p.name, p.items.length]));
check(`stayers open the chest, leavers/kicked don't: ${JSON.stringify(items)}`, items.Ann === 1 && items.Cat === 1 && items.Bob === 0 && items.Dan === 0);
