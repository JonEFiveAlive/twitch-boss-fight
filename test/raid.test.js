// Phase 7 raid flow through the real game loop (mocked timers, in-memory DB).
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
const MOD = true;
const join = (n, c) => game.handleJoin(`id-${n}`, n, c);

// Strong veterans so the raid can be cleared: ~level 30 and good gear.
const team = [["Tank", "tank"], ["Mage", "mage"], ["Cleric", "cleric"]];
store.recordFight({ bossId: "frost_wyrm", variant: "standard", outcome: "loss", rounds: 1, players: team.map(([n, c]) =>
  ({ userId: `id-${n}`, name: n, classId: c, roundsActive: 1500, damage: 0, healing: 0, revives: 0, kos: 0, daringHits: 0, finished: true })) });
for (const [n, c] of team) {
  store.awardItems(`id-${n}`, c, ["offhand", "head", "body"].map(slot =>
    ({ slot, rarity: "epic", name: `Test ${slot}`, stat: "defense", value: cfg.GEAR_SLOTS[slot].max })));
}

// "Sensible" play driven off the announced move.
function playInput() {
  const players = state.fight.players;
  const move = state.nextMove ?? {};
  const targets = move.id === "strike" || move.id === "chain" ? move.targetIds : [];
  const tankFree = players["id-Tank"]?.alive && !targets.includes("id-Tank");
  const covered = tankFree ? targets.find(t => t !== "id-Tank") : null;
  for (const [n] of team) {
    const id = `id-${n}`, p = players[id];
    if (!p?.alive) continue;
    const brace = targets.includes(id) && id !== covered;
    let action = "attack", arg = null;
    if (n === "Cleric") {
      const fallen = Object.entries(players).find(([, q]) => !q.alive);
      if (fallen && p.mp >= 30) { action = "revive"; arg = String(fallen[1].slot); }
      else if (Object.values(players).some(q => q.alive && q.hp / q.maxHp < 0.6) || move.id === "storm") action = "heal";
      else if (move.id === "power" || move.id === "counter" || move.id === "eruption" || brace) action = "defend";
    } else if (n === "Tank" && (covered || move.id === "power") && !targets.includes(id)) action = "taunt";
    else if (move.id === "power" || move.id === "counter" || move.id === "eruption" || brace) action = "defend";
    else if (n === "Mage" && p.mp >= 15) action = "fire";
    game.handleAction(id, action, arg);
  }
}
// topUp: refill HP every tick (test-only), for checks that need a battle won rather
// than testing whether it can be — even sensible veterans lose one now and then.
function runUntil(pred, { maxTicks = 20000, topUp = false } = {}) {
  let lastRound = null;
  for (let i = 0; i < maxTicks && !pred(); i++) {
    if (topUp) for (const p of Object.values(state.fight?.players ?? {})) if (p.alive) p.hp = p.maxHp;
    if (state.phase === "input" && state.fight && state.fight.round !== lastRound) { playInput(); lastRound = state.fight.round; }
    mock.timers.tick(250);
  }
}

// --- Vote gating ---
join("Viewer", "mage"); join("Viewer2", "tank");
game.handleRaidCommand("id-Viewer", "!raidvote", false);
check("raid voting is off by default: !raidvote ignored", state.mode === "skirmish" && state.raidVote.votes === 0);
game.handleRaidCommand("id-x", "!enableraidvote", false);
check("non-mods can't enable voting", state.raidVote.enabled === false);
game.handleRaidCommand("id-mod", "!enableraidvote", MOD);
game.handleRaidCommand("id-Viewer", "!raidvote", false);
game.handleRaidCommand("id-Viewer", "!raidvote", false);
check(`one vote per viewer (votes ${state.raidVote.votes}/${state.raidVote.needed})`, state.raidVote.votes === 1 && state.mode === "skirmish");
game.handleRaidCommand("id-Viewer2", "!raidvote", false);
check("reaching the vote threshold opens a raid lobby", state.mode === "raid" && state.countdownSecondsLeft >= cfg.RAID_LOBBY_SECONDS);
game.handleRaidCommand("id-mod", "!endraid", MOD);
check("!endraid in a raid lobby reverts to a skirmish lobby", state.mode === "skirmish" && state.phase === "lobby");
game.handleRaidCommand("id-mod", "!disableraidvote", MOD);

// --- !raid during a skirmish queues a raid for the next lobby ---
game.handleForceStart(MOD);
game.handleRaidCommand("id-mod", "!raid", MOD);
check("!raid mid-skirmish keeps the fight a skirmish", state.mode === "skirmish" && state.phase !== "lobby");
runUntil(() => state.phase === "lobby");
check("next lobby opens as a raid lobby", state.mode === "raid");
game.handleRaidCommand("id-mod", "!endraid", MOD);

// --- A full raid with the veteran team ---
game.handleRaidCommand("id-mod", "!raid", MOD);
for (const [n, c] of team) join(n, c);
join("Tank", "mage"); join("Tank", "tank"); // class switching still works in the raid lobby
game.handleForceStart(MOD);
check(`raid battle 1 starts: chip data ${JSON.stringify(state.raid)}`, state.raid?.stage === 1 && state.fight.variant === "powerful");
const hp1 = state.fight.bossMaxHP; const boss1 = state.fight.bossId; const lineup = state.raid.lineup.map(b => b.id);
check(`raid lineup: ${lineup.join(", ")} (every boss once, then a rematch), tier ${state.raid.tier}`, new Set(lineup.slice(0, 4)).size === 4 && lineup[4] !== lineup[3] && boss1 === lineup[0]);

join("LateViewer", "tank");
check("a mid-raid !join waits in the queue", state.queue.some(q => q.userId === "id-LateViewer"));

runUntil(() => state.phase === "intermission" || state.phase === "ended", { topUp: true });
check(`battle 1 cleared -> intermission, ${state.raid?.chests} chest banked, countdown ${state.countdownSecondsLeft}`,
  state.phase === "intermission" && state.raid.chests === 1 && !!state.fightResults);
check("no per-battle loot drops in a raid", state.fightResults.players.every(p => !p.drop));
game.handleForceStart(MOD);
check(`!startbattle skips the intermission: battle ${state.raid.stage} vs ${state.fight.bossName} (${state.fight.bossMaxHP} HP)`,
  state.raid.stage === 2 && state.phase === "input" && state.fight.bossId === lineup[1]);
check("the late joiner was not added to the raid", !state.fight.players["id-LateViewer"]);

runUntil(() => state.phase === "ended");
const rr = state.raidResults;
const expectedChests = rr.stagesCleared + (rr.outcome === "cleared" ? cfg.RAID_CLEAR_BONUS_CHESTS : 0);
check(`chests = battles cleared${rr.outcome === "cleared" ? " + clear bonus" : ""} (${rr.chests})`, rr.chests === expectedChests);
check("every raider who stayed opens one item per chest",
  rr.players.every(p => p.items.length === (p.finished ? rr.chests : 0)));
mock.timers.tick(cfg.RAID_RESULTS_SECONDS * 1000 + 500);
check("after the raid summary: a skirmish lobby, with the late joiner carried in", state.phase === "lobby" && state.mode === "skirmish" && state.joinedUsers.includes("id-LateViewer"));

// --- !endraid mid-battle opens the chests banked so far ---
game.handleRaidCommand("id-mod", "!raid", MOD);
for (const [n, c] of team) join(n, c);
game.handleForceStart(MOD);
runUntil(() => state.phase === "intermission", { topUp: true });
game.handleForceStart(MOD);
mock.timers.tick(3000);
game.handleRaidCommand("id-mod", "!endraid", MOD);
const er = state.raidResults;
check(`!endraid mid-battle: raid "${er?.outcome}", ${er?.chests} chest opened, battle XP saved`,
  state.phase === "ended" && er.outcome === "ended" && er.chests === 1 && er.players.every(p => p.items.length === (p.finished ? 1 : 0)) && er.players.filter(p => p.finished).length === 3 && !!state.fightResults);

// --- !endraid during an intermission, then a wipe ---
mock.timers.tick(cfg.RAID_RESULTS_SECONDS * 1000 + 500);
game.handleRaidCommand("id-mod", "!raid", MOD);
for (const [n, c] of team) join(n, c);
game.handleForceStart(MOD);
runUntil(() => state.phase === "intermission", { topUp: true });
game.handleRaidCommand("id-mod", "!endraid", MOD);
check(`!endraid in intermission: ${state.raidResults?.chests} chest, no extra fight recorded`,
  state.phase === "ended" && state.raidResults.chests === 1 && state.raidResults.stagesCleared === 1);
mock.timers.tick(cfg.RAID_RESULTS_SECONDS * 1000 + 500);

// Wipe: three level-1 players fighting on 1 HP against stage 1. (Only attacking is
// a valid gamble that sometimes wins, so the test doesn't rely on it losing: at
// 1 HP any hit is a KO, so the party falls long before it can deal enough damage.)
// state.fight.players is the live fight's player objects, so the test can set HP.
game.handleRaidCommand("id-mod", "!raid", MOD);
for (const n of ["A", "B", "C"]) join(n, "mage");
game.handleForceStart(MOD);
const wipeTeam = ["id-A", "id-B", "id-C"];
for (let i = 0; i < 4000 && state.phase !== "ended" && state.phase !== "intermission"; i++) {
  if (state.phase === "input") {
    for (const id of wipeTeam) {
      const p = state.fight.players[id];
      if (!p?.alive) continue;
      p.hp = 1;
      game.handleAction(id, "attack");
    }
  }
  mock.timers.tick(250);
}
check(`a party that falls wipes the raid: raid ${state.raidResults?.outcome}`, state.phase === "ended" && state.raidResults?.outcome === "wiped");
