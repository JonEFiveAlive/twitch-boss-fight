// NPC allies (src/npc.js): who fills in, how they play, the revive grace after a wipe,
// and the game loop around them (mocked timers, in-memory DB).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const { createFight, resolveRound } = require(P + "fight");
const { npcAlliesFor, npcAction } = require(P + "npc");
const cfg = require(P + "gameConfig");

const check = (label, ok) => test(label, () => assert.ok(ok, label));
const classes = (allies) => allies.map(a => a.classId).join(",");

// --- Who fills in ---
check("a solo Tank gets an NPC Cleric and Mage", classes(npcAlliesFor([{ classId: "tank" }])) === "cleric,mage");
check("a solo Cleric gets an NPC Tank and Mage", classes(npcAlliesFor([{ classId: "cleric" }])) === "tank,mage");
check("Tank + Mage get an NPC Cleric", classes(npcAlliesFor([{ classId: "tank" }, { classId: "mage" }])) === "cleric");
check("two Mages get an NPC Cleric (party of three)", classes(npcAlliesFor([{ classId: "mage" }, { classId: "mage" }])) === "cleric");
check("three players get no NPCs", npcAlliesFor([{ classId: "tank" }, { classId: "tank" }, { classId: "tank" }]).length === 0);
const vetAllies = npcAlliesFor([{ classId: "tank", power: 1.2 }, { classId: "mage", power: 1.0 }]);
check(`NPCs fight at ${cfg.NPC_POWER_SHARE} of the players' average power (${vetAllies[0].power})`,
  Math.abs(vetAllies[0].power - 1.1 * cfg.NPC_POWER_SHARE) < 0.001 && vetAllies[0].npc && vetAllies[0].id === "npc:cleric");

// --- How they play: their own life first ---
const steady = () => 0.99; // rng that never slips (see NPC_ERROR_RATE)
const slip = () => 0;      // rng that always does
const duo = () => createFight([
  { id: "t", name: "T", classId: "tank" },
  ...npcAlliesFor([{ classId: "tank", power: 1 }])
], { bossId: "frost_wyrm" });
let f = duo();
const wren = f.players["npc:cleric"];
check("the NPC Cleric is flagged and named", wren.npc && wren.name === "Sister Wren" && !f.players.t.npc);
f.players.t.hp = 20;
check("healthy, it heals the hurt player", npcAction(f, "npc:cleric", { id: "swipe" }, steady).type === "heal");
wren.hp = 12; // a worst-case swipe (enraged) is 12 × 1.25 × 0.9 = 13.5
check("a swipe that could kill it: defends instead of healing someone else",
  npcAction(f, "npc:cleric", { id: "swipe" }, steady).type === "defend");
wren.hp = 20; // a worst-case storm is 22.5, and defending doesn't reduce it
const stormChoice = npcAction(f, "npc:cleric", { id: "storm" }, steady);
check(`a storm (defend can't help) that could kill it: heals itself (${stormChoice.type} → ${stormChoice.targetId})`,
  stormChoice.type === "heal" && stormChoice.targetId === "npc:cleric");
wren.hp = wren.maxHp;
f.players.t.hp = f.players.t.maxHp;
check("with nobody hurt, it braces for a Power Attack", npcAction(f, "npc:cleric", { id: "power" }, steady).type === "defend");
f.players["npc:mage"].hp = 10;
check("an NPC Mage never fires into a counter", npcAction(f, "npc:mage", { id: "counter" }, steady).type === "defend");
check("...nor eats a strike aimed at it that could kill it",
  npcAction(f, "npc:mage", { id: "strike", targetIds: ["npc:mage"] }, steady).type === "defend");

f = duo();
f.players.t.alive = false; f.players.t.hp = 0;
f.players["npc:mage"].alive = false; f.players["npc:mage"].hp = 0;
const rev = npcAction(f, "npc:cleric", { id: "swipe" }, steady);
check(`it revives the player before the NPC (${rev.type} → ${rev.targetId})`, rev.type === "revive" && rev.targetId === "t");
check("a revive is never slipped on", npcAction(f, "npc:cleric", { id: "swipe" }, slip).type === "revive");

// --- Slips (NPC_ERROR_RATE): careless, but never fatal, never with a revive at stake ---
check(`NPCs slip now and then (NPC_ERROR_RATE ${cfg.NPC_ERROR_RATE})`, cfg.NPC_ERROR_RATE > 0 && cfg.NPC_ERROR_RATE < 0.5);
f = duo();
check("a slip: a healthy NPC Mage fires into a counter it was warned about",
  npcAction(f, "npc:mage", { id: "counter" }, slip).type === "fire" && npcAction(f, "npc:mage", { id: "counter" }, steady).type === "defend");
f.players["npc:mage"].hp = 10;
check("...even one that could kill it: a slip can be fatal", npcAction(f, "npc:mage", { id: "counter" }, slip).type === "fire");
f = duo();
f.wipeRounds = 1;
check("no slips during the revive grace", npcAction(f, "npc:mage", { id: "counter" }, slip).type === "defend");
f.players.t.alive = false; f.players.t.hp = 0;
f.players["npc:cleric"].hp = 20;
f.players["npc:cleric"].mp = 0;
const lastStand = npcAction(f, "npc:cleric", { id: "power" }, slip);
check(`the last Cleric standing never risks a lethal hit (${lastStand.type})`, ["defend", "heal"].includes(lastStand.type));

// --- The revive grace after a wipe ---
f = duo();
f.players.t.alive = false; f.players.t.hp = 0;
f.nextMove = { id: "windup" };
let r = resolveRound(f, { "npc:cleric": { type: "defend" }, "npc:mage": { type: "defend" } });
check(`every player down, an NPC Cleric up: the fight goes on (${r.outcome}) — "${r.log.at(-1)}"`,
  r.outcome === "ongoing" && /3 rounds to revive/.test(r.log.at(-1)));
for (let i = 0; i < cfg.NPC_REVIVE_GRACE_ROUNDS - 1; i++) {
  f.nextMove = { id: "windup" };
  r = resolveRound(f, { "npc:cleric": { type: "defend" } });
}
check(`...through ${cfg.NPC_REVIVE_GRACE_ROUNDS} grace rounds (${r.outcome}, "${r.log.at(-1)}")`, r.outcome === "ongoing" && /1 round left/.test(r.log.at(-1)));
f.nextMove = { id: "windup" };
r = resolveRound(f, { "npc:cleric": { type: "defend" } });
check(`...then, with nobody revived, it's lost (${r.outcome})`, r.outcome === "loss");

f = duo();
f.players.t.alive = false; f.players.t.hp = 0;
f.nextMove = { id: "windup" };
resolveRound(f, {});
f.nextMove = { id: "windup" };
r = resolveRound(f, { "npc:cleric": { type: "revive", targetId: "t" } });
check(`a revive within the grace saves the fight (${r.outcome}, wipeRounds ${f.wipeRounds})`, r.outcome === "ongoing" && f.wipeRounds === 0 && f.players.t.alive);

f = createFight([{ id: "c", name: "C", classId: "cleric" }, ...npcAlliesFor([{ classId: "cleric", power: 1 }])], { bossId: "frost_wyrm" });
f.players.c.alive = false; f.players.c.hp = 0;
f.nextMove = { id: "windup" };
r = resolveRound(f, {});
check(`no NPC Cleric to revive: every player down is a loss (${r.outcome})`, r.outcome === "loss");

// --- The game loop ---
const store = openProgressStore(":memory:");
const chat = [];
let state;
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store, announce: (m) => chat.push(m) });
const mod = (cmd, arg = null) => game.handleModCommand(cmd, arg, true);
const toPhase = (p, max = 600) => { for (let i = 0; i < max && state.phase !== p; i++) mock.timers.tick(250); };
const players = () => state.fight?.players ?? {};

game.handleJoin("id-ann", "Ann", "tank");
check(`the lobby previews the NPC allies (${classes(state.npcAllies)}) and the Standard boss (${state.projectedVariant})`,
  classes(state.npcAllies) === "cleric,mage" && state.projectedVariant === "standard");
mod("!skip");
check(`the battle starts with them: ${Object.values(players()).map(p => p.name).join(", ")}`,
  players()["npc:cleric"]?.npc && players()["npc:mage"]?.npc && state.fight.variant === "standard");
check(`chat hears who joins in: "${chat.at(-1)}"`, /Sister Wren \(Cleric\) and Pell \(Mage\) join in/.test(chat.at(-1)));
check(`NPCs lock in as the round opens (${state.pendingActions["npc:cleric"]}, ${state.pendingActions["npc:mage"]})`,
  state.pendingActions["npc:cleric"] && state.pendingActions["npc:mage"] && !state.pendingActions["id-ann"]);
check("NPCs have names for the overlay, but no level", state.playerNames["npc:cleric"] === "Sister Wren" && !("npc:cleric" in state.playerLevels));
check(`a full input window while a player stands (${state.countdownSecondsLeft}s)`, state.countdownSecondsLeft === cfg.INPUT_WINDOW_SECONDS);

// Ann falls (as if to the boss): the NPC Cleric gets its grace, on short rounds.
players()["id-ann"].alive = false; players()["id-ann"].hp = 0;
toPhase("results"); toPhase("input");
check(`with only NPCs standing, rounds are short (${state.countdownSecondsLeft}s) and the overlay hears of the grace (${JSON.stringify(state.fight.reviveGrace)})`,
  state.countdownSecondsLeft === cfg.NPC_ONLY_INPUT_SECONDS && state.fight.reviveGrace?.name === "Sister Wren");
check(`...and Sister Wren goes for the revive (${state.pendingActions["npc:cleric"]} → ${state.pendingTargets["npc:cleric"]})`,
  ["revive", "defend", "heal"].includes(state.pendingActions["npc:cleric"]));
mod("!endbattle");
const results = state.fightResults?.players ?? [];
check(`results and XP are for players only (${results.map(p => p.name).join(", ")})`,
  results.length === 1 && results[0].userId === "id-ann");

// Off and on again.
mod("!skip");
mod("!npcs", "off");
check(`!npcs off: ${chat.at(-1)}`, /off/.test(chat.at(-1)) && state.npcAlliesOn === false);
game.handleJoin("id-ann", "Ann", "tank");
check(`...the lobby has no allies and a Lesser boss (${state.projectedVariant})`, state.npcAllies.length === 0 && state.projectedVariant === "lesser");
mod("!skip");
check("...and the battle is players only", Object.keys(players()).join() === "id-ann");
mod("!npcs", "on");
check("!npcs on: a fight in progress keeps its roster", Object.keys(players()).length === 1);
mod("!endbattle"); mod("!skip");

// The last player leaving ends the battle, even with NPCs standing.
game.handleJoin("id-ann", "Ann", "mage");
mod("!skip");
check("NPCs are back for the next battle", Object.keys(players()).length === 3);
game.handleLeave("id-ann");
check(`the last player fleeing calls the battle off (${state.phase})`, state.phase === "ended");
mod("!skip");

// Raids: NPC allies are locked in with the party and come back each battle.
game.handleRaidCommand("x", "!raid", true);
game.handleJoin("id-ann", "Ann", "tank"); game.handleJoin("id-bob", "Bob", "mage");
mod("!skip");
check(`a raid with an NPC Cleric (tier ${state.raid.tier})`, players()["npc:cleric"]?.npc && state.raid.tier === "normal");
for (let i = 0; i < 200 && state.phase !== "intermission" && state.phase !== "ended"; i++) {
  if (state.phase === "input") {
    for (const id of ["id-ann", "id-bob"]) if (players()[id]?.alive) game.handleAction(id, id === "id-bob" ? "fire" : "attack");
    mod("!skip");
  }
  mock.timers.tick(250);
}
check(`raid battle 1 ends (${state.phase})`, state.phase === "intermission" || state.phase === "ended");
if (state.phase === "intermission") {
  game.handleForceStart(true);
  check(`raid battle 2 brings the NPC back (${Object.values(players()).map(p => p.name).join(", ")}; stage ${state.raid.stage}, alive ${players()["npc:cleric"]?.alive})`,
    state.raid.stage === 2 && players()["npc:cleric"]?.alive);
}
