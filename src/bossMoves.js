// The boss's move selection. One move is picked per round at the start of the input
// phase, so it can be announced to chat before anyone commits; resolveRound() then
// carries it out. Picks are weighted-random from the boss's pool for its current HP
// phase (see BOSSES in gameConfig.js, where the move kinds are described).
//
// A move is { id: kind, targetIds? }. strike and curse name their targets (one, plus
// the variant's extraTargets); chain names the run of adjacent slots it will arc through.

const { BOSSES, BOSS_VARIANTS, CHAIN_SHARE, CHAIN_MIN, BOLD_COUNTER_MULTIPLIER, BOLD_POWER_MULTIPLIER } = require("./gameConfig");
const { BOSS_INFO, moveName } = require("./bosses");

// "+50%" for a 1.5 multiplier, so the warning states what the risk pays.
const bonusText = (multiplier) => `+${Math.round((multiplier - 1) * 100)}%`;

// Announced moves; these never repeat back-to-back.
const BIG_MOVES = new Set(["strike", "windup", "counter", "storm", "eruption", "curse", "chain"]);

function weightedPick(weights, rng) {
  const entries = Object.entries(weights);
  let roll = rng() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1][0];
}

function livingBySlot(fight) {
  return Object.keys(fight.players)
    .filter(pid => fight.players[pid].alive)
    .sort((a, b) => fight.players[a].slot - fight.players[b].slot);
}

/** Returns { id, targetIds? } for the boss's next move. */
function chooseBossMove(fight, rng = Math.random) {
  if (fight.lastMoveId === "windup") return { id: "power" };

  const phases = BOSSES[fight.bossId].phases;
  const hpPct = fight.bossHP / fight.bossMaxHP;
  const phase = phases.find(p => hpPct >= p.minHpPct) ?? phases[phases.length - 1];
  const weights = { ...phase.weights };
  if (BIG_MOVES.has(fight.lastMoveId)) delete weights[fight.lastMoveId];
  // The Hex only lands on someone not already hexed (otherwise a party with no Cleric
  // would stay hexed for good); with everyone hexed, the Lich does something else.
  const unhexed = livingBySlot(fight).filter(pid => !(fight.players[pid].curse > 0));
  if (unhexed.length === 0) delete weights.curse;
  for (const kind of BOSS_VARIANTS[fight.variant]?.withoutMoves ?? []) delete weights[kind];

  const id = weightedPick(weights, rng);
  const extra = BOSS_VARIANTS[fight.variant]?.extraTargets ?? 0;
  const living = livingBySlot(fight);

  if (id === "strike" || id === "curse") {
    // Distinct random targets (never more than are alive). The Hex stays single-target
    // (two at once overwhelmed a lone Cleric in simulation) and skips the hexed.
    const pool = id === "curse" ? unhexed : living.slice();
    const count = Math.min(1 + (id === "strike" ? extra : 0), pool.length);
    const targetIds = [];
    for (let i = 0; i < count; i++) targetIds.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return { id, targetIds };
  }
  if (id === "chain") {
    // A run of neighbors in slot order (wrapping round), from a random start.
    const count = Math.min(Math.max(CHAIN_MIN, Math.round(living.length * CHAIN_SHARE)) + extra, living.length);
    const start = Math.floor(rng() * living.length);
    return { id, targetIds: Array.from({ length: count }, (_, i) => living[(start + i) % living.length]) };
  }
  return { id };
}

const slotList = (ids = [], fight) => ids.map(id => fight.players[id]?.slot).filter(Boolean).join(" & ");
// A chain's run of slots: "2–5", or "9, 10, 1" when it wraps round.
function slotRange(ids = [], fight) {
  const slots = ids.map(id => fight.players[id]?.slot).filter(Boolean);
  const contiguous = slots.every((s, i) => i === 0 || s === slots[i - 1] + 1);
  return contiguous && slots.length > 2 ? `${slots[0]}–${slots[slots.length - 1]}` : slots.join(slots.length > 2 ? ", " : " & ");
}

/** The warning shown to chat while they choose; swipe comes with no warning. */
function describeMove(move, fight) {
  const name = moveName(fight.bossId, move.id).toUpperCase();
  const targets = (move.targetIds ?? []).map(id => fight.players[id]).filter(Boolean);
  // Two names don't fit on one line; the overlay's reticles show who, so just slots.
  const who = targets.length === 1 ? `${targets[0].slot} ${targets[0].name}` : `slots ${slotList(move.targetIds, fight)}`;
  switch (move.id) {
    case "strike":   return `${BOSS_INFO[fight.bossId].icon} ${name} → ${who} · defend or !taunt`;
    case "windup":   return `⚡ Winding up ${name} · hit it now for bonus damage`;
    case "power":    return `💥 ${name} incoming · defend, or strike for ${bonusText(BOLD_POWER_MULTIPLIER)}`;
    case "counter":  return `🔁 ${name} · attackers get hit but deal ${bonusText(BOLD_COUNTER_MULTIPLIER)}`;
    case "storm":    return `🌨 ${name} incoming · defend won't help, heal up`;
    case "eruption": return `🌋 ${name} incoming · defend or you'll burn`;
    case "curse":    return `☠ ${name} → ${who} · Cleric !heal lifts it`;
    case "chain":    return `⚡ ${name} → slots ${slotRange(move.targetIds, fight)} · defend!`;
    default:         return "";
  }
}

/** The headline shown while the move plays out, e.g. "❄ FROST BREATH!". */
function moveTitle(bossId, kind) {
  const name = moveName(bossId, kind).toUpperCase();
  const icon = { strike: BOSS_INFO[bossId].icon, windup: "⚡", power: "💥", counter: "🔁", storm: "🌨",
    eruption: "🌋", curse: "☠", chain: "⚡" }[kind];
  return kind === "windup" ? `⚡ Winding up ${moveName(bossId, kind)}...` : icon ? `${icon} ${name}!` : `${moveName(bossId, kind)}!`;
}

module.exports = { chooseBossMove, describeMove, moveTitle };
