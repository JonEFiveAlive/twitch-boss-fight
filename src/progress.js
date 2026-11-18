// Persistent player progression (Phase 5a): per-user, per-class profiles, fight
// history, and per-boss win counters in SQLite. Like fight.js, this knows nothing
// about Twitch or Socket.IO — the game loop hands it a finished fight's summary.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  XP_PER_ACTIVE_ROUND,
  XP_WIN_BONUS,
  XP_SPEED_BONUS_PER_ROUND,
  LEVEL_XP_BASE,
  LEVEL_XP_GROWTH,
  TARGET_FIGHT_ROUNDS
} = require("./gameConfig");

// v2 (Phase 6) added `items`; CREATE TABLE IF NOT EXISTS upgrades v1 databases in place.
const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    user_id      TEXT PRIMARY KEY,           -- Twitch user ID (stable across renames)
    display_name TEXT NOT NULL,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS class_profiles (
    user_id       TEXT NOT NULL,
    class_id      TEXT NOT NULL,
    xp            INTEGER NOT NULL DEFAULT 0, -- lifetime XP; level is derived from it
    level         INTEGER NOT NULL DEFAULT 1,
    battles       INTEGER NOT NULL DEFAULT 0,
    wins          INTEGER NOT NULL DEFAULT 0,
    rounds_active INTEGER NOT NULL DEFAULT 0,
    damage_dealt  INTEGER NOT NULL DEFAULT 0,
    healing_done  INTEGER NOT NULL DEFAULT 0,
    revives       INTEGER NOT NULL DEFAULT 0,
    kos_taken     INTEGER NOT NULL DEFAULT 0,
    daring_hits   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, class_id)
  );
  -- Feeds future titles ("defeat the Powerful Frost Wyrm 25 times").
  CREATE TABLE IF NOT EXISTS boss_wins (
    user_id TEXT NOT NULL,
    boss_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    wins    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, boss_id, variant)
  );
  CREATE TABLE IF NOT EXISTS fights (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ended_at   TEXT NOT NULL,
    boss_id    TEXT NOT NULL,
    variant    TEXT NOT NULL,
    outcome    TEXT NOT NULL,                -- "win" | "loss" | "ended" (called off by a mod)
    rounds     INTEGER NOT NULL,
    party_size INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fight_players (
    fight_id      INTEGER NOT NULL REFERENCES fights(id),
    user_id       TEXT NOT NULL,
    class_id      TEXT NOT NULL,
    rounds_active INTEGER NOT NULL,
    damage_dealt  INTEGER NOT NULL,
    healing_done  INTEGER NOT NULL,
    revives       INTEGER NOT NULL,
    kos_taken     INTEGER NOT NULL,
    daring_hits   INTEGER NOT NULL,
    finished      INTEGER NOT NULL,           -- 1 if still in the party when the fight ended
    xp_earned     INTEGER NOT NULL,
    PRIMARY KEY (fight_id, user_id, class_id)  -- a player can fight one fight as two classes (flee + rejoin)
  );
  -- Every gear drop ever received; at most one equipped per user/class/slot.
  CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    class_id    TEXT NOT NULL,
    slot        TEXT NOT NULL,              -- weapon | offhand | head | body | trinket
    rarity      TEXT NOT NULL,              -- common | uncommon | rare | epic
    name        TEXT NOT NULL,
    stat        TEXT NOT NULL,              -- power | defense
    value       REAL NOT NULL,              -- e.g. 0.075 = +7.5%
    equipped    INTEGER NOT NULL DEFAULT 0,
    fight_id    INTEGER REFERENCES fights(id),
    acquired_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_owner ON items (user_id, class_id, equipped);
`;

// XP needed to go from `level` to `level + 1`.
function xpToNextLevel(level) {
  return LEVEL_XP_BASE + LEVEL_XP_GROWTH * (level - 1);
}

function levelForXp(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level += 1;
  }
  return level;
}

// Rogue-lite XP: active rounds always pay; finishing a won fight adds the win bonus,
// plus the shared speed bonus for every round under par.
function xpForFight(stat, { outcome, rounds }) {
  let xp = stat.roundsActive * XP_PER_ACTIVE_ROUND;
  if (outcome === "win" && stat.finished) {
    xp += XP_WIN_BONUS + Math.max(0, TARGET_FIGHT_ROUNDS - rounds) * XP_SPEED_BONUS_PER_ROUND;
  }
  return xp;
}

function openProgressStore(dbFile) {
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);

  const upsertPlayer = db.prepare(`
    INSERT INTO players (user_id, display_name, first_seen, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen`);
  const getProfile = db.prepare("SELECT * FROM class_profiles WHERE user_id = ? AND class_id = ?");
  const upsertProfile = db.prepare(`
    INSERT INTO class_profiles (user_id, class_id, xp, level, battles, wins, rounds_active,
      damage_dealt, healing_done, revives, kos_taken, daring_hits)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, class_id) DO UPDATE SET
      xp = excluded.xp, level = excluded.level, battles = battles + 1, wins = wins + excluded.wins,
      rounds_active = rounds_active + excluded.rounds_active, damage_dealt = damage_dealt + excluded.damage_dealt,
      healing_done = healing_done + excluded.healing_done, revives = revives + excluded.revives,
      kos_taken = kos_taken + excluded.kos_taken, daring_hits = daring_hits + excluded.daring_hits`);
  const insertFight = db.prepare(
    "INSERT INTO fights (ended_at, boss_id, variant, outcome, rounds, party_size) VALUES (?, ?, ?, ?, ?, ?)");
  const insertFightPlayer = db.prepare(`
    INSERT INTO fight_players (fight_id, user_id, class_id, rounds_active, damage_dealt, healing_done,
      revives, kos_taken, daring_hits, finished, xp_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addBossWin = db.prepare(`
    INSERT INTO boss_wins (user_id, boss_id, variant, wins) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, boss_id, variant) DO UPDATE SET wins = wins + 1`);
  const equippedItems = db.prepare(
    "SELECT slot, rarity, name, stat, value FROM items WHERE user_id = ? AND class_id = ? AND equipped = 1");
  const equippedInSlot = db.prepare(
    "SELECT id, value FROM items WHERE user_id = ? AND class_id = ? AND slot = ? AND equipped = 1");
  const unequipItem = db.prepare("UPDATE items SET equipped = 0 WHERE id = ?");
  const insertItem = db.prepare(`
    INSERT INTO items (user_id, class_id, slot, rarity, name, stat, value, equipped, fight_id, acquired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Saves an item; a drop that strictly beats the equipped item in its slot replaces
  // it (auto-equip until the companion app exists), anything else goes to inventory.
  function storeItem(userId, classId, item, fightId, now) {
    const current = equippedInSlot.get(userId, classId, item.slot);
    const upgrade = !current || item.value > current.value;
    if (upgrade && current) unequipItem.run(current.id);
    insertItem.run(userId, classId, item.slot, item.rarity, item.name, item.stat, item.value,
      upgrade ? 1 : 0, fightId, now);
    return { ...item, equipped: upgrade };
  }

  const topProfiles = db.prepare(`
    SELECT p.display_name AS name, c.class_id AS classId, c.level, c.xp, c.wins
    FROM class_profiles c JOIN players p USING (user_id)
    ORDER BY c.level DESC, c.xp DESC, c.wins DESC LIMIT ?`);

  return {
    /** Level of a user's class profile (1 if they've never played that class). */
    levelOf(userId, classId) {
      return getProfile.get(userId, classId)?.level ?? 1;
    },

    leaderboard(limit = 5) {
      return topProfiles.all(limit);
    },

    /** Items currently equipped on a user's class: [{ slot, rarity, name, stat, value }]. */
    equippedGear(userId, classId) {
      return equippedItems.all(userId, classId);
    },

    /** Saves items outside a fight (raid chests), in order, auto-equipping upgrades. */
    awardItems(userId, classId, items) {
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        const saved = items.map(item => storeItem(userId, classId, item, null, now));
        db.exec("COMMIT");
        return saved;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    /**
     * Saves a finished fight and returns each player's XP result (plus their drop, if
     * any, flagged `equipped` when it beat the item in its slot and was auto-equipped).
     * summary: { bossId, variant, outcome, rounds, players: [{ userId, name, classId,
     *   roundsActive, damage, healing, revives, kos, daringHits, finished, drop? }] }
     */
    recordFight(summary) {
      const now = new Date().toISOString();
      const results = [];
      db.exec("BEGIN");
      try {
        const { lastInsertRowid: fightId } = insertFight.run(
          now, summary.bossId, summary.variant, summary.outcome, summary.rounds, summary.players.length);
        for (const stat of summary.players) {
          const before = getProfile.get(stat.userId, stat.classId);
          const oldXp = before?.xp ?? 0;
          const oldLevel = before?.level ?? 1;
          const xpEarned = xpForFight(stat, summary);
          const newLevel = levelForXp(oldXp + xpEarned);
          const won = summary.outcome === "win" && stat.finished ? 1 : 0;

          upsertPlayer.run(stat.userId, stat.name, now, now);
          upsertProfile.run(stat.userId, stat.classId, oldXp + xpEarned, newLevel, won, stat.roundsActive,
            stat.damage, stat.healing, stat.revives, stat.kos, stat.daringHits);
          insertFightPlayer.run(fightId, stat.userId, stat.classId, stat.roundsActive, stat.damage, stat.healing,
            stat.revives, stat.kos, stat.daringHits, stat.finished ? 1 : 0, xpEarned);
          if (won) addBossWin.run(stat.userId, summary.bossId, summary.variant);

          const drop = stat.drop ? storeItem(stat.userId, stat.classId, stat.drop, fightId, now) : null;

          results.push({ ...stat, drop, xpEarned, level: newLevel, leveledUp: newLevel > oldLevel });
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return results;
    },

    close() {
      db.close();
    }
  };
}

module.exports = { openProgressStore, levelForXp, xpToNextLevel, xpForFight };
