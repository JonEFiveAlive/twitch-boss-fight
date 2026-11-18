// Gear drops (Phase 6): rolling items, naming them, and turning an equipped set into
// power/defense bonuses. Pure functions — storage lives in progress.js.
const {
  LOOT_DROP_CHANCE,
  LOOT_MIN_PARTICIPATION,
  LOOT_RARITIES,
  LOOT_PARTICIPATION_LUCK,
  LOOT_POWERFUL_LUCK,
  GEAR_SLOTS
} = require("./gameConfig");

const SLOT_IDS = Object.keys(GEAR_SLOTS);

// Base item names per class and slot; rarity adds an adjective.
const BASE_NAMES = {
  tank:   { weapon: ["Sword", "Axe"],   offhand: ["Shield", "Buckler"], head: ["Helm", "Greathelm"], body: ["Plate", "Chain Mail"], trinket: ["Charm", "Pendant", "Ring"] },
  mage:   { weapon: ["Staff", "Wand"],  offhand: ["Tome", "Orb"],       head: ["Hat", "Circlet"],    body: ["Robe", "Mantle"],     trinket: ["Charm", "Pendant", "Ring"] },
  cleric: { weapon: ["Mace", "Rod"],    offhand: ["Relic", "Censer"],   head: ["Hood", "Mitre"],     body: ["Vestments", "Cassock"], trinket: ["Charm", "Pendant", "Ring"] }
};
const RARITY_WORDS = {
  common: ["Worn", "Plain"],
  uncommon: ["Sturdy", "Fine"],
  rare: ["Runed", "Frostbitten"],
  epic: ["Wyrmslayer's", "Glacial"]
};

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

// Share of the rounds a player was alive for in which they actually acted.
function participation(stat) {
  return stat.roundsAlive > 0 ? stat.roundsActive / stat.roundsAlive : 0;
}

function rollRarity(luck, rng) {
  const roll = rng();
  let cumulative = 0;
  for (const rarity of LOOT_RARITIES) {
    if (rarity.id === "common") return rarity;
    cumulative += rarity.chance * luck;
    if (roll < cumulative) return rarity;
  }
  return LOOT_RARITIES[LOOT_RARITIES.length - 1];
}

// Whether a player earned loot from a fight (or a raid): still in the party at the
// end, and acted in enough of the rounds they were alive for.
function lootEligible(stat) {
  return stat.finished && participation(stat) >= LOOT_MIN_PARTICIPATION;
}

/**
 * Rolls a won fight's drop for one player, or null (ineligible or unlucky).
 * stat: { classId, roundsActive, roundsAlive, finished }; variant: the fight's boss variant.
 */
function rollDrop(stat, variant, rng = Math.random) {
  if (!lootEligible(stat)) return null;
  if (rng() >= LOOT_DROP_CHANCE) return null;

  const above = (participation(stat) - LOOT_MIN_PARTICIPATION) / (1 - LOOT_MIN_PARTICIPATION);
  const luck = (1 + above * (LOOT_PARTICIPATION_LUCK - 1)) * (variant === "powerful" ? LOOT_POWERFUL_LUCK : 1);
  return makeItem(stat.classId, luck, rng);
}

// A guaranteed item for a class, at the given luck (raid chests use this directly).
function makeItem(classId, luck, rng = Math.random) {
  const rarity = rollRarity(luck, rng);
  const slot = pick(SLOT_IDS, rng);
  const slotDef = GEAR_SLOTS[slot];
  const statType = slotDef.stat === "either" ? pick(["power", "defense"], rng) : slotDef.stat;
  const value = Math.round(slotDef.max * rarity.statFactor * 200) / 200; // nearest 0.5%

  return {
    classId,
    slot,
    rarity: rarity.id,
    name: `${pick(RARITY_WORDS[rarity.id], rng)} ${pick(BASE_NAMES[classId][slot], rng)}`,
    stat: statType,
    value
  };
}

// Totals an equipped set: { power, defense, look: { slot: rarity } }.
function gearBonuses(items) {
  const bonuses = { power: 0, defense: 0, look: {} };
  for (const item of items) {
    bonuses[item.stat] += item.value;
    bonuses.look[item.slot] = item.rarity;
  }
  return bonuses;
}

module.exports = { rollDrop, makeItem, lootEligible, gearBonuses, SLOT_IDS };
