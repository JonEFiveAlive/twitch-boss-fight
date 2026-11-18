// All the "placeholder numbers" from the design doc live here so they're easy to
// tune in one place without hunting through game logic.

module.exports = {
  // Classes (Phase 3). `actions` lists the commands each class may use; anything
  // else a player types is ignored and their previous choice stays locked in.
  // Key order is also the tie-break order when plain !join auto-assigns a class.
  // `expectedDamage` is the boss damage per round the class actually averages when
  // played sensibly (defending through telegraphs, Mages using Fire, Clerics mostly
  // healing) — measured by simulation, not derived from `attack`. It sizes boss HP.
  // Re-measure if class kits or boss moves change.
  CLASSES: {
    tank:   { maxHp: 130, maxMp: 0,  mpRegen: 0, attack: 10, expectedDamage: 6,  actions: ["attack", "defend", "taunt"] },
    mage:   { maxHp: 80,  maxMp: 60, mpRegen: 5, attack: 10, expectedDamage: 15, actions: ["attack", "defend", "fire"] },
    cleric: { maxHp: 100, maxMp: 50, mpRegen: 5, attack: 5,  expectedDamage: 2,  actions: ["attack", "defend", "heal", "revive"] }
  },

  // Class skills
  FIRE_DAMAGE: 25,               // Mage !fire damage to the boss
  FIRE_MP_COST: 15,
  HEAL_PERCENT: 0.25,            // Cleric !heal restores 25% of the TARGET's max HP
  REVIVE_MP_COST: 30,
  REVIVE_HP_PERCENT: 0.25,       // revived player returns at 25% of their max HP
  TAUNT_COVER_MULTIPLIER: 0.5,   // while a Tank taunts, everyone else takes 50% of blockable AoE damage
  NO_MP_FALLBACK_STRENGTH: 0.7,  // a skill without enough MP falls back to its basic version at 70%

  // Boss. Max HP isn't fixed: it's the party's summed `expectedDamage` ×
  // TARGET_FIGHT_ROUNDS, so any party size wins in roughly the same number of rounds.
  // The floor matters for a lone Cleric: their party-play value (2/round) would make
  // a 30-HP boss, but alone they just attack — a ~5-round XP farm without it.
  MIN_BOSS_HP: 60,
  // Bosses (Phase 8). Every boss draws on the same move kinds (see bossMoves.js),
  // under its own names (src/bosses.js), plus a signature move:
  //   swipe   - light hit on every living player, never announced
  //   strike  - heavy hit on announced target(s); each taunting Tank takes one instead
  //   windup  - no damage, boss takes extra damage; always followed by power
  //   power   - heavy hit on every living player
  //   counter - punishes everyone who chose !attack or !fire
  //   storm   - moderate hit on everyone that defend and taunt can't reduce (Wyrm, Lich)
  //   eruption- moderate hit on everyone; anyone who didn't defend starts to Burn (Golem)
  //   curse   - announced target is Hexed: loses HP every round until a Cleric heals them (Lich)
  //   chain   - lightning arcs through a run of adjacent slots; only defend helps (Roc)
  // `damage` is each kind's base hit (scaled per player by power, enrage, variant, raid
  // stage, and cut by armor). `phases`: the first whose minHpPct the boss is at or above
  // supplies the move weights. `damageTaken` multiplies damage by type: !attack is
  // physical (holy for a Cleric), !fire is fire. Boss HP accounts for it (see
  // bossHpForParty), so a weakness changes who shines, not how long the fight runs.
  // `hpMultiplier` evens out pace: bosses that force more defend rounds get less HP.
  // Tuned by simulation (scripts/balance-sim.js --boss ...); see the plan's Change Log.
  BOSSES: {
    frost_wyrm: {
      damageTaken: { fire: 1.25 },
      damage: { swipe: 12, strike: 60, power: 30, counter: 20, storm: 20 },
      phases: [
        { minHpPct: 0.6, weights: { swipe: 4, strike: 3, counter: 2 } },
        { minHpPct: 0.3, weights: { swipe: 3, strike: 3, counter: 2, windup: 2, storm: 2 } },
        { minHpPct: 0,   weights: { swipe: 2, strike: 4, counter: 2, windup: 2, storm: 2 } }
      ]
    },
    ember_golem: {
      damageTaken: { fire: 0.6 },
      hpMultiplier: 0.92,
      damage: { swipe: 14, strike: 66, power: 36, counter: 22, eruption: 18 },
      phases: [
        { minHpPct: 0.6, weights: { swipe: 4, strike: 2, counter: 2, windup: 2 } },
        { minHpPct: 0.3, weights: { swipe: 3, strike: 2, counter: 2, windup: 2, eruption: 3 } },
        { minHpPct: 0,   weights: { swipe: 2, strike: 3, counter: 2, windup: 2, eruption: 3 } }
      ]
    },
    shadow_lich: {
      damageTaken: { holy: 2 },
      hpMultiplier: 1.05,
      damage: { swipe: 12, strike: 55, counter: 20, storm: 18 },
      phases: [
        { minHpPct: 0.6, weights: { swipe: 4, strike: 2, counter: 2, curse: 2 } },
        { minHpPct: 0.3, weights: { swipe: 3, strike: 2, counter: 2, curse: 2, storm: 2 } },
        { minHpPct: 0,   weights: { swipe: 2, strike: 3, counter: 2, curse: 3, storm: 2 } }
      ]
    },
    storm_roc: {
      damageTaken: { physical: 1.2 },
      hpMultiplier: 0.95,
      damage: { swipe: 12, strike: 65, power: 32, counter: 20, chain: 44 },
      phases: [
        { minHpPct: 0.6, weights: { swipe: 4, strike: 2, counter: 2, chain: 2 } },
        { minHpPct: 0.3, weights: { swipe: 3, strike: 2, counter: 2, windup: 2, chain: 3 } },
        { minHpPct: 0,   weights: { swipe: 2, strike: 3, counter: 2, windup: 2, chain: 3 } }
      ]
    }
  },
  // Signature effects. Burn and Hex tick at the end of each round (after the boss's
  // move), scaled like any boss hit; a Cleric's heal on the player ends them.
  BURN_DAMAGE: 8,        // per round...
  BURN_ROUNDS: 3,        // ...for this many rounds
  CURSE_DAMAGE: 12,      // per round...
  CURSE_ROUNDS: 3,       // ...for this many rounds, unless a Cleric heals the target first
  CHAIN_SHARE: 0.35,     // the lightning arcs through this share of the living party...
  CHAIN_MIN: 2,          // ...but always at least this many adjacent slots (+ the variant's extraTargets)
  // Picked when the fight starts (see variantForParty in fight.js): a party with no
  // Cleric can't out-heal the full boss at any level, so it faces Lesser; otherwise a
  // party whose average power reaches POWERFUL_MIN_AVG_POWER faces Powerful.
  // Optional per-variant overrides: extraTargets (strike and chain each reach this
  // many more players; the Hex stays single-target), enrageHpPct, withoutMoves (move
  // kinds the variant never uses: the Hex is answered by a Cleric, and Lesser means
  // there isn't one — a solo Mage wiped 54% against the Lich even playing well).
  // Powerful's challenge is its extra targets and early enrage: simulated veteran
  // parties wiped 8–26% even playing well at ×1.1–1.2 damage, vs ~2–4% at ×1.0.
  BOSS_VARIANTS: {
    lesser:   { prefix: "LESSER", damageMultiplier: 0.7, withoutMoves: ["curse"] },
    standard: { prefix: "", damageMultiplier: 1.0 },
    powerful: { prefix: "POWERFUL", damageMultiplier: 1.0, extraTargets: 1, enrageHpPct: 0.5 }
  },
  POWERFUL_MIN_AVG_POWER: 1.14,  // ≈ an average level of 15
  ENRAGE_HP_PCT: 0.3,            // below this, the boss is enraged...
  ENRAGE_DAMAGE_MULTIPLIER: 1.25, // ...and all its damage is multiplied by this

  // Modifiers
  DEFEND_MITIGATION: 0.10,      // defending players take only 10% of incoming damage
  DEFEND_RECOVERY_PERCENT: 0.12, // defenders who survive the round recover 12% of max HP — sustain for every class
  WINDUP_BONUS_MULTIPLIER: 1.25, // boss takes 25% extra damage during Power Attack windup
  // Risk/reward: attacking into an announced danger hits harder than usual. At 1.5,
  // simulated "risky" chat wins 20–28% faster than careful chat but takes 2.5–7× the
  // KOs; at 2.0 risk became the obvious best play, at 1.0 it was never worth it.
  BOLD_COUNTER_MULTIPLIER: 1.5,  // player damage when attacking through a Tail Counter
  BOLD_POWER_MULTIPLIER: 1.5,    // player damage when attacking into a Power Attack instead of defending

  // Party management (Phase 3.5)
  MAX_ACTIVE_FIGHTERS: 10,       // roster cap; extra !joins wait in a visible queue
  REVIVE_WINDOW_ROUNDS: 5,       // rounds a fallen player can wait for a revive before a queued player takes their slot
  FLEE_AFTER_MISSED_ROUNDS: 4,   // consecutive rounds without input before a player flees, freeing their slot
  TARGET_FIGHT_ROUNDS: 15,       // intended fight length (~5 min); sizes starting boss HP and HP added for mid-fight joiners
  MIN_JOIN_ROUNDS: 3,            // a late joiner always adds at least this many rounds' worth of boss HP

  // Level-based power (Phase 5b). A player's power multiplies their max HP, damage
  // and healing. It grows fastest early and stops at the stat cap (+30%), leaving
  // room for gear's +20% in Phase 6 inside the 1.5× power band. Levels past the cap
  // still count, but only as progress. The boss's HP and hits scale with party
  // power too (see fight.js), so danger stays constant as everyone levels.
  STAT_LEVEL_CAP: 50,
  LEVEL_POWER_BONUS_MAX: 0.30,   // L10 ≈ +10%, L25 ≈ +22%, L50+ = +30%

  // Gear (Phase 6). On a win, each player still in the fight who acted in at least
  // LOOT_MIN_PARTICIPATION of the rounds they were alive for has LOOT_DROP_CHANCE of
  // a drop for their class. A drop that beats the item in its slot is equipped
  // automatically (manual choice comes with the companion app). Weapons add power;
  // armor adds defense, a cut to incoming boss hits that per-player hit scaling
  // doesn't cancel. A full epic set ≈ +13% power and 15% defense (inside the 1.5×
  // power band with levels' +30%).
  LOOT_DROP_CHANCE: 0.5,           // raised from 0.4 after playtesting (2026-11-18)
  LOOT_MIN_PARTICIPATION: 0.5,
  // Rarest first. `chance` is before luck; common takes whatever is left.
  // `statFactor` is the share of the slot's max stat the item gets.
  LOOT_RARITIES: [
    { id: "epic",     chance: 0.03, statFactor: 1.0 },
    { id: "rare",     chance: 0.12, statFactor: 0.75 },
    { id: "uncommon", chance: 0.30, statFactor: 0.5 },
    { id: "common",   chance: 1,    statFactor: 0.25 }
  ],
  // Luck multiplies the non-common chances: from ×1 at minimum participation up to
  // LOOT_PARTICIPATION_LUCK at 100%, times LOOT_POWERFUL_LUCK against the Powerful boss.
  // Keep the combined maximum × (sum of non-common chances) below 1, or commons vanish
  // (at 1.25 × 1.5 they're still ~16% of drops).
  LOOT_PARTICIPATION_LUCK: 1.25,
  LOOT_POWERFUL_LUCK: 1.5,
  GEAR_SLOTS: {
    weapon:  { stat: "power",   max: 0.10 },
    offhand: { stat: "defense", max: 0.04 },
    head:    { stat: "defense", max: 0.03 },
    body:    { stat: "defense", max: 0.05 },
    trinket: { stat: "either",  max: 0.03 }   // rolls power or defense
  },

  // Raids (Phase 7): five battles in a row against escalating bosses (Phase 8: a
  // shuffled lineup of every boss, then a final rematch). Mods
  // start one with !raid; chat can with !raidvote while a mod has enabled voting.
  // Classes lock for the whole raid and nobody joins mid-raid. The party is fully
  // restored between battles; each stage multiplies boss HP and hit damage.
  // Simulated full-clear rates (scripts/balance-sim.js --raid): new Tank/Mage/Cleric
  // party 76% playing well / 33% sloppily; ungeared veterans (Powerful boss) ~35–45%;
  // rare-geared veterans ~64%; epic-geared ~83%. Stage 5 is the wall.
  RAID_STAGES: [
    { hpMultiplier: 0.8, damageMultiplier: 0.85 },
    { hpMultiplier: 1.0, damageMultiplier: 1.0 },
    { hpMultiplier: 1.1, damageMultiplier: 1.05 },
    { hpMultiplier: 1.2, damageMultiplier: 1.15 },
    { hpMultiplier: 1.3, damageMultiplier: 1.25 }
  ],
  RAID_LOBBY_SECONDS: 60,          // a raid lobby stays open longer
  RAID_INTERMISSION_SECONDS: 30,   // results + chests between battles, then the next one starts
  RAID_RESULTS_SECONDS: 22,        // the end-of-raid summary (chests opened) stays up longer
  RAID_VOTE_ENABLED_DEFAULT: false, // !enableraidvote / !disableraidvote toggle it at runtime
  RAID_VOTE_MIN_VOTES: 2,          // votes needed: at least this many unique voters...
  RAID_VOTE_SHARE: 0.5,            // ...and at least this share of the lobby
  // Rewards scale with progress: each cleared battle banks a chest (a full clear adds
  // RAID_CLEAR_BONUS_CHESTS). When the raid ends, every raider still in the party who
  // took part in ≥ LOOT_MIN_PARTICIPATION of their rounds opens them all. Each chest
  // is a guaranteed item; chest n rolls with luck 1 + RAID_CHEST_LUCK_STEP × (n − 1).
  // Raid battles skip the normal per-win drop roll.
  RAID_CLEAR_BONUS_CHESTS: 1,
  RAID_CHEST_LUCK_STEP: 0.2,
  // Raid tier, fixed when the raid starts: the first tier whose minAvgPower the
  // party's average power reaches (a party without a Cleric is always Normal — it
  // faces Lesser bosses). Heroic is the Powerful-boss threshold. Tiers multiply chest
  // luck (on top of the per-chest step; at Mythic the last chests never roll common)
  // and boss damage. Nobody is ever kept out: the tier follows whoever joined.
  RAID_TIERS: [
    { id: "mythic", minAvgPower: 1.30, damageMultiplier: 1.1, chestLuck: 1.5 },
    { id: "heroic", minAvgPower: 1.14, damageMultiplier: 1.0, chestLuck: 1.25 },
    { id: "normal", minAvgPower: 0,    damageMultiplier: 1.0, chestLuck: 1.0 }
  ],

  // Progression (Phase 5a). XP is rogue-lite: every round a player actually acted
  // earns XP, win or lose; finishing a won fight adds a bonus, more if it beat par.
  // Levels are unlimited; their effect on power stops at STAT_LEVEL_CAP.
  XP_PER_ACTIVE_ROUND: 10,
  XP_WIN_BONUS: 50,              // to everyone still in the party when the boss falls
  XP_SPEED_BONUS_PER_ROUND: 10,  // per round under TARGET_FIGHT_ROUNDS, on a win
  LEVEL_XP_BASE: 100,            // XP to go from level 1 to 2...
  LEVEL_XP_GROWTH: 25,           // ...and each later level costs this much more (level 50 ≈ 170 fights)
  DATABASE_FILE: "data/bossfight.db",          // relative to the project root; gitignored
  OFFLINE_DATABASE_FILE: "data/offline.db",    // used by --offline so fake chatters never touch real profiles

  // Timing
  INPUT_WINDOW_SECONDS: 15,     // how long chat has to choose an action each round
  ENDED_PAUSE_SECONDS: 14,      // how long the post-fight results screen stays up before the next lobby
  RESULTS_PAUSE_SECONDS: 4,     // minimum pause after resolution so viewers can read the log
  RESULTS_MS_PER_EVENT: 750,    // ≈ one overlay animation beat; big rounds get a longer pause to finish animating
  LOBBY_JOIN_SECONDS: 20,       // how long the !join lobby stays open before battle starts

  // Stream controls. Mods can change both at runtime (!manualmode / !automode,
  // !opengame / !closegame / !closequeue); these are what the server starts with.
  MANUAL_START_DEFAULT: false,  // true: lobbies wait for a mod's !startbattle instead of counting down
  GAME_OPEN_ON_START: true,     // false: the server starts closed until a mod types !opengame
  // Starts every message the bot posts, so game announcements stand out from the
  // streamer's own messages when the bot logs in as the streamer's account.
  BOT_MESSAGE_PREFIX: "🤖"
};
