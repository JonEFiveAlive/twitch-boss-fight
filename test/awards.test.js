// Awards: tiers, titles, auras, frames, chat commands, raid clears and the upgrade
// backfill (mocked timers, in-memory or temp-file DBs).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const P = "../src/";
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const { TRACKS, tierFor, cosmeticsFor, matchName } = require(P + "achievements");

// Each check registers its own test, so every result is reported separately.
const check = (label, ok) => test(label, () => assert.ok(ok, label));

// A fight summary for one player (wins it unless outcome says otherwise).
const fightFor = (userId, name, extra = {}, bossId = "frost_wyrm", outcome = "win") => ({
  bossId, variant: "standard", outcome, rounds: 12, players: [{ userId, name, classId: "cleric",
    roundsActive: 12, damage: 0, healing: 0, revives: 0, kos: 0, daringHits: 0, finished: true, ...extra }]
});

// --- Pure helpers ---
const wyrm = TRACKS.find(t => t.id === "frost_wyrm");
check("tierFor: 9 → none, 10 → bronze, 99 → gold, 100 → legendary",
  tierFor(wyrm, 9) === -1 && tierFor(wyrm, 10) === 0 && tierFor(wyrm, 99) === 2 && tierFor(wyrm, 100) === 3);
const cos = cosmeticsFor([{ trackId: "revives", tier: 1, earnedAt: "a" }, { trackId: "frost_wyrm", tier: 3, earnedAt: "b" }]);
check(`auto shows the best: "${cos.title}", aura ${cos.aura}, frame ${cos.frame}; lower tiers stay owned (${cos.titles.length} titles)`,
  cos.title === "Wyrm Sovereign" && cos.aura === "frostbound" && cos.frame === "legendary" &&
  cos.titles.some(t => t.title === "Frostbreaker") && cos.titles.some(t => t.title === "Medic"));
check("matchName: prefix and partial, ambiguous → null",
  matchName("wyrm s", ["Wyrmslayer", "Wyrm Sovereign"]) === "Wyrm Sovereign" && matchName("slay", ["Wyrmslayer"]) === "Wyrmslayer" &&
  matchName("wyrm", ["Wyrmslayer", "Wyrm Sovereign"]) === null);

// --- Store: earning tiers once ---
const store = openProgressStore(":memory:");
for (let i = 0; i < 9; i++) store.recordFight(fightFor("u1", "Ann"));
check("9 wins: no Frost Wyrm title yet", store.checkAwards(["u1"]).every(a => a.trackId !== "frost_wyrm"));
store.recordFight(fightFor("u1", "Ann"));
const tenth = store.checkAwards(["u1"]);
check(`10th win earns Frostbreaker (${JSON.stringify(tenth)})`, tenth.some(a => a.trackId === "frost_wyrm" && a.tier === 0));
check("an earned tier isn't awarded twice", store.checkAwards(["u1"]).length === 0);

// --- Game loop: awards after a fight, chat + results ---
let state;
const chat = [];
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store, announce: (m) => chat.push(m) });
const mod = (c, a = null) => game.handleModCommand(c, a, true);
for (let i = 0; i < 14; i++) store.recordFight(fightFor("u2", "Bob", { revives: 3 }, "ember_golem", "loss"));
// Bob has 42 revives (bronze Medic: 10); his next fight's check announces it.
game.handleJoin("u2", "Bob", "cleric");
mod("!skip");
mod("!endbattle");
const fr = state.fightResults;
check(`a called-off fight still checks awards: ${JSON.stringify(fr.awards?.map(a => a.title))}`, fr.awards?.some(a => a.title === "Medic"));
check(`chat hears it: "${chat.find(m => m.includes("Medic"))}"`, chat.some(m => m.includes('"Medic"')));
check("the overlay gets Bob's cosmetics", state.playerCosmetics?.u2?.title === "Medic" && state.playerCosmetics.u2.frame === "bronze");
mod("!skip");

// --- Chat commands ---
store.recordFight(fightFor("u2", "Bob", { daringHits: 30 }));
store.checkAwards(["u2"]);
game.handleAwardCommand("u2", "Bob", "!title", "bold");
game.handleJoin("u2", "Bob", "cleric");
check(`!title bold switches it: ${state.playerCosmetics.u2.title}`, state.playerCosmetics.u2.title === "Bold");
game.handleAwardCommand("u2", "Bob", "!title", "Wyrm Sovereign");
check("an unearned title is ignored (the choice stays)", state.playerCosmetics.u2.title === "Bold");
game.handleAwardCommand("u2", "Bob", "!title", "off");
check("!title off hides it (the frame stays)", !state.playerCosmetics.u2.title && state.playerCosmetics.u2.frame === "bronze");
game.handleAwardCommand("u2", "Bob", "!title", "auto");
check(`!title auto goes back to the best: ${state.playerCosmetics.u2.title}`, ["Medic", "Bold"].includes(state.playerCosmetics.u2.title));
const before = chat.length;
game.handleAwardCommand("u2", "Bob", "!titles", null);
game.handleAwardCommand("u2", "Bob", "!titles", null);
check(`!titles posts once per cooldown: "${chat[before]}"`, chat.length === before + 1 && chat[before].includes("Medic") && chat[before].includes("Bold"));
game.handleAwardCommand("u3", "Newbie", "!titles", null);

// --- Legendary: an aura, chosen and cleared ---
for (let i = 0; i < 100; i++) store.recordFight(fightFor("u4", "Cat", {}, "storm_roc"));
const legend = store.checkAwards(["u4"]);
check(`100 Storm Rocs: legendary "${legend.find(a => a.trackId === "storm_roc")?.tier === 3 ? "Thunderborn" : "?"}"`,
  legend.some(a => a.trackId === "storm_roc" && a.tier === 3));
game.handleJoin("u4", "Cat", "tank");
check(`legendary shows the Stormcaller aura and a legendary frame (${JSON.stringify(state.playerCosmetics.u4)})`,
  state.playerCosmetics.u4.aura === "stormcaller" && state.playerCosmetics.u4.frame === "legendary");
game.handleAwardCommand("u4", "Cat", "!aura", "off");
check("!aura off removes it", !state.playerCosmetics.u4.aura);
game.handleAwardCommand("u4", "Cat", "!aura", "storm");
check("!aura storm puts it back", state.playerCosmetics.u4.aura === "stormcaller");
game.handleAwardCommand("u4", "Cat", "!aura", "halo");
check("an unearned aura is ignored", state.playerCosmetics.u4.aura === "stormcaller");

// --- Raid clears count toward the raid tracks ---
store.recordRaidClear(["u4"], "mythic");
const raidAwards = store.checkAwards(["u4"]);
check(`a Mythic clear earns Raider and Mythbreaker (${raidAwards.map(a => a.trackId).join(", ")})`,
  raidAwards.some(a => a.trackId === "raids" && a.tier === 0) && raidAwards.some(a => a.trackId === "mythic" && a.tier === 0));

// --- Upgrading a v2 database credits history silently ---
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bossfight-")), "old.db");
const old = openProgressStore(file);
for (let i = 0; i < 25; i++) old.recordFight(fightFor("v1", "Vet"));
old.close();
const raw = new DatabaseSync(file);
raw.exec("DROP TABLE achievements; PRAGMA user_version = 2;");
raw.close();
const upgraded = openProgressStore(file);
check(`reopening a v2 database backfills earned tiers (${upgraded.cosmetics("v1").title})`,
  upgraded.cosmetics("v1").title === "Wyrmslayer");
check("...without leaving them to be announced later", upgraded.checkAwards(["v1"]).length === 0);
upgraded.close();
