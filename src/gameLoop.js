const { createFight, addPlayer, bossHpForParty, variantForParty, raidTierFor, resolveRound } = require("./fight");
const { chooseBossMove, describeMove, moveTitle } = require("./bossMoves");
const { BOSS_IDS, BOSS_INFO, bossName, bossDisplay, findBoss } = require("./bosses");
const { AURAS, TRACKS, awardMessage, matchName } = require("./achievements");
const { xpForFight } = require("./progress");
const { playerPower } = require("./power");
const { rollDrop, makeItem, lootEligible, gearBonuses } = require("./loot");
const { isNpcId, npcAlliesFor, npcPower, npcAction } = require("./npc");
const {
  CLASSES,
  ENDED_PAUSE_SECONDS,
  RAID_STAGES,
  RAID_LOBBY_SECONDS,
  RAID_INTERMISSION_SECONDS,
  RAID_RESULTS_SECONDS,
  RAID_VOTE_ENABLED_DEFAULT,
  RAID_VOTE_MIN_VOTES,
  RAID_VOTE_SHARE,
  RAID_CLEAR_BONUS_CHESTS,
  RAID_CHEST_LUCK_STEP,
  XP_SPEED_BONUS_PER_ROUND,
  MAX_ACTIVE_FIGHTERS,
  REVIVE_WINDOW_ROUNDS,
  FLEE_AFTER_MISSED_ROUNDS,
  TARGET_FIGHT_ROUNDS,
  MIN_JOIN_ROUNDS,
  INPUT_WINDOW_SECONDS,
  RESULTS_PAUSE_SECONDS,
  RESULTS_MS_PER_EVENT,
  LOBBY_JOIN_SECONDS,
  MANUAL_START_DEFAULT,
  GAME_OPEN_ON_START,
  NPC_ALLIES_DEFAULT,
  NPC_ONLY_INPUT_SECONDS,
  NPC_REVIVE_GRACE_ROUNDS
} = require("./gameConfig");

const TARGETED_ACTIONS = ["heal", "revive"];
const CLOSED_MESSAGE = "The game is closed for now — thanks for playing!";
const RAID_LENGTH = RAID_STAGES.length;
const CLASS_NAMES = { tank: "Tank", mage: "Mage", cleric: "Cleric" };

// What the lobby's class cards show, straight from the class config.
const CLASS_INFO = Object.fromEntries(Object.entries(CLASSES).map(([id, c]) => [id, {
  maxHp: c.maxHp, maxMp: c.maxMp, attack: c.attack, expectedDamage: c.expectedDamage, actions: c.actions
}]));

// "LESSER FROST WYRM" -> "Lesser Frost Wyrm", for chat messages.
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// Phases: "lobby" | "input" | "resolving" | "results" | "intermission" (between raid
// battles) | "ended" (results screen; after a raid, the chest-opening summary) |
// "closed" (no game running until a mod's !opengame)

/**
 * @param io      Socket.IO server to broadcast state on
 * @param options fetchAvatar(userId) -> Promise<url|null>; store: a progress store
 *                (src/progress.js) or null to skip saving; announce(message) posts to chat.
 */
function createGameLoop(io, { fetchAvatar = null, store = null, announce = () => {} } = {}) {
  let phase = "lobby";
  let fight = null;
  let joinedUsers = new Set();
  let joinedClasses = {};      // userId -> classId chosen in the lobby
  let pendingActions = {};     // userId -> action name ("attack", "heal", "fire", ...)
  let pendingTargets = {};     // userId -> targetId for heal/revive (null = auto-pick at resolution)
  let queue = [];              // [{ userId, classId }] waiting for a slot; survives into the next lobby
  let countdownTimer = null;
  let countdownSecondsLeft = 0;
  let upcomingMoveLabel = "";
  let lastState = null;
  let avatarCache = {}; // userId -> Twitch profile_image_url, persists across rounds
  let playerNames = {}; // userId -> Twitch display name, refreshed on each !join
  const avatarRequests = new Set();
  // "userId:classId" -> this fight's tallies. Kept even if the player leaves mid-fight,
  // and per class, so someone who flees and rejoins as another class keeps both.
  let fightStats = {};
  const levelCache = new Map(); // "userId:classId" -> level, cleared whenever a fight is saved
  const gearCache = new Map();  // "userId:classId" -> gearBonuses(), cleared likewise
  const cosmeticsCache = new Map(); // userId -> store.cosmetics(), cleared when awards or choices change
  const titlesAsked = new Map();    // userId -> when they last used !titles (it posts to chat)
  let leaderboard = store ? store.leaderboard() : [];

  // Raids (Phase 7). `mode` is the current lobby/fight's mode. `raid` exists from the
  // first raid battle until the next lobby: { stage, cleared, members: [{ id, classId }]
  // (locked roster, minus anyone who fled), totals: { userId: summed stats }, levels }.
  let mode = "skirmish";
  let raid = null;
  // Bosses (Phase 8). A skirmish lobby shows the boss it will face (random, never the
  // last one fought; a mod's !boss picks it). A raid's lineup is drawn when its lobby
  // opens so the lobby can show it.
  let lobbyBossId = null;
  let lastBossId = null;
  let bossOverride = null;     // !boss during a fight: used by the next skirmish lobby
  let raidLineup = null;
  let raidNext = false;        // a mod called !raid during a fight: the next lobby is a raid
  let raidVoteEnabled = RAID_VOTE_ENABLED_DEFAULT;
  let raidVotes = new Set();
  let onScreenDone = null;     // what a timed screen does next (lets !startbattle skip ahead)
  let resolutionTimer = null;  // the pause after a round, cancelled if a raid is called off
  let unsettled = null;        // { outcome, fightResults } of a fight that ended but whose pause is still running

  // Stream controls (mods): a paused countdown stands still; kicked viewers can't
  // join again until the next lobby opens. Roster notes (someone left between
  // rounds) are added to the top of the next round's log.
  let paused = false;
  let kicked = new Set();
  // manualStart: lobbies don't count down; a mod starts each battle (!manualmode /
  // !automode). lastCall: no new joins; the game closes once the queue has played
  // and the last battle ends (!closequeue, and !closegame, which also empties the queue).
  let manualStart = MANUAL_START_DEFAULT;
  let lastCall = false;
  // NPC allies fill out small parties (see npc.js); !npcs on / !npcs off.
  let npcAllies = NPC_ALLIES_DEFAULT;
  let rosterNotes = [];
  // The results / intermission / raid-summary data of the timed screen on show, kept in
  // every broadcast until it ends — otherwise a !join or avatar update mid-screen
  // would blank it.
  let screenExtra = {};

  // Replay the latest state to any client that connects mid-game (e.g. OBS reload).
  io.on("connection", (socket) => {
    if (lastState) socket.emit("state", lastState);
  });

  function broadcastState(extra = {}) {
    extra = { ...screenExtra, ...extra };
    lastState = {
      phase,
      countdownSecondsLeft,
      fight: fight
        ? {
            round: fight.round,
            bossHP: fight.bossHP,
            bossMaxHP: fight.bossMaxHP,
            enraged: fight.enraged,
            variant: fight.variant,
            bossId: fight.bossId,
            bossName: bossName(fight.bossId, fight.variant),
            players: fight.players,
            // Every player is down and an NPC Cleric has this many rounds to revive one.
            reviveGrace: reviveGrace()
          }
        : null,
      // The announced move for the round being chosen ({ id, targetIds? }), else null.
      nextMove: fight?.nextMove ?? null,
      joinedUsers: Array.from(joinedUsers),
      joinedClasses: { ...joinedClasses },
      // In the lobby: the NPC allies this party would get ([{ id, name, classId }]).
      npcAllies: phase === "lobby" ? lobbyAllies().map(({ id, name, classId }) => ({ id, name, classId })) : [],
      npcAlliesOn: npcAllies,
      // In the lobby: the boss this party would face if the fight started now,
      // plus each class's stats and commands for the lobby's class cards.
      // (A raid lobby previews battle 1, which is scaled by its stage.)
      projectedBossHP: fight || !lobbyBossId ? null
        : Math.round(bossHpForParty(lobbyRoster(), lobbyBossId) * (mode === "raid" ? RAID_STAGES[0].hpMultiplier : 1)),
      projectedVariant: fight || !joinedUsers.size ? null : variantForParty(lobbyRoster()),
      projectedBossName: fight || !lobbyBossId ? null
        : bossName(lobbyBossId, joinedUsers.size ? variantForParty(lobbyRoster()) : "standard"),
      // The boss on screen (fighting, or coming up in the lobby): name, element, biome...
      boss: fight ? bossDisplay(fight.bossId) : lobbyBossId ? bossDisplay(lobbyBossId) : null,
      classInfo: phase === "lobby" ? CLASS_INFO : null,
      queue: queue.map(q => ({ ...q })),
      rules: {
        maxActiveFighters: MAX_ACTIVE_FIGHTERS,
        reviveWindowRounds: REVIVE_WINDOW_ROUNDS,
        fleeAfterMissedRounds: FLEE_AFTER_MISSED_ROUNDS
      },
      pendingActions: { ...pendingActions },
      pendingTargets: { ...pendingTargets },
      upcomingMoveLabel,
      avatarUrls: { ...avatarCache },
      playerNames: { ...playerNames },
      playerLevels: currentLevels(),
      playerGear: currentLooks(),
      // Awards on show: { userId: { title, titleTier, aura, frame } } for visible players.
      playerCosmetics: currentCosmetics(),
      leaderboard: phase === "lobby" || phase === "closed" ? leaderboard : null,
      mode,
      paused,
      manualStart,
      lastCall,
      // stage = the battle being fought (or just cleared, during an intermission);
      // scales = every stage's HP/damage multipliers for the overlay's raid track.
      raid: raid || mode === "raid" ? {
        stage: raid?.stage ?? 0,
        stages: RAID_LENGTH,
        chests: raid?.cleared ?? 0,
        scales: RAID_STAGES,
        lineup: (raid?.lineup ?? raidLineup ?? []).map(id => ({ id, name: BOSS_INFO[id].name })),
        // Fixed once the raid starts; in the lobby, what this party would get.
        tier: raid?.tier.id ?? (joinedUsers.size ? raidTierFor(lobbyRoster()).id : null),
        nextBossHP: phase === "intermission" && raid.stage < RAID_LENGTH
          ? Math.round(bossHpForParty(raidRoster(), raid.lineup[raid.stage]) * RAID_STAGES[raid.stage].hpMultiplier) : null
      } : null,
      raidVote: { enabled: raidVoteEnabled, votes: raidVotes.size, needed: raidVotesNeeded() },
      ...extra
    };
    io.emit("state", lastState);
  }

  function levelOf(userId, classId) {
    if (!store || !classId) return 1;
    const key = `${userId}:${classId}`;
    if (!levelCache.has(key)) levelCache.set(key, store.levelOf(userId, classId));
    return levelCache.get(key);
  }

  // Equipped-gear bonuses for a user's class: { power, defense, look }.
  function gearOf(userId, classId) {
    if (!store || !classId) return gearBonuses([]);
    const key = `${userId}:${classId}`;
    if (!gearCache.has(key)) gearCache.set(key, gearBonuses(store.equippedGear(userId, classId)));
    return gearCache.get(key);
  }

  // Combat stats for a user's class, from their saved level and equipped gear.
  function combatStats(userId, classId) {
    const gear = gearOf(userId, classId);
    return { power: playerPower(levelOf(userId, classId), gear.power), defense: gear.defense };
  }

  // The lobby's players in createFight's shape: [{ id, name, classId, power, defense }].
  function lobbyPlayers() {
    return Array.from(joinedUsers).map(id => ({
      id, name: playerNames[id], classId: joinedClasses[id], ...combatStats(id, joinedClasses[id])
    }));
  }

  // The NPC allies the lobby's players would get (none while NPCs are switched off).
  function lobbyAllies() {
    return npcAllies ? npcAlliesFor(lobbyPlayers()) : [];
  }

  // The full lobby roster a battle would start with: players, then NPC allies.
  function lobbyRoster() {
    return [...lobbyPlayers(), ...lobbyAllies()];
  }

  // { name, roundsLeft } while every player is down and an NPC Cleric may revive one.
  function reviveGrace() {
    if (!fight?.wipeRounds) return null;
    const reviver = Object.values(fight.players).find(p => p.npc && p.alive && p.classId === "cleric");
    return reviver ? { name: reviver.name, roundsLeft: NPC_REVIVE_GRACE_ROUNDS + 1 - fight.wipeRounds } : null;
  }

  // Players (not NPCs) still standing in the fight.
  function livingPlayers() {
    return Object.keys(fight?.players ?? {}).filter(id => fight.players[id].alive && !fight.players[id].npc);
  }

  // [userId, classId] for every visible player: the class they're playing or queued as.
  // NPCs have no level, gear or awards, so they're left out.
  function visibleClasses() {
    const pairs = Object.entries(joinedClasses);
    for (const q of queue) pairs.push([q.userId, q.classId]);
    for (const [id, p] of Object.entries(fight?.players ?? {})) if (!p.npc) pairs.push([id, p.classId]);
    return pairs;
  }

  function currentLevels() {
    return Object.fromEntries(visibleClasses().map(([id, classId]) => [id, levelOf(id, classId)]));
  }

  function cosmeticsOf(userId) {
    if (!store) return null;
    if (!cosmeticsCache.has(userId)) {
      try {
        cosmeticsCache.set(userId, store.cosmetics(userId));
      } catch (err) {
        console.error("Failed to load awards:", err.message);
        cosmeticsCache.set(userId, null);
      }
    }
    return cosmeticsCache.get(userId);
  }

  function currentCosmetics() {
    const out = {};
    for (const [id] of visibleClasses()) {
      const c = cosmeticsOf(id);
      if (c && (c.title || c.aura || c.frame)) out[id] = { title: c.title, titleTier: c.titleTier, aura: c.aura, frame: c.frame };
    }
    return out;
  }

  // Saves newly reached award tiers and announces them. Legendary tiers get their own
  // line; several smaller ones in one fight share a line to spare chat.
  function grantAwards(userIds) {
    if (!store || !userIds.length) return [];
    let awards = [];
    try {
      awards = store.checkAwards(userIds);
    } catch (err) {
      console.error("Failed to check awards:", err.message);
      return [];
    }
    for (const a of awards) cosmeticsCache.delete(a.userId);
    const legendary = awards.filter(a => a.tier === 3);
    const others = awards.filter(a => a.tier < 3);
    for (const a of legendary) announce(awardMessage(a.name, a.trackId, a.tier));
    if (others.length === 1) announce(awardMessage(others[0].name, others[0].trackId, others[0].tier));
    else if (others.length > 1) {
      announce(`🏅 New titles! ${others.map(a => `${a.name}: "${TRACKS.find(t => t.id === a.trackId).titles[a.tier]}"`).join(", ")}`);
    }
    return awards.map(a => ({ ...a, title: TRACKS.find(t => t.id === a.trackId).titles[a.tier],
      aura: a.tier === 3 ? AURAS[TRACKS.find(t => t.id === a.trackId).aura].name : null }));
  }

  // Rarity per equipped slot, so the overlay can draw each player's gear.
  function currentLooks() {
    return Object.fromEntries(visibleClasses().map(([id, classId]) => [id, gearOf(id, classId).look]));
  }

  function startLobby() {
    // Last call with nobody left in line: the game closes instead.
    if (lastCall && queue.length === 0) {
      enterClosed();
      return;
    }
    phase = "lobby";
    screenExtra = {};
    fight = null;
    raid = null;
    mode = raidNext ? "raid" : "skirmish";
    raidNext = false;
    chooseLobbyBoss();
    raidVotes = new Set();
    kicked = new Set();
    joinedUsers = new Set();
    joinedClasses = {};
    pendingActions = {};
    pendingTargets = {};
    countdownSecondsLeft = mode === "raid" ? RAID_LOBBY_SECONDS : LOBBY_JOIN_SECONDS;
    clearInterval(countdownTimer);
    countdownTimer = null;

    // Players who waited in the queue get first claim on the next fight.
    while (queue.length && joinedUsers.size < MAX_ACTIVE_FIGHTERS) {
      const { userId, classId } = queue.shift();
      joinedUsers.add(userId);
      joinedClasses[userId] = classId;
    }
    // A raid lobby counts down even while empty; if nobody joins it lapses back to
    // skirmishes. In manual-start mode nothing counts down: a mod starts the battle.
    if (!manualStart && (joinedUsers.size > 0 || mode === "raid")) startLobbyCountdown();
    if (mode === "raid") announceRaidLobby("The raid is on!");

    broadcastState(); // the overlay's lobby text covers raid / manual start / last call
  }

  // Turns the open lobby into a raid lobby (a mod's !raid, or a successful vote).
  function openRaidLobby(reason) {
    mode = "raid";
    chooseLobbyBoss();
    raidVotes = new Set();
    countdownSecondsLeft = Math.max(countdownSecondsLeft, RAID_LOBBY_SECONDS);
    if (!manualStart) startLobbyCountdown();
    announceRaidLobby(reason);
    broadcastState();
  }

  function announceRaidLobby(reason) {
    const when = manualStart ? "is open" : `starts in ${countdownSecondsLeft}s`;
    announce(`⚔ ${reason} A ${RAID_LENGTH}-battle RAID ${when} — !join tank, mage, or cleric. Classes lock until the raid ends!`);
  }

  // A skirmish lobby gets one boss (a mod's pick, else random but never the last one
  // fought); a raid lobby gets its whole lineup, and shows battle 1's boss.
  function chooseLobbyBoss() {
    if (mode === "raid") {
      raidLineup = makeRaidLineup();
      lobbyBossId = raidLineup[0];
      return;
    }
    raidLineup = null;
    const pool = BOSS_IDS.filter(id => id !== lastBossId);
    lobbyBossId = bossOverride ?? pool[Math.floor(Math.random() * pool.length)];
    bossOverride = null;
  }

  // Every boss once in a shuffled order (cycling if there are more battles than
  // bosses), then a final rematch against any boss but the one just beaten.
  function makeRaidLineup() {
    const shuffled = BOSS_IDS.slice().sort(() => Math.random() - 0.5);
    const lineup = Array.from({ length: RAID_LENGTH - 1 }, (_, i) => shuffled[i % shuffled.length]);
    const finalPool = BOSS_IDS.filter(id => id !== lineup[lineup.length - 1]);
    lineup.push(finalPool[Math.floor(Math.random() * finalPool.length)]);
    return lineup;
  }

  // No game running: no lobby, no fight, nothing counting down, until !opengame.
  function enterClosed() {
    phase = "closed";
    screenExtra = {};
    fight = null;
    raid = null;
    mode = "skirmish";
    lobbyBossId = null;
    raidLineup = null;
    raidVotes = new Set();
    joinedUsers = new Set();
    joinedClasses = {};
    pendingActions = {};
    pendingTargets = {};
    queue = [];
    paused = false;
    clearInterval(countdownTimer);
    countdownTimer = null;
    countdownSecondsLeft = 0;
    announce(`🔒 ${CLOSED_MESSAGE}`);
    broadcastState({ message: CLOSED_MESSAGE });
  }

  function raidVotesNeeded() {
    return Math.max(RAID_VOTE_MIN_VOTES, Math.ceil(joinedUsers.size * RAID_VOTE_SHARE));
  }

  // A results-style screen with a live countdown, then `onDone` (also what
  // !startbattle triggers to skip ahead during a raid intermission).
  function startTimedScreen(extra, seconds, onDone) {
    countdownSecondsLeft = seconds;
    onScreenDone = onDone;
    screenExtra = extra;
    broadcastState();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (paused) return;
      countdownSecondsLeft -= 1;
      if (countdownSecondsLeft <= 0) {
        clearInterval(countdownTimer);
        onScreenDone = null;
        screenExtra = {};
        onDone();
      } else {
        broadcastState();
      }
    }, 1000);
  }

  function startLobbyCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (paused) return;
      countdownSecondsLeft -= 1;
      broadcastState();
      if (countdownSecondsLeft <= 0) {
        clearInterval(countdownTimer);
        startBattle();
      }
    }, 1000);
  }

  function startBattle() {
    if (joinedUsers.size === 0) {
      // Nobody joined — reopen the lobby rather than starting an empty fight.
      startLobby();
      return;
    }
    if (mode === "raid") {
      // Lock the roster and classes for the whole raid, NPC allies included.
      raid = {
        stage: 1, cleared: 0, totals: {}, levels: {},
        members: Array.from(joinedUsers).map(id => ({ id, classId: joinedClasses[id] })),
        npcs: lobbyAllies().map(({ id, name, classId }) => ({ id, name, classId })),
        lineup: raidLineup ?? makeRaidLineup(),
        tier: raidTierFor(lobbyRoster())
      };
    }
    beginFight(lobbyRoster());
  }

  function beginFight(roster) {
    const bossId = raid ? raid.lineup[raid.stage - 1] : lobbyBossId;
    const stage = raid ? RAID_STAGES[raid.stage - 1] : null;
    fight = createFight(roster, {
      bossId,
      hpMultiplier: stage?.hpMultiplier ?? 1,
      damageMultiplier: (stage?.damageMultiplier ?? 1) * (raid?.tier.damageMultiplier ?? 1)
    });
    lastBossId = bossId;
    lobbyBossId = null;
    fightStats = {};
    rosterNotes = [];
    screenExtra = {};
    // NPCs earn nothing, so they get no tallies; their names go where the overlay looks.
    for (const [id, p] of Object.entries(fight.players)) {
      if (p.npc) playerNames[id] = p.name;
      else initStats(id);
    }

    const allies = roster.filter(r => r.npc);
    const count = roster.length - allies.length;
    const name = titleCase(bossName(fight.bossId, fight.variant));
    const joinedBy = allies.length && (!raid || raid.stage === 1)
      ? ` NPC ${allies.length === 1 ? "ally" : "allies"} ${allies.map(a => `${a.name} (${CLASS_NAMES[a.classId]})`).join(" and ")} ${allies.length === 1 ? "joins" : "join"} in.`
      : "";
    announce(raid
      ? `⚔ ${raid.stage === RAID_LENGTH ? "Final raid battle" : `Raid battle ${raid.stage}/${RAID_LENGTH}`}: the ${name} appears!${joinedBy}`
      : `⚔ The ${name} appears! ${count} ${count === 1 ? "hero steps" : "heroes step"} up to fight.${joinedBy}`);
    startInputPhase();
  }

  // The raid's locked roster, rebuilt for the next battle (fallen raiders return;
  // levels gained mid-raid count, for the NPC allies too).
  function raidRoster() {
    const players = raid.members.map(({ id, classId }) => ({ id, name: playerNames[id], classId, ...combatStats(id, classId) }));
    if (!players.length) return players;
    const power = npcPower(players);
    return [...players, ...raid.npcs.map(n => ({ ...n, power, defense: 0, npc: true }))];
  }

  function startNextRaidBattle() {
    if (!raid.members.length) {
      finishRaid("ended", null); // everyone left during the intermission
      return;
    }
    raid.stage += 1;
    beginFight(raidRoster());
  }

  // Tallies for a player's current class in this fight.
  function statsFor(userId) {
    return fightStats[`${userId}:${fight.players[userId].classId}`];
  }

  function initStats(userId) {
    const classId = fight.players[userId].classId;
    fightStats[`${userId}:${classId}`] = {
      userId, name: playerNames[userId], classId,
      roundsAlive: 0, roundsActive: 0, damage: 0, healing: 0, revives: 0, kos: 0, daringHits: 0
    };
  }

  // Tallies a resolved round into fightStats (before roster changes remove anyone).
  // roundsAlive (rounds a player could act) is the base for loot participation.
  // NPCs have no tallies and are skipped.
  function trackRoundStats(events, aliveAtStart) {
    for (const id of aliveAtStart) {
      if (!statsFor(id)) continue;
      statsFor(id).roundsAlive += 1;
      if (pendingActions[id]) statsFor(id).roundsActive += 1;
      if (!fight.players[id].alive) statsFor(id).kos += 1;
    }
    for (const e of events) {
      if (!e.userId || !statsFor(e.userId)) continue;
      if (e.type === "player_attack") {
        statsFor(e.userId).damage += e.damageToBoss;
        if (e.bold) statsFor(e.userId).daringHits += 1;
      } else if (e.type === "player_heal") {
        statsFor(e.userId).healing += e.healAmount;
      } else if (e.type === "player_revive") {
        statsFor(e.userId).revives += 1;
      }
    }
  }

  // Saves the fight and builds the results screen. A save failure must never stall
  // the game, so it falls back to unsaved XP figures.
  function finishFight(outcome) {
    const rounds = fight.round - 1;
    const players = Object.values(fightStats)
      .map(s => ({ ...s, finished: fight.players[s.userId]?.classId === s.classId }));
    // Loot only drops on a win, and only matters when there's somewhere to save it.
    // Raid battles drop nothing; raids pay out in chests at the end instead.
    if (outcome === "win" && store && !raid) {
      for (const p of players) p.drop = rollDrop(p, fight.variant);
    }
    const summary = { bossId: fight.bossId, variant: fight.variant, outcome, rounds, players };

    let results;
    try {
      results = store ? store.recordFight(summary) : null;
    } catch (err) {
      console.error("Failed to save fight results:", err.message);
    }
    results ??= players.map(p => ({
      ...p, drop: null, xpEarned: xpForFight(p, summary), level: levelOf(p.userId, p.classId), leveledUp: false
    }));
    results.sort((a, b) => b.xpEarned - a.xpEarned || b.damage - a.damage);

    levelCache.clear();
    gearCache.clear();
    if (store) leaderboard = store.leaderboard();

    // Recognition only — no extra rewards attached.
    const best = (key) => {
      const top = results.reduce((a, b) => (b[key] > (a?.[key] ?? 0) ? b : a), null);
      return top ? { userId: top.userId, name: top.name, value: top[key] } : null;
    };
    const badges = { damage: best("damage"), healing: best("healing"), revives: best("revives"), daring: best("daringHits") };

    const name = titleCase(bossName(fight.bossId, fight.variant));
    if (raid) {
      addToRaidTotals(results); // the raid flow announces its own progress
    } else if (outcome === "ended") {
      announce(`⛔ The battle was called off — every round fought still earned XP.`);
    } else if (outcome === "win") {
      const mvp = badges.damage ? ` Top damage: ${badges.damage.name} (${badges.damage.value}).` : "";
      announce(`🏆 The ${name} falls in ${rounds} rounds!${mvp}`);
    } else {
      announce(`💀 The party has fallen to the ${name}... every round fought still earned XP.`);
    }
    const levelUps = results.filter(r => r.leveledUp);
    if (levelUps.length) {
      announce(`⭐ Level up! ${levelUps.map(r => `${r.name} (${CLASS_NAMES[r.classId]} ${r.level})`).join(", ")}`);
    }

    const awards = grantAwards([...new Set(results.map(r => r.userId))]);

    const speedBonus = outcome === "win" ? Math.max(0, TARGET_FIGHT_ROUNDS - rounds) * XP_SPEED_BONUS_PER_ROUND : 0;
    return {
      outcome, rounds, par: TARGET_FIGHT_ROUNDS, speedBonus,
      bossId: fight.bossId, bossName: bossName(fight.bossId, fight.variant), players: results, badges, awards
    };
  }

  const RAID_TOTAL_KEYS = ["roundsAlive", "roundsActive", "damage", "healing", "revives", "kos", "daringHits", "xpEarned"];

  function addToRaidTotals(results) {
    for (const r of results) {
      const t = (raid.totals[r.userId] ??= { userId: r.userId, name: r.name, classId: r.classId,
        ...Object.fromEntries(RAID_TOTAL_KEYS.map(k => [k, 0])) });
      for (const k of RAID_TOTAL_KEYS) t[k] += r[k] ?? 0;
      t.level = r.level;
      t.leveledUp = t.leveledUp || r.leveledUp;
    }
  }

  // After a raid battle: on to an intermission, or the raid is over. Anyone who left
  // mid-battle (fled) is out of the raid for good.
  function afterRaidBattle(outcome, fightResults) {
    raid.members = raid.members.filter(m => fight.players[m.id]);
    if (outcome === "win") raid.cleared += 1;

    if (outcome === "win" && raid.stage < RAID_LENGTH && raid.members.length > 0) {
      phase = "intermission";
      announce(`🏆 Raid battle ${raid.stage}/${RAID_LENGTH} cleared in ${fightResults.rounds} rounds! ` +
        `${raid.cleared} chest${raid.cleared === 1 ? "" : "s"} banked — next battle in ${RAID_INTERMISSION_SECONDS}s.`);
      startTimedScreen({ fightResults }, RAID_INTERMISSION_SECONDS, startNextRaidBattle);
    } else {
      finishRaid(outcome === "win" && raid.cleared === RAID_LENGTH ? "cleared" : outcome === "win" ? "ended" : "wiped",
        fightResults);
    }
  }

  // Opens the raid's chests for every raider who stayed in and took part, then shows
  // the raid summary. outcome: "cleared" | "wiped" | "ended" (called off by a mod).
  function finishRaid(outcome, lastFightResults) {
    const chests = raid.cleared + (outcome === "cleared" ? RAID_CLEAR_BONUS_CHESTS : 0);
    const stillIn = new Set(raid.members.map(m => m.id));

    const players = Object.values(raid.totals).map(t => {
      const finished = stillIn.has(t.userId);
      let items = [];
      if (store && chests > 0 && lootEligible({ ...t, finished })) {
        const luck = (i) => (1 + RAID_CHEST_LUCK_STEP * i) * raid.tier.chestLuck;
        const rolled = Array.from({ length: chests }, (_, i) => makeItem(t.classId, luck(i)));
        try {
          items = store.awardItems(t.userId, t.classId, rolled);
        } catch (err) {
          console.error("Failed to save raid chests:", err.message);
        }
      }
      return { ...t, finished, items };
    }).sort((a, b) => b.xpEarned - a.xpEarned || b.damage - a.damage);
    gearCache.clear();

    const banked = `${chests} chest${chests === 1 ? "" : "s"}`;
    announce(outcome === "cleared"
      ? `👑 RAID CLEARED! All ${RAID_LENGTH} battles won — ${banked} opened (including the clear bonus)!`
      : outcome === "wiped"
        ? `💀 The raid ends at battle ${raid.stage}/${RAID_LENGTH}. ${banked} banked and opened — well fought!`
        : `The raid was called off after ${raid.cleared} battle${raid.cleared === 1 ? "" : "s"} — ${banked} opened.`);

    // A full clear counts toward the raid award tracks for everyone who saw it through.
    let awards = [];
    if (outcome === "cleared" && store) {
      const clearers = players.filter(p => p.finished).map(p => p.userId);
      try {
        store.recordRaidClear(clearers, raid.tier.id);
      } catch (err) {
        console.error("Failed to save raid clears:", err.message);
      }
      awards = grantAwards(clearers);
    }

    phase = "ended";
    const raidResults = { outcome, stagesCleared: raid.cleared, stages: RAID_LENGTH, chests, players, awards,
      tier: raid.tier.id, lineup: raid.lineup.map(id => ({ id, name: BOSS_INFO[id].name })) };
    startTimedScreen({
      result: outcome === "cleared" ? "win" : "loss",
      message: outcome === "cleared" ? "The raid is cleared!" : "The raid is over",
      fightResults: lastFightResults,
      raidResults
    }, RAID_RESULTS_SECONDS, startLobby);
  }

  function startInputPhase() {
    phase = "input";
    pendingActions = {};
    pendingTargets = {};
    countdownSecondsLeft = INPUT_WINDOW_SECONDS;

    // Pick the boss's move now so it can be announced before anyone locks in.
    fight.nextMove = chooseBossMove(fight);
    upcomingMoveLabel = describeMove(fight.nextMove, fight);

    // NPCs answer the announced move straight away.
    for (const [id, p] of Object.entries(fight.players)) {
      if (!p.npc || !p.alive) continue;
      const { type, targetId } = npcAction(fight, id, fight.nextMove);
      pendingActions[id] = type;
      if (targetId) pendingTargets[id] = targetId;
    }
    // With only NPCs standing nobody is typing: a short round, just long enough to watch.
    if (!livingPlayers().length) countdownSecondsLeft = NPC_ONLY_INPUT_SECONDS;

    broadcastState();

    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (paused) return;
      countdownSecondsLeft -= 1;
      broadcastState();
      if (countdownSecondsLeft <= 0) {
        clearInterval(countdownTimer);
        runResolution();
      }
    }, 1000);
  }

  function runResolution() {
    upcomingMoveLabel = "";
    phase = "resolving"; // overlay shows "BATTLE!" during this brief instant
    broadcastState();

    const aliveAtStart = new Set(Object.keys(fight.players).filter(id => fight.players[id].alive));

    // pendingActions stays plain strings for the overlay; targets live separately.
    const actionsForResolution = {};
    for (const [uid, actionType] of Object.entries(pendingActions)) {
      actionsForResolution[uid] = { type: actionType, targetId: pendingTargets[uid] ?? null };
    }
    const { log, outcome, bossMove, resolutionEvents } = resolveRound(fight, actionsForResolution);
    log.unshift(...rosterNotes);
    rosterNotes = [];
    trackRoundStats(resolutionEvents, aliveAtStart);
    if (outcome === "ongoing") updateRoster(log, aliveAtStart);
    const fightResults = outcome === "ongoing" ? null : finishFight(outcome);

    phase = "results";
    broadcastState({ log, bossMove: bossMove.id, bossMoveLabel: moveTitle(fight.bossId, bossMove.id), resolutionEvents });

    // Big parties take longer to animate; don't cut the overlay's sequence short.
    // (The overlay shows all defend-recovery numbers in a single beat.)
    const recoveries = resolutionEvents.filter(e => e.type === "player_recover").length;
    const beats = resolutionEvents.length - recoveries + (recoveries > 0 ? 1 : 0);
    const pauseMs = Math.max(RESULTS_PAUSE_SECONDS * 1000, beats * RESULTS_MS_PER_EVENT + 1000);
    unsettled = fightResults ? { outcome, fightResults } : null;
    resolutionTimer = setTimeout(() => {
      resolutionTimer = null;
      unsettled = null;
      if (!fightResults) {
        startInputPhase();
      } else if (raid) {
        afterRaidBattle(outcome, fightResults);
      } else {
        // Results screen with a live countdown to the next lobby.
        phase = "ended";
        startTimedScreen({
          result: outcome,
          message: outcome === "win" ? "The boss has been defeated!" : "The party has fallen...",
          fightResults
        }, ENDED_PAUSE_SECONDS, startLobby);
      }
    }, pauseMs);
  }

  // Between rounds: track idling and time spent fallen, drop players who fled or
  // weren't revived in time (the latter only when someone is waiting), then fill
  // open slots from the queue. Roster changes are appended to the round's log.
  function updateRoster(log, aliveAtStart) {
    for (const [id, player] of Object.entries(fight.players)) {
      if (aliveAtStart.has(id)) player.idleRounds = pendingActions[id] ? 0 : player.idleRounds + 1;
      // Counts only full rounds spent fallen, so the death round itself doesn't count.
      player.roundsDown = !player.alive && !aliveAtStart.has(id) ? player.roundsDown + 1 : 0;
    }

    for (const [id, player] of Object.entries(fight.players)) {
      if (player.alive && player.idleRounds >= FLEE_AFTER_MISSED_ROUNDS) {
        removeFromFight(id);
        log.push(`${player.name} fled the battle!`);
      }
    }

    // Raids keep their roster locked: no revive-window swaps and no fills from the queue.
    if (raid) return;

    const openSlots = MAX_ACTIVE_FIGHTERS - Object.keys(fight.players).length;
    const stillWaiting = Math.max(0, queue.length - openSlots);
    const expired = Object.entries(fight.players)
      .filter(([, p]) => !p.alive && p.roundsDown >= REVIVE_WINDOW_ROUNDS)
      .sort(([, a], [, b]) => b.roundsDown - a.roundsDown)
      .slice(0, stillWaiting);
    for (const [id, player] of expired) {
      removeFromFight(id);
      log.push(`${player.name} wasn't revived in time and leaves the fight.`);
    }

    while (queue.length && Object.keys(fight.players).length < MAX_ACTIVE_FIGHTERS) {
      const { userId, classId } = queue.shift();
      const slot = lowestFreeSlot();
      const { power, defense } = combatStats(userId, classId);
      addPlayer(fight, { id: userId, name: playerNames[userId], classId, power, defense }, slot);
      // Someone who left and rejoins as the same class keeps adding to their tallies.
      if (!statsFor(userId)) initStats(userId);
      let line = `${playerNames[userId]} joins the fight in slot ${slot}!`;

      // Growing the party past what the boss was sized for adds boss HP worth the
      // newcomer's expected damage over the rest of the fight.
      if (Object.keys(fight.players).length > fight.fundedSlots) {
        fight.fundedSlots += 1;
        const roundsLeft = Math.max(MIN_JOIN_ROUNDS, TARGET_FIGHT_ROUNDS - (fight.round - 1));
        const extraHp = Math.round(CLASSES[classId].expectedDamage * power * roundsLeft);
        fight.bossHP += extraHp;
        fight.bossMaxHP += extraHp;
        line += ` The boss grows stronger (+${extraHp} HP).`;
      }
      log.push(line);
    }
  }

  function removeFromFight(userId) {
    delete fight.players[userId];
    delete pendingActions[userId];
    delete pendingTargets[userId];
  }

  function lowestFreeSlot() {
    const used = new Set(Object.values(fight.players).map(p => p.slot));
    let slot = 1;
    while (used.has(slot)) slot += 1;
    return slot;
  }

  // Plain !join balances the party by picking whichever class has the fewest players.
  function leastPickedClass() {
    const picks = fight ? Object.values(fight.players).map(p => p.classId) : Object.values(joinedClasses);
    const counts = Object.fromEntries(Object.keys(CLASSES).map(c => [c, 0]));
    for (const classId of picks) counts[classId] += 1;
    return Object.keys(counts).reduce((best, c) => (counts[c] < counts[best] ? c : best));
  }

  // Resolves a !heal / !revive argument to a userId: "self"/"me", a slot number, or a
  // display name — with or without "@", exact first, then a unique prefix, then a
  // unique partial match ("!heal mel" → Melody). Ambiguous or unknown → null, which
  // falls back to auto-targeting. Liveness is checked at resolution.
  // The whole argument is tried first (NPC names have spaces: "!heal sister wren"),
  // then just its first word, so extra words never lose the target: players add
  // them to dodge Twitch's 30-second duplicate-message filter ("!heal 2 again").
  function findTargetId(userId, arg) {
    if (!arg) return null;
    const words = arg.trim().split(/\s+/);
    return matchTarget(userId, words.join(" ")) ?? (words.length > 1 ? matchTarget(userId, words[0]) : null);
  }

  function matchTarget(userId, arg) {
    const query = arg.replace(/^@/, "").toLowerCase();
    if (query === "self" || query === "me") return userId;

    const entries = Object.entries(fight.players);
    if (/^\d+$/.test(query)) {
      const bySlot = entries.find(([, p]) => p.slot === Number(query));
      return bySlot ? bySlot[0] : null;
    }
    const unique = (matches) => (matches.length === 1 ? matches[0][0] : null);
    const lower = ([, p]) => p.name.toLowerCase();
    return entries.find(e => lower(e) === query)?.[0]
      ?? unique(entries.filter(e => lower(e).startsWith(query)))
      ?? unique(entries.filter(e => lower(e).includes(query)));
  }

  function ensureAvatar(userId) {
    if (!fetchAvatar || avatarCache[userId] || avatarRequests.has(userId)) return;
    avatarRequests.add(userId);
    fetchAvatar(userId).then(url => {
      if (url) { avatarCache[userId] = url; broadcastState(); }
      else avatarRequests.delete(userId); // allow a retry on their next !join
    }).catch(() => avatarRequests.delete(userId));
  }

  // --- Chat command handlers, called from server.js ---

  function handleJoin(userId, displayName, classArg) {
    if (kicked.has(userId)) return; // removed by a mod: back in the next lobby
    if (phase === "closed") return;
    // Last call: only people already in the lobby or queue (switching class) get through.
    if (lastCall && !joinedUsers.has(userId) && !queue.some(q => q.userId === userId)) return;
    playerNames[userId] = displayName;
    ensureAvatar(userId);
    const requestedClass = classArg && CLASSES[classArg] ? classArg : null;

    // Lobby with room (or already in it): join directly. A valid class always
    // (re)assigns, so players can switch while the lobby is open.
    if (phase === "lobby" && (joinedUsers.has(userId) || joinedUsers.size < MAX_ACTIVE_FIGHTERS)) {
      if (requestedClass) joinedClasses[userId] = requestedClass;
      else if (!joinedClasses[userId]) joinedClasses[userId] = leastPickedClass();
      queue = queue.filter(q => q.userId !== userId);

      const isNewJoin = !joinedUsers.has(userId);
      joinedUsers.add(userId);
      if (isNewJoin && joinedUsers.size === 1 && !manualStart) startLobbyCountdown();
      broadcastState();
      return;
    }

    if (fight?.players[userId]) return; // already fighting; no class changes mid-fight

    // Fight in progress or lobby full: wait in the queue (re-joining updates the class).
    const queued = queue.find(q => q.userId === userId);
    if (queued) {
      if (requestedClass) queued.classId = requestedClass;
    } else {
      queue.push({ userId, classId: requestedClass ?? leastPickedClass() });
    }
    broadcastState();
  }

  function handleAction(userId, action, arg = null) {
    if (phase !== "input") return;
    const player = fight?.players[userId];
    if (!player?.alive) return;
    // Commands outside the player's class kit are ignored; their previous choice stands.
    if (!CLASSES[player.classId].actions.includes(action)) return;

    pendingActions[userId] = action; // overwrite — last command before lock wins
    if (TARGETED_ACTIONS.includes(action)) {
      pendingTargets[userId] = findTargetId(userId, arg);
    } else {
      delete pendingTargets[userId];
    }

    hurryIfAllLocked();
    broadcastState();
  }

  // Once every living player has locked in, the round needn't wait out the full window.
  function hurryIfAllLocked() {
    if (phase !== "input") return;
    const livingIds = Object.keys(fight.players).filter(id => fight.players[id].alive);
    const allLocked = livingIds.every(id => pendingActions[id] !== undefined);
    if (allLocked && countdownSecondsLeft > 5) {
      countdownSecondsLeft = 5;
    }
  }

  function handleForceStart(isMod) {
    // Lets a mod/broadcaster skip the lobby countdown, or a raid intermission.
    if (!isMod) return;
    if (phase === "lobby" || phase === "intermission") paused = false; // starting means going
    if (phase === "lobby") {
      clearInterval(countdownTimer);
      startBattle();
    } else if (phase === "intermission" && onScreenDone) {
      clearInterval(countdownTimer);
      const next = onScreenDone;
      onScreenDone = null;
      next();
    }
  }

  // !raid / !endraid / !enableraidvote / !disableraidvote (mods), !raidvote (anyone).
  function handleRaidCommand(userId, command, isMod) {
    if (command === "!raidvote") {
      // Only while voting is enabled, in an open skirmish lobby; one vote per viewer.
      // (Not during last call: chat shouldn't stretch the final battle into a raid.)
      if (!raidVoteEnabled || phase !== "lobby" || mode !== "skirmish" || lastCall) return;
      raidVotes.add(userId);
      if (raidVotes.size >= raidVotesNeeded()) openRaidLobby("Chat voted for it!");
      else broadcastState();
      return;
    }
    if (!isMod) return;

    if (command === "!enableraidvote" || command === "!disableraidvote") {
      raidVoteEnabled = command === "!enableraidvote";
      raidVotes = new Set();
      announce(raidVoteEnabled
        ? "🗳 Raid voting is ON — type !raidvote in the lobby to start a raid."
        : "🗳 Raid voting is off.");
      broadcastState();
    } else if (command === "!raid") {
      if (phase === "lobby" && mode === "skirmish") openRaidLobby("A raid has been called!");
      else if (!raid && mode === "skirmish" && !raidNext) {
        raidNext = true; // a skirmish is underway (or the game is closed): the next lobby is a raid lobby
        announce(phase === "closed"
          ? "⚔ A raid has been called — it opens when the game does (!opengame)."
          : "⚔ A raid has been called — it opens as soon as this fight ends!");
      }
    } else if (command === "!endraid") {
      if (raidNext) {
        raidNext = false;
        announce("The upcoming raid was called off.");
      } else if (phase === "lobby" && mode === "raid") {
        // Back to an ordinary skirmish lobby (facing raid battle 1's boss).
        mode = "skirmish";
        raidLineup = null;
        countdownSecondsLeft = Math.min(countdownSecondsLeft, LOBBY_JOIN_SECONDS);
        if (joinedUsers.size === 0) clearInterval(countdownTimer);
        announce("The raid was called off — back to skirmishes.");
        broadcastState();
      } else if (raid && phase !== "ended") {
        endRaidNow();
      }
    }
  }

  // Mid-raid: stop where we are. A battle in progress counts as fought (its XP is
  // saved); one that just ended keeps its real result; every chest banked so far is
  // opened.
  function endRaidNow() {
    clearInterval(countdownTimer);
    clearTimeout(resolutionTimer);
    resolutionTimer = null;
    onScreenDone = null;
    let lastResults = null;
    if (unsettled) {
      lastResults = unsettled.fightResults;
      if (unsettled.outcome === "win") raid.cleared += 1;
      unsettled = null;
    } else if (phase !== "intermission") {
      lastResults = finishFight("ended");
    }
    raid.members = raid.members.filter(m => fight.players[m.id]);
    finishRaid("ended", lastResults);
  }

  // A skirmish called off mid-fight: saved like any other fight (XP for every round
  // fought; no win bonus or loot), then the usual results screen.
  function endSkirmishNow() {
    clearInterval(countdownTimer);
    clearTimeout(resolutionTimer);
    resolutionTimer = null;
    const fightResults = finishFight("ended");
    phase = "ended";
    startTimedScreen({ result: "ended", message: "The battle was called off", fightResults },
      ENDED_PAUSE_SECONDS, startLobby);
  }

  // A fight (or raid) is underway and hasn't already reached its result.
  function battleUnderway() {
    return Boolean(fight) && !unsettled && ["input", "resolving", "results", "intermission"].includes(phase);
  }

  function endBattleNow() {
    if (raid) endRaidNow();
    else endSkirmishNow();
  }

  // Takes a user out of whatever they're in: the queue, the lobby, the fight, the
  // raid. Their tallies so far stay in fightStats, so the XP for rounds they fought is
  // still saved when the fight ends (a raider who leaves forfeits the raid's chests).
  // `note` finishes the log line ("fled the battle!"). Returns false if they weren't in anything.
  function removeUser(userId, note) {
    let removed = false;
    const queued = queue.findIndex(q => q.userId === userId);
    if (queued !== -1) {
      queue.splice(queued, 1);
      removed = true;
    }
    if (phase === "lobby" && joinedUsers.has(userId)) {
      joinedUsers.delete(userId);
      delete joinedClasses[userId];
      raidVotes.delete(userId);
      // An emptied skirmish lobby waits for its first joiner again.
      if (joinedUsers.size === 0 && mode === "skirmish") {
        clearInterval(countdownTimer);
        countdownTimer = null;
        countdownSecondsLeft = LOBBY_JOIN_SECONDS;
      }
      removed = true;
    }
    // ...unless it's last call, when nobody else can come: close now.
    if (phase === "lobby" && lastCall && joinedUsers.size === 0 && queue.length === 0) {
      enterClosed();
      return true;
    }
    if (phase === "lobby" || phase === "ended") return removed; // results list everyone who played

    if (raid?.members.some(m => m.id === userId)) {
      raid.members = raid.members.filter(m => m.id !== userId);
      removed = true;
    }
    if (fight?.players[userId]) {
      const name = fight.players[userId].name;
      removeFromFight(userId);
      removed = true;
      if (phase !== "intermission") {
        rosterNotes.push(`${name} ${note}`);
        // No players left to fight (NPCs don't count): call the battle off rather than
        // play it out empty.
        if (battleUnderway() && !Object.values(fight.players).some(p => !p.npc)) {
          endBattleNow();
          return true;
        }
        hurryIfAllLocked();
      }
    }
    return removed;
  }

  // !leave / !flee: quit the queue, the lobby, or the fight in progress.
  function handleLeave(userId) {
    if (removeUser(userId, "fled the battle!")) broadcastState();
  }

  // Finds someone in the lobby, queue, fight or raid by display name (with or without
  // "@"; exact, then a unique prefix, then a unique partial match) or by slot number.
  function findListedUser(arg) {
    if (!arg) return null;
    const query = arg.replace(/^@/, "").toLowerCase();
    if (/^\d+$/.test(query)) {
      const n = Number(query);
      if (phase === "lobby") return Array.from(joinedUsers)[n - 1] ?? null;
      return Object.entries(fight?.players ?? {}).find(([, p]) => p.slot === n)?.[0] ?? null;
    }
    const ids = new Set([...joinedUsers, ...queue.map(q => q.userId),
      ...Object.keys(fight?.players ?? {}), ...(raid?.members.map(m => m.id) ?? [])]);
    const entries = Array.from(ids).map(id => [id, (playerNames[id] ?? "").toLowerCase()]);
    const unique = (matches) => (matches.length === 1 ? matches[0][0] : null);
    return entries.find(([, name]) => name === query)?.[0]
      ?? unique(entries.filter(([, name]) => name.startsWith(query)))
      ?? unique(entries.filter(([, name]) => name.includes(query)));
  }

  // !titles (list what you've earned; posts to chat, so once per TITLES_COOLDOWN_MS),
  // !title <name | off | auto>, !aura <name | off | auto>. Choosing is silent: the
  // overlay shows the change.
  const TITLES_COOLDOWN_MS = 30000;
  function handleAwardCommand(userId, displayName, command, arg) {
    if (!store) return;
    playerNames[userId] ??= displayName;
    cosmeticsCache.delete(userId); // rare commands: always read the latest from the store
    const c = cosmeticsOf(userId);
    if (!c) return;
    if (command === "!titles") {
      const now = Date.now();
      if (now - (titlesAsked.get(userId) ?? 0) < TITLES_COOLDOWN_MS) return;
      titlesAsked.set(userId, now);
      if (!c.titles.length) {
        announce(`${displayName} has no titles yet — win fights, revive allies and clear raids to earn them!`);
        return;
      }
      const shown = c.titles.slice(0, 8).map(t => t.title).join(", ") + (c.titles.length > 8 ? ` +${c.titles.length - 8} more` : "");
      const auras = c.auras.length ? ` · Auras: ${c.auras.map(a => AURAS[a].name).join(", ")}` : "";
      announce(`${displayName}'s titles: ${shown} (showing: ${c.title ?? "none"})${auras} · !title <name> / !aura <name> to choose`);
      return;
    }
    const choice = (arg ?? "").trim();
    if (!choice) return;
    // "" = show none, null = automatic (the best earned), else a title / aura id they own.
    let value;
    if (/^(off|none)$/i.test(choice)) value = "";
    else if (/^auto$/i.test(choice)) value = null;
    else {
      const owned = command === "!title" ? c.titles.map(t => t.title) : c.auras.map(a => AURAS[a].name);
      const match = matchName(choice, owned);
      if (!match) return; // not one they've earned (or ambiguous)
      value = command === "!title" ? match : Object.keys(AURAS).find(id => AURAS[id].name === match);
    }
    try {
      if (command === "!title") store.setTitle(userId, value);
      else store.setAura(userId, value);
    } catch (err) {
      console.error("Failed to save award choice:", err.message);
      return;
    }
    cosmeticsCache.delete(userId);
    broadcastState();
  }

  // Mod controls: !pause / !resume (any countdown), !skip (move on now), !endbattle
  // (call off the fight or raid in progress), !kick <name|slot>.
  function handleModCommand(command, arg, isMod) {
    if (!isMod) return;
    if (command === "!pause" || command === "!resume") {
      const pausing = command === "!pause";
      if (paused === pausing) return;
      paused = pausing;
      announce(paused ? "⏸ The game is paused by a mod." : "▶ The game resumes!");
      broadcastState();
    } else if (command === "!skip") {
      // Lobby -> start the battle; input -> resolve the round now; intermission or
      // results screen -> move on. Skipping also lifts a pause.
      paused = false;
      if (phase === "lobby") {
        clearInterval(countdownTimer);
        startBattle();
      } else if (phase === "input") {
        clearInterval(countdownTimer);
        runResolution();
      } else if ((phase === "intermission" || phase === "ended") && onScreenDone) {
        clearInterval(countdownTimer);
        const next = onScreenDone;
        onScreenDone = null;
        screenExtra = {};
        next();
      } else {
        broadcastState();
      }
    } else if (command === "!endbattle") {
      if (!battleUnderway()) return;
      paused = false;
      endBattleNow();
    } else if (command === "!manualmode" || command === "!automode") {
      const manual = command === "!manualmode";
      if (manualStart === manual) return;
      manualStart = manual;
      if (phase === "lobby") {
        if (manual) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        } else if (joinedUsers.size > 0 || mode === "raid") {
          countdownSecondsLeft = mode === "raid" ? RAID_LOBBY_SECONDS : LOBBY_JOIN_SECONDS;
          startLobbyCountdown();
        }
      }
      announce(manual
        ? "🎬 Manual start: the streamer starts each battle — !join and get ready!"
        : "⏱ Battles start on their own again when the lobby countdown ends.");
      broadcastState();
    } else if (command === "!closequeue") {
      // Last call: everyone already in the lobby or queue still plays; then it closes.
      if (lastCall || phase === "closed") return;
      lastCall = true;
      raidVotes = new Set();
      if (phase === "lobby" && joinedUsers.size === 0 && queue.length === 0) {
        enterClosed();
        return;
      }
      announce("🔔 Last call! The queue is closed — everyone already in line still gets to play, then the game closes.");
      broadcastState();
    } else if (command === "!closegame") {
      // No new joins and the queue is cleared. An open lobby closes now; a fight or
      // raid in progress plays out first (!endbattle stops it now).
      if (phase === "closed") return;
      lastCall = true;
      queue = [];
      raidNext = false;
      raidVotes = new Set();
      if (phase === "lobby") {
        enterClosed();
        return;
      }
      announce("🔒 The game closes after this battle — no new joins.");
      broadcastState();
    } else if (command === "!opengame") {
      if (!lastCall && phase !== "closed") return;
      lastCall = false;
      if (phase === "closed") {
        announce("🔓 The game is open — !join tank, mage, or cleric to play!");
        startLobby();
      } else {
        announce("🔓 Joins are open again — the game keeps going!");
        broadcastState();
      }
    } else if (command === "!boss") {
      // Pick the next skirmish's boss: now, in a skirmish lobby; otherwise for the next
      // one. "!boss random" clears a pick. Raids keep their drawn lineup.
      const random = arg === "random";
      const bossId = random ? null : findBoss(arg);
      if (!random && !bossId) return;
      if (phase === "lobby" && mode === "skirmish") {
        const pool = BOSS_IDS.filter(id => id !== lastBossId);
        lobbyBossId = bossId ?? pool[Math.floor(Math.random() * pool.length)];
        announce(`👁 Next up: the ${titleCase(BOSS_INFO[lobbyBossId].name)}!`);
      } else {
        bossOverride = bossId;
        announce(bossId ? `👁 The next skirmish will be against the ${titleCase(BOSS_INFO[bossId].name)}.`
          : "👁 The next skirmish's boss will be random.");
      }
      broadcastState();
    } else if (command === "!npcs") {
      // NPC allies on or off from the next battle (one in progress keeps its allies).
      if (arg !== "on" && arg !== "off") return;
      const on = arg === "on";
      if (npcAllies === on) return;
      npcAllies = on;
      announce(on
        ? "🤝 NPC allies are on: a party of one or two gets NPCs for the classes it's missing."
        : "🤝 NPC allies are off: from the next battle, only players fight.");
      broadcastState();
    } else if (command === "!kick") {
      const userId = findListedUser(arg);
      if (!userId) return;
      kicked.add(userId);
      removeUser(userId, "was removed by a mod.");
      announce(`🚫 ${playerNames[userId] ?? userId} was removed by a mod — they can !join again next lobby.`);
      broadcastState();
    }
  }

  // Kick things off
  if (GAME_OPEN_ON_START) startLobby();
  else {
    phase = "closed";
    broadcastState({ message: CLOSED_MESSAGE });
  }

  return {
    handleJoin, handleAction, handleForceStart, handleRaidCommand, handleLeave, handleModCommand, handleAwardCommand,
    getState: () => lastState
  };
}

module.exports = { createGameLoop };
