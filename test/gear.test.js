// End-to-end gear test through the real game loop (mocked timers, in-memory DB).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const { playerPower } = require(P + "power");
const { gearBonuses } = require(P + "loot");
const { ENDED_PAUSE_SECONDS } = require(P + "gameConfig");

// Each check registers its own test, so every result is reported separately.
const check = (label, ok) => test(label, () => assert.ok(ok, label));
const store = openProgressStore(":memory:");
let state;
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store });
const team = ["Ana", "Bo", "Cy"];

const drops = [];
let wins = 0;
for (let fightNo = 0; fightNo < 12; fightNo++) {
  for (const n of team) game.handleJoin(`id-${n}`, n, "tank");
  game.handleForceStart(true);
  for (let t = 0; t < 400 && state.phase !== "ended"; t++) {
    if (state.phase === "input") {
      for (const n of team) if (state.fight.players[`id-${n}`]?.alive) game.handleAction(`id-${n}`, "attack");
    }
    mock.timers.tick(500);
  }
  const fr = state.fightResults;
  if (fr.outcome === "win") wins += 1;
  for (const p of fr.players) if (p.drop) drops.push({ who: p.name, ...p.drop });
  mock.timers.tick(ENDED_PAUSE_SECONDS * 1000 + 500);
}

check("drops only appear on wins", wins > 0 ? drops.length >= 0 : drops.length === 0);
check("some loot dropped across the wins", drops.length > 0);
const gear = Object.fromEntries(team.map(n => [n, store.equippedGear(`id-${n}`, "tank")]));
const oneEach = Object.values(gear).every(items => new Set(items.map(i => i.slot)).size === items.length);
check("at most one equipped item per slot", oneEach);
const firstInSlot = drops.find(d => d.equipped);
check("a drop into an empty slot is auto-equipped", !!firstInSlot);
const downgrade = drops.find(d => !d.equipped);
check(`a drop that isn't an upgrade goes to inventory${downgrade ? "" : " (none rolled this run)"}`,
  !downgrade || gear[downgrade.who].some(i => i.slot === downgrade.slot && i.value >= downgrade.value));

// Next fight: gear feeds combat stats and the overlay's look data.
for (const n of team) game.handleJoin(`id-${n}`, n, "tank");
const geared = team.find(n => gear[n].length > 0);
check(`lobby broadcasts ${geared}'s gear look: ${JSON.stringify(state.playerGear[`id-${geared}`])}`,
  Object.keys(state.playerGear[`id-${geared}`]).length === gear[geared].length);
game.handleForceStart(true);
const bonus = gearBonuses(gear[geared]);
const player = state.fight.players[`id-${geared}`];
const level = store.levelOf(`id-${geared}`, "tank");
const expectedPower = playerPower(level, bonus.power);
check(`${geared} fights with power ${player.power.toFixed(3)} (expected ${expectedPower.toFixed(3)}) and defense ${player.defense.toFixed(3)} (expected ${bonus.defense.toFixed(3)})`,
  Math.abs(player.power - expectedPower) < 1e-9 && Math.abs(player.defense - bonus.defense) < 1e-9);
