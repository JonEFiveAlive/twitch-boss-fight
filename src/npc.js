// NPC allies: who fills in for a small party, and how they play. Like fight.js, plain
// functions with no Twitch/Socket.IO dependencies. The game loop adds NPCs when a battle
// starts (see NPC_* in gameConfig.js) and asks npcAction() for each living NPC's command
// once the boss's move is announced; scripts/balance-sim.js plays them the same way.
const {
  BOSSES,
  BOSS_VARIANTS,
  BURN_DAMAGE,
  CURSE_DAMAGE,
  DEFEND_MITIGATION,
  DEFEND_RECOVERY_PERCENT,
  ENRAGE_DAMAGE_MULTIPLIER,
  FIRE_MP_COST,
  HEAL_PERCENT,
  REVIVE_MP_COST,
  NPC_FILL_MAX_HUMANS,
  NPC_PARTY_SIZE,
  NPC_FILL_ORDER,
  NPC_POWER_SHARE,
  NPC_ERROR_RATE
} = require("./gameConfig");

// One NPC per class; the id prefix can never collide with a Twitch user ID.
const NPC_NAMES = { cleric: "Sister Wren", tank: "Old Brannoc", mage: "Pell" };
const npcId = (classId) => `npc:${classId}`;
const isNpcId = (id) => typeof id === "string" && id.startsWith("npc:");

/**
 * The NPC allies a party of players gets: [{ id, name, classId, power, defense, npc }].
 * players: [{ classId, power }]. Empty for no players or a big enough party; otherwise
 * the classes the party lacks, in NPC_FILL_ORDER, until it reaches NPC_PARTY_SIZE.
 */
function npcAlliesFor(players) {
  if (!players.length || players.length > NPC_FILL_MAX_HUMANS) return [];
  const taken = new Set(players.map(p => p.classId));
  const power = npcPower(players);
  return NPC_FILL_ORDER.filter(classId => !taken.has(classId))
    .slice(0, Math.max(0, NPC_PARTY_SIZE - players.length))
    .map(classId => ({ id: npcId(classId), name: NPC_NAMES[classId], classId, power, defense: 0, npc: true }));
}

// NPCs fight at a share of the players' average power: useful, never better than a player.
function npcPower(players) {
  const avg = players.reduce((sum, p) => sum + (p.power ?? 1), 0) / players.length;
  return Math.round(avg * NPC_POWER_SHARE * 1000) / 1000;
}

/**
 * A sensible chat member's command: reads every warning, braces for a strike aimed at
 * them (or a Tank taunts it) or a chain, defends through power attacks, counters and
 * eruptions; Clerics revive, then heal (burning / hexed players first). Also the
 * balance sim's "sensible" style.
 */
function sensibleAction(fight, id, move) {
  const p = fight.players[id];
  const players = Object.entries(fight.players);
  const living = players.filter(([, q]) => q.alive);
  const fallen = players.filter(([, q]) => !q.alive);
  const hurt = living.filter(([, q]) => q.hp / q.maxHp < 0.6 || q.burn > 0 || q.curse > 0);
  const firstTank = living.find(([, q]) => q.classId === "tank")?.[0];
  const strikeTargets = move.id === "strike" ? move.targetIds : [];
  // An untargeted first Tank covers the first non-Tank target; every other target braces.
  const covered = firstTank && !strikeTargets.includes(firstTank)
    ? strikeTargets.find(t => fight.players[t].classId !== "tank") : null;
  const mustBrace = (strikeTargets.includes(id) && id !== covered) ||
    (move.id === "chain" && move.targetIds.includes(id));
  const braceAll = move.id === "power" || move.id === "counter" || move.id === "eruption";

  if (p.classId === "cleric") {
    if (fallen.length && p.mp >= REVIVE_MP_COST) return "revive";
    if (move.id === "eruption") return "defend";
    if (hurt.length || move.id === "storm") return "heal";
    if (braceAll || mustBrace) return "defend";
    return "attack";
  }
  if (id === firstTank && !strikeTargets.includes(id) && (move.id === "power" || covered)) return "taunt";
  if (braceAll || mustBrace) return "defend";
  if (move.id === "swipe" && p.hp / p.maxHp < 0.3) return "defend";
  // Burning or hexed with no Cleric to lift it: defend to recover while it runs out.
  const clericUp = living.some(([, q]) => q.classId === "cleric");
  if (!clericUp && (p.burn > 0 || p.curse > 0) && p.hp / p.maxHp < 0.5) return "defend";
  if (p.classId === "mage") return p.mp >= FIRE_MP_COST ? "fire" : "attack";
  return "attack";
}

/**
 * A careless chat member's command, ignoring the boss's warning: attack (Fire for a
 * Mage with the MP), or a Cleric heals if anyone's hurt. NPCs slip into this now and
 * then (NPC_ERROR_RATE); also the balance sim's "sloppy" style, part of the time.
 */
function naiveAction(fight, id) {
  const p = fight.players[id];
  if (p.classId === "cleric") {
    const hurt = Object.values(fight.players).some(q => q.alive && q.hp / q.maxHp < 0.6);
    return hurt ? "heal" : "attack";
  }
  if (p.classId === "mage") return p.mp >= FIRE_MP_COST ? "fire" : "attack";
  return "attack";
}

/**
 * The most this round could cost NPC `id` if it takes `action` ("heal-self" = a heal on
 * itself, which lifts Burn and Hex before they tick). Assumes the worst: the boss
 * enrages this round, and no Tank's taunt covers it. Mirrors resolveRound's damage.
 */
function worstCaseDamage(fight, id, move, action) {
  const p = fight.players[id];
  const base = BOSSES[fight.bossId].damage;
  const targeted = (move.targetIds ?? []).includes(id);
  let hit = 0;
  if (move.id === "counter") hit = action === "attack" || action === "fire" ? base.counter : 0;
  else if (["swipe", "power", "eruption", "storm"].includes(move.id)) hit = base[move.id];
  else if (move.id === "strike") hit = targeted || action === "taunt" ? base.strike : 0;
  else if (move.id === "chain") hit = targeted ? base.chain : 0;
  if (action === "defend" && move.id !== "storm") hit *= DEFEND_MITIGATION;
  const ticks = action === "heal-self" ? 0 : (p.burn > 0 ? BURN_DAMAGE : 0) + (p.curse > 0 ? CURSE_DAMAGE : 0);
  const rage = ENRAGE_DAMAGE_MULTIPLIER * BOSS_VARIANTS[fight.variant].damageMultiplier * (fight.bossDamageMultiplier ?? 1);
  return (hit + ticks) * rage * p.power * (1 - p.defense);
}

/**
 * An NPC's command for this round: { type, targetId }. It plays sensibly and minds its
 * own life: if what it means to do could get it killed, it defends instead, or (a
 * Cleric) heals itself when that leaves it with more HP. A Cleric NPC revives players
 * before other NPCs. Now and then (NPC_ERROR_RATE) it slips like a careless chatter,
 * ignoring the warning without that check, so a slip can be fatal. Never while a
 * revive is at stake, though: when a Cleric NPC means to revive, or during the grace
 * after every player fell, when the Cleric staying up is the fight's only chance.
 */
function npcAction(fight, id, move, rng = Math.random) {
  const p = fight.players[id];
  let type = sensibleAction(fight, id, move);
  let targetId = null;
  const reviveAtStake = fight.wipeRounds > 0 || type === "revive";
  if (!reviveAtStake && rng() < NPC_ERROR_RATE) return { type: naiveAction(fight, id), targetId: null };

  if (type === "revive") {
    // Players first, then NPCs, each in slot order.
    const fallen = Object.entries(fight.players).filter(([, q]) => !q.alive)
      .sort(([, a], [, b]) => (a.npc - b.npc) || (a.slot - b.slot));
    targetId = fallen[0]?.[0] ?? null;
  }

  if (worstCaseDamage(fight, id, move, type) < p.hp) return { type, targetId };

  // Could be lethal: brace, or (a Cleric) heal itself if that leaves more HP.
  const afterDefend = p.hp - worstCaseDamage(fight, id, move, "defend");
  if (p.classId !== "cleric") return { type: "defend", targetId: null };
  const healed = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * HEAL_PERCENT * p.power));
  const afterHeal = healed - worstCaseDamage(fight, id, move, "heal-self");
  const defendTotal = afterDefend > 0 ? afterDefend + p.maxHp * DEFEND_RECOVERY_PERCENT : afterDefend;
  return afterHeal > defendTotal ? { type: "heal", targetId: id } : { type: "defend", targetId: null };
}

module.exports = { NPC_NAMES, npcId, isNpcId, npcAlliesFor, npcPower, sensibleAction, naiveAction, npcAction, worstCaseDamage };
