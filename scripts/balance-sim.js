// Balance harness: plays hundreds of full fights through the real resolveRound() and
// chooseBossMove() with scripted "chat" behaviors, and reports fight length, KOs,
// revives and wipe rate per party. Re-run after changing class kits, boss moves,
// damage numbers or power scaling (see CLAUDE.md: balance is measured, not guessed).
//
//   node scripts/balance-sim.js                       # every party, sensible + sloppy
//   node scripts/balance-sim.js --styles sensible,risky --only TMC,full --fights 500
//   node scripts/balance-sim.js --set BOSS_VARIANTS.powerful.damageMultiplier=1.1
//     (--set overrides any gameConfig value for this run only; repeatable, JSON values)
//   node scripts/balance-sim.js --boss ember_golem    # one boss (default: frost_wyrm)
//   node scripts/balance-sim.js --boss all            # every boss, one block each
//   node scripts/balance-sim.js --only "TMC,TMC @15" --exact   # exact labels, not prefixes
//   node scripts/balance-sim.js --raid --only TMC
//     (plays each party through every RAID_STAGES stage and reports the chance of
//      clearing each one and of reaching it; the party is fully restored between.
//      Raids draw on every boss, so each stage's clear chance is the average over
//      bosses, and the party's raid tier damage applies)
//
// Party members are "class@level+rarity" — level defaults to 1; "+rare" etc. equips a
// full set of that rarity (trinket as defense). A party ending in "+npcs" gets the NPC
// allies the game would give it (src/npc.js), played by npcAction() whatever the style
// (with its own NPC_ERROR_RATE slips).
// Styles:
//   sensible - reads every warning: braces for a strike (or a Tank taunts it) or a
//              chain, defends through power attacks, counters and eruptions, Clerics
//              revive, then heal (burning / hexed players first)
//   sloppy   - misses 15% of turns (-> defend) and ignores warnings on 30% of them
//   risky    - like sensible, but non-Clerics attack through counters and Power Attacks
const config = require("../src/gameConfig");

const PARTIES = {
  "TMC": ["tank", "mage", "cleric"],
  "TMMC": ["tank", "mage", "mage", "cleric"],
  "TTMMC": ["tank", "tank", "mage", "mage", "cleric"],
  "full mix (10)": ["tank", "tank", "tank", "mage", "mage", "mage", "mage", "cleric", "cleric", "cleric"],
  "MMC no tank": ["mage", "mage", "cleric"],
  "TTM no cleric": ["tank", "tank", "mage"],
  "solo tank": ["tank"],
  "solo mage": ["mage"],
  "solo cleric": ["cleric"],
  "TMC @14": ["tank@14", "mage@14", "cleric@14"],
  "TMC @15": ["tank@15", "mage@15", "cleric@15"],
  "TMC @30": ["tank@30", "mage@30", "cleric@30"],
  "TMC @50": ["tank@50", "mage@50", "cleric@50"],
  "TTMMC @50": ["tank@50", "tank@50", "mage@50", "mage@50", "cleric@50"],
  "full mix @50": ["tank@50", "tank@50", "tank@50", "mage@50", "mage@50", "mage@50", "mage@50", "cleric@50", "cleric@50", "cleric@50"],
  "TTM no cleric @50": ["tank@50", "tank@50", "mage@50"],
  "vets+new TMC": ["tank@50", "mage@1", "cleric@50"],
  "2 vets + 3 new": ["tank@50", "mage@1", "mage@1", "cleric@50", "tank@1"],
  "TMC @15+rare": ["tank@15+rare", "mage@15+rare", "cleric@15+rare"],
  "TMC @50+epic": ["tank@50+epic", "mage@50+epic", "cleric@50+epic"],
  "TTMMC @50+epic": ["tank@50+epic", "tank@50+epic", "mage@50+epic", "mage@50+epic", "cleric@50+epic"],
  "TTM no cleric @50+epic": ["tank@50+epic", "tank@50+epic", "mage@50+epic"],
  "geared vet + new TMC": ["tank@50+epic", "mage@1", "cleric@50+epic"],
  // NPC allies fill in the missing classes (see NPC_* in gameConfig.js).
  "solo tank +npcs": ["tank", "+npcs"],
  "solo mage +npcs": ["mage", "+npcs"],
  "solo cleric +npcs": ["cleric", "+npcs"],
  "TM +npcs": ["tank", "mage", "+npcs"],
  "MM +npcs": ["mage", "mage", "+npcs"],
  "solo tank @50 +npcs": ["tank@50", "+npcs"],
  "TM @50+epic +npcs": ["tank@50+epic", "mage@50+epic", "+npcs"]
};

function parseArgs(argv) {
  const opts = { styles: ["sensible", "sloppy"], only: null, fights: 300, seed: 7, sets: [], raid: false, boss: "frost_wyrm", exact: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raid") opts.raid = true;
    else if (argv[i] === "--styles") opts.styles = argv[++i].split(",");
    else if (argv[i] === "--only") opts.only = argv[++i].split(",");
    else if (argv[i] === "--fights") opts.fights = Number(argv[++i]);
    else if (argv[i] === "--seed") opts.seed = Number(argv[++i]);
    else if (argv[i] === "--set") opts.sets.push(argv[++i]);
    else if (argv[i] === "--boss") opts.boss = argv[++i];
    else if (argv[i] === "--exact") opts.exact = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// Overrides go in before the game modules load, since they copy config values at require time.
for (const assignment of opts.sets) {
  const [keyPath, raw] = assignment.split("=");
  const keys = keyPath.split(".");
  const parent = keys.slice(0, -1).reduce((obj, k) => obj[k], config);
  parent[keys[keys.length - 1]] = JSON.parse(raw);
  console.log(`override: ${keyPath} = ${raw}`);
}
const { createFight, resolveRound, raidTierFor } = require("../src/fight");
const { BOSS_IDS } = require("../src/bosses");
const { chooseBossMove } = require("../src/bossMoves");
const { playerPower } = require("../src/power");
const { gearBonuses } = require("../src/loot");
const { sensibleAction, naiveAction, npcAction, npcAlliesFor } = require("../src/npc");
const { FIRE_MP_COST, GEAR_SLOTS, LOOT_RARITIES } = config;

// A full set of one rarity (trinket rolled as defense) -> { power, defense }.
function fullSet(rarityId) {
  if (!rarityId) return { power: 0, defense: 0 };
  const factor = LOOT_RARITIES.find(r => r.id === rarityId).statFactor;
  return gearBonuses(Object.entries(GEAR_SLOTS).map(([slot, def]) => ({
    slot, rarity: rarityId, stat: def.stat === "either" ? "defense" : def.stat, value: def.max * factor
  })));
}
let seed = opts.seed;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function riskyAction(fight, id, move) {
  const p = fight.players[id];
  if (p.classId !== "cleric" && (move.id === "counter" || move.id === "power")) {
    return p.classId === "mage" && p.mp >= FIRE_MP_COST ? "fire" : "attack";
  }
  return sensibleAction(fight, id, move);
}


// "class@level+rarity" members -> createFight's roster, plus NPC allies for "+npcs".
function buildRoster(members) {
  const players = members.filter(m => m !== "+npcs").map((m, i) => {
    const [spec, rarity] = m.split("+");
    const [classId, level = "1"] = spec.split("@");
    const gear = fullSet(rarity);
    return { id: `p${i}`, name: `p${i}`, classId, power: playerPower(Number(level), gear.power), defense: gear.defense };
  });
  return members.includes("+npcs") ? [...players, ...npcAlliesFor(players)] : players;
}

function playFight(members, style, stage = null, bossId = "frost_wyrm") {
  const fight = createFight(buildRoster(members), { bossId, ...(stage ?? {}) });
  let outcome = "ongoing", kos = 0, revives = 0;
  while (outcome === "ongoing" && fight.round <= 80) {
    fight.nextMove = chooseBossMove(fight, rand);
    const actions = {};
    for (const id of Object.keys(fight.players).filter(pid => fight.players[pid].alive)) {
      if (fight.players[id].npc) {
        actions[id] = npcAction(fight, id, fight.nextMove, rand);
        continue;
      }
      const r = style === "sloppy" ? rand() : 1;
      if (r < 0.15) continue; // missed turn -> defend
      const type = r < 0.45 ? naiveAction(fight, id)
                 : style === "risky" ? riskyAction(fight, id, fight.nextMove)
                 : sensibleAction(fight, id, fight.nextMove);
      actions[id] = { type, targetId: null };
    }
    // KOs and revives count players only, so NPC parties compare with all-player ones.
    const aliveBefore = Object.keys(fight.players).filter(pid => fight.players[pid].alive && !fight.players[pid].npc);
    const res = resolveRound(fight, actions, rand);
    outcome = res.outcome;
    revives += res.resolutionEvents.filter(e => e.type === "player_revive" && !fight.players[e.targetId].npc).length;
    kos += aliveBefore.filter(pid => !fight.players[pid].alive).length;
  }
  return { rounds: fight.round - 1, outcome, kos, revives, hp: fight.bossMaxHP, variant: fight.variant };
}

const BOSS_LIST = opts.boss === "all" ? BOSS_IDS : [opts.boss];

// The raid tier this party would get (see RAID_TIERS), exactly as the game picks it.
const raidTier = (members) => raidTierFor(buildRoster(members));

if (opts.raid) {
  // Stages are independent (full restore between battles), so the chance of reaching
  // stage n is the product of the clear chances before it. Raid lineups are shuffled,
  // so a stage's clear chance is averaged over every boss.
  const bosses = process.argv.includes("--boss") ? BOSS_LIST : BOSS_IDS;
  console.log(`${opts.fights} fights per stage per boss (${bosses.join(", ")})\n`);
  console.log("party               tier    style      " + config.RAID_STAGES.map((_, i) => `  S${i + 1} clear`).join("") + "  | full clear  avg stages");
  for (const [label, members] of Object.entries(PARTIES)) {
    if (opts.only && !opts.only.some(o => (opts.exact ? label === o : label.startsWith(o)))) continue;
    const tier = raidTier(members);
    for (const style of opts.styles) {
      const clears = config.RAID_STAGES.map(stage => {
        let wins = 0;
        const scaled = { ...stage, damageMultiplier: stage.damageMultiplier * tier.damageMultiplier };
        for (const bossId of bosses) {
          for (let i = 0; i < opts.fights; i++) if (playFight(members, style, scaled, bossId).outcome === "win") wins += 1;
        }
        return wins / (opts.fights * bosses.length);
      });
      let reach = 1, expected = 0;
      for (const c of clears) { reach *= c; expected += reach; }
      console.log(`${label.padEnd(19)} ${tier.id.padEnd(7)} ${style.padEnd(9)} ` + clears.map(c => `${(100 * c).toFixed(0).padStart(8)}%`).join("") +
        `  | ${(100 * reach).toFixed(0).padStart(8)}%  ${expected.toFixed(2).padStart(9)}`);
    }
  }
  process.exit(0);
}

console.log(`${opts.fights} fights per row\n`);
for (const bossId of BOSS_LIST) {
  console.log(`=== ${bossId} ===`);
  console.log("party               variant      HP | style      rounds   KOs/fight  revives  wipe%");
  for (const [label, members] of Object.entries(PARTIES)) {
    if (opts.only && !opts.only.some(o => (opts.exact ? label === o : label.startsWith(o)))) continue;
    opts.styles.forEach((style, si) => {
      let rounds = 0, kos = 0, revives = 0, wipes = 0, first;
      for (let i = 0; i < opts.fights; i++) {
        const r = playFight(members, style, null, bossId);
        first ??= r;
        rounds += r.rounds; kos += r.kos; revives += r.revives;
        if (r.outcome !== "win") wipes += 1;
      }
      const n = opts.fights;
      const head = si === 0 ? `${label.padEnd(19)} ${first.variant.padEnd(9)} ${String(first.hp).padStart(5)}` : "".padEnd(35);
      console.log(`${head} | ${style.padEnd(9)} ${(rounds / n).toFixed(1).padStart(6)}   ${(kos / n).toFixed(2).padStart(7)}   ${(revives / n).toFixed(2).padStart(6)}  ${(100 * wipes / n).toFixed(0).padStart(4)}`);
    });
  }
  console.log();
}
