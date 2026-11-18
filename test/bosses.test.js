// Phase 8: signature mechanics, elements, boss choice and raid tiers.
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { createFight, resolveRound, bossHpForParty } = require(P + "fight");
const { chooseBossMove, describeMove, moveTitle } = require(P + "bossMoves");
const { findBoss } = require(P + "bosses");
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const cfg = require(P + "gameConfig");
// Each check registers its own test, so every result is reported separately.
const check = (label, ok) => test(label, () => assert.ok(ok, label));
const TMC = [{ id: "t", name: "Tank", classId: "tank" }, { id: "m", name: "Mage", classId: "mage" }, { id: "c", name: "Cleric", classId: "cleric" }];
const ids = ["t", "m", "c"];

// --- Eruption burns non-defenders; a heal douses it ---
let f = createFight(TMC, { bossId: "ember_golem" });
f.nextMove = { id: "eruption" };
let r = resolveRound(f, { t: { type: "defend" }, m: { type: "attack" }, c: { type: "attack" } });
check(`eruption: defender unburnt, others burning (t ${f.players.t.burn}, m ${f.players.m.burn}, c ${f.players.c.burn})`,
  f.players.t.burn === 0 && f.players.m.burn === cfg.BURN_ROUNDS && f.players.c.burn === cfg.BURN_ROUNDS);
const mageHp = f.players.m.hp;
f.nextMove = { id: "swipe" };
r = resolveRound(f, { t: { type: "attack" }, m: { type: "defend" }, c: { type: "heal", targetId: "c" } });
const tick = r.resolutionEvents.find(e => e.type === "status_tick");
check(`burn ticks on the Mage (${tick?.hits.map(h => `${h.userId}:${h.damage}`).join(", ")}), healed Cleric is doused first`,
  tick.hits.some(h => h.userId === "m" && h.status === "burn") && !tick.hits.some(h => h.userId === "c") && f.players.c.burn === 0);
check(`heal event reports the cleanse: ${JSON.stringify(r.resolutionEvents.find(e => e.type === "player_heal").cleansed)}`,
  r.resolutionEvents.find(e => e.type === "player_heal").cleansed[0] === "burn");
check(`burn counts down (${f.players.m.burn} left)`, f.players.m.burn === cfg.BURN_ROUNDS - 1);

// --- Elements: fire weak vs Wyrm, resisted by Golem; holy vs Lich ---
const hit = (bossId, who, type) => {
  const fx = createFight(TMC, { bossId });
  fx.nextMove = { id: "swipe" };
  const rx = resolveRound(fx, { [who]: { type } });
  return rx.resolutionEvents.find(e => e.type === "player_attack");
};
const fireW = hit("frost_wyrm", "m", "fire"), fireG = hit("ember_golem", "m", "fire"), holyL = hit("shadow_lich", "c", "attack"), physR = hit("storm_roc", "t", "attack");
check(`Fire: ${fireW.damageToBoss} vs Wyrm (${fireW.element}), ${fireG.damageToBoss} vs Golem (${fireG.element}); Cleric holy vs Lich ${holyL.damageToBoss} (${holyL.element}); Tank vs Roc ${physR.damageToBoss} (${physR.element})`,
  fireW.damageToBoss === 31 && fireW.element === "weak" && fireG.damageToBoss === 15 && fireG.element === "resist" && holyL.damageToBoss === 10 && physR.damageToBoss === 12);
check(`boss HP follows weaknesses: TMC vs Wyrm ${bossHpForParty(TMC, "frost_wyrm")}, Golem ${bossHpForParty(TMC, "ember_golem")}, Lich ${bossHpForParty(TMC, "shadow_lich")}`,
  bossHpForParty(TMC, "ember_golem") < bossHpForParty(TMC, "frost_wyrm"));

// --- Hex: single target, skips the hexed, lifted by heal; Lesser never hexes ---
f = createFight(TMC, { bossId: "shadow_lich" });
f.nextMove = { id: "curse", targetIds: ["m"] };
r = resolveRound(f, { t: { type: "attack" }, m: { type: "attack" }, c: { type: "attack" } });
check(`curse lands on the Mage (${f.players.m.curse} rounds)`, f.players.m.curse === cfg.CURSE_ROUNDS);
let pickedHexed = false, rngSeed = 1;
const rng = () => ((rngSeed = (rngSeed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 400; i++) {
  f.lastMoveId = "swipe";
  const mv = chooseBossMove(f, rng);
  if (mv.id === "curse" && mv.targetIds.includes("m")) pickedHexed = true;
}
check("the Lich never re-hexes a hexed player", !pickedHexed);
f.nextMove = { id: "swipe" };
r = resolveRound(f, { c: { type: "heal" } }); // untargeted: afflicted first
check(`an untargeted heal finds the hexed Mage and lifts it (curse ${f.players.m.curse})`,
  r.resolutionEvents.find(e => e.type === "player_heal").targetId === "m" && f.players.m.curse === 0);
const lesser = createFight([TMC[0], TMC[1]], { bossId: "shadow_lich" });
let lesserHex = false;
for (let i = 0; i < 500; i++) { lesser.lastMoveId = "swipe"; if (chooseBossMove(lesser, rng).id === "curse") lesserHex = true; }
check(`Lesser Lich (${lesser.variant}, no Cleric) never casts the Hex`, lesser.variant === "lesser" && !lesserHex);

// --- Chain: adjacent run, defend softens, taunt doesn't help ---
const ten = Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, classId: i === 0 ? "tank" : i < 6 ? "mage" : "cleric" }));
f = createFight(ten, { bossId: "storm_roc" });
let chain;
for (let i = 0; i < 200 && !chain; i++) { f.lastMoveId = "swipe"; const mv = chooseBossMove(f, rng); if (mv.id === "chain") chain = mv; }
const slots = chain.targetIds.map(id => f.players[id].slot);
check(`chain targets adjacent slots ${slots.join(",")} (${chain.targetIds.length} of 10)`,
  chain.targetIds.length === Math.round(10 * cfg.CHAIN_SHARE) && slots.every((s, i) => i === 0 || s === slots[i - 1] % 10 + 1));
f.nextMove = chain;
const acts = Object.fromEntries(ten.map(p => [p.id, { type: "attack" }]));
acts[chain.targetIds[0]] = { type: "defend" };
acts.p1 = { type: "taunt" };
r = resolveRound(f, acts);
const ch = r.resolutionEvents.find(e => e.type === "boss_chain");
check(`chain hits every marked slot; the defender takes ${ch.hits[0].damage}, others ${ch.hits[1].damage}; no taunt cover`,
  ch.hits.length === chain.targetIds.length && ch.hits[0].defended && ch.hits[0].damage < ch.hits[1].damage);

// --- Name lookup ---
check(`findBoss: golem→${findBoss("golem")}, "Storm Roc"→${findBoss("storm roc")}, lich→${findBoss("lich")}, ice→${findBoss("ice")}`,
  findBoss("golem") === "ember_golem" && findBoss("storm roc") === "storm_roc" && findBoss("lich") === "shadow_lich" && findBoss("ice") === null);

// --- Game loop: random no-repeat, !boss, raid tiers ---
let state;
const store = openProgressStore(":memory:");
const chat = [];
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store, announce: m => chat.push(m) });
const mod = (c, a = null) => game.handleModCommand(c, a, true);
check(`lobby shows a boss: ${state.boss?.name} (${state.boss?.biome}, weak ${state.boss?.weak}, resists ${state.boss?.resists})`, !!state.boss?.name && !!state.boss.biome);
mod("!boss", "roc");
check(`!boss in a lobby switches it now: ${state.boss.name}`, state.boss.id === "storm_roc" && chat.at(-1).includes("Storm Roc"));
game.handleJoin("a", "A", "tank");
mod("!skip");
check(`the fight is against it (${state.fight.bossName})`, state.fight.bossId === "storm_roc");
mod("!boss", "lich");
mod("!endbattle"); mod("!skip");
check(`!boss mid-fight sets the next lobby's boss: ${state.boss.name}`, state.boss.id === "shadow_lich");
let repeats = 0, last = "shadow_lich", seen = new Set();
for (let i = 0; i < 40; i++) {
  game.handleJoin("a", "A", "tank"); mod("!skip"); mod("!endbattle"); mod("!skip");
  if (state.boss.id === last) repeats += 1;
  seen.add(state.boss.id); last = state.boss.id;
}
check(`random skirmish bosses never repeat back-to-back (${repeats} repeats, ${seen.size} bosses seen)`, repeats === 0 && seen.size === 4);

// Mythic tier: veterans with great gear.
store.recordFight({ bossId: "frost_wyrm", variant: "standard", outcome: "loss", rounds: 1, players:
  ["v1", "v2", "v3"].map((userId, i) => ({ userId, name: userId, classId: ["tank", "mage", "cleric"][i], roundsActive: 2500, damage: 0, healing: 0, revives: 0, kos: 0, daringHits: 0, finished: true })) });
for (const [u, c] of [["v1", "tank"], ["v2", "mage"], ["v3", "cleric"]]) {
  store.awardItems(u, c, [{ slot: "weapon", rarity: "epic", name: "W", stat: "power", value: 0.1 }]);
}
game.handleRaidCommand("x", "!raid", true);
game.handleJoin("v1", "V1", "tank"); game.handleJoin("v2", "V2", "mage");
check(`raid lobby with no Cleric: tier ${state.raid.tier}`, state.raid.tier === "normal");
game.handleJoin("v3", "V3", "cleric");
check(`raid lobby previews tier ${state.raid.tier} and lineup ${state.raid.lineup.map(b => b.name).join(" → ")}`, state.raid.tier === "mythic" && state.raid.lineup.length === 5);
mod("!skip");
check(`mythic raid battle 1: ${state.fight.bossName}, boss ×${cfg.RAID_TIERS[0].damageMultiplier} damage`, state.raid.tier === "mythic");
