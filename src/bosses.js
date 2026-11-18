// The bosses' presentation: names, move names, elements and biomes. Their numbers
// (damage, move weights, damage taken by type) live in gameConfig.js under BOSSES.
// Move kinds are described in gameConfig.js and carried out in fight.js.

const { BOSSES, BOSS_VARIANTS } = require("./gameConfig");

// moves: the name each kind goes by (only kinds in the boss's weights are used).
// icon: shown with the boss's announced strike. element/biome feed the overlay.
// signature: one line for the lobby on how to handle the boss's special move.
const BOSS_INFO = {
  frost_wyrm: {
    name: "FROST WYRM",
    element: "ice",
    biome: "ice",
    icon: "❄",
    moves: {
      swipe: "Claw Swipe", strike: "Frost Breath", windup: "Power Attack", power: "Power Attack",
      counter: "Tail Counter", storm: "Blizzard"
    },
    signature: "Blizzard ignores defend — heal through it"
  },
  ember_golem: {
    name: "EMBER GOLEM",
    element: "fire",
    biome: "volcano",
    icon: "🔥",
    moves: {
      swipe: "Stone Fist", strike: "Magma Slam", windup: "Meteor Crush", power: "Meteor Crush",
      counter: "Obsidian Spikes", eruption: "Eruption"
    },
    signature: "Eruption burns anyone not defending — Clerics !heal to douse it"
  },
  shadow_lich: {
    name: "SHADOW LICH",
    element: "shadow",
    biome: "crypt",
    icon: "💀",
    moves: {
      swipe: "Shadow Bolt", strike: "Soul Spear", counter: "Bone Ward", storm: "Death Wail",
      curse: "Hex of Decay"
    },
    signature: "Hex drains its target every round until a Cleric heals them"
  },
  storm_roc: {
    name: "STORM ROC",
    element: "storm",
    biome: "sky",
    icon: "🪶",
    moves: {
      swipe: "Talon Rake", strike: "Dive Bomb", windup: "Thunderclap", power: "Thunderclap",
      counter: "Static Field", chain: "Chain Lightning"
    },
    signature: "Chain Lightning arcs through neighbors — the marked slots defend"
  }
};

const BOSS_IDS = Object.keys(BOSS_INFO);
const DAMAGE_TYPES = ["physical", "fire", "holy"];

/** "POWERFUL EMBER GOLEM" etc. */
function bossName(bossId, variant = "standard") {
  const prefix = BOSS_VARIANTS[variant]?.prefix;
  return prefix ? `${prefix} ${BOSS_INFO[bossId].name}` : BOSS_INFO[bossId].name;
}

function moveName(bossId, kind) {
  return BOSS_INFO[bossId].moves[kind] ?? kind;
}

// { weak: ["fire"], resists: [] } from the boss's damageTaken multipliers.
function elementChips(bossId) {
  const taken = BOSSES[bossId].damageTaken ?? {};
  return {
    weak: DAMAGE_TYPES.filter(t => (taken[t] ?? 1) > 1),
    resists: DAMAGE_TYPES.filter(t => (taken[t] ?? 1) < 1)
  };
}

// What the overlay needs to draw a boss (sent with every state).
function bossDisplay(bossId) {
  const info = BOSS_INFO[bossId];
  return { id: bossId, name: info.name, element: info.element, biome: info.biome,
    signature: info.signature, ...elementChips(bossId) };
}

/** Matches "golem", "ember", "Storm Roc", "lich"... to a boss id, or null. */
function findBoss(query) {
  const q = (query ?? "").toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (!q) return null;
  return BOSS_IDS.find(id => id === q.replace(/ /g, "_"))
    ?? BOSS_IDS.find(id => BOSS_INFO[id].name.toLowerCase().split(" ").includes(q))
    ?? BOSS_IDS.find(id => BOSS_INFO[id].name.toLowerCase().startsWith(q))
    ?? null;
}

module.exports = { BOSS_INFO, BOSS_IDS, bossName, moveName, bossDisplay, findBoss };
