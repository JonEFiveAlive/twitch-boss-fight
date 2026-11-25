const {
  CLASSES,
  FIRE_DAMAGE,
  FIRE_MP_COST,
  HEAL_PERCENT,
  REVIVE_MP_COST,
  REVIVE_HP_PERCENT,
  TAUNT_COVER_MULTIPLIER,
  NO_MP_FALLBACK_STRENGTH,
  TARGET_FIGHT_ROUNDS,
  MIN_BOSS_HP,
  BOSSES,
  BOSS_VARIANTS,
  BURN_DAMAGE,
  BURN_ROUNDS,
  CURSE_DAMAGE,
  CURSE_ROUNDS,
  POWERFUL_MIN_AVG_POWER,
  ENRAGE_HP_PCT,
  ENRAGE_DAMAGE_MULTIPLIER,
  DEFEND_MITIGATION,
  DEFEND_RECOVERY_PERCENT,
  WINDUP_BONUS_MULTIPLIER,
  BOLD_COUNTER_MULTIPLIER,
  BOLD_POWER_MULTIPLIER,
  NPC_REVIVE_GRACE_ROUNDS,
  NPC_RAID_TIER_CAP,
  RAID_TIERS
} = require("./gameConfig");

// Player damage multipliers by boss move: the windup leaves the boss open, and
// attacking into a counter or a power attack is a deliberate risk that pays off.
const PLAYER_DAMAGE_MULTIPLIERS = {
  windup: WINDUP_BONUS_MULTIPLIER,
  counter: BOLD_COUNTER_MULTIPLIER,
  power: BOLD_POWER_MULTIPLIER
};
const BOLD_MOVES = new Set(["counter", "power"]);
const { chooseBossMove } = require("./bossMoves");
const { moveName } = require("./bosses");

// Moves that hit every living player. storm ignores defend and taunt cover; eruption
// sets anyone who didn't defend burning.
const AOE_MOVES = new Set(["swipe", "power", "storm", "eruption"]);
const AOE_LOGS = {
  swipe: (name) => `The boss lashes out with ${name}!`,
  power: (name) => `${name} crashes down on everyone!`,
  storm: (name) => `${name} engulfs the party — there's no defending against it!`,
  eruption: (name) => `${name}! Molten rock rains on the party!`
};

// Damage type of a player's attack: !fire is fire; !attack is physical, or holy for a Cleric.
function damageType(classId, skill) {
  if (skill === "fire" || skill === "fizzle") return "fire";
  return classId === "cleric" ? "holy" : "physical";
}
// What a class's measured expectedDamage is mostly made of (for sizing boss HP).
const MAIN_DAMAGE_TYPE = { tank: "physical", mage: "fire", cleric: "holy" };
const damageTaken = (bossId, type) => BOSSES[bossId].damageTaken?.[type] ?? 1;

// `power` (see power.js) scales max HP here, and damage/healing in resolveRound.
// `defense` (from armor, see loot.js) is the share of every boss hit that's blocked.
// `npc`: an NPC ally (see npc.js), played by script rather than chat.
function newPlayer(name, classId, slot, power = 1, defense = 0, npc = false) {
  const stats = CLASSES[classId];
  const maxHp = Math.round(stats.maxHp * power);
  return {
    name,
    classId,
    npc,
    power,
    defense,
    hp: maxHp,
    maxHp,
    mp: stats.maxMp,
    maxMp: stats.maxMp,
    alive: true,
    lastAction: null,
    slot,
    idleRounds: 0,  // consecutive rounds with no command (see FLEE_AFTER_MISSED_ROUNDS)
    roundsDown: 0,  // full rounds spent fallen without a revive (see REVIVE_WINDOW_ROUNDS)
    burn: 0,        // rounds of Burn left (Ember Golem's Eruption)
    curse: 0        // rounds of Hex left (Shadow Lich)
  };
}

// Boss HP sized so this party, playing sensibly, wins in about TARGET_FIGHT_ROUNDS
// against this boss (its weaknesses and resistances included).
// members: [{ classId, power }] (power defaults to 1).
function bossHpForParty(members, bossId = "frost_wyrm") {
  if (members.length === 0) return 0;
  const perRound = members.reduce((sum, m) => sum + expectedDamageVs(bossId, m.classId) * (m.power ?? 1), 0);
  return Math.max(MIN_BOSS_HP, Math.round(perRound * TARGET_FIGHT_ROUNDS * (BOSSES[bossId].hpMultiplier ?? 1)));
}

function expectedDamageVs(bossId, classId) {
  return CLASSES[classId].expectedDamage * damageTaken(bossId, MAIN_DAMAGE_TYPE[classId]);
}

// A party without a Cleric can't out-heal the full boss at any level (hits scale with
// each player's power, so leveling doesn't make anyone relatively tougher): Lesser.
// Otherwise strong parties (by average power) face Powerful. An NPC Cleric counts as a
// Cleric, but NPCs don't count toward the average: they'd only drag it down.
function variantForParty(members) {
  if (!members.some(m => m.classId === "cleric")) return "lesser";
  const players = members.some(m => !m.npc) ? members.filter(m => !m.npc) : members;
  const avgPower = players.reduce((sum, m) => sum + (m.power ?? 1), 0) / players.length;
  return avgPower >= POWERFUL_MIN_AVG_POWER ? "powerful" : "standard";
}

// The raid tier for a roster (see RAID_TIERS): the first whose minAvgPower the
// players' average power reaches (NPCs don't count). Always Normal for a party without
// a Cleric (it faces Lesser bosses); a party with NPC allies gets NPC_RAID_TIER_CAP at most.
function raidTierFor(roster) {
  const normal = RAID_TIERS[RAID_TIERS.length - 1];
  const players = roster.filter(r => !r.npc);
  if (!players.length || variantForParty(roster) === "lesser") return normal;
  const avg = players.reduce((sum, r) => sum + (r.power ?? 1), 0) / players.length;
  let tier = RAID_TIERS.find(t => avg >= t.minAvgPower) ?? normal;
  // RAID_TIERS runs from the top tier down, so a later index is a lower tier.
  const capIndex = RAID_TIERS.findIndex(t => t.id === NPC_RAID_TIER_CAP);
  if (players.length < roster.length && capIndex > RAID_TIERS.indexOf(tier)) tier = RAID_TIERS[capIndex];
  return tier;
}

/**
 * Creates a fresh fight state from the joined roster: [{ id, name, classId, power?, defense?, npc? }],
 * where id is the Twitch user ID (the key everywhere) and name is the display name.
 * Slot numbers (1-based) are assigned by join order and used for !heal/!revive targeting.
 * options.hpMultiplier / damageMultiplier scale the boss (raid stages); both default to 1.
 */
function createFight(roster, { bossId = "frost_wyrm", hpMultiplier = 1, damageMultiplier = 1 } = {}) {
  const players = {};
  roster.forEach(({ id, name, classId, power, defense, npc }, index) => {
    players[id] = newPlayer(name, classId, index + 1, power, defense, Boolean(npc));
  });
  const bossHP = Math.round(bossHpForParty(roster, bossId) * hpMultiplier);

  return {
    bossId,
    round: 1,
    bossHP,
    bossMaxHP: bossHP,
    bossDamageMultiplier: damageMultiplier,
    variant: variantForParty(roster), // fixed for the whole fight, even if the roster changes
    enraged: false,
    lastMoveId: null,
    nextMove: null,
    // How many party slots the boss's HP already accounts for. Refilling a freed
    // slot is free; only growing the party past this adds boss HP.
    fundedSlots: roster.length,
    // Rounds since every player (not NPC) fell, while an NPC Cleric still stands.
    wipeRounds: 0,
    players,
    log: []
  };
}

// Adds a mid-fight joiner at full HP/MP in the given slot.
function addPlayer(fight, { id, name, classId, power, defense }, slot) {
  fight.players[id] = newPlayer(name, classId, slot, power, defense);
}

function applyDamage(player, dmg) {
  player.hp = Math.max(0, Math.round(player.hp - dmg));
  if (player.hp === 0) {
    player.alive = false;
    player.burn = 0; // a fallen player sheds Burn and Hex
    player.curse = 0;
  }
}

// Burn and Hex are lifted by a Cleric's heal. Returns what was cleansed.
function cleanse(player) {
  const cleansed = [player.burn > 0 && "burn", player.curse > 0 && "curse"].filter(Boolean);
  player.burn = 0;
  player.curse = 0;
  return cleansed;
}

const afflicted = (p) => p.burn > 0 || p.curse > 0;

function livingPlayerIds(fight) {
  return Object.keys(fight.players).filter((id) => fight.players[id].alive);
}

// Lowest HP as a fraction of max, so a 60/130 Tank isn't picked over a 50/80 Mage.
// preferAfflicted: a burning or hexed player comes first (untargeted heals cleanse).
function lowestHpLivingId(fight, preferAfflicted = false) {
  return livingPlayerIds(fight).sort((a, b) => {
    const pa = fight.players[a];
    const pb = fight.players[b];
    if (preferAfflicted && afflicted(pa) !== afflicted(pb)) return afflicted(pa) ? -1 : 1;
    return pa.hp / pa.maxHp - pb.hp / pb.maxHp;
  })[0];
}

function firstFallenId(fight) {
  return Object.keys(fight.players)
    .filter((id) => !fight.players[id].alive)
    .sort((a, b) => fight.players[a].slot - fight.players[b].slot)[0];
}

// Returns the HP actually restored (healing a full-HP player restores nothing).
function healPlayer(target, strength) {
  const amount = Math.round(target.maxHp * HEAL_PERCENT * strength);
  const actual = Math.min(amount, target.maxHp - target.hp);
  target.hp += actual;
  return actual;
}

/**
 * Resolves one round of combat.
 *
 * @param fight   - current fight state (will be mutated)
 * @param actions - map of userId -> { type, targetId? }. Missing entries, and actions
 *                  the player's class can't use, default to defend.
 * @returns { fight, log, outcome, bossMove, resolutionEvents }
 */
function resolveRound(fight, actions, rng = Math.random) {
  // The game loop picks (and announces) the move when the input phase opens;
  // callers that skip that step, like simulations, get one picked here.
  const move = fight.nextMove ?? chooseBossMove(fight, rng);
  fight.nextMove = null;
  const log = [];

  const bossDamageMultiplierThisRound = PLAYER_DAMAGE_MULTIPLIERS[move.id] ?? 1.0;
  const boldRound = BOLD_MOVES.has(move.id) && bossDamageMultiplierThisRound > 1;

  let totalDamageToBoss = 0;
  const attackers = [];
  const defenders = [];
  const taunters = [];
  const resolutionEvents = [];

  // --- Resolve each living player's chosen action ---
  for (const userId of livingPlayerIds(fight)) {
    const player = fight.players[userId];
    const stats = CLASSES[player.classId];
    const pending = actions[userId];
    const actionType = pending && stats.actions.includes(pending.type) ? pending.type : "defend";

    player.lastAction = actionType;

    if (actionType === "attack" || actionType === "fire") {
      let base = stats.attack;
      let skill = null;
      if (actionType === "fire") {
        if (player.mp >= FIRE_MP_COST) {
          player.mp -= FIRE_MP_COST;
          base = FIRE_DAMAGE;
          skill = "fire";
        } else {
          base = stats.attack * NO_MP_FALLBACK_STRENGTH;
          skill = "fizzle";
        }
      }
      // Weaknesses and resistances (see BOSSES[...].damageTaken).
      const typeMultiplier = damageTaken(fight.bossId, damageType(player.classId, skill));
      const dmg = Math.round(base * player.power * bossDamageMultiplierThisRound * typeMultiplier);
      const element = typeMultiplier > 1 ? "weak" : typeMultiplier < 1 ? "resist" : null;
      attackers.push(userId);
      totalDamageToBoss += dmg;
      resolutionEvents.push({ type: "player_attack", userId, damageToBoss: dmg, skill, bold: boldRound, element });
      if (skill === "fire") log.push(`${player.name} casts Fire for ${dmg} damage!`);
      if (skill === "fizzle") log.push(`${player.name} is out of MP — a weak spark hits for ${dmg}.`);

    } else if (actionType === "heal") {
      // An invalid/dead target (or none) falls back to the lowest-HP living player,
      // re-evaluated now rather than when the command was typed.
      let targetId = pending.targetId;
      if (!fight.players[targetId]?.alive) targetId = lowestHpLivingId(fight, true);
      const target = fight.players[targetId];
      const healed = healPlayer(target, player.power);
      const cleansed = cleanse(target);

      resolutionEvents.push({ type: "player_heal", userId, targetId, healAmount: healed, cleansed });
      const extra = cleansed.length ? ` and ${cleansed.map(c => (c === "burn" ? "douses the flames" : "lifts the Hex")).join(" and ")}` : "";
      log.push(
        targetId === userId
          ? `${player.name} heals themselves for ${healed} HP${extra}!`
          : `${player.name} heals ${target.name} for ${healed} HP${extra}!`
      );

    } else if (actionType === "revive") {
      let targetId = pending.targetId;
      if (fight.players[targetId]?.alive !== false) targetId = firstFallenId(fight);

      if (targetId && player.mp >= REVIVE_MP_COST) {
        player.mp -= REVIVE_MP_COST;
        const target = fight.players[targetId];
        target.alive = true;
        target.hp = Math.max(1, Math.round(target.maxHp * REVIVE_HP_PERCENT));
        target.lastAction = "defend"; // revived mid-round; braces for the boss's attack
        resolutionEvents.push({ type: "player_revive", userId, targetId, hp: target.hp });
        log.push(`${player.name} revives ${target.name}!`);
      } else {
        // Can't revive (no MP or nobody fallen): a weaker untargeted heal instead.
        const healTargetId = lowestHpLivingId(fight, true);
        const healTarget = fight.players[healTargetId];
        const healed = healPlayer(healTarget, NO_MP_FALLBACK_STRENGTH * player.power);
        const cleansed = cleanse(healTarget);
        const who = healTargetId === userId ? "themselves" : healTarget.name;
        resolutionEvents.push({ type: "player_heal", userId, targetId: healTargetId, healAmount: healed, cleansed, fallback: true });
        log.push(
          targetId
            ? `${player.name} lacks the MP to revive — heals ${who} for ${healed} HP instead.`
            : `${player.name} finds no one to revive — heals ${who} for ${healed} HP instead.`
        );
      }

    } else if (actionType === "taunt") {
      taunters.push(userId);
      resolutionEvents.push({ type: "player_taunt", userId });

    } else {
      defenders.push(userId);
      resolutionEvents.push({ type: "player_defend", userId });
    }
  }

  // --- Apply damage to boss ---
  fight.bossHP = Math.max(0, fight.bossHP - totalDamageToBoss);

  if (totalDamageToBoss > 0) {
    log.push(`Chat deals ${totalDamageToBoss} damage to the boss! (${attackers.length} attacked, ${defenders.length} defended)`);
    if (boldRound && attackers.length > 0) {
      log.push(`${attackers.length} daring hit${attackers.length > 1 ? "s" : ""} struck through ${moveName(fight.bossId, move.id)} for bonus damage!`);
    }
  } else {
    log.push(`Nobody attacked this round. The boss takes no damage.`);
  }

  // Dropping below the threshold enrages the boss for the rest of the fight,
  // starting with this round's attack.
  const variant = BOSS_VARIANTS[fight.variant];
  const enrageAt = variant.enrageHpPct ?? ENRAGE_HP_PCT;
  if (!fight.enraged && fight.bossHP > 0 && fight.bossHP / fight.bossMaxHP < enrageAt) {
    fight.enraged = true;
    resolutionEvents.push({ type: "enrage" });
    log.push(`The boss becomes ENRAGED!`);
  }
  // Every boss hit this round is scaled by enrage and the variant — and, per hit, by
  // the power of whoever it lands on, so each player's danger stays constant as they
  // level (a newcomer among veterans takes newcomer-sized hits). Armor's defense then
  // blocks a share of it; that part isn't scaled away.
  const rage = (fight.enraged ? ENRAGE_DAMAGE_MULTIPLIER : 1) * variant.damageMultiplier * (fight.bossDamageMultiplier ?? 1);
  const hitFor = (player, base) => base * rage * player.power * (1 - player.defense);

  const bossDamage = BOSSES[fight.bossId].damage;
  const name = moveName(fight.bossId, move.id);

  // --- Burn and Hex bite first (a Cleric's heal this round already lifted them) ---
  const bossAlive = fight.bossHP > 0;
  if (bossAlive) {
    const ticks = [];
    for (const userId of livingPlayerIds(fight)) {
      const player = fight.players[userId];
      for (const [status, base] of [["burn", BURN_DAMAGE], ["curse", CURSE_DAMAGE]]) {
        if (player[status] <= 0 || !player.alive) continue;
        player[status] -= 1;
        const dmg = hitFor(player, base);
        applyDamage(player, dmg);
        ticks.push({ userId, damage: Math.round(dmg), status });
      }
    }
    if (ticks.length) {
      resolutionEvents.push({ type: "status_tick", hits: ticks });
      const burned = ticks.filter(t => t.status === "burn").length;
      const hexed = ticks.filter(t => t.status === "curse").length;
      if (burned) log.push(`${burned} burning player${burned > 1 ? "s" : ""} take${burned > 1 ? "" : "s"} fire damage.`);
      if (hexed) log.push(`The Hex drains ${ticks.filter(t => t.status === "curse").map(t => fight.players[t.userId].name).join(" and ")}.`);
    }
  }

  // --- Apply boss's action to players (a boss the party just killed doesn't act) ---
  if (!bossAlive) {
    log.push(`The boss collapses!`);

  } else if (AOE_MOVES.has(move.id)) {
    // storm ignores both defend and taunt cover — only healing answers it.
    const unblockable = move.id === "storm";
    const tauntActive = taunters.length > 0 && !unblockable;
    const bossEvent = { type: "boss_aoe", move: move.id, hits: [] };
    for (const userId of livingPlayerIds(fight)) {
      const player = fight.players[userId];
      const defended = !unblockable && player.lastAction === "defend";
      const covered = tauntActive && player.lastAction !== "taunt";
      let dmg = hitFor(player, bossDamage[move.id]);
      if (defended) dmg *= DEFEND_MITIGATION;
      if (covered) dmg *= TAUNT_COVER_MULTIPLIER;
      applyDamage(player, dmg);
      // Eruption: anyone still standing who didn't defend starts to burn.
      const burned = move.id === "eruption" && !defended && player.alive;
      if (burned) player.burn = BURN_ROUNDS;
      bossEvent.hits.push({ userId, damage: Math.round(dmg), defended, covered, burned });
    }
    resolutionEvents.push(bossEvent);
    if (tauntActive) {
      const names = taunters.map((id) => fight.players[id].name).join(" and ");
      log.push(`${names} draws the boss's attention — the party takes reduced damage!`);
    }
    log.push(AOE_LOGS[move.id](name));
    const burning = bossEvent.hits.filter(h => h.burned).length;
    if (burning) log.push(`${burning} player${burning > 1 ? "s" : ""} caught fire — a Cleric's heal douses it!`);

  } else if (move.id === "strike") {
    // Each announced target takes a strike (a target who left is swapped for a random
    // survivor). Each taunting Tank steps in front of one target's strike: a Tank who
    // is targeted takes their own; the rest cover the other targets in order.
    const living = livingPlayerIds(fight);
    const targets = (move.targetIds ?? [])
      .map(id => (fight.players[id]?.alive ? id : living[Math.floor(rng() * living.length)]))
      .filter(Boolean);
    const freeTaunters = taunters.filter(id => !targets.includes(id));
    const bossEvent = { type: "boss_single", move: "strike", hits: [] };

    for (const intendedId of targets) {
      const coverId = taunters.includes(intendedId) ? null : freeTaunters.shift();
      const hitId = coverId ?? intendedId;
      const target = fight.players[hitId];
      const defended = target.lastAction === "defend";
      const dmg = hitFor(target, bossDamage.strike) * (defended ? DEFEND_MITIGATION : 1);
      applyDamage(target, dmg);
      bossEvent.hits.push({ userId: hitId, damage: Math.round(dmg), defended });
      log.push(
        coverId
          ? `${target.name} taunts and takes the ${name} meant for ${fight.players[intendedId].name}!`
          : `${name} hits ${target.name}${defended ? ", who braced for it" : ""}!`
      );
    }
    if (bossEvent.hits.length) resolutionEvents.push(bossEvent);

  } else if (move.id === "chain") {
    // Lightning arcs through the announced run of neighbors. Taunting can't draw it;
    // only defending softens it.
    const bossEvent = { type: "boss_chain", move: "chain", hits: [] };
    for (const userId of move.targetIds ?? []) {
      const target = fight.players[userId];
      if (!target?.alive) continue;
      const defended = target.lastAction === "defend";
      const dmg = hitFor(target, bossDamage.chain) * (defended ? DEFEND_MITIGATION : 1);
      applyDamage(target, dmg);
      bossEvent.hits.push({ userId, damage: Math.round(dmg), defended });
    }
    if (bossEvent.hits.length) resolutionEvents.push(bossEvent);
    const braced = bossEvent.hits.filter(h => h.defended).length;
    log.push(`${name} arcs through ${bossEvent.hits.length} player${bossEvent.hits.length === 1 ? "" : "s"}` +
      (braced ? ` — ${braced} braced for it!` : "!"));

  } else if (move.id === "curse") {
    // A Hex on each announced target (a target who left or fell is spared).
    const bossEvent = { type: "boss_curse", move: "curse", hits: [] };
    for (const userId of move.targetIds ?? []) {
      const target = fight.players[userId];
      if (!target?.alive) continue;
      target.curse = CURSE_ROUNDS;
      bossEvent.hits.push({ userId });
    }
    if (bossEvent.hits.length) {
      resolutionEvents.push(bossEvent);
      log.push(`${name} falls on ${bossEvent.hits.map(h => fight.players[h.userId].name).join(" and ")} — a Cleric's heal lifts it!`);
    }

  } else if (move.id === "counter") {
    const bossEvent = { type: "counter", hits: [] };
    for (const userId of attackers) {
      const dmg = Math.round(hitFor(fight.players[userId], bossDamage.counter));
      applyDamage(fight.players[userId], dmg);
      bossEvent.hits.push({ userId, damage: dmg });
    }
    resolutionEvents.push(bossEvent);
    log.push(
      attackers.length > 0
        ? `${name}! ${attackers.length} attacker(s) take retaliation damage.`
        : `${name} — but everyone played it safe!`
    );

  } else if (move.id === "windup") {
    resolutionEvents.push({ type: "power_windup" });
    log.push(`The boss is winding up ${name} — brace yourselves next round!`);
  }
  fight.lastMoveId = move.id;

  // Defending players who made it through the round catch their breath.
  for (const userId of defenders) {
    const player = fight.players[userId];
    if (!player.alive || DEFEND_RECOVERY_PERCENT <= 0) continue;
    const gain = Math.min(Math.round(player.maxHp * DEFEND_RECOVERY_PERCENT), player.maxHp - player.hp);
    if (gain > 0) {
      player.hp += gain;
      resolutionEvents.push({ type: "player_recover", userId, amount: gain });
    }
  }

  // --- MP regeneration for surviving casters ---
  for (const userId of livingPlayerIds(fight)) {
    const player = fight.players[userId];
    player.mp = Math.min(player.maxMp, player.mp + CLASSES[player.classId].mpRegen);
  }

  fight.log.push(...log);
  fight.round += 1;

  // --- Determine outcome ---
  // With every player down the fight is lost, unless an NPC Cleric still stands: it
  // gets NPC_REVIVE_GRACE_ROUNDS more rounds to bring someone back.
  let outcome = "ongoing";
  const living = livingPlayerIds(fight);
  if (fight.bossHP <= 0) {
    outcome = "win";
  } else if (!living.some(id => !fight.players[id].npc)) {
    const reviver = living.map(id => fight.players[id]).find(p => p.classId === "cleric");
    fight.wipeRounds += 1;
    const roundsLeft = NPC_REVIVE_GRACE_ROUNDS + 1 - fight.wipeRounds;
    if (!reviver || roundsLeft <= 0) {
      outcome = "loss";
    } else {
      const line = fight.wipeRounds === 1
        ? `Every hero has fallen! ${reviver.name} has ${roundsLeft} round${roundsLeft === 1 ? "" : "s"} to revive someone!`
        : `${reviver.name} has ${roundsLeft} round${roundsLeft === 1 ? "" : "s"} left to revive someone!`;
      log.push(line);
      fight.log.push(line);
    }
  } else {
    fight.wipeRounds = 0;
  }

  return { fight, log, outcome, bossMove: move, resolutionEvents };
}

module.exports = { createFight, addPlayer, bossHpForParty, variantForParty, raidTierFor, resolveRound, livingPlayerIds };
