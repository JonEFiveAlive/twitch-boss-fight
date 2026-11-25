const socket = io();

const phaseMessageEl  = document.getElementById("phaseMessage");
const lockedCountEl   = document.getElementById("lockedCount");
const timerEl         = document.getElementById("timer");
const bossHpBarEl     = document.getElementById("bossHpBar");
const bossHpTextEl    = document.getElementById("bossHpText");
const bossMoveLabelEl = document.getElementById("bossMoveLabel");
const bossNameEl      = document.getElementById("bossName");
const enragedChipEl   = document.getElementById("enragedChip");
const bossSpriteEl    = document.getElementById("bossSprite");
const elementChipsEl  = document.getElementById("elementChips");
const arenaEl         = document.getElementById("arena");
const partyFieldEl    = document.getElementById("partyField");
const battlefieldEl   = document.getElementById("battlefield");
const bottomRowEl     = document.getElementById("bottomRow");
const lobbyScreenEl   = document.getElementById("lobbyScreen");
const resultsScreenEl = document.getElementById("resultsScreen");
const modeChipEl      = document.getElementById("modeChip");
const lastCallChipEl  = document.getElementById("lastCallChip");
const closedScreenEl  = document.getElementById("closedScreen");
const queueStripEl    = document.getElementById("queueStrip");
const combatLogEl     = document.getElementById("combatLog");
const statusWindowEl  = document.getElementById("statusWindow");

const INTENTS = {
  attack: { icon: "attack", text: "ATTACK", color: "#ffd76a" },
  defend: { icon: "defend", text: "DEFEND", color: "#9cc8ff" },
  taunt:  { icon: "taunt",  text: "TAUNT",  color: "#ff9a9a" },
  fire:   { icon: "fire",   text: "FIRE",   color: "#ffb070" },
  heal:   { icon: "heal",   text: "HEAL",   color: "#7dffb0" },
  revive: { icon: "revive", text: "REVIVE", color: "#d6c4ff" }
};
// Status bubbles with no icon; `short` is used in the compact status window.
const KO_INTENT   = { icon: null, text: "KO",    short: "KO", color: "#8888b8", target: "" };
const IDLE_INTENT = { icon: null, text: "IDLE?", short: "?",  color: "#ffb070", target: "" };
const CLASS_LABELS = { tank: "TANK", mage: "MAGE", cleric: "CLERIC" };
const CLASS_NAMES  = { tank: "Tank", mage: "Mage", cleric: "Cleric" };
// Marks NPC allies (see src/npc.js), whose sprites are also drawn see-through.
const ALLY_TAG = `<span class="ally-tag">ALLY</span>`;
const QUEUE_NAMES_SHOWN = 4;
const TARGETED_ACTIONS = ["heal", "revive"];

const COMMAND_HELP = [
  "Everyone: !attack (!a) · !defend (!d) · !leave",
  "Tank: !taunt — take strikes for the party",
  "Mage: !fire — big damage, costs MP",
  "Cleric: !heal (!h) [#/name] · !revive [#/name]",
  // Twitch rejects a repeat of the same message within 30 seconds (see chatCommands.js).
  "Repeat blocked? Add a word: !taunt 1, !taunt 2"
];

// Boss animations per move kind (the move names come from the server, per boss).
const BOSS_AOE_ANIMS = { swipe: "anim-boss-attack", power: "anim-boss-power-attack", storm: "anim-boss-blizzard", eruption: "anim-boss-power-attack" };
// Moves worth a warning pulse on the boss sprite while chat is choosing.
const PULSE_MOVES = new Set(["power", "storm", "eruption", "chain"]);
// Announced moves that name players: they get a reticle while chat chooses.
const TARGETED_MOVES = new Set(["strike", "chain", "curse"]);
// Each boss element's color for its hits; damage types for weakness chips.
const ELEMENT_COLORS = { ice: "#bfe6ff", fire: "#ff9a3d", shadow: "#c39bff", storm: "#fff27a" };
const DAMAGE_TYPE_LABELS = { physical: "PHYSICAL", fire: "FIRE", holy: "HOLY" };
// Text icons, for floating numbers; on the battlefield and status window use statusIconHtml.
const STATUS_ICONS = { burn: "🔥", curse: "☠" };

// Burn is a colour emoji; Hex is a solid pixel skull (the ☠ glyph is a thin outline).
function statusIconHtml(status, size) {
  return status === "curse" ? `<span class="st-icon curse">${iconSvg("hex", size)}</span>` : STATUS_ICONS[status];
}

// Above this many players: smaller battlefield sprites and a two-column status window.
const COMPACT_PARTY_SIZE = 5;
const MAX_LOG_LINES = 6;

// Time budget per animation step (ms)
const PLAYER_STEP_MS = 550;
const BOSS_STEP_MS   = 800;
const INTER_STEP_MS  = 200; // gap between each action so they read as distinct beats

// Boss damage numbers spawn to the right of the sprite, out over the battlefield.
const BOSS_NUMBER_OFFSET = { xOffset: 170, yFraction: 0.35 };

let prevState = null;
let isAnimatingResolution = false;
let sequenceGeneration = 0;      // incremented to cancel stale sequences
const unitMap = new Map();       // userId -> battlefield unit element

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Add a CSS animation class, auto-removing it when that element's own animation ends
// (animationend bubbles, so a child's animation must not end the parent's early).
function addAnim(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so removing+re-adding restarts the animation
  el.classList.add(className);
  const onEnd = (e) => {
    if (e.target !== el) return;
    el.classList.remove(className);
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}

// Spawn a floating damage/number label anchored to an element, drifts up and fades.
// xOffset / yFraction move the spawn point away from the anchor's center-top third.
function showFloatingNumber(anchorEl, text, color, { xOffset = 0, yFraction = 1 / 3 } = {}) {
  if (!anchorEl) return;
  const arenaRect  = arenaEl.getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className   = "floating-number";
  el.textContent = text;
  el.style.color = color;
  el.style.left  = `${anchorRect.left - arenaRect.left + anchorRect.width / 2 + xOffset}px`;
  el.style.top   = `${anchorRect.top  - arenaRect.top  + anchorRect.height * yFraction}px`;
  arenaEl.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// Mirrors the server's fallback heal target: lowest HP as a fraction of max HP.
function lowestHpLivingId(players) {
  const alive = Object.entries(players).filter(([, p]) => p.alive);
  if (!alive.length) return null;
  return alive.sort(([, a], [, b]) => a.hp / a.maxHp - b.hp / b.maxHp)[0][0];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function spriteOf(userId) {
  return unitMap.get(userId)?.querySelector(".unit-sprite");
}

// ─── Sequential resolution animation ────────────────────────────────────────

// Defend shields and taunt auras both last until the boss's hit lands.
function clearShields() {
  for (const [, unit] of unitMap) unit.classList.remove("anim-shielded", "anim-taunting");
}

// Consecutive defend-recovery events play as one beat instead of one per defender.
function groupRecoveries(events) {
  const grouped = [];
  for (const event of events) {
    const last = grouped[grouped.length - 1];
    if (event.type === "player_recover" && last?.type === "recover_group") last.items.push(event);
    else if (event.type === "player_recover") grouped.push({ type: "recover_group", items: [event] });
    else grouped.push(event);
  }
  return grouped;
}

function showBossHits(hits, color) {
  for (const hit of hits) {
    const sprite = spriteOf(hit.userId);
    addAnim(sprite, "anim-damage");
    showFloatingNumber(sprite, `-${hit.damage}${hit.burned ? STATUS_ICONS.burn : ""}`, hit.defended ? "#44aaff" : color);
  }
}

// The current boss's element color (for its storm / eruption hits).
let currentBoss = null;
const bossColor = () => ELEMENT_COLORS[currentBoss?.element] ?? "#ff4444";

// ─── Battle effects: projectiles, slashes and bursts ────────────────────────
// Like floating numbers, these are absolutely positioned in the arena and remove
// themselves when done. Timings fit inside the existing step budgets above.
const PROJECTILE_MS = 260;      // a player's bolt / heal in flight
const BOSS_PROJECTILE_MS = 230; // a boss projectile in flight
const LAUNCH_DELAY_MS = 90;     // into the caster's lunge before the bolt leaves

// An element's point in arena coordinates (yFraction: how far down it).
function arenaPoint(el, yFraction = 0.45) {
  const arenaRect = arenaEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - arenaRect.left + r.width / 2, y: r.top - arenaRect.top + r.height * yFraction };
}

function spawnFx(className, { x, y }, color) {
  const el = document.createElement("div");
  el.className = `fx ${className}`;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  if (color) el.style.setProperty("--fx", color);
  arenaEl.appendChild(el);
  return el;
}

// A ring that pops where something lands.
function burstAt(point, color) {
  const el = spawnFx("burst", point, color);
  el.addEventListener("animationend", () => el.remove());
}

// A blade streak across a target (melee hits, the boss's swipes and counters).
function slashAt(targetEl, color, length = 70) {
  if (!targetEl) return;
  const el = spawnFx("slash", arenaPoint(targetEl), color);
  el.style.setProperty("--len", `${length}px`);
  el.addEventListener("animationend", () => el.remove());
}

// A bolt flies from one element to another on a slight arc, then bursts.
// kind: "orb" (glowing ball with a tail), "zap" (lightning streak), "hex" (skull).
function launchProjectile(fromEl, toEl, { color, size = 12, ms = PROJECTILE_MS, arc = 30, kind = "orb" } = {}) {
  if (!fromEl || !toEl) return;
  const from = arenaPoint(fromEl);
  const to = arenaPoint(toEl);
  const el = spawnFx(`projectile ${kind}`, from, color);
  el.style.setProperty("--size", `${size}px`);
  if (kind === "hex") el.innerHTML = iconSvg("hex", size);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const turn = `rotate(${Math.atan2(dy, dx)}rad)`;
  const spin = kind === "hex" ? "" : turn; // the skull stays upright
  const anim = el.animate([
    { transform: `translate(-50%, -50%) ${spin}` },
    { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - arc}px)) ${spin}` },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) ${spin}` }
  ], { duration: ms, easing: "ease-in" });
  anim.onfinish = () => { el.remove(); burstAt(to, color); };
}

// A heal or revive flies from the Cleric to its target (a self-heal just glows).
// Resolves at the moment it lands; returns that time (ms since the step began).
async function sendSupport(event, color) {
  if (event.targetId === event.userId) {
    await sleep(220);
    return 220;
  }
  await sleep(LAUNCH_DELAY_MS);
  launchProjectile(spriteOf(event.userId), spriteOf(event.targetId), { color, size: 12, arc: 44 });
  await sleep(PROJECTILE_MS);
  return LAUNCH_DELAY_MS + PROJECTILE_MS;
}

// What a player's attack looks like in flight; null for a melee swing (the Tank).
function attackProjectile(event, classId) {
  if (event.skill === "fire")   return { color: "#ff8a2a", size: 20, arc: 36 };
  if (event.skill === "fizzle") return { color: "#c08a5a", size: 8, arc: 12 };
  if (classId === "mage")       return { color: "#b48cff", size: 13 };
  if (classId === "cleric")     return { color: "#ffe08a", size: 13 };
  return null;
}

async function runResolutionSequence(events, generation) {
  bossSpriteEl.classList.remove("anim-boss-pulse"); // clear the warning pulse

  for (const event of groupRecoveries(events)) {
    if (generation !== sequenceGeneration) return; // newer render superseded this

    if (event.type === "player_attack") {
      // Spells and the Cleric's holy strike fly to the boss; the Tank's sword slashes it.
      const attacker = unitMap.get(event.userId);
      const bolt = attackProjectile(event, attacker?.dataset.classId);
      addAnim(attacker, "anim-lunge");
      let impactAt = 220;
      if (bolt) {
        await sleep(LAUNCH_DELAY_MS);
        launchProjectile(spriteOf(event.userId), bossSpriteEl, bolt);
        await sleep(PROJECTILE_MS);
        impactAt = LAUNCH_DELAY_MS + PROJECTILE_MS;
      } else {
        await sleep(impactAt);
        slashAt(bossSpriteEl, "#e8f0ff", 110);
      }
      if (generation !== sequenceGeneration) return;
      addAnim(bossSpriteEl, "anim-boss-shake");
      // Daring hits (through a counter / into a power attack) pop in gold with a "!".
      // Weakness hits pop pale gold with a "▲", resisted ones grey with a "▼".
      const color = event.bold ? "#ffd76a"
                  : event.element === "weak" ? "#fff0a0"
                  : event.element === "resist" ? "#9a9ab8"
                  : event.skill === "fire" ? "#ff9a3d"
                  : event.skill === "fizzle" ? "#c08a5a"
                  : "#ff4444";
      const mark = event.bold ? "!" : event.element === "weak" ? "▲" : event.element === "resist" ? "▼" : "";
      showFloatingNumber(bossSpriteEl, `-${event.damageToBoss}${mark}`, color, BOSS_NUMBER_OFFSET);
      await sleep(PLAYER_STEP_MS - impactAt);

    } else if (event.type === "player_heal") {
      addAnim(unitMap.get(event.userId), "anim-lunge");
      const impactAt = await sendSupport(event, "#44ff88");
      if (generation !== sequenceGeneration) return;
      const targetSprite = spriteOf(event.targetId);
      addAnim(targetSprite, "anim-heal");
      showFloatingNumber(targetSprite, `+${event.healAmount}`, "#44ff88");
      if (event.cleansed?.length) showFloatingNumber(targetSprite, "CURED", "#c8ffd8", { yFraction: 0 });
      unitMap.get(event.targetId)?.querySelector(".status-badges")?.remove();
      await sleep(PLAYER_STEP_MS - impactAt);

    } else if (event.type === "player_revive") {
      addAnim(unitMap.get(event.userId), "anim-lunge");
      const impactAt = await sendSupport(event, "#ffe08a");
      if (generation !== sequenceGeneration) return;
      const targetUnit = unitMap.get(event.targetId);
      const targetSprite = spriteOf(event.targetId);
      if (targetUnit && targetSprite) {
        // Swap the tombstone for the class sprite right away; the full render follows later.
        targetUnit.classList.remove("fallen");
        const svg = targetSprite.querySelector("svg");
        svg.outerHTML = spriteSvg(targetUnit.dataset.classId, svg.getAttribute("width"));
      }
      addAnim(targetSprite, "anim-heal");
      showFloatingNumber(targetSprite, "REVIVED", "#44ff88");
      await sleep(PLAYER_STEP_MS - impactAt);

    } else if (event.type === "player_defend") {
      unitMap.get(event.userId)?.classList.add("anim-shielded");
      await sleep(PLAYER_STEP_MS);

    } else if (event.type === "player_taunt") {
      unitMap.get(event.userId)?.classList.add("anim-taunting");
      await sleep(PLAYER_STEP_MS);

    } else if (event.type === "enrage") {
      addAnim(bossSpriteEl, "anim-boss-enrage");
      showFloatingNumber(bossSpriteEl, "ENRAGED!", "#ff4444", BOSS_NUMBER_OFFSET);
      enragedChipEl.hidden = false;
      await sleep(BOSS_STEP_MS);

    } else if (event.type === "boss_aoe" || event.type === "boss_single" || event.type === "counter") {
      const anim = event.type === "boss_aoe" ? BOSS_AOE_ANIMS[event.move]
                 : event.type === "counter" ? "anim-boss-counter"
                 : "anim-boss-attack";
      addAnim(bossSpriteEl, anim);
      // Strikes, storms, eruptions and power attacks fly to each target in the boss's
      // element color; swipes and counters are claws that slash where they land.
      const ranged = event.type === "boss_single" || (event.type === "boss_aoe" && event.move !== "swipe");
      await sleep(380 - BOSS_PROJECTILE_MS);
      if (generation !== sequenceGeneration) return;
      if (ranged) {
        for (const hit of event.hits) {
          launchProjectile(bossSpriteEl, spriteOf(hit.userId),
            { color: bossColor(), size: event.move === "power" ? 24 : 16, ms: BOSS_PROJECTILE_MS, arc: 20 });
        }
      }
      await sleep(BOSS_PROJECTILE_MS);
      if (generation !== sequenceGeneration) return;
      clearShields(); // shields shatter at the moment of impact
      if (!ranged) for (const hit of event.hits) slashAt(spriteOf(hit.userId), "#ff6060", 60);
      showBossHits(event.hits, event.move === "storm" || event.move === "eruption" ? bossColor() : "#ff4444");
      await sleep(BOSS_STEP_MS - 380);

    } else if (event.type === "boss_chain") {
      // The lightning jumps from one marked player to the next.
      addAnim(bossSpriteEl, "anim-boss-attack");
      await sleep(300);
      clearShields();
      let from = bossSpriteEl;
      for (const hit of event.hits) {
        if (generation !== sequenceGeneration) return;
        const to = spriteOf(hit.userId);
        launchProjectile(from, to, { color: ELEMENT_COLORS.storm, kind: "zap", size: 26, ms: 120, arc: 0 });
        await sleep(120);
        showBossHits([hit], ELEMENT_COLORS.storm);
        from = to ?? from;
        await sleep(40);
      }
      await sleep(BOSS_STEP_MS - 300);

    } else if (event.type === "boss_curse") {
      addAnim(bossSpriteEl, "anim-boss-windup");
      await sleep(300 - BOSS_PROJECTILE_MS);
      for (const hit of event.hits) {
        launchProjectile(bossSpriteEl, spriteOf(hit.userId),
          { color: ELEMENT_COLORS.shadow, size: 22, ms: BOSS_PROJECTILE_MS, arc: 50, kind: "hex" });
      }
      await sleep(BOSS_PROJECTILE_MS);
      if (generation !== sequenceGeneration) return;
      for (const hit of event.hits) {
        const sprite = spriteOf(hit.userId);
        addAnim(sprite, "anim-damage");
        showFloatingNumber(sprite, "HEXED ☠", ELEMENT_COLORS.shadow);
      }
      await sleep(BOSS_STEP_MS - 300);

    } else if (event.type === "status_tick") {
      for (const hit of event.hits) {
        const sprite = spriteOf(hit.userId);
        addAnim(sprite, "anim-damage");
        if (sprite) burstAt(arenaPoint(sprite), hit.status === "burn" ? ELEMENT_COLORS.fire : ELEMENT_COLORS.shadow);
        showFloatingNumber(sprite, `-${hit.damage}${STATUS_ICONS[hit.status]}`,
          hit.status === "burn" ? ELEMENT_COLORS.fire : ELEMENT_COLORS.shadow);
      }
      await sleep(PLAYER_STEP_MS);

    } else if (event.type === "recover_group") {
      for (const item of event.items) showFloatingNumber(spriteOf(item.userId), `+${item.amount}`, "#7dffb0");
      await sleep(PLAYER_STEP_MS);

    } else if (event.type === "power_windup") {
      addAnim(bossSpriteEl, "anim-boss-windup");
      await sleep(BOSS_STEP_MS);
      clearShields(); // boss didn't attack but the window has passed
    }

    await sleep(INTER_STEP_MS); // breathing room between each action beat
  }
}

// ─── Top bar and boss ───────────────────────────────────────────────────────

function renderTimer(state) {
  const { phase, countdownSecondsLeft } = state;
  if (phase === "closed") {
    timerEl.textContent = "";
    timerEl.className   = "";
    return;
  }
  if (state.paused && phase !== "resolving") {
    timerEl.textContent = "PAUSED";
    timerEl.className   = "timer-paused";
    return;
  }
  if (phase === "resolving") {
    timerEl.textContent = "BATTLE!";
    timerEl.className   = "timer-battle";
    return;
  }
  if (phase === "lobby" && state.manualStart) {
    timerEl.textContent = "STANDBY"; // the streamer starts this battle
    timerEl.className   = "timer-paused timer-standby";
    return;
  }
  if (phase === "input" || phase === "lobby") {
    timerEl.textContent = Math.max(0, countdownSecondsLeft);
    timerEl.className   = countdownSecondsLeft <= 4 ? "timer-red" : "timer-green";
    return;
  }
  timerEl.textContent = "";
  timerEl.className   = "";
}

function lobbyMessage(state) {
  if (state.lastCall) return "Last call! Joins are closed — this party plays the final battle.";
  const start = state.manualStart ? " — the streamer starts the battle!" : "";
  if (state.mode === "raid") return state.manualStart ? "RAID! !join now — classes lock for 5 battles. The streamer starts it!"
    : "RAID! !join tank, mage, or cleric — classes lock for all 5 battles!";
  return state.manualStart ? `Type !join tank, mage, or cleric${start}` : "Type !join tank, !join mage, or !join cleric to enter the fight!";
}

function renderPhaseMessage(state) {
  if (state.message) {
    phaseMessageEl.textContent = state.message;
  } else {
    switch (state.phase) {
      case "lobby":    phaseMessageEl.textContent = lobbyMessage(state); break;
      case "closed":   phaseMessageEl.textContent = "The game is closed for now — thanks for playing!"; break;
      case "intermission": phaseMessageEl.textContent = `Raid battle ${state.raid?.stage} cleared — catch your breath!`; break;
      case "input":    phaseMessageEl.textContent = state.fight?.reviveGrace
        ? `Every hero is down! ${state.fight.reviveGrace.name} has ${state.fight.reviveGrace.roundsLeft} round${state.fight.reviveGrace.roundsLeft === 1 ? "" : "s"} to revive someone...`
        : `Round ${state.fight?.round ?? ""} — !a(ttack) · !d(efend) · !taunt · !fire · !h(eal) · !revive`; break;
      case "resolving":phaseMessageEl.textContent = "Resolving round..."; break;
      case "results":  phaseMessageEl.textContent = "Results:"; break;
      default:         phaseMessageEl.textContent = "";
    }
  }

  lockedCountEl.textContent = "";
  if (state.phase === "input" && state.fight) {
    // Players only: NPC allies lock in the moment the round opens.
    const livingIds = Object.keys(state.fight.players).filter(id => state.fight.players[id].alive && !state.fight.players[id].npc);
    const locked = livingIds.filter(id => state.pendingActions?.[id]).length;
    if (livingIds.length) lockedCountEl.textContent = `${locked} / ${livingIds.length} locked in`;
  }
}

// Redraws the boss sprite, element chips and biome only when the boss changes.
let renderedBossId = null;
function renderBossIdentity(state) {
  currentBoss = state.boss ?? currentBoss;
  arenaEl.dataset.biome = state.boss?.biome ?? "";
  const id = state.boss?.id ?? null;
  if (id === renderedBossId) return;
  renderedBossId = id;
  bossSpriteEl.innerHTML = id ? bossSvg(id, 280) : "";
  elementChipsEl.innerHTML = state.boss ? elementChipsHtml(state.boss) : "";
}

// "WEAK: FIRE" / "RESISTS: FIRE" chips for a boss.
function elementChipsHtml(boss) {
  return boss.weak.map(t => `<span class="el-chip weak">WEAK: ${DAMAGE_TYPE_LABELS[t]}</span>`).join("") +
    boss.resists.map(t => `<span class="el-chip resist">RESISTS: ${DAMAGE_TYPE_LABELS[t]}</span>`).join("");
}

function renderBoss(state) {
  renderBossIdentity(state);
  bossNameEl.textContent = state.fight?.bossName ?? state.projectedBossName ?? state.boss?.name ?? "";
  enragedChipEl.hidden = !state.fight?.enraged;

  if (!state.fight) {
    bossHpBarEl.style.width = "100%";
    bossHpTextEl.textContent = state.projectedBossHP ? `${state.projectedBossHP} HP · scales with party` : "";
    bossMoveLabelEl.textContent = "";
    bossSpriteEl.classList.remove("anim-boss-pulse");
    return;
  }
  const pct = Math.max(0, (state.fight.bossHP / state.fight.bossMaxHP) * 100);
  bossHpBarEl.style.width  = `${pct}%`;
  bossHpTextEl.textContent = `${state.fight.bossHP} / ${state.fight.bossMaxHP}`;

  if (state.bossMove && (state.phase === "resolving" || state.phase === "results")) {
    bossMoveLabelEl.textContent = state.bossMoveLabel || "";
  } else if (state.phase === "input") {
    bossMoveLabelEl.textContent = state.upcomingMoveLabel || "";
  } else {
    bossMoveLabelEl.textContent = "";
  }

  // Pulse the boss sprite while players are choosing ahead of a big party-wide hit.
  if (state.phase === "input" && PULSE_MOVES.has(state.nextMove?.id)) {
    bossSpriteEl.classList.add("anim-boss-pulse");
  } else {
    bossSpriteEl.classList.remove("anim-boss-pulse");
  }
}

// ─── Party: battlefield units + status window ───────────────────────────────

// One entry per player in slot order, from the fight if it exists, else the lobby.
function partyEntries(state) {
  const players = state.fight?.players;
  if (players) {
    return Object.entries(players)
      .map(([userId, player]) => ({ userId, player, slot: player.slot, classId: player.classId, alive: player.alive, npc: player.npc }))
      .sort((a, b) => a.slot - b.slot);
  }
  return (state.joinedUsers || []).map((userId, i) => ({
    userId, player: null, slot: i + 1, classId: state.joinedClasses?.[userId], alive: true
  }));
}

// What a player's action bubble shows: this round's pending choice while choosing
// and while the round plays out, the action actually taken once results are in.
// (lastAction is never used before results — it would still be last round's.)
function currentIntent(state, entry) {
  const { userId, player } = entry;
  if (!player) return null;

  if (!player.alive) {
    // Only while someone is queued does a fallen player have a limited window to be
    // revived. Their slot is given up at the end of the round where roundsDown reaches
    // the window, so "1 LEFT" means this round is the last chance.
    if (!state.queue?.length) return KO_INTENT;
    const left = Math.max(1, (state.rules?.reviveWindowRounds ?? 0) - player.roundsDown);
    return { ...KO_INTENT, text: `KO · ${left} LEFT` };
  }

  const choosing = state.phase === "input" || state.phase === "resolving";
  const action = choosing ? state.pendingActions?.[userId]
               : state.phase === "results" ? player.lastAction
               : null;
  if (!INTENTS[action]) {
    // One more silent round and this player flees.
    const fleeAt = state.rules?.fleeAfterMissedRounds ?? Infinity;
    return state.phase === "input" && player.idleRounds >= fleeAt - 1 ? IDLE_INTENT : null;
  }

  // Heal/revive show who they're aimed at: slot number, SELF, or ↓ (auto-pick lowest HP).
  let target = "";
  if (choosing && TARGETED_ACTIONS.includes(action)) {
    const targetId = state.pendingTargets?.[userId];
    if (targetId === userId) target = " SELF";
    else if (state.fight.players[targetId]) target = ` → ${state.fight.players[targetId].slot}`;
    else if (action === "heal") target = " ↓";
  }
  return { ...INTENTS[action], target };
}

// Players targeted by a pending heal get a green ✚ badge.
function healTargetIds(state) {
  const ids = new Set();
  const players = state.fight?.players;
  if (state.phase !== "input" || !players) return ids;
  const fallbackId = lowestHpLivingId(players);
  for (const [healerId, action] of Object.entries(state.pendingActions ?? {})) {
    if (action !== "heal") continue;
    const targetId = state.pendingTargets?.[healerId];
    const resolvedId = players[targetId]?.alive ? targetId : fallbackId;
    if (resolvedId) ids.add(resolvedId);
  }
  return ids;
}

// Staggered FF-style formation: columns run from the front (nearest the boss) back,
// every other column offset by half a row. Big parties get smaller sprites and taller columns.
function formation(count) {
  const large = count <= COMPACT_PARTY_SIZE;
  const spriteSize = large ? 80 : 56;
  const unitW = large ? 140 : 116;
  const unitH = large ? 146 : 108;
  if (count === 0) return { large, spriteSize, unitW, positions: [] };

  const rows = Math.min(count, large ? 2 : 3);
  const cols = Math.ceil(count / rows);
  const fieldW = partyFieldEl.clientWidth;
  const fieldH = partyFieldEl.clientHeight;
  const colStep = cols > 1 ? Math.min(large ? 160 : 130, (fieldW - unitW) / (cols - 1)) : 0;
  const stagger = cols > 1 ? unitH / 2 : 0;
  const left0 = Math.max(0, (fieldW - ((cols - 1) * colStep + unitW)) / 2);
  const top0 = Math.max(0, (fieldH - (rows * unitH + stagger)) / 2);

  const positions = [];
  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    positions.push({ left: left0 + col * colStep, top: top0 + row * unitH + (col % 2 ? stagger : 0) });
  }
  return { large, spriteSize, unitW, positions };
}

function renderBattlefield(state, entries) {
  const ids = entries.map(e => e.userId);
  for (const [userId, unit] of unitMap) {
    if (!ids.includes(userId)) { unit.remove(); unitMap.delete(userId); }
  }

  const healTargets = healTargetIds(state);
  const { large, spriteSize, unitW, positions } = formation(entries.length);
  const choosing = state.phase === "input" || state.phase === "resolving";
  const marked = choosing && TARGETED_MOVES.has(state.nextMove?.id) ? state.nextMove.targetIds : [];
  const reticleClass = state.nextMove?.id === "curse" ? "reticle hex" : state.nextMove?.id === "chain" ? "reticle chain" : "reticle";

  entries.forEach((entry, i) => {
    let unit = unitMap.get(entry.userId);
    const isNew = !unit;
    if (isNew) {
      unit = document.createElement("div");
      partyFieldEl.appendChild(unit);
      unitMap.set(entry.userId, unit);
    }

    // Preserve in-flight animation classes while resetting base classes.
    const activeAnims = [...unit.classList].filter(c => c.startsWith("anim-"));
    unit.className = "unit";
    if (!large) unit.classList.add("small");
    if (!entry.alive) unit.classList.add("fallen");
    if (entry.npc) unit.classList.add("npc");
    // Badly hurt: the idle bob turns into a faster, leaning sway.
    if (entry.alive && entry.player && entry.player.hp <= entry.player.maxHp * 0.25) unit.classList.add("weary");
    activeAnims.forEach(c => unit.classList.add(c));
    // The unit's contents are rebuilt on every update, so looping animations inside it
    // (idle bob, aura particles) take their phase from the page clock: a negative delay
    // of the time since load picks each loop up where it was instead of restarting it.
    unit.style.setProperty("--clock", `${-Math.round(performance.now())}ms`);
    unit.style.setProperty("--idle-offset", `${-(entry.slot ?? i) * 470}ms`);
    unit.style.setProperty("--sprite-px", `${spriteSize / 16}px`); // one pixel of the 16x16 art, on screen

    unit.dataset.classId = entry.classId ?? "";
    unit.style.left  = `${positions[i].left}px`;
    unit.style.top   = `${positions[i].top}px`;
    unit.style.width = `${unitW}px`;

    const intent = currentIntent(state, entry);
    const name = state.playerNames?.[entry.userId] ?? entry.userId;
    const cos = state.playerCosmetics?.[entry.userId];
    unit.innerHTML = `
      <div class="intent ${intent ? "" : "empty"}" style="color:${intent?.color ?? "inherit"}">
        ${intent ? `${intent.icon ? iconSvg(intent.icon, large ? 14 : 12) : ""}<span>${intent.text}${escapeHtml(intent.target)}</span>` : "&nbsp;"}
      </div>
      <div class="unit-sprite">
        <div class="aura"></div>
        ${entry.alive ? auraHtml(state.playerCosmetics?.[entry.userId], spriteSize) : ""}
        ${spriteSvg(entry.alive ? entry.classId : "fallen", spriteSize, state.playerGear?.[entry.userId])}
        ${marked.includes(entry.userId) ? `<div class="${reticleClass}"><i></i><i></i><i></i><i></i></div>` : ""}
        ${statusBadgesHtml(entry.player)}
        ${healTargets.has(entry.userId) ? `<div class="heal-target-badge">✚</div>` : ""}
      </div>
      <div class="unit-name${cos?.frame ? ` frame-${cos.frame}` : ""}"><span class="slot">${entry.slot}</span><span class="name-text">${escapeHtml(name)}</span>${entry.npc ? ALLY_TAG : ""}</div>
      ${large ? titleHtml(cos, "unit-title") : ""}
    `;

    // Bounce the action bubble when a player freshly locks in a command.
    if (state.pendingActions?.[entry.userId] && !prevState?.pendingActions?.[entry.userId]) {
      addAnim(unit.querySelector(".intent"), "anim-action-bounce");
    }
    if (isNew) addAnim(unit, "anim-unit-enter");
  });
}

// Award cosmetics (see src/achievements.js). AURA_LOOKS mirrors its AURAS:
// glyph = drifting particles, accessory = a pixel item above the head.
const AURA_LOOKS = {
  frostbound:  { color: "#bfe6ff", glyph: "❄" },
  emberheart:  { color: "#ff9a3d", glyph: "✦" },
  voidtouched: { color: "#c39bff", glyph: "✧" },
  stormcaller: { color: "#fff27a", glyph: "ϟ" },
  victor:      { color: "#7dffb0", glyph: "✚" },
  crown:       { color: "#ffd76a", accessory: "crown" },
  radiant:     { color: "#ff9ef0", glyph: "✶" },
  halo:        { color: "#ffe08a", accessory: "halo" },
  blaze:       { color: "#ff5a3d", glyph: "▲" },
  ascendant:   { color: "#ffffff", glyph: "✦" }
};

// The glow (and particles or accessory) behind/above a sprite, for a player's aura.
function auraHtml(cosmetics, spriteSize) {
  const look = AURA_LOOKS[cosmetics?.aura];
  if (!look) return "";
  const particles = look.glyph ? Array.from({ length: 4 }, () => `<i>${look.glyph}</i>`).join("") : "";
  const accessory = look.accessory
    ? `<div class="accessory">${accessorySvg(look.accessory, Math.max(16, Math.round(spriteSize * 0.4)))}</div>` : "";
  return `<div class="cos-aura" style="--aura:${look.color}">${particles}</div>${accessory}`;
}

// A player's title line (colored by the tier it came from), or "".
function titleHtml(cosmetics, className = "p-title") {
  if (!cosmetics?.title) return "";
  return `<span class="${className} tier-${["bronze", "silver", "gold", "legendary"][cosmetics.titleTier] ?? "bronze"}">${escapeHtml(cosmetics.title)}</span>`;
}

// Burn / Hex markers on a player (rounds left as a small number).
function statusBadgesHtml(player) {
  if (!player?.alive || !(player.burn > 0 || player.curse > 0)) return "";
  const badge = (status) => player[status] > 0
    ? `<span class="sb ${status}">${statusIconHtml(status, 14)}<b>${player[status]}</b></span>` : "";
  return `<div class="status-badges">${badge("burn")}${badge("curse")}</div>`;
}

function barHtml(value, max, width, kind) {
  const pct = Math.max(0, (value / max) * 100);
  const fill = kind === "mp" ? "f-mp" : pct <= 25 ? "f-crit" : pct <= 50 ? "f-low" : "f-hp";
  const textClass = kind === "mp" ? "mp-text" : pct <= 25 && value > 0 ? "hp-crit-text" : "";
  return `<div class="s-bar"><div class="mini-bar ${kind}" style="width:${width}px"><div class="mini-fill ${fill}" style="width:${pct}%"></div></div><span class="${textClass}">${value}/${max}</span></div>`;
}

function statusRowHtml(state, entry, compact) {
  const { userId, player, slot, classId } = entry;
  const name = escapeHtml(state.playerNames?.[userId] ?? userId);
  const avatarUrl = state.avatarUrls?.[userId];
  const avatar = avatarUrl ? `<img class="s-avatar" src="${escapeAttr(avatarUrl)}" alt="">`
    : spriteSvg(classId, 22, state.playerGear?.[userId]);
  const intent = currentIntent(state, entry);
  const level = entry.npc ? "ALLY" : state.playerLevels?.[userId] ?? 1;
  const rowClass = `status-row${player && !player.alive ? " fallen" : ""}${entry.npc ? " npc" : ""}`;
  const afflictions = player?.alive ? ["burn", "curse"].filter(st => player[st] > 0).map(st => statusIconHtml(st, 16)).join("") : "";
  // The icons sit beside the name, outside its ellipsis, so a long name can't hide them.
  const nameCell = `<span class="s-name-cell"><span class="s-name">${name}</span>${afflictions ? `<span class="s-aff">${afflictions}</span>` : ""}</span>`;
  const hp = player ? barHtml(player.hp, player.maxHp, compact ? 56 : 100, "hp") : "";
  const mp = player?.maxMp ? barHtml(player.mp, player.maxMp, compact ? 56 : 64, "mp") : "";
  const dash = `<span style="color:var(--text-dim)">—</span>`;

  if (compact) {
    return `<div class="${rowClass}">
      <span class="slot">${slot}</span>${avatar}${nameCell}
      <span class="s-lv">${level}</span>
      <div class="s-bars-stacked">${hp}${mp}</div>
      <span class="s-intent" style="color:${intent?.color ?? "inherit"}">${intent ? (intent.icon ? iconSvg(intent.icon, 14) : intent.short) : ""}</span>
    </div>`;
  }
  return `<div class="${rowClass}">
    <span class="slot">${slot}</span>${avatar}${nameCell}
    <span class="s-class class-${classId}">${CLASS_LABELS[classId] ?? ""}<span class="s-lv">${entry.npc ? level : `LV ${level}`}</span></span>
    <div>${hp || dash}</div>
    <div>${mp || dash}</div>
    <span class="s-intent" style="color:${intent?.color ?? "inherit"}">${intent ? `${intent.icon ? iconSvg(intent.icon, 14) : ""}<span>${intent.text}${escapeHtml(intent.target)}</span>` : ""}</span>
  </div>`;
}

function renderStatus(state, entries) {
  const compact = entries.length > COMPACT_PARTY_SIZE;
  const rows = entries.map(entry => statusRowHtml(state, entry, compact)).join("");
  statusWindowEl.innerHTML = compact
    ? `<div class="status-grid compact">${rows}</div>`
    : `<div class="status-head"><span>#</span><span></span><span>NAME</span><span>CLASS</span><span>HP</span><span>MP</span><span>ACTION</span></div>
       <div class="status-grid">${rows}</div>`;
}

// "PARTY 8/10 · QUEUE a, b, c +2" — or a nudge to join while there are open slots.
function renderQueue(state, partySize) {
  const max = state.rules?.maxActiveFighters;
  const queue = state.queue ?? [];
  if (!max || (partySize === 0 && queue.length === 0)) {
    queueStripEl.hidden = true;
    return;
  }

  const parts = [`<span class="q-label">PARTY</span><span>${partySize} / ${max}</span>`];
  if (queue.length) {
    const names = queue.slice(0, QUEUE_NAMES_SHOWN)
      .map(q => `<span class="q-name">${escapeHtml(state.playerNames?.[q.userId] ?? q.userId)}</span>`)
      .join(", ");
    const more = queue.length > QUEUE_NAMES_SHOWN ? ` +${queue.length - QUEUE_NAMES_SHOWN}` : "";
    parts.push(`<span class="q-label">QUEUE ${queue.length}</span><span>${names}${more}</span>`);
  } else if (state.lastCall) {
    parts.push(`<span class="q-hint">last call · joins closed</span>`);
  } else if (state.phase !== "ended") {
    const hint = partySize >= max ? "!join to queue" : state.phase === "lobby" ? "!join to play" : "!join to jump in";
    parts.push(`<span class="q-hint">${hint}</span>`);
  }
  queueStripEl.innerHTML = parts.join(`<span class="q-sep">·</span>`);
  queueStripEl.hidden = false;
}

function renderParty(state) {
  const entries = partyEntries(state);
  renderBattlefield(state, entries);
  renderStatus(state, entries);
  renderQueue(state, entries.length);
}

// ─── Combat log and banner ──────────────────────────────────────────────────

// (The lobby and results screens replace the log entirely; see renderScreens.)
function renderLog(state) {
  let title;
  let lines;
  if (state.log?.length) {
    title = `ROUND ${(state.fight?.round ?? 1) - 1}`; // round already advanced past the one resolved
    lines = state.log.slice(-MAX_LOG_LINES);
  } else if (state.phase === "input" && state.fight?.round === 1) {
    title = "COMMANDS";
    lines = COMMAND_HELP;
  } else {
    return; // keep showing the last round's log during input
  }
  combatLogEl.innerHTML = `<div class="log-title">${title}</div><div class="log-lines">` +
    lines.map(line => `<p>${escapeHtml(line)}</p>`).join("") + `</div>`;
}

// ─── Screens: battle, lobby, results ────────────────────────────────────────

// The lobby and results screens replace the battlefield and bottom row entirely.
// Runs first in renderAll so the battlefield has its real size when units are laid out.
function renderScreens(state) {
  const hasResults = state.fightResults || state.raidResults;
  const screen = state.phase === "lobby" ? "lobby"
               : state.phase === "closed" ? "closed"
               : (state.phase === "ended" || state.phase === "intermission") && hasResults ? "results"
               : "battle";
  battlefieldEl.hidden = screen !== "battle";
  bottomRowEl.hidden = screen !== "battle";
  lobbyScreenEl.hidden = screen !== "lobby";
  resultsScreenEl.hidden = screen !== "results";
  closedScreenEl.hidden = screen !== "closed";
  lastCallChipEl.hidden = !state.lastCall || screen === "closed";
  // The lobby shows what kind of fight is coming; a raid shows its battle number throughout.
  const raidStage = state.raid?.stage ?? 0;
  modeChipEl.hidden = state.phase !== "lobby" && !raidStage;
  modeChipEl.textContent = raidStage ? `RAID ${raidStage}/${state.raid.stages}` : state.mode === "raid" ? "RAID" : "SKIRMISH";
  modeChipEl.classList.toggle("raid", state.mode === "raid");
}

const CLASS_ROLES = { tank: "Protector · melee", mage: "Damage · ranged", cleric: "Healer · support" };
// Each class's signature commands, shown on its lobby card.
const SKILL_LINES = {
  taunt:  ["!taunt", "take the boss's strike, shield the party"],
  fire:   ["!fire", "big damage, costs MP"],
  heal:   ["!heal / !h [# / name / self]", "mend an ally"],
  revive: ["!revive [# / name]", "raise the fallen"]
};
const VARIANT_LABELS = { lesser: "LESSER", standard: "STANDARD", powerful: "POWERFUL" };
const VARIANT_HINTS = {
  lesser: "No Cleric in the party: a gentler boss",
  standard: "Veteran parties face a Powerful boss",
  powerful: "Veteran party: extra targets, early enrage!"
};
const TIER_LABELS = { normal: "NORMAL", heroic: "HEROIC", mythic: "MYTHIC" };
const tierChip = (tier) => (tier ? `<span class="tier-chip ${tier}">${TIER_LABELS[tier]}</span>` : "");

// Five pips, filled in proportion to the best class's value.
function pipsHtml(value, max, color) {
  const on = max > 0 ? Math.round((value / max) * 5) : 0;
  return `<div class="pips">${Array.from({ length: 5 }, (_, i) =>
    `<div class="pip"${i < on ? ` style="background:${color}"` : ""}></div>`).join("")}</div>`;
}

function renderLobby(state) {
  const classes = state.classInfo;
  if (state.phase !== "lobby" || !classes) return;
  const joined = state.joinedUsers ?? [];
  const names = state.playerNames ?? {};
  const allies = state.npcAllies ?? [];
  const best = (key) => Math.max(...Object.values(classes).map(c => c[key]));

  const cards = Object.entries(classes).map(([classId, c]) => {
    const members = joined.filter(id => state.joinedClasses?.[id] === classId);
    const skills = c.actions.filter(a => SKILL_LINES[a])
      .map(a => `<span><span class="class-${classId}">${SKILL_LINES[a][0]}</span> — ${SKILL_LINES[a][1]}</span>`).join("");
    const who = members.slice(0, 4).map(id => `<span class="who">${escapeHtml(names[id] ?? id)}</span>`).join("");
    const more = members.length > 4 ? `<span>+${members.length - 4}</span>` : "";
    const ally = allies.find(a => a.classId === classId);
    const nobody = ally ? `<span>No one yet — NPC <span class="who">${escapeHtml(ally.name)}</span> fills in</span>`
      : "<span>No one yet — be the first!</span>";
    return `<div class="panel class-card">
      <div class="cc-head">${spriteSvg(classId, 72)}
        <div><div class="cc-title class-${classId}">${CLASS_LABELS[classId]}</div><div class="cc-role">${CLASS_ROLES[classId] ?? ""}</div></div>
      </div>
      <span class="cmd">!join ${classId}</span>
      <div class="cc-stats">
        <span>HP</span>${pipsHtml(c.maxHp, best("maxHp"), "#3ddc3d")}
        <span>DMG</span>${pipsHtml(c.expectedDamage, best("expectedDamage"), "#e8a13b")}
        <span>MP</span>${pipsHtml(c.maxMp, best("maxMp"), "#4f8fe8")}
      </div>
      <div class="cc-skills"><span style="color:var(--gold)">!attack (!a) · !defend (!d)</span>${skills}</div>
      <div class="cc-joined">${members.length ? `<span>${members.length} joined ·</span>${who}${more}` : nobody}</div>
    </div>`;
  }).join("");

  const variant = state.projectedVariant;
  const meter = Object.keys(VARIANT_LABELS)
    .map(v => `<span class="vm ${v}${v === variant ? " active" : ""}">${VARIANT_LABELS[v]}</span>`).join("");
  const bossArt = state.boss ? bossSvg(state.boss.id, 112) : "";
  const board = (state.leaderboard ?? []).map((b, i) =>
    `<p><span style="color:var(--gold)">${i + 1}.</span> ${escapeHtml(b.name)} — ${CLASS_NAMES[b.classId] ?? ""} Lv ${b.level} · ${b.wins} win${b.wins === 1 ? "" : "s"}</p>`
  ).join("") || `<p style="color:var(--text-dim)">Win a fight to claim a spot!</p>`;

  const isRaid = state.mode === "raid" && state.raid;
  // While a mod has raid voting on, a skirmish lobby shows the vote's progress.
  const vote = !isRaid && state.raidVote?.enabled
    ? `<span class="vote-chip">RAID VOTE · <span class="cmd-inline">!raidvote</span> ${state.raidVote.votes} / ${state.raidVote.needed}</span>` : "";
  const max = state.rules?.maxActiveFighters ?? 10;
  const cells = Array.from({ length: max }, (_, i) => {
    const id = joined[i];
    // After the players: the NPC allies they'd get, see-through like on the battlefield.
    const ally = !id && allies[i - joined.length];
    if (ally) {
      return `<div class="roster-cell npc"><span class="slot">${i + 1}</span>
        <div class="roster-sprite">${spriteSvg(ally.classId, 44)}</div>
        <span class="roster-name">${escapeHtml(ally.name)}</span>
        <span class="s-class class-${ally.classId}">${CLASS_LABELS[ally.classId]}${ALLY_TAG}</span>
      </div>`;
    }
    if (!id) return `<div class="roster-cell open"><span class="roster-open">${state.lastCall ? "CLOSED" : "OPEN"}</span></div>`;
    const classId = state.joinedClasses[id];
    const cos = state.playerCosmetics?.[id];
    return `<div class="roster-cell${cos?.frame ? ` frame-${cos.frame}` : ""}"><span class="slot">${i + 1}</span>
      <div class="roster-sprite">${auraHtml(cos, 44)}${spriteSvg(classId, 44, state.playerGear?.[id])}</div>
      <span class="roster-name">${escapeHtml(names[id] ?? id)}</span>
      ${titleHtml(cos, "roster-title")}
      <span class="s-class class-${classId}">${CLASS_LABELS[classId]}<span class="s-lv">LV ${state.playerLevels?.[id] ?? 1}</span></span>
    </div>`;
  }).join("");
  const queue = state.queue ?? [];
  const note = queue.length
    ? `Queue ${queue.length}: ${queue.slice(0, 5).map(q => escapeHtml(names[q.userId] ?? q.userId)).join(", ")}`
    : state.lastCall ? "Last call — joins are closed · !leave to drop out"
    : joined.length >= max ? "Party full — !join to queue"
    : allies.length ? "NPC allies fill in for a party of one or two — join and they step aside"
    : "Plain !join picks the class the party needs · !leave to drop out";

  lobbyScreenEl.innerHTML = `
    <div class="lobby-main">
      ${cards}
      <div class="lobby-side">
        <div class="panel lobby-boss">
          <span class="lb-label">${isRaid ? `RAID · BATTLE 1 OF ${state.raid.stages}` : "NEXT FIGHT"}</span>
          <span class="lb-name">${escapeHtml(state.projectedBossName ?? state.boss?.name ?? "")}</span>
          <div class="lb-sprite">${bossArt}</div>
          <div class="lb-chips">${state.boss ? elementChipsHtml(state.boss) : ""}</div>
          <div class="variant-meter">${meter}</div>
          <span class="lb-hp">${state.projectedBossHP ? `${state.projectedBossHP} HP · ${isRaid ? "grows every battle" : "scales with party"}` : "Waiting for heroes..."}</span>
          <span class="lb-hint">${state.boss?.signature ?? ""}${variant && variant !== "standard" ? ` · ${VARIANT_HINTS[variant]}` : ""}</span>
        </div>
        ${isRaid ? `<div class="panel lobby-board lobby-raid"><span class="lb-label">RAID · ${state.raid.stages} BATTLES ${tierChip(state.raid.tier)}</span>
            ${raidTrackHtml(state.raid, { next: 1, compact: true })}
            <p>Classes lock · full heal between battles</p>
            <p>Each win banks a chest</p>
            <p>Clear all ${state.raid.stages}: <span style="color:var(--gold)">+1 bonus chest</span></p>
          </div>`
        : `<div class="panel lobby-board"><span class="lb-label">TOP HEROES</span>${board}</div>`}
      </div>
    </div>
    <div class="panel lobby-roster">
      <div class="rs-head"><span class="rs-label">PARTY ${joined.length} / ${max}</span>${vote}<span class="rs-note">${note}</span></div>
      <div class="roster-grid">${cells}</div>
    </div>`;
}

const RESULT_ROWS_SHOWN = 10;
const LOOT_ROWS_SHOWN = 6;
const SLOT_NAMES = { weapon: "weapon", offhand: "off-hand", head: "head", body: "body", trinket: "trinket" };

function lootItemHtml(p) {
  const d = p.drop;
  const stat = `+${+(d.value * 100).toFixed(1)}% ${d.stat}`;
  return `<div class="loot-item">
    <div class="loot-icon rarity-${d.rarity}">${itemSvg(d.slot, p.classId, d.rarity, 32)}</div>
    <div class="loot-info">
      <span class="loot-name rarity-${d.rarity}">${escapeHtml(d.name)}</span>
      <span class="loot-stat">${stat} · ${SLOT_NAMES[d.slot] ?? d.slot}</span>
    </div>
    <div class="loot-who"><span>→ ${escapeHtml(p.name)}</span>
      ${d.equipped ? `<span class="equipped">EQUIPPED</span>` : `<span class="rs-note">to inventory</span>`}</div>
  </div>`;
}

const BADGES = [
  { key: "damage",  label: "TOP DAMAGE", color: "#ffb070" },
  { key: "healing", label: "TOP HEALER", color: "#7dffb0" },
  { key: "revives", label: "LIFESAVER",  color: "#d6c4ff" },
  { key: "daring",  label: "DAREDEVIL",  color: "#ffd76a" }
];

const countdownText = (state) => (state.paused ? "PAUSED" : Math.max(0, state.countdownSecondsLeft));

function resultRowsHtml(state, players) {
  const rows = players.slice(0, RESULT_ROWS_SHOWN).map(p => {
    const avatarUrl = state.avatarUrls?.[p.userId];
    const avatar = avatarUrl ? `<img class="s-avatar" src="${escapeAttr(avatarUrl)}" alt="">`
      : spriteSvg(p.classId, 22, state.playerGear?.[p.userId]);
    return `<div class="results-row${p.finished ? "" : " left"}">
      ${avatar}<span class="s-name">${escapeHtml(p.name)}</span>
      <span class="s-class class-${p.classId}">${CLASS_LABELS[p.classId] ?? ""}</span>
      <span class="num">${p.damage}</span><span class="num">${p.healing}</span>
      <span class="num">${p.revives}</span><span class="num">${p.kos}</span><span class="num">${p.daringHits}</span>
      <span class="xp">+${p.xpEarned}</span>
      <span>Lv ${p.level}</span>
    </div>`;
  }).join("");
  const more = players.length > RESULT_ROWS_SHOWN
    ? `<div class="results-more">+${players.length - RESULT_ROWS_SHOWN} more</div>` : "";
  return `<div class="results-row head">
      <span></span><span>PLAYER</span><span>CLASS</span><span class="num">DAMAGE</span><span class="num">HEALING</span>
      <span class="num">REVIVES</span><span class="num">KOS</span><span class="num">DARING</span><span class="num">XP</span><span>LEVEL</span>
    </div>${rows}${more}`;
}

function badgesHtml(badges) {
  return BADGES
    .filter(b => badges?.[b.key]?.value > 0)
    .map(b => `<div class="badge" style="color:${b.color}"><span class="badge-label">${b.label}</span>` +
              `<span class="badge-name">${escapeHtml(badges[b.key].name)}</span></div>`)
    .join("");
}

// Same shape the server sends for a single fight, worked out from raid totals.
function raidBadges(players) {
  const top = (key) => players.reduce((best, p) => (p[key] > (best?.value ?? 0) ? { name: p.name, value: p[key] } : best), null);
  return { damage: top("damage"), healing: top("healing"), revives: top("revives"), daring: top("daringHits") };
}

function levelLineHtml(players, awards = []) {
  const levelUps = players.filter(p => p.leveledUp);
  const ups = levelUps.length
    ? `<span class="level-up">LEVEL UP!</span>` + levelUps.map(p =>
        `${escapeHtml(p.name)} <span class="class-${p.classId}">${CLASS_NAMES[p.classId]} ${p.level}</span>`).join(" · ")
    : "";
  // New titles (legendary ones first) earned this fight or raid.
  const sorted = awards.slice().sort((a, b) => b.tier - a.tier);
  const won = sorted.length
    ? `<span class="level-up award-label">${sorted.some(a => a.tier === 3) ? "LEGENDARY!" : "NEW TITLE!"}</span>` + sorted.map(a =>
        `${escapeHtml(a.name)} <span class="tier-${["bronze", "silver", "gold", "legendary"][a.tier]}">"${escapeHtml(a.title)}"${a.aura ? ` + ${escapeHtml(a.aura)} aura` : ""}</span>`).join(" · ")
    : "";
  if (!ups && !won) return `<span style="color:var(--text-dim)">No level-ups this time — every round fought still earned XP</span>`;
  return [ups, won].filter(Boolean).join(`<span class="strip-sep">|</span>`);
}

const pct = (x) => `×${+x.toFixed(2)}`;

// The raid's battles as a row of nodes: cleared ones hold a banked chest, `next` is
// highlighted, `failed` marks where a wipe happened. compact = numbers only (lobby).
function raidTrackHtml(raid, { cleared = 0, next = null, failed = null, compact = false } = {}) {
  const nodes = (raid.scales ?? []).map((scale, i) => {
    const n = i + 1;
    const status = n === failed ? "failed" : n <= cleared ? "cleared" : n === next ? "next" : "";
    const bossId = raid.lineup?.[i]?.id;
    const icon = n <= cleared ? chestSvg(compact ? 22 : 30)
      : n === failed ? `<span class="rt-num">X</span>`
      : bossId ? `<span class="rt-boss">${bossSvg(bossId, compact ? 30 : 38)}</span>`
      : `<span class="rt-num">${n}</span>`;
    const label = compact ? "" : `<span class="rt-label">${n === raid.stages ? "FINAL" : `BATTLE ${n}`}</span>`;
    const scales = compact ? "" : `<span class="rt-scale">HP ${pct(scale.hpMultiplier)}</span><span class="rt-scale">HITS ${pct(scale.damageMultiplier)}</span>`;
    return `<div class="rt-node ${status}">${label}<span class="rt-icon">${icon}</span>${scales}</div>`;
  }).join("");
  return `<div class="raid-track${compact ? " compact" : ""}">${nodes}</div>`;
}

function chestRowHtml(count, opened, ghosts = 0) {
  return Array.from({ length: count }, () => chestSvg(48, opened)).join("") +
    Array.from({ length: ghosts }, () => `<span class="ghost-chest">${chestSvg(48)}</span>`).join("");
}

// Post-fight screen: outcome banner, loot drops (or, between raid battles, the
// raid's progress), per-player stats and badges, level-ups, and a countdown.
function renderResults(state) {
  if (state.phase !== "ended" && state.phase !== "intermission") return;
  if (state.raidResults) return renderRaidSummary(state);
  const r = state.fightResults;
  if (!r) return;
  const raid = state.phase === "intermission" ? state.raid : null;

  const boss = escapeHtml(r.bossName);
  const sub = r.outcome === "win"
    ? `${boss} defeated in ${r.rounds} rounds` +
      (r.speedBonus ? ` · ${r.par - r.rounds} under par: <span style="color:#7dffb0">+${r.speedBonus} XP</span> speed bonus` : "")
    : r.outcome === "ended"
      ? `Called off by a mod after ${r.rounds} round${r.rounds === 1 ? "" : "s"} · every round fought still earns XP`
      : `The party fell in round ${r.rounds} · every round fought still earns XP`;

  let leftPanel;
  if (raid) {
    const nextStage = raid.stage + 1;
    const scale = raid.scales[raid.stage];
    leftPanel = `<div class="panel rs-loot rs-raid">
      <div class="rs-head"><span class="rs-label">RAID PROGRESS ${tierChip(raid.tier)}</span><span class="rs-note">${raid.chests} chest${raid.chests === 1 ? "" : "s"} banked</span></div>
      ${raidTrackHtml(raid, { cleared: raid.chests, next: nextStage })}
      <div class="raid-next">
        <span class="lb-label">${nextStage === raid.stages ? "FINAL BATTLE" : `NEXT · BATTLE ${nextStage} OF ${raid.stages}`}${raid.lineup?.[raid.stage] ? ` · ${escapeHtml(raid.lineup[raid.stage].name)}` : ""}</span>
        <span>${raid.nextBossHP ? `${raid.nextBossHP} HP · ` : ""}hits ${pct(scale.damageMultiplier)} · party fully restored</span>
      </div>
      <span class="lb-label">CHESTS BANKED</span>
      <div class="raid-chests">${chestRowHtml(raid.chests, false, raid.stages - raid.chests)}<span class="bonus-chest" title="full-clear bonus">+1</span></div>
      <div class="rs-note raid-foot">Chests open when the raid ends · clear all ${raid.stages} for a bonus chest</div>
    </div>`;
  } else {
    const drops = r.players.filter(p => p.drop);
    const loot = drops.length
      ? drops.slice(0, LOOT_ROWS_SHOWN).map(lootItemHtml).join("") +
        (drops.length > LOOT_ROWS_SHOWN ? `<div class="results-more">+${drops.length - LOOT_ROWS_SHOWN} more</div>` : "")
      : `<div class="loot-empty">${r.outcome === "win" ? "No drops this time — every win is another chance" : r.outcome === "ended" ? "No loot from a called-off battle" : "Loot only drops on a win"}</div>`;
    leftPanel = `<div class="panel rs-loot">
      <div class="rs-head"><span class="rs-label">LOOT DROPS</span><span class="rs-note">${drops.length} this fight</span></div>
      ${loot}
    </div>`;
  }

  resultsScreenEl.innerHTML = `
    <div class="panel rs-banner">
      <div class="results-title ${r.outcome}">${raid ? `BATTLE ${raid.stage}/${raid.stages} CLEARED!` : RESULT_TITLES[r.outcome]}</div>
      <div class="results-sub">${sub}</div>
    </div>
    <div class="rs-main">
      ${leftPanel}
      <div class="panel rs-stats">
        <div class="rs-head"><span class="rs-label">BATTLE STATS</span><span class="rs-note">saved to each class profile</span></div>
        ${resultRowsHtml(state, r.players)}
        <div class="rs-badges">${badgesHtml(r.badges)}</div>
      </div>
    </div>
    <div class="panel rs-strip">
      <span>${levelLineHtml(r.players, r.awards)}</span>
      <span class="next-lobby">${raid ? "NEXT BATTLE" : "NEXT LOBBY"} ${countdownText(state)}</span>
    </div>`;
}

const CHEST_ROWS_SHOWN = 7;
const RESULT_TITLES = { win: "VICTORY!", loss: "DEFEAT", ended: "BATTLE ENDED" };
const RAID_TITLES = { cleared: "RAID CLEARED!", wiped: "RAID OVER", ended: "RAID ENDED" };

// End of a raid: how far the party got, every raider's opened chests, and raid totals.
function renderRaidSummary(state) {
  const rr = state.raidResults;
  const chests = `${rr.chests} chest${rr.chests === 1 ? "" : "s"}`;
  const sub = rr.outcome === "cleared"
    ? `All ${rr.stages} battles won · ${chests} each, including the full-clear bonus`
    : rr.outcome === "wiped"
      ? `The party fell in battle ${rr.stagesCleared + 1} of ${rr.stages} · ${chests} banked and opened`
      : `Called off after ${rr.stagesCleared} of ${rr.stages} battles · ${chests} opened`;

  const rows = rr.players.slice(0, CHEST_ROWS_SHOWN).map(p => {
    const equipped = p.items.filter(i => i.equipped).length;
    const items = p.items.length
      ? p.items.map(i => `<div class="loot-icon small rarity-${i.rarity}${i.equipped ? " is-equipped" : ""}">${itemSvg(i.slot, p.classId, i.rarity, 20)}</div>`).join("")
      : `<span class="rs-note">${p.finished ? "too few rounds played" : "left the raid"}</span>`;
    return `<div class="chest-row">
      <span class="cr-name">${escapeHtml(p.name)}<span class="s-class class-${p.classId}">${CLASS_LABELS[p.classId] ?? ""}</span></span>
      <div class="cr-items">${items}</div>
      <span class="equipped">${equipped ? `${equipped} EQUIPPED` : ""}</span>
    </div>`;
  }).join("");
  const more = rr.players.length > CHEST_ROWS_SHOWN
    ? `<div class="results-more">+${rr.players.length - CHEST_ROWS_SHOWN} more</div>` : "";

  const raid = { stages: rr.stages, scales: state.raid?.scales ?? [], lineup: rr.lineup };
  const titleClass = rr.outcome === "cleared" ? "win" : rr.outcome === "wiped" ? "loss" : "ended";
  resultsScreenEl.innerHTML = `
    <div class="panel rs-banner">
      <div class="results-title ${titleClass}">${RAID_TITLES[rr.outcome]}</div>
      <div class="results-sub">${sub}</div>
    </div>
    <div class="rs-main">
      <div class="panel rs-loot rs-raid">
        <div class="rs-head"><span class="rs-label">RAID CHESTS ${tierChip(rr.tier)}</span><span class="rs-note">${rr.chests ? `${chests} per raider` : "no battles cleared"}</span></div>
        ${raidTrackHtml(raid, { cleared: rr.stagesCleared, failed: rr.outcome === "wiped" ? rr.stagesCleared + 1 : null })}
        ${rows}${more}
      </div>
      <div class="panel rs-stats">
        <div class="rs-head"><span class="rs-label">RAID TOTALS</span><span class="rs-note">all ${rr.stagesCleared + (rr.outcome === "wiped" ? 1 : 0)} battles · saved per fight</span></div>
        ${resultRowsHtml(state, rr.players)}
        <div class="rs-badges">${badgesHtml(raidBadges(rr.players))}</div>
      </div>
    </div>
    <div class="panel rs-strip">
      <span>${levelLineHtml(rr.players, [...(state.fightResults?.awards ?? []), ...(rr.awards ?? [])])}</span>
      <span class="next-lobby">NEXT LOBBY ${countdownText(state)}</span>
    </div>`;
}

function renderAll(state) {
  renderScreens(state);
  renderTimer(state);
  renderPhaseMessage(state);
  renderBoss(state);
  renderParty(state);
  renderLog(state);
  renderLobby(state);
  renderResults(state);
  renderClosed(state);
}

// Shown while the game is closed (!closegame, or once last call has played out).
function renderClosed(state) {
  if (state.phase !== "closed") return;
  const wyrm = bossSvg("frost_wyrm", 240);
  const board = (state.leaderboard ?? []).map((b, i) =>
    `<p><span style="color:var(--gold)">${i + 1}.</span> ${escapeHtml(b.name)} — ${CLASS_NAMES[b.classId] ?? ""} Lv ${b.level} · ${b.wins} win${b.wins === 1 ? "" : "s"}</p>`
  ).join("") || `<p style="color:var(--text-dim)">No heroes yet</p>`;
  closedScreenEl.innerHTML = `
    <div class="panel closed-card">
      <div class="closed-wyrm">${wyrm}<span class="zzz">z<span>z</span><span>Z</span></span></div>
      <div class="closed-text">
        <div class="results-title ended">THE WYRM SLEEPS</div>
        <div class="results-sub">The game is closed for now — thanks for playing!</div>
        <div class="closed-note">Watch chat: the next battle opens soon.</div>
        <div class="panel lobby-board closed-board"><span class="lb-label">TOP HEROES</span>${board}</div>
      </div>
    </div>`;
}

// ─── Socket event handlers ───────────────────────────────────────────────────

// The server's overlay version changes on every restart and overlay file edit;
// reload when it does so this page never runs outdated code.
let loadedOverlayVersion = null;
socket.on("overlayVersion", (version) => {
  if (loadedOverlayVersion && version !== loadedOverlayVersion) location.reload();
  loadedOverlayVersion = version;
});

socket.on("state", (state) => {
  const enteringResults = state.phase === "results" && prevState?.phase !== "results";

  if (enteringResults && state.resolutionEvents?.length) {
    isAnimatingResolution = true;
    const gen = ++sequenceGeneration;

    // Show the text log and phase label immediately; hold off HP bar updates.
    renderTimer(state);
    renderPhaseMessage(state);
    renderLog(state);

    runResolutionSequence(state.resolutionEvents, gen).then(() => {
      if (gen !== sequenceGeneration) return; // superseded — don't overwrite a newer render
      isAnimatingResolution = false;
      renderBoss(state);   // snap HP bars to final values once sequence finishes
      renderParty(state);
    });

    prevState = state;
    return;
  }

  if (isAnimatingResolution) {
    if (state.phase !== "results") {
      // A new phase arrived before the sequence finished — abort and render immediately.
      sequenceGeneration++;
      isAnimatingResolution = false;
      renderAll(state);
    }
    prevState = state;
    return;
  }

  renderAll(state);
  prevState = state;
});
