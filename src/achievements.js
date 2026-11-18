// Awards: tiered achievement tracks that grant titles, name-plate frames and auras.
// Pure data + helpers; progress.js stores what each player has earned.
//
// Every track has four tiers (bronze, silver, gold, legendary), each with a title.
// A player's best tier across all tracks sets their name-plate frame; every
// legendary tier also unlocks an aura (a cosmetic effect around their sprite).
// Titles and auras are chosen with !title / !aura; until a player chooses, the best
// one they've earned is shown. Like the boss table, the thresholds here are content:
// tune them freely (players keep tiers they've already earned).

const TIERS = ["bronze", "silver", "gold", "legendary"];

// stat: which lifetime stat (see progress.js awardStats) a track counts.
const TRACKS = [
  { id: "frost_wyrm", stat: "wins:frost_wyrm", noun: "Frost Wyrms defeated", at: [10, 25, 50, 100],
    titles: ["Frostbreaker", "Wyrmslayer", "Wyrmbane", "Wyrm Sovereign"], aura: "frostbound" },
  { id: "ember_golem", stat: "wins:ember_golem", noun: "Ember Golems defeated", at: [10, 25, 50, 100],
    titles: ["Stonebreaker", "Golem Smasher", "Magma Walker", "Heart of the Forge"], aura: "emberheart" },
  { id: "shadow_lich", stat: "wins:shadow_lich", noun: "Shadow Liches defeated", at: [10, 25, 50, 100],
    titles: ["Hexbreaker", "Lichbane", "Soulwarden", "The Deathless"], aura: "voidtouched" },
  { id: "storm_roc", stat: "wins:storm_roc", noun: "Storm Rocs defeated", at: [10, 25, 50, 100],
    titles: ["Skyhunter", "Rocslayer", "Stormbreaker", "Thunderborn"], aura: "stormcaller" },
  { id: "victories", stat: "wins", noun: "battles won", at: [25, 100, 250, 500],
    titles: ["Brawler", "Champion", "Warlord", "Undefeated"], aura: "victor" },
  { id: "raids", stat: "raids", noun: "raids cleared", at: [1, 5, 15, 30],
    titles: ["Raider", "Raid Veteran", "Raid Champion", "Raid Legend"], aura: "crown" },
  { id: "mythic", stat: "raids:mythic", noun: "Mythic raids cleared", at: [1, 3, 10, 25],
    titles: ["Mythbreaker", "Mythslayer", "Myth Made Flesh", "Living Legend"], aura: "radiant" },
  { id: "revives", stat: "revives", noun: "allies revived", at: [10, 50, 150, 300],
    titles: ["Medic", "Lifesaver", "Miracle Worker", "Angel of Mercy"], aura: "halo" },
  { id: "daring", stat: "daring", noun: "daring hits landed", at: [25, 100, 250, 500],
    titles: ["Bold", "Daredevil", "Fearless", "Unflinching"], aura: "blaze" },
  { id: "level", stat: "level", noun: "highest class level", at: [10, 25, 50, 100],
    titles: ["Adventurer", "Veteran", "Hero of the Realm", "Ascendant"], aura: "ascendant" }
];

// Auras (legendary rewards). glyph: the particle that drifts around the sprite;
// accessory: a pixel item drawn above the head instead (see sprites.js).
const AURAS = {
  frostbound:  { name: "Frostbound",  color: "#bfe6ff", glyph: "❄" },
  emberheart:  { name: "Emberheart",  color: "#ff9a3d", glyph: "✦" },
  voidtouched: { name: "Voidtouched", color: "#c39bff", glyph: "✧" },
  stormcaller: { name: "Stormcaller", color: "#fff27a", glyph: "ϟ" },
  victor:      { name: "Victor",      color: "#7dffb0", glyph: "✚" },
  crown:       { name: "Crown",       color: "#ffd76a", accessory: "crown" },
  radiant:     { name: "Radiant",     color: "#ff9ef0", glyph: "✶" },
  halo:        { name: "Halo",        color: "#ffe08a", accessory: "halo" },
  blaze:       { name: "Blaze",       color: "#ff5a3d", glyph: "▲" },
  ascendant:   { name: "Ascendant",   color: "#ffffff", glyph: "✦" }
};

const trackById = Object.fromEntries(TRACKS.map(t => [t.id, t]));

/** Highest tier index (0–3) a stat value reaches on a track, or -1. */
function tierFor(track, value) {
  let tier = -1;
  track.at.forEach((threshold, i) => { if (value >= threshold) tier = i; });
  return tier;
}

/** Every tier reached for a stats object: [{ trackId, tier }]. */
function tiersReached(stats) {
  return TRACKS.map(t => ({ trackId: t.id, tier: tierFor(t, stats[t.stat] ?? 0) })).filter(x => x.tier >= 0);
}

/**
 * What a player shows, from their earned tiers ([{ trackId, tier, earnedAt }]) and
 * their choices (title / aura: a choice, "" for none, null for automatic).
 * Returns { title, aura, frame, titles: [...], auras: [...] }.
 */
function cosmeticsFor(earned, { title = null, aura = null } = {}) {
  // Every title on a track up to the tier reached, best tiers first.
  const titles = [];
  const auras = [];
  const ranked = earned.slice().sort((a, b) => b.tier - a.tier || String(b.earnedAt).localeCompare(String(a.earnedAt)));
  for (const { trackId, tier } of ranked) {
    const track = trackById[trackId];
    if (!track) continue;
    for (let i = tier; i >= 0; i--) titles.push({ title: track.titles[i], tier: i, trackId });
    if (tier === 3) auras.push(track.aura);
  }
  const best = ranked[0]?.tier ?? -1;
  const pickTitle = title === null ? titles[0]?.title ?? null : title === "" ? null : titles.find(t => t.title === title)?.title ?? titles[0]?.title ?? null;
  const pickAura = aura === null ? auras[0] ?? null : aura === "" ? null : auras.includes(aura) ? aura : auras[0] ?? null;
  return {
    title: pickTitle,
    titleTier: titles.find(t => t.title === pickTitle)?.tier ?? null,
    aura: pickAura,
    frame: best >= 0 ? TIERS[best] : null,
    titles,
    auras
  };
}

/** The chat line for a newly earned tier. */
function awardMessage(name, trackId, tier, value) {
  const track = trackById[trackId];
  const title = track.titles[tier];
  if (tier === 3) {
    return `✨ LEGENDARY! ${name} becomes "${title}" (${track.at[tier]} ${track.noun}) and unlocks the ${AURAS[track.aura].name} aura!`;
  }
  return `🏅 ${name} earned the title "${title}" — ${track.at[tier]} ${track.noun}!`;
}

/** Matches a typed title or aura name against a list (exact, then prefix, then partial). */
function matchName(query, names) {
  const q = (query ?? "").toLowerCase().replace(/^"|"$/g, "").trim();
  if (!q) return null;
  const lower = names.map(n => [n, n.toLowerCase()]);
  const unique = (list) => (list.length === 1 ? list[0][0] : null);
  return lower.find(([, l]) => l === q)?.[0]
    ?? unique(lower.filter(([, l]) => l.startsWith(q)))
    ?? unique(lower.filter(([, l]) => l.includes(q)));
}

module.exports = { TIERS, TRACKS, AURAS, tierFor, tiersReached, cosmeticsFor, awardMessage, matchName };
