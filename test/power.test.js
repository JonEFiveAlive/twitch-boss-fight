// End-to-end: saved levels -> power in the game loop (mocked timers, in-memory DB).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const { playerPower } = require(P + "power");

// Each check registers its own test, so every result is reported separately.
const check = (label, ok) => test(label, () => assert.ok(ok, label));
const store = openProgressStore(":memory:");
// Give three players ~4,000 XP each in their class (level 16) via a recorded fight.
store.recordFight({ bossId: "frost_wyrm", variant: "standard", outcome: "loss", rounds: 1, players:
  [["v1", "Vet Tank", "tank"], ["v2", "Vet Mage", "mage"], ["v3", "Vet Cleric", "cleric"]].map(([userId, name, classId]) =>
    ({ userId, name, classId, roundsActive: 400, damage: 0, healing: 0, revives: 0, kos: 0, daringHits: 0, finished: true })) });
const vetLevel = store.levelOf("v1", "tank");

let state;
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store });
game.handleJoin("v1", "Vet Tank", "tank");
game.handleJoin("v2", "Vet Mage", "mage");
game.handleJoin("v3", "Vet Cleric", "cleric");
check(`veterans are level ${vetLevel} (power ${playerPower(vetLevel).toFixed(3)})`, vetLevel >= 15);
check(`lobby predicts the Powerful boss (${state.projectedBossName}, ${state.projectedBossHP} HP)`, state.projectedBossName.startsWith("POWERFUL "));

game.handleJoin("n1", "Newbie", "mage");
check(`a level-1 joiner lowers the average: ${state.projectedBossName}`, state.projectedVariant === "standard" && !state.projectedBossName.startsWith("POWERFUL"));
game.handleForceStart(true);

const p = state.fight.players;
const expectedTankHp = Math.round(130 * playerPower(vetLevel));
check(`veteran Tank max HP scaled: ${p.v1.maxHp} (expected ${expectedTankHp}); newbie Mage ${p.n1.maxHp}`, p.v1.maxHp === expectedTankHp && p.n1.maxHp === 80);
check("standard boss for the mixed party (avg power below threshold)", state.fight.variant === "standard");

// A powerful-only party: restart with just the veterans and look for a two-target breath.
let state2; const game2 = createGameLoop({ on() {}, emit(_, s) { state2 = s; } }, { store });
game2.handleModCommand("!boss", "wyrm", true);
game2.handleJoin("v1", "Vet Tank", "tank"); game2.handleJoin("v2", "Vet Mage", "mage"); game2.handleJoin("v3", "Vet Cleric", "cleric");
game2.handleForceStart(true);
check("veteran party faces the Powerful boss", state2.fight.variant === "powerful" && state2.fight.bossName.startsWith("POWERFUL "));
let breath = null;
for (let i = 0; i < 400 && !breath && state2.phase !== "ended"; i++) {
  if (state2.phase === "input" && state2.nextMove?.id === "strike") breath = { move: state2.nextMove, label: state2.upcomingMoveLabel };
  for (const id of ["v1", "v2", "v3"]) if (state2.fight.players[id]?.alive) game2.handleAction(id, "defend");
  mock.timers.tick(1000);
}
check(`Powerful strike names two targets: "${breath?.label}"`, breath?.move.targetIds.length === 2);
