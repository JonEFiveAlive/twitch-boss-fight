// Placeholder pixel art for the overlay: 16x16-grid SVG rects, characters facing
// left toward the boss. Loaded before overlay.js, which uses the helpers below.
//
// Each part is [x, y, w, h, fill, slot?, tone?]. A part tagged with a gear slot is
// recolored when the player has an uncommon-or-better item there ("main" tone for
// big pieces, "light" for blades/gems); rare and epic items also add RARE_EXTRAS.

const SPRITE_PARTS = {
  tank: [
    [7, 0, 2, 1, "#e83b3b", "head", "light"],  // plume
    [5, 1, 6, 5, "#9aa3b5", "head"],           // helmet
    [5, 3, 6, 1, "#1a1a2e"],                   // visor
    [5, 6, 6, 6, "#6b7690", "body"],           // breastplate
    [5, 10, 6, 1, "#d4a854"],                  // belt
    [5, 12, 2, 3, "#3a4256"], [9, 12, 2, 3, "#3a4256"],
    [1, 6, 4, 7, "#3a5bd9", "offhand"],        // shield
    [2, 8, 2, 3, "#d4a854"],                   // shield emblem
    [11, 7, 2, 2, "#6b7690", "body"],          // arm
    [13, 2, 1, 7, "#dfe6f2", "weapon", "light"], // blade
    [12, 8, 3, 1, "#d4a854"]                   // hilt
  ],
  mage: [
    [6, 0, 2, 1, "#7c4dff", "head", "light"], [5, 1, 4, 2, "#7c4dff", "head", "light"], // hat
    [3, 3, 9, 1, "#5b2fd6", "head"],           // brim
    [5, 4, 5, 3, "#f2c9a0"], [6, 5, 1, 1, "#1a1a2e"],
    [4, 7, 7, 7, "#5b2fd6", "body"],           // robe
    [4, 13, 7, 1, "#d4a854"],                  // hem
    [5, 14, 2, 1, "#3a2a5e"], [8, 14, 2, 1, "#3a2a5e"],
    [2, 4, 1, 11, "#8b5a2b", "weapon"],        // staff
    [1, 1, 3, 3, "#ff8a3d", "offhand", "light"], // orb
    [2, 2, 1, 1, "#ffe08a"]
  ],
  cleric: [
    [4, 1, 7, 6, "#e8e8f8", "head", "light"],  // hood
    [5, 3, 4, 3, "#f2c9a0"], [5, 4, 1, 1, "#1a1a2e"],
    [4, 7, 7, 7, "#d8d8ee", "body", "light"],  // vestments
    [7, 8, 1, 4, "#d4a854"], [6, 9, 3, 1, "#d4a854"], // holy symbol
    [5, 14, 2, 1, "#6a6a8a"], [8, 14, 2, 1, "#6a6a8a"],
    [2, 3, 1, 12, "#d4a854", "weapon"],        // rod
    [1, 1, 3, 2, "#44ff88", "offhand", "light"] // relic gem
  ],
  fallen: [
    [5, 3, 6, 2, "#4a4a6a"], [4, 5, 8, 9, "#4a4a6a"], [7, 6, 2, 6, "#2a2a40"],
    [5, 7, 6, 2, "#2a2a40"], [2, 14, 12, 1, "#2a2a40"]
  ]
};

const RARITY_TONES = {
  uncommon: { main: "#3f8f4f", light: "#8fe08f" },
  rare:     { main: "#3a68cc", light: "#9cc4ff" },
  epic:     { main: "#7d45cc", light: "#d8b0ff" }
};

// Flourishes for rare/epic items in a slot.
const RARE_EXTRAS = {
  tank: {
    head: [[3, 0, 1, 2, "#e8e8f8"], [4, 2, 1, 2, "#e8e8f8"], [12, 0, 1, 2, "#e8e8f8"], [11, 2, 1, 2, "#e8e8f8"]], // horns
    body: [[4, 6, 1, 2, "#ffd76a"], [11, 6, 1, 1, "#ffd76a"]]  // pauldrons
  },
  mage: {
    head: [[7, 2, 1, 1, "#ffe08a"]],                            // hat star
    body: [[4, 9, 7, 1, "#ffd76a"]]                             // sash
  },
  cleric: {
    head: [[4, 1, 7, 1, "#ffd76a"], [7, 0, 1, 1, "#ffd76a"]],  // gold circlet
    body: [[3, 7, 2, 2, "#ffd76a"], [10, 7, 2, 2, "#ffd76a"]]  // pauldrons
  }
};

// A trinket shows as a colored glow around the whole sprite.
const TRINKET_GLOW = { uncommon: "#5fd35f", rare: "#5aa0ff", epic: "#c77dff" };

// Loot icons (results screen). "M"/"L" fills take the item's rarity main/light tone.
const ITEM_TONES = { common: { main: "#8a93a8", light: "#c8ccd8" }, ...RARITY_TONES };
const ITEM_ICONS = {
  weapon: {
    tank:   [[7, 1, 2, 9, "L"], [4, 10, 8, 2, "M"], [7, 12, 2, 3, "#8b5a2b"], [7, 15, 2, 1, "#d4a854"]],
    mage:   [[7, 5, 2, 10, "#8b5a2b"], [5, 1, 6, 4, "M"], [6, 2, 2, 1, "L"]],
    cleric: [[7, 7, 2, 8, "#8b5a2b"], [4, 2, 8, 5, "M"], [3, 4, 1, 1, "L"], [12, 4, 1, 1, "L"], [7, 1, 2, 1, "L"]]
  },
  offhand: {
    tank:   [[3, 2, 10, 7, "M"], [4, 9, 8, 2, "M"], [5, 11, 6, 2, "M"], [7, 13, 2, 1, "M"], [7, 4, 2, 6, "#d4a854"], [5, 6, 6, 2, "#d4a854"]],
    mage:   [[3, 2, 10, 12, "M"], [3, 2, 2, 12, "#1a1a2e"], [7, 6, 4, 1, "L"], [7, 8, 4, 1, "L"], [7, 10, 3, 1, "L"]],
    cleric: [[7, 1, 2, 4, "#d4a854"], [5, 5, 6, 6, "M"], [6, 6, 2, 2, "L"], [7, 11, 2, 2, "M"]]
  },
  head:    { any: [[4, 3, 8, 8, "M"], [4, 7, 8, 1, "#1a1a2e"], [7, 1, 2, 2, "L"], [3, 5, 1, 4, "M"], [12, 5, 1, 4, "M"]] },
  body:    { any: [[3, 3, 10, 4, "M"], [4, 7, 8, 7, "M"], [7, 4, 2, 9, "L"], [4, 11, 8, 1, "#d4a854"]] },
  trinket: { any: [[6, 1, 4, 1, "#d4a854"], [5, 2, 1, 3, "#d4a854"], [10, 2, 1, 3, "#d4a854"], [5, 6, 6, 6, "M"], [6, 7, 2, 2, "L"]] }
};

function itemSvg(slot, classId, rarity, size) {
  const tones = ITEM_TONES[rarity] ?? ITEM_TONES.common;
  const parts = ITEM_ICONS[slot]?.[classId] ?? ITEM_ICONS[slot]?.any ?? [];
  const body = parts
    .map(([x, y, w, h, fill]) => rectSvg([x, y, w, h, fill === "M" ? tones.main : fill === "L" ? tones.light : fill]))
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
}

// Single-color action icons; they take the surrounding text color.
const ICONS = {
  attack: '<rect x="7" y="1" width="2" height="9"/><rect x="4" y="10" width="8" height="2"/><rect x="7" y="12" width="2" height="3"/>',
  defend: '<rect x="3" y="2" width="10" height="7"/><rect x="4" y="9" width="8" height="2"/><rect x="5" y="11" width="6" height="2"/><rect x="7" y="13" width="2" height="1"/>',
  heal:   '<rect x="6" y="2" width="4" height="12"/><rect x="2" y="6" width="12" height="4"/>',
  fire:   '<rect x="7" y="1" width="2" height="3"/><rect x="5" y="4" width="6" height="3"/><rect x="4" y="7" width="8" height="5"/><rect x="5" y="12" width="6" height="2"/>',
  taunt:  '<rect x="6" y="1" width="4" height="9"/><rect x="6" y="12" width="4" height="3"/>',
  revive: '<rect x="7" y="2" width="2" height="10"/><rect x="5" y="4" width="6" height="2"/><rect x="3" y="6" width="2" height="2"/><rect x="11" y="6" width="2" height="2"/><rect x="3" y="13" width="10" height="2"/>'
};

const rectSvg = ([x, y, w, h, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** look: { slot: rarity } for the player's equipped gear (optional). */
function spriteSvg(name, size, look = {}) {
  const parts = SPRITE_PARTS[name] ?? SPRITE_PARTS.tank;
  let body = parts
    .map(([x, y, w, h, fill, slot, tone = "main"]) => rectSvg([x, y, w, h, RARITY_TONES[look[slot]]?.[tone] ?? fill]))
    .join("");
  for (const [slot, extras] of Object.entries(RARE_EXTRAS[name] ?? {})) {
    if (look[slot] === "rare" || look[slot] === "epic") body += extras.map(rectSvg).join("");
  }
  const glow = TRINKET_GLOW[look.trinket];
  const style = glow ? ` style="filter: drop-shadow(0 0 ${Math.max(2, Math.round(size / 14))}px ${glow})"` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"${style}>${body}</svg>`;
}

// Bosses (32x28 grid), facing the party on the right. Placeholder art like the rest.
const BOSS_SPRITES = {
  frost_wyrm: [
    [0,20,6,3,"#4fa3d9"], [2,18,3,2,"#4fa3d9"], [9,4,3,10,"#2e6f9e"], [12,6,3,8,"#2e6f9e"], [15,8,3,6,"#2e6f9e"],
    [10,7,7,6,"#3d88bf"], [6,14,15,9,"#4fa3d9"], [8,19,11,4,"#bfe6ff"], [7,12,1,2,"#e8f6ff"], [19,12,1,2,"#e8f6ff"],
    [8,23,3,4,"#2e6f9e"], [15,23,3,4,"#2e6f9e"], [7,27,2,1,"#e8e8f8"], [14,27,2,1,"#e8e8f8"], [19,9,4,8,"#4fa3d9"],
    [21,5,8,6,"#4fa3d9"], [28,7,4,3,"#4fa3d9"], [24,10,7,2,"#2e6f9e"], [25,6,2,2,"#ff4444"], [26,6,1,1,"#ffe08a"],
    [22,2,2,3,"#e8e8f8"], [24,3,2,2,"#e8e8f8"], [27,10,1,2,"#e8f6ff"], [30,10,1,2,"#e8f6ff"]
  ],
  ember_golem: [
    [8,22,5,6,"#3a2f2a"], [17,22,5,6,"#3a2f2a"], [6,9,18,13,"#4a3c34"], [7,9,16,2,"#5c4a40"],
    [1,10,5,11,"#4a3c34"], [0,19,6,5,"#5c4a40"], [24,10,6,11,"#4a3c34"], [24,19,7,5,"#5c4a40"],
    [5,8,4,3,"#6e5a4c"], [22,8,4,3,"#6e5a4c"], [11,3,9,7,"#5c4a40"], [12,2,7,1,"#6e5a4c"],
    [13,5,2,2,"#ffb347"], [17,5,2,2,"#ffb347"], [14,8,4,1,"#2a201c"],
    [10,12,1,6,"#ff7a1a"], [11,17,4,1,"#ff7a1a"], [19,11,1,5,"#ff7a1a"], [16,15,4,1,"#ffb347"],
    [14,19,1,3,"#ff7a1a"], [13,12,4,3,"#ffd27a"], [2,13,2,1,"#ff7a1a"], [26,13,1,3,"#ff7a1a"],
    [3,6,1,1,"#ffb347"], [27,4,1,1,"#ff7a1a"], [25,2,1,1,"#ffd27a"], [29,7,1,1,"#ffb347"]
  ],
  shadow_lich: [
    [9,10,13,14,"#3b2560"], [9,24,3,2,"#3b2560"], [14,24,3,3,"#3b2560"], [19,24,3,2,"#3b2560"],
    [10,12,2,12,"#2a1845"], [17,13,1,10,"#2a1845"], [9,10,13,1,"#7a4fc4"], [15,11,1,13,"#7a4fc4"],
    [10,3,11,8,"#2a1845"], [11,2,9,1,"#3b2560"], [13,5,6,5,"#e6e0cc"],
    [14,6,1,2,"#7dff9a"], [17,6,1,2,"#7dff9a"], [14,9,4,1,"#b8b09a"],
    [6,13,4,2,"#3b2560"], [5,14,2,2,"#e6e0cc"], [21,12,4,2,"#3b2560"], [24,12,2,2,"#e6e0cc"],
    [25,4,1,22,"#6b4a2a"], [24,1,3,3,"#7dff9a"], [23,2,1,1,"#c8ffd8"], [27,2,1,1,"#c8ffd8"],
    [3,6,1,1,"#a37dff"], [7,3,1,1,"#a37dff"], [28,18,1,1,"#a37dff"], [2,19,1,1,"#a37dff"]
  ],
  storm_roc: [
    [10,12,12,8,"#5a6b8c"], [12,16,8,4,"#b9c6dd"], [21,7,6,6,"#5a6b8c"], [22,4,2,3,"#3e4a66"], [24,3,2,3,"#3e4a66"],
    [27,9,4,2,"#f2c94c"], [27,11,3,1,"#d9a93a"], [24,8,1,1,"#ffffff"], [25,8,1,1,"#1a1a2e"],
    [2,4,10,9,"#3e4a66"], [0,2,4,3,"#3e4a66"], [4,1,3,3,"#3e4a66"], [3,7,8,1,"#7a8bb0"], [4,10,7,1,"#7a8bb0"],
    [9,9,4,4,"#3e4a66"], [5,15,6,3,"#3e4a66"], [2,16,3,2,"#3e4a66"],
    [13,20,2,5,"#f2c94c"], [18,20,2,5,"#f2c94c"], [12,25,4,1,"#d9a93a"], [17,25,4,1,"#d9a93a"],
    [8,0,1,3,"#fff27a"], [9,2,1,2,"#fff27a"], [8,4,1,1,"#fff27a"], [29,15,1,3,"#fff27a"], [30,17,1,2,"#fff27a"],
    [28,19,1,1,"#fff27a"]
  ]
};
function bossSvg(bossId, width) {
  const parts = BOSS_SPRITES[bossId] ?? BOSS_SPRITES.frost_wyrm;
  const height = Math.round(width * 28 / 32);
  return `<svg width="${width}" height="${height}" viewBox="0 0 32 28" shape-rendering="crispEdges" aria-hidden="true">${parts.map(rectSvg).join("")}</svg>`;
}

// Raid chest (16x16): wood body, gold bands and lock. `open` lifts the lid off a glow.
const CHEST_PARTS = [
  [1, 7, 14, 8, "#7a4a22"], [1, 7, 14, 1, "#a8692f"], [2, 9, 12, 5, "#8f5726"],
  [1, 10, 14, 1, "#d4a854"], [3, 7, 2, 8, "#d4a854"], [11, 7, 2, 8, "#d4a854"],
  [7, 9, 2, 3, "#ffe08a"], [7, 11, 2, 1, "#5a3518"]
];
const CHEST_LID = [[1, 3, 14, 4, "#8f5726"], [2, 2, 12, 1, "#a8692f"], [3, 2, 2, 5, "#d4a854"], [11, 2, 2, 5, "#d4a854"]];
const CHEST_OPEN_LID = [[1, 1, 14, 3, "#8f5726"], [3, 1, 2, 3, "#d4a854"], [11, 1, 2, 3, "#d4a854"], [2, 4, 12, 3, "#ffe08a"]];
function chestSvg(size, open = false) {
  const parts = [...CHEST_PARTS, ...(open ? CHEST_OPEN_LID : CHEST_LID)];
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${parts.map(rectSvg).join("")}</svg>`;
}

function iconSvg(name, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;
}
