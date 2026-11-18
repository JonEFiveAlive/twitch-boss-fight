# Twitch Chat Boss Fight — Project Plan

A collaborative, PvE, round-based boss-fight game for Twitch chat, presented in a
classic Final-Fantasy-style battle screen. Chat fights a shared boss together using
typed commands, resolved once per round (not spam-driven).

---

## Vision Summary

- **Format:** Chat vs. shared PvE boss, resolved in discrete rounds.
- **Presentation:** Classic JRPG battle screen — side-view party vs. boss, HP/MP bars,
  portraits, text-log "combat message" window. Placeholder graphics for now (simple
  shapes/silhouettes), real pixel art later.
- **Participation model:** Round-based resolution using each unique viewer's *last*
  command before the round closes. This is the core anti-spam mechanic — repeating a
  command doesn't add extra effect, so the only decision that matters is *which*
  command you pick that round.
- **Classes (introduced in Phase 2):** Tank/Fighter (melee), DPS/Mage (ranged),
  Healer/Cleric (support).
- **Class commitment rule:** For skirmishes, players choose a class each time via
  `!join <class>`. For raids (Phase 7), the class choice locks for the entire raid —
  no switching until the raid ends.
- **Game modes:**
  - Skirmish (formerly "one-off battle"): single boss fight, class chosen freely each time.
  - Raid: 5 battles in a row, progressively harder, class locked for the duration,
    rewards scaled by how far the team gets (even a wipe partway through nets something).
- **PvE only** for now — chat collaborates against the game, not against each other.
- **Inclusive by default:** anyone can join any fight regardless of level or gear.
  New and returning players should never be locked out or feel like dead weight.
  Bosses scale to the party that actually joined (see Open Questions) rather than
  gating entry by level.

---

## Build Order (Crawl / Walk / Run)

1. **Phase 1 — Core Loop (complete)**
   - `!join` to enter the fight (no classes yet).
   - Two commands each round: `!attack` and `!defend`.
   - Round-based resolution: tally each unique user's last command, resolve all at
     once, boss acts.
   - **Individual player HP** (not a shared team pool) — a player's own choices and
     survival matter to them personally. Team damage output scales down as players
     die (dead players contribute nothing).
   - **Boss attacks are full AoE for now** — hits all living players equally.
     Individual targeting is deferred to Phase 4, alongside targeted player commands.
   - **Boss moveset (scripted rotation, not random, for v1):**
     - *Basic Attack* — no telegraph, 100% damage, hits all living players.
       `!defend` reduces incoming damage by 90%.
     - *Power Attack* — 1-round telegraph ("windup"); boss takes +25% damage while
       telegraphing (attacking during windup has no defensive payoff that round,
       since the boss isn't attacking yet); executes on the following round at
       250% damage, hits all living players. `!defend` reduces the execute round's
       incoming damage by 90%, same as Basic Attack — makes the windup/execute
       sequence a genuine two-round risk/reward decision (attack both rounds for
       max boss damage vs. defend on execute to survive the big hit). May be
       refactored later so Power Attack's execute is unavoidable, making healing
       the primary answer to it instead — revisit once Phase 2 (heal) exists.
     - *Counter* — telegraphed; any player who chooses `!attack` while the boss is
       countering takes full retaliation damage; players who choose `!defend`
       avoid it entirely (no partial mitigation needed here — it's a clean
       safe/risky binary by design). Rewards defending. (Replaces a plain "Defend"
       boss move, which gave players no new information to react to.)
     - **Universal defend rule:** `!defend` always reduces incoming boss attack
       damage by 90%, across all move types where the boss deals damage that round
       (Basic Attack, Power Attack execute). Counter is the exception — it's a full
       avoid/don't-avoid choice rather than a damage-reduction one.
     - Rotation is scripted/fixed order for v1 (not randomized) — easier to debug
       and balance; randomize later once the fundamentals are solid.
   - **Placeholder numbers (tune later once playtested):**
     - Player base attack: 10 dmg to boss per attacking living player.
     - Boss Basic Attack: 8 dmg to each living player (0.8 dmg if defending).
     - Boss Power Attack execute: 20 dmg to each living player (2 dmg if defending).
     - Counter retaliation: 15 dmg to each player who chose `!attack` that round
       (0 dmg if defending).
     - Windup bonus: player damage to boss ×1.25 during the windup round only.
   - On-screen indicator near each character showing their locked-in command for
     the round (not a full menu — just enough to show everyone's move is registered).
   - Single generic boss with an HP bar. Placeholder graphics (simple
     shapes/silhouettes) for party + boss + HP bars.
   - Goal: prove the core loop is fun to watch and technically solid before adding
     ANY other complexity.

2. **Phase 2 — Universal Heal (complete)**
   - Add a single `!heal` command available to *everyone* (not class-gated yet) that
     heals the lowest-HP living player.
   - Goal: prove out the "heals matter" loop — especially valuable against Power
     Attack's AoE damage — before gating healing behind a Healer class.

3. **Phase 3 — Classes**
   - Tank/Fighter (melee), DPS/Mage (ranged), Healer/Cleric (support).
   - `!join <class>` for skirmishes (free choice each time).
   - Class-specific commands (e.g. `!attack` for Tank/Mage, `!heal` now gated to
     Healer, maybe `!taunt` for Tank).

4. **Phase 4 — Targeted Commands + Individual Boss Targeting (complete)**
   - e.g. `!heal player2`, plus single-target boss attack options alongside/instead
     of pure AoE.
   - Fuzzy/partial username matching, sensible fallback if target is invalid or
     already gone (e.g. default to lowest-HP active player).
   - Groundwork for later mechanics like a "cursed player" the healer must save.

5. **Phase 5 — Persistence (5a and 5b playtested)**
   - Per-user, per-class profiles (SQLite): wins, damage done, healing done, levels.
   - No gear yet — just stats and a leaderboard.
   - Record per-boss / per-variant win counters and other tracked stats from day
     one — they feed titles and badges (see Progression & Balance), and history
     recorded before titles exist shouldn't be lost.
   - **Risk rewards (decided):** a *team speed bonus* — extra XP for every
     participant when the boss falls under par (`TARGET_FIGHT_ROUNDS`), scaling with
     how far under — plus tracked *daring stats* per player (hits landed through a
     counter, attacks into a Power Attack) that unlock titles/badges such as
     "Counter-Puncher" or "Unflinching". Base XP for careful play is unchanged; the
     bonus is shared, so a reckless KO that slows the team costs everyone.

6. **Phase 6 — Gear Drops (playtested)**
   - Loot on boss defeat; simple stat-bump items to start.
   - Equipped gear is visible on the player's sprite (layered sprite parts per
     visible gear slot), so progression shows up on stream, not just in numbers.
   - Distribution method TBD (random vs. contribution-weighted — revisit fairness
     question when we get here).

7. **Phase 7 — Raids (playtested)**
   - 5 battles in a row, progressively harder.
   - Class locked for the full raid.
   - Rewards scaled by how far the team progressed.
   - A capped/queued roster (see Ideas Log) likely becomes relevant around here or
     Phase 8, once team size needs to be bounded.
   - **Decided:** the streamer/mods start raids (`!raid`); chat can too with
     `!raidvote`, but only while a mod has voting switched on
     (`!enableraidvote` / `!disableraidvote`), so a busy stream isn't taken over
     by a raid. Battles follow each other automatically after a short
     intermission. Phase 7 escalates the one Frost Wyrm; new bosses wait for
     Phase 8.

8. **Phase 8 — Raid Tiers / Boss Variety (implemented, awaiting playtest)**
   - Multiple bosses, difficulty tiers gated by average party gear/level.
   - Refine difficulty curve.
   - **Decided:** three new bosses (four in all), each reusing the shared move
     kinds under its own names plus one signature move. Skirmish bosses are
     random (never the same twice in a row) with a mod override (`!boss`).
     Raids mix the bosses; the raid tier (Normal/Heroic/Mythic) is picked
     from the party's average power like variants are, with better chests
     higher up, so nobody is gated out. Elemental weaknesses and biome
     backdrops come in, kept light (no new player commands).

9. **Phase 9 — Web Companion App**
   - Not for playing the game — for reviewing character stats/history and choosing/
     equipping gear between streams.
   - Twitch OAuth login (matches usernames already used in chat).
   - Per-class XP progress: current XP, XP to next level, and lifetime stats
     (the on-stream results screen only shows XP gained and level-ups, by design;
     a thin XP bar there is an optional later addition).
   - Equip/gear selection happens here, between streams — keeps the live chat-command
     game loop simpler since gear-swapping isn't something that has to happen live.

---

## Progression & Balance (decided)

Guiding goal: anyone can join any fight and matter. Progression is mostly about
**options, cosmetics, titles and awards** rather than raw power.

- **Power band:** a fully progressed player is at most ~1.5× as strong as a
  brand-new player of the same class. Every power source (level, gear) is capped
  to fit inside this band.
- **Levels are unlimited; stats are not.** Stat growth from levels follows a
  diminishing-returns curve and stops at a configurable stat-cap level (proposed
  50). XP and levels keep counting past it — a level-200 player is a mark of time
  played and battles won, not extra power. Past the cap, levels award cosmetics,
  title flair and name-plate frames.
- **Power formula lives in one place.** A single `playerPower()` function (level
  part + gear part, each capped) feeds both player stats and boss scaling. Caps
  live in `gameConfig.js`, so a future expansion can raise the cap or add a new
  axis (e.g. mastery/sidegrade points) without rebalancing everything.
- **Class-specific progression and gear.** Each class levels independently and
  has its own gear, so playing a different class means building it up too.
- **Visible gear:** weapon, off-hand, head and body show on the sprite. Trinkets
  never show as equipment, but some trinkets add an aura or visible effect around
  the sprite (e.g. frost shimmer, ember sparks).
- **Loot is personal.** Every participant gets their own roll — nobody competes
  for drops. Quality is weighted by participation (actions submitted, rounds
  survived), not damage, so showing up is what's rewarded.
- **Heals scale with the target** (% of the target's max HP), so Clerics stay
  useful in any party.
- **Risk is rewarded, never required.** Attacking through a Tail Counter or into
  a Power Attack deals +50% damage (`BOLD_*_MULTIPLIER`), announced in the boss's
  warning and shown as gold "!" numbers. Careful play is balanced to the same
  fight length as before; risky play wins faster at the cost of more KOs. Phase 5
  layers XP/title rewards for speed and daring on top (see Phase 5).
- **Titles, badges and milestone rewards:** tracked stats (e.g. Frost Wyrm
  defeated 10 / 25 / 50 times, per variant) unlock upgrading titles and badges;
  some milestones grant a special drop. Milestone drops can be cosmetic or a
  sidegrade (a new skill option, a unique effect) but never break the power band.
  Players choose which earned title to display; it shows with their name on
  stream.
- **Boss scaling (locked at battle start):**
  - Boss HP scales with the party's **total** power, so each player adds boss HP
    in proportion to the damage they bring and fights land near a target length
    (`TARGET_FIGHT_ROUNDS`). Each boss **hit** scales with the power of the player
    it lands on (decided in 5b, replacing the earlier "party median" idea, which
    left newcomers in veteran parties taking veteran-sized hits). Relative danger
    is therefore constant per player; veterans carry through damage and healing.
    Phase 6 defensive gear should add a separate defense stat (not more power) so
    it still matters under this scaling.
  - The boss **variant**: a party with no Cleric faces the Lesser Frost Wyrm at
    any level; otherwise a party whose average power reaches ~1.14 (≈ average
    level 15) faces the Powerful Frost Wyrm (two-target Frost Breath, enrages at
    50% instead of 30%), else the standard Frost Wyrm. A veteran party gets a
    different fight, not just a longer one.
  - Scaling and variant are shown in the lobby so chat knows joining is always
    welcome.
  - Deaths don't reduce boss HP mid-fight.

---

## Party, Participation & Stream Ops (decided)

- **Identity:** players are keyed by their Twitch user ID (stable across
  renames). The display name is only for showing on stream and for
  `!heal <name>` matching.
- **Roster cap + queue:** at most `MAX_ACTIVE_FIGHTERS` (start at 10) fight at
  once; extra `!join`s go into a visible queue. Built so the cap can grow with the
  channel.
- **Joins and fills mid-fight (skirmishes only; raids stay locked):** new or
  queued players fill open slots between rounds. Each joiner adds boss HP equal to
  the damage they're expected to deal over the rounds remaining, so mid-fight
  joins fit total-power scaling instead of breaking it. A filler takes over the
  freed slot number.
- **Revive:** Clerics can `!revive` a fallen player. The revived player's HP
  scales with the Cleric's skill level (within the power band).
- **Unrevived slots open up:** if a fallen player isn't revived within
  `REVIVE_WINDOW_ROUNDS` (start at 5) and someone is queued, their slot goes to
  the next in line. They keep the XP they earned.
- **Fleeing:** missing input for `FLEE_AFTER_MISSED_ROUNDS` (3–5) consecutive
  rounds makes a player flee, freeing their slot. They get XP only for the rounds
  they were active. Loot requires a participation threshold (e.g. acted in ≥50%
  of the rounds they were present).
- **Rogue-lite XP:** XP comes from participation and progress, even when a player
  dies or the party loses. Deaths are expected and still move you forward, making
  the next attempt more winnable.
- **No reward for wasted actions:** healing a full-HP player gives no bonus —
  picking the right action is part of the strategy.
- **Insufficient MP:** a skill used without enough MP falls back to the basic
  version at reduced strength (start at 70% — e.g. a 20 HP heal becomes 14).
- **Fight modes:** *Auto-play* (the loop starts battles on its own) and *Streamer
  Control* (the streamer starts each battle). Target fight length starts at ~5
  minutes; tune after playtesting.
- **Minimal bot chat posts:** battle start, battle end, and achievement
  milestones (e.g. "JonEFive has defeated 5 Frost Wyrms!"). No per-round or
  per-loot messages — chat is already busy with `!` commands.

---

## Tech Stack (working assumption)

- **Chat integration:** Node.js + tmi.js (connects to Twitch chat via a bot account,
  parses `!commands`). Auth uses a registered Twitch application (Client ID/Secret)
  with the OAuth refresh-token flow, so the bot's access token renews itself
  automatically rather than needing manual regeneration every couple months.
- **Game state / real-time updates:** WebSockets (e.g. socket.io) pushing state from
  the Node backend to a browser overlay.
- **Display:** Browser page (HTML/JS/Canvas or similar) captured as an OBS Browser
  Source — not a Twitch Extension (avoids Twitch review/approval overhead for a
  personal project).
- **Persistence (Phase 4+):** SQLite, keyed by `(twitch_user_id, class)` since class
  progression is independent per class.
- **Web app (Phase 8):** Twitch OAuth for login; separate from the live game loop.

---

## Ideas Log (parked for later — not in current scope)

- Sprite customization for players via the web interface.
- ~~Biomes and elemental weaknesses~~ — done in Phase 8 (each boss has a biome
  and a weakness/resistance). Still open: biomes independent of the boss, and
  elemental typing beyond physical / fire / holy.
- Different biomes/locations as fight settings (desert, ice cave, volcano, etc.) —
  could double as a way to reskin/flavor difficulty tiers.
- Elemental strengths/weaknesses (e.g. ice boss weak to fire attacks) — would require
  elemental typing on attacks eventually, likely tied to Mage abilities.
- Capped team size with a visible queue — lets viewers see their name queued up even
  when the active roster is full, which is itself an engagement hook. Likely relevant
  around Phase 7/8 (raids, raid tiers) once team size needs to be bounded.
- ~~Randomized (vs. scripted) boss move selection~~ — done: weighted-random,
  announced moves (see Change Log, 2026-11-17).
- **Champions mode** — an admin-run mode where the streamer sets level/gear
  requirements and has extra control over the battle. Deliberately the opposite of
  the default inclusive mode; parked until the inclusive mode is solid.
- **Spectator participation ("crowd meter"):** non-fighters type e.g. `!cheer`;
  each *unique* spectator per round fills a shared meter (keeps the anti-spam
  rule). A full meter triggers a small party effect — a group heal, a boss
  stagger, or a faster/stronger revive. Spectators could earn badges (never
  power) for cheering, and might vote on the next boss or biome.
- **Support-class temporary buffs** (e.g. a Cleric blessing that raises a
  target's defense for a round or two).
- **Loot crafting:** combine or scrap duplicates (e.g. 5 commons → 1 uncommon).
- **Procedurally randomized loot:** generated names, values and appearance;
  higher rarity can mean a visual effect even at the same stats.
- **Channel points / bits redeems** — cosmetic only (sprite flair, cheer
  effects), since paid power conflicts with the inclusive principle.
- **Community goals:** e.g. "Chat has defeated 100 Frost Wyrms" unlocks a new boss
  or biome for everyone.
- **Seasonal / event bosses** with limited-time titles.
- **Sound effects** for hits, heals and victory.
- *(add more here as they come up)*

---

## Open Questions (to revisit at the relevant phase)

- Progression numbers are now set (stat cap 50, levels +30%, gear ≈ +13% power
  and 15% defense, XP curve, Powerful at average power 1.14) — revisit only if
  playtesting says the grind is too fast or slow.
- Mixed parties: one veteran with several new players averages out to a lower
  variant — confirm that feels right in playtesting.
- Gear drop rate (40% per eligible player per win) and rarity odds — confirm the
  pace of upgrades feels right on stream.
- One shared raid/fight per stream vs. multiple simultaneous instances (leaning
  toward one shared fight for v1 — much simpler to build and to watch).
- Revive HP scaling by Cleric skill: revived HP is a share of the target's max HP
  (which already grows with their level); whether the Cleric's own level should
  add to it is still open. (Flee threshold is 4 rounds; loot needs ≥ 50%
  participation.)
- Spectator participation: adopt the crowd-meter idea (Ideas Log), and if so,
  which effects it can trigger.

---

## Change Log

- Initial plan drafted covering Phases 1–8, vision summary, tech stack, and ideas log.
- Reworked Phase 1: individual player HP with AoE-only boss attacks (targeting
  deferred to Phase 4), three-move scripted boss rotation (Basic Attack, Power
  Attack, Counter — replacing the earlier plain "Defend" boss move), and an
  on-screen per-character command indicator. Inserted a new Phase 2 (universal,
  non-class-gated `!heal`) ahead of Classes. Renumbered all subsequent phases
  accordingly (Classes → 3, Targeted Commands (+ individual boss targeting) → 4,
  Persistence → 5, Gear Drops → 6, Raids → 7, Raid Tiers/Boss Variety → 8, Web
  Companion App → 9). Added capped/queued roster and scripted-vs-random boss move
  selection to the Ideas Log.
- Finalized Phase 1 defend mechanics: `!defend` universally reduces incoming boss
  attack damage by 90% (Basic Attack and Power Attack execute both mitigated this
  way; Counter remains a clean full avoid/no-avoid choice). Documented placeholder
  damage numbers for reference.
- Switched bot auth from a manually-generated token to a registered Twitch
  application (Client ID/Secret) using the OAuth refresh-token flow, so the
  access token renews itself automatically. Added `src/twitchAuth.js` and a
  one-time `scripts/get-twitch-token.js` setup script.
- **Phase 1 feature completion and visual polish:**
  - Bumped `INPUT_WINDOW_SECONDS` from 10 → 15; added all-players-locked
    shortcut that caps the timer to 5 s once every living player has submitted.
  - Fixed `upcomingMoveLabel` gap: boss move telegraph now correctly computed at
    the start of each input phase and included in every broadcast.
  - Added `lastState` tracking and an `io.on("connection")` replay handler so
    overlay clients that reconnect mid-game (e.g. OBS reload) receive the
    current state immediately rather than a blank screen.
  - Added HP numbers (current / max) to boss and all player HP bars.
  - Twitch avatar integration: `fetchTwitchAvatar` calls the Helix `/users`
    endpoint, results are cached in `avatarCache` across rounds and broadcast
    as `avatarUrls`; overlay displays the avatar image in place of the
    placeholder emoji (falls back to emoji if unavailable).
  - Sequential per-step animation system: `fight.js` now produces a
    `resolutionEvents` array alongside each resolved round; the overlay
    consumes it in `runResolutionSequence` to animate each player action and
    boss move as a distinct timed beat with inter-step pauses. HP bar updates
    are held until the full sequence completes.
  - Floating damage numbers anchored to their target element, drifting up and
    fading out (color-coded: red for boss hits, blue for defended hits).
  - Persistent blue shield aura (`anim-shielded`) applied to defenders when
    their turn resolves; cleared at the moment of boss impact rather than
    expiring on a timer.
  - Fixed stale action icon bug: `player.lastAction` (previous round's icon)
    no longer appears on cards during the `resolving` phase; icons are cleared
    immediately when combat begins and restored after the animation sequence.
  - FF-style visual overhaul: Google Fonts (VT323 + Press Start 2P), dark
    navy/purple background with radial gradients and scanline texture, layered
    panel borders on all major UI sections, boss name plate, gold accent
    palette, HP bar shimmer highlights, combat log with gold ▶ prefix,
    Press Start 2P floating damage numbers. Action intent icon moved from a
    floating absolute position above the card to a bottom row inside the card.
- Added the "inclusive by default" design principle, visible gear on player
  sprites (Phase 6), Champions mode (Ideas Log), and boss scaling / power band /
  loot fairness to Open Questions, following the full-vision mockup review.
- Added the Progression & Balance section: ~1.5× power band, unlimited levels
  with a stat cap, single `playerPower()` formula, class-specific gear, visible
  gear slots, personal participation-weighted loot, %-based heals, stat-tracked
  titles/badges/milestone drops, and total-power boss scaling with
  average-power boss variants (Lesser / standard / Powerful).
- Trinkets can add a visible aura/effect instead of showing as equipment;
  players select which earned title to display.
- Added the Party, Participation & Stream Ops section (Cleric revive, queue fills
  for unrevived/fled slots, mid-fight joins with HP added per joiner, flee on
  inactivity, rogue-lite XP, reduced-strength MP fallback, Auto-play vs. Streamer
  Control modes, minimal chat posts). Moved loot crafting, randomized loot,
  support buffs, spectator crowd meter, channel points/bits, community goals,
  event bosses and sound effects into the Ideas Log.
- Switched player identity from display name to Twitch user ID (`tags["user-id"]`)
  across server/gameLoop/fight/overlay; display names travel separately as
  `player.name` / `playerNames`, and avatars are fetched by ID.
- Added offline test mode (`npm run offline`, `src/devChat.js`): no Twitch
  connection; fake chat via stdin or `POST /dev/chat`, state via `GET /dev/state`,
  localhost-only. Lets full fights be driven and verified without a live chat.
- **Phase 2 complete.** `!heal` is available to everyone and restores 20 HP
  (`PLAYER_HEAL_AMOUNT`). Targeting was pulled forward from Phase 4: `!heal`
  (lowest-HP living player, re-evaluated at resolution), `!heal self`,
  `!heal <slot#>`, `!heal <name>`. Players get join-order slot numbers shown on
  their cards; the healer's card shows the target (`💊 ↓` / `self` / `→2`) and the
  target's card shows a green ✚. Healers take full boss damage (no mitigation).
- **Phase 3 implemented (awaiting playtest).** Classes live in `CLASSES` in
  `gameConfig.js` (stats + allowed commands); all numbers are placeholders.
  - Tank 130 HP, no MP, `!attack` 10 / `!defend` / `!taunt` (taunter takes full
    AoE damage, everyone else takes 50%; doesn't stack; in Phase 4 it will also
    pull single-target hits). Mage 80 HP, 60 MP (+5/round), `!attack` 10 /
    `!defend` / `!fire` (15 MP, 25 dmg). Cleric 100 HP, 50 MP (+5/round),
    `!attack` 5 / `!defend` / `!heal [target]` (free, 25% of target's max HP) /
    `!revive [target]` (30 MP, returns at 25% max HP; no arg = first fallen by slot).
  - `!heal` is now Cleric-only. Commands outside a class's kit are ignored and
    the previous choice stays locked in.
  - Not enough MP → the skill falls back at 70%: `!fire` becomes a 7-damage hit;
    any `!revive` that can't happen (no MP, or nobody fallen) becomes an
    untargeted heal at 70% and spends no MP.
  - Fallback heal targets now pick the lowest HP *percentage*, not absolute HP.
  - `!join <class>` (repeat to switch while the lobby is open); plain or
    unrecognized `!join` auto-assigns the least-picked class.
  - Overlay: class badge and MP bar on cards, taunt/fire/revive icons and
    animations (red taunt aura, orange Fire numbers, "REVIVED" popup).
  - Next: "Phase 3.5" party management — roster cap + queue, mid-fight joins and
    fills (boss HP added per joiner), revive window, fleeing on inactivity.
- **Phase 3 playtested and confirmed working** (Twitch chat + `npm run dev`).
- Added `npm run screenshot` (`scripts/screenshot.js`, Playwright as a pinned dev
  dependency) to capture the overlay headlessly, including frame-by-frame capture
  of a scripted round on the offline server.
- Overlay polish found via screenshots: boss damage numbers now spawn beside the
  sprite (no longer drift into the nameplate); cards are flex columns with the
  action icon pinned to the bottom, so icons line up across Tank and caster cards;
  heal-target ✚ badge enlarged from 8px to 14px.
- Ran `npm audit fix` (lockfile-only, within existing semver ranges): cleared the
  critical/high advisories in express/socket.io dependencies (proxy-addr,
  body-parser, qs, engine.io, socket.io-parser) and brace-expansion. Remaining:
  a moderate minimatch advisory via nodemon (dev-only file watcher), whose fix
  requires a breaking nodemon change — deliberately left.
- **Decision: develop toward the mockups incrementally** rather than one big
  reskin later — each visual change lands in the mockup's layout so nothing gets
  built twice. Mockup elements tied to later phases (gear layering, boss
  variants/weakness chips, raid track, loot screen) wait for their phase.
- **Overlay reskinned to the mockup's Battle screen:**
  - Side-view battlefield: Frost Wyrm pixel sprite on the left (attacks lunge
    toward the party), party in a staggered FF-style formation on the right.
    Players appear as class pixel sprites (from `public/sprites.js`) with an
    action bubble above (icon + text + heal/revive target) and a defend/taunt
    aura behind; fallen players become tombstones.
  - Bottom row: combat log (newest lines pinned to the bottom; shows join help
    in the lobby and a class command sheet before round 1 resolves) and an
    FF-style party status window — slot, Twitch avatar portrait (class sprite
    fallback), name, class, HP/MP bars, current action.
  - Top bar adds an "N / M locked in" counter; VICTORY / DEFEAT banner on fight end.
  - Scales to 10 players: above 5, sprites shrink into 3-row columns and the
    status window switches to two compact columns.
  - Action bubbles now stay visible during the resolution animation (they show
    this round's pending choice, which is safe — only `lastAction` was stale).
- **Phase 3.5 (party management) implemented, awaiting playtest.** New
  `gameConfig.js` values: `MAX_ACTIVE_FIGHTERS` 10, `REVIVE_WINDOW_ROUNDS` 5,
  `FLEE_AFTER_MISSED_ROUNDS` 4, `TARGET_FIGHT_ROUNDS` 15, `MIN_JOIN_ROUNDS` 3,
  `RESULTS_MS_PER_EVENT` 750.
  - Roster cap + queue: `!join` beyond the cap, or any `!join` once a fight is
    running, waits in a queue (re-joining while queued changes class). Open slots
    fill from the queue between rounds, lowest free slot number first.
  - Fleeing: a living player who sends no command for 4 consecutive rounds flees
    and frees their slot. The overlay shows "IDLE?" one round before.
  - Revive window: a fallen player who isn't revived within 5 full rounds gives
    their slot to a queued player — only when someone is waiting. The overlay
    shows "KO · N LEFT" while that clock matters.
  - Boss HP: `fight.fundedSlots` tracks how many slots the boss's HP accounts
    for. Refilling a freed slot adds nothing (fight length stays steady); growing
    the party past its starting size adds class ATK × rounds remaining
    (`TARGET_FIGHT_ROUNDS` − rounds elapsed, min 3).
  - Queue carry-over: whoever is still queued when a fight ends is placed in the
    next lobby automatically (class kept), and the lobby countdown starts.
  - Roster changes are appended to the round's log ("X fled the battle!",
    "X joins the fight in slot N! The boss grows stronger (+120 HP)").
  - Overlay: PARTY n/10 · QUEUE strip on the battlefield (or a "!join to jump in"
    hint); 10-player layout tightened so the bottom row never grows.
  - The results pause now stretches with the round's event count so big
    rounds finish animating (≈ events × 750 ms + 1 s, min 4 s).
  - Not yet done: XP for active rounds only (needs Phase 5 persistence).
- **Boss HP now scales with the party** (replaces the fixed 1000 HP / `BOSS_MAX_HP`).
  Starting HP = Σ each player's class `expectedDamage` × `TARGET_FIGHT_ROUNDS`; mid-
  fight joiners add `expectedDamage` × rounds left. `expectedDamage` was *measured*
  by simulating fights through `resolveRound` with a "sensible chat" policy (defend
  through telegraphs, Mages Fire when they have MP, Clerics heal/revive first):
  Tank ≈ 8, Mage ≈ 16, Cleric ≈ 2 per round. Validation runs: every party from a
  solo Tank to a full 10 wins in 15–18 rounds with sensible play and 19–24 rounds
  when a quarter of turns are missed. Re-measure if class kits or boss moves change.
  The lobby shows the projected boss HP as players join.
  - Finding: no player was KO'd in any validation run — boss *damage* (8 / 20 / 15)
    doesn't scale yet, so fights have the right length but little danger. Scaling
    boss hit damage (decided: to the party's median effective HP) is the next lever.
- **Boss rework for challenge (2026-11-17)** — replaces the fixed six-move rotation
  (`bossRotation.js` → `bossMoves.js`):
  - Move set: Claw Swipe (light AoE, unannounced), Frost Breath (heavy single-target
    on an announced player — pulled forward from Phase 4), Power Attack windup →
    execute, Tail Counter, Blizzard (AoE that ignores defend and taunt cover).
  - Weighted-random selection from a pool per boss HP phase (>60% / 60–30% / <30%);
    big moves never repeat back-to-back and a windup always leads to the execute.
    Every move except Claw Swipe is announced while chat chooses (Breath names its
    target, shown as a red reticle on the overlay).
  - Below 30% HP the boss **enrages**: all damage ×1.25, ENRAGED badge on screen.
  - Taunt now redirects Frost Breath to the taunting Tank (and still halves
    blockable AoE for everyone else).
  - `!defend` also recovers 12% max HP for survivors (`DEFEND_RECOVERY_PERCENT`).
  - **Variants:** a party with no Cleric faces the **Lesser Frost Wyrm** (×0.7
    damage, same HP), fixed at fight start and previewed in the lobby — the first
    use of the planned Lesser/Standard/Powerful variants, chosen by composition
    until levels exist.
  - Tuned with a balance harness (300 simulated fights per party mix, "sensible"
    chat that reads every telegraph vs. "sloppy" chat that misses 15% of turns and
    ignores telegraphs 30% of the time). Final numbers (claw 12, breath 60, power
    30, counter 20, blizzard 20; expectedDamage Tank 6 / Mage 15 / Cleric 2):
    - Parties with a Cleric: 14.5–17 rounds; sensible ≈ 0.1–0.6 KOs/fight, ~0–1%
      wipes; sloppy ≈ 0.4–1.2 KOs, mostly revived, 0–6% wipes.
    - Healer-less (Lesser): sensible ≈ 0–0.25 KOs, 0–1% wipes; a solo Tank wins
      100% (sensible) / 90% (sloppy). Outlier: a solo Mage playing sloppily
      wipes ~50% — fragile alone, but "sloppy" overstates mistakes for one player.
  - The results pause counts all defend-recovery popups as one animation beat.
- **Risk/reward bonus:** attacking through a Tail Counter or into a Power Attack
  now deals ×1.5 damage (`BOLD_COUNTER_MULTIPLIER`, `BOLD_POWER_MULTIPLIER`). The
  boss's warning states the bonus ("defend, or strike for +50%"), daring hits pop
  as gold "-N!" numbers, and the log calls them out. Simulated with a "risky" chat
  (reads telegraphs but attacks through counters/power attacks) vs. careful chat:
  - ×1.0: risk never paid — barely faster, 4–6× the KOs, up to 52% wipes.
  - **×1.5 (chosen):** risky wins 20–28% faster (TMC 15.7 → 11.7 rounds) with
    2.5–7× the KOs and 0–19% wipes; careful play unchanged.
  - ×2.0: risky became the dominant strategy (33% faster, few extra KOs).
  - Phase 5 adds the reward layer: a shared team speed bonus and daring stats
    feeding titles (recorded under Phase 5).
- **Phase 4 complete.** Most of it landed early (targeted `!heal`/`!revive` by
  slot/name/self with fallbacks, single-target Frost Breath, taunt redirects). The
  last piece: fuzzy target names — a leading "@" is ignored, matching tries exact
  name, then a unique prefix, then a unique partial ("!heal pixel" → PixelPaladin);
  ambiguous ("mel" with Melody and MelonMan) or unknown names fall back to
  auto-targeting. `!heal me` works like `!heal self`. The "cursed player the healer
  must save" idea stays parked for a later boss mechanic.
- **Phase 5 split** into 5a (persistence + progression, levels cosmetic) and 5b
  (levels grant power within the 1.5× band, boss scales to party power, Powerful
  variant), so today's tuned balance stays stable while saving lands.
- **Phase 5a implemented, awaiting playtest.**
  - `src/progress.js`: SQLite through Node's built-in `node:sqlite` (Node ≥ 22.13;
    no native package). Tables: `players`, `class_profiles` (XP, level, battles,
    wins, rounds active, damage, healing, revives, KOs taken, daring hits),
    `boss_wins` (per boss + variant, for future titles), `fights`, `fight_players`.
    Schema version tracked in `PRAGMA user_version` for future migrations.
  - XP (rogue-lite): 10 per round a player actually acted; finishing a won fight
    adds 50 plus 10 per round under par (the shared speed bonus). Fled players
    keep XP for rounds they were active, with no win credit. Levels are unlimited;
    each level costs 25 more XP than the last (L2 = 100, L10 = 1,800,
    L50 ≈ 34,300 ≈ 170 fights).
  - Results screen after every fight (replaces the VICTORY/DEFEAT banner, shown
    for `ENDED_PAUSE_SECONDS` = 14): outcome + speed bonus, a per-player table
    (damage, healing, revives, KOs, daring hits, XP, level, LEVEL UP!), and
    recognition badges (Top Damage, Top Healer, Lifesaver, Daredevil).
  - Levels shown in the status window ("TANK LV 7"); the lobby alternates join
    help with a TOP HEROES leaderboard (best class profiles by level/XP).
  - The bot posts to chat: fight start, fight end (top damage on a win), and a
    combined level-up line.
  - `--offline` saves to `data/offline.db`, never the real profiles.
  - Fix found while testing: a lone Cleric's boss was sized at 30 HP (Clerics
    average 2 dmg/round in parties), letting a solo Cleric farm ~200 XP per
    one-minute fight. Added `MIN_BOSS_HP` = 60. A solo Cleric remains the weakest
    solo option (plain `!join` assigns a lone player Tank).
- Fix: an open overlay (OBS browser source) kept running stale page code after
  server restarts — its socket silently reconnects — so new features (e.g. the
  results screen) didn't appear until a manual refresh. The server now sends an
  `overlayVersion` that changes on every restart and on any `public/` file change,
  and the overlay reloads itself when it changes; overlay files are served with
  `Cache-Control: no-cache` so reloads always fetch fresh code.
- **Phase 5b implemented, awaiting playtest.**
  - `src/power.js`: `playerPower(level)` = 1 + up to 30% on an ease-out curve
    (L10 ≈ +10%, L15 ≈ +15%, L25 ≈ +22%, L50+ = +30%; `STAT_LEVEL_CAP` 50,
    `LEVEL_POWER_BONUS_MAX` 0.30). Power multiplies a player's max HP, damage and
    healing (MP unchanged), and comes from their saved level in that class.
  - Boss HP = Σ class `expectedDamage` × power × 15 rounds (joiners likewise).
    Each boss hit is scaled by the power of the player it hits (user chose "scale
    HP and hits"; per-target rather than party-median after simulation showed a
    level-1 Mage with two level-50s wiping 37% under median scaling vs ~4% now).
  - Variants: no Cleric → Lesser at any level (a veteran healer-less party on
    Standard wiped 9% even playing well); otherwise average power ≥ 1.14 →
    Powerful, else Standard. Powerful = two-target Frost Breath (one taunt covers
    one target; warning shows "slots 2 & 3" plus a reticle on each) and enrage at
    50% HP. Its damage multiplier was simulated at ×1.2 / ×1.1 / ×1.0 / ×0.9 and
    set to ×1.0: higher made sensible veteran parties wipe 8–26%.
  - Simulated (`scripts/balance-sim.js`, 300 fights per row): level-1 parties are
    unchanged; a uniformly leveled party on Standard plays the same as level 1;
    Powerful parties with a Cleric see ~0.5–1.1 KOs and 1–5% wipes playing well
    (vs ~0.3 and 0% on Standard) and ~1–1.8 KOs / 0–27% wipes playing sloppily;
    mixed veteran + newbie parties stay fair.
  - Lobby predicts the variant and HP from saved levels; status window shows
    scaled max HP.
  - The balance harness now lives in the repo (`scripts/balance-sim.js`) instead
    of a scratch file, with `--set` overrides for trying config values.
- **Phase 5b playtested.** Noted for Phase 9: the results screen shows XP gained,
  not XP-to-next-level; full XP progress belongs in the companion app.
- **Phase 6 implemented, awaiting playtest.** Decisions (2026-11-17): auto-equip
  upgrades until the companion app exists; a *chance* per win rather than a
  guaranteed drop; stats split by slot.
  - `src/loot.js` rolls drops; `progress.js` adds an `items` table (schema v2;
    upgrades v1 databases in place) and auto-equips inside the fight-save
    transaction: a drop that strictly beats the equipped item in its slot replaces
    it, anything else goes to inventory (all items are kept for the companion app).
  - Eligibility: a won fight, still in the party at the end, and acted in ≥ 50%
    of the rounds they were alive for. Then a 40% drop chance.
  - Rarity (before luck): epic 3%, rare 12%, uncommon 30%, common the rest. Luck
    multiplies the non-common chances: up to ×1.25 for full participation and
    ×1.5 against the Powerful boss (the plan's "quality weighted by
    participation"). At full participation on the standard boss a drop is ≈ 44%
    common / 38% uncommon / 15% rare / 4% epic.
  - Slots (class-specific items; stat = slot max × rarity factor 25/50/75/100%):
    weapon +10% power; off-hand / head / body 4% / 3% / 5% defense; trinket 3%
    of either. A full epic set ≈ +13% power and 15% defense. Defense cuts every
    boss hit and isn't scaled away by per-player hit scaling.
  - Names like "Runed Staff", "Wyrmslayer's Plate" (rarity word + class/slot base).
  - Sprites: slot-tagged parts recolor by rarity (green / blue / purple); rare and
    epic add flourishes (Tank horns + pauldrons, Mage hat star + sash, Cleric gold
    circlet + pauldrons); a trinket adds a colored glow. Shown on the battlefield,
    status window and results screen.
  - Results screen LOOT column: rarity-colored item, stat, EQUIPPED tag.
  - Simulated: a full-epic veteran party vs. Powerful ≈ 0.16 KOs sensible /
    0.82 KOs, 8% wipes sloppy (ungeared veterans: 0.52 / 1.66, 26%) — about what
    new players see on the standard boss. Gear is the reward that lowers danger.
  - Not yet: duplicate handling (crafting/salvage stays in the Ideas Log), manual
    equipping and inventory browsing (Phase 9), per-item art.
- **Mockup review + visual pass (before Phase 7).** Battle screen already matched
  the mockup (only biome backdrops and elemental weakness chips remain — both wait
  for those mechanics). Rebuilt the other two screens on the mockup so Phase 7's
  raid lobby and between-battle screens extend them rather than replace them:
  - **Lobby screen** (replaces the battle layout during the lobby): three class
    cards generated from the real class config (sprite, role, `!join <class>`,
    HP / DMG / MP pips relative to the best class — DMG uses measured
    `expectedDamage` — signature commands, who's joined); a NEXT FIGHT panel
    with the projected boss, a Lesser / Standard / Powerful meter, projected HP and
    a hint; TOP HEROES leaderboard; a roster grid with every slot (gear-drawn
    sprites, class + level, OPEN seats) and the queue; a mode chip (renamed from
    ONE-OFF BATTLE to SKIRMISH after playtest; reads RAID in Phase 7).
  - **Results screen** (full screen during "ended"): VICTORY/DEFEAT banner with
    the speed bonus; a LOOT DROPS panel with pixel item icons per slot (weapons
    and off-hands per class) framed in rarity color, recipient, EQUIPPED / to
    inventory; the stats table and badges; a level-up strip; a live NEXT LOBBY
    countdown (the server now broadcasts every second during "ended").
  - The combat log no longer carries lobby help or the leaderboard.
- Fixed a Phase 1 bug: a boss reduced to 0 HP still took its turn, so the
  killing round could wipe the party it lost to. A dead boss now just
  "collapses".
- **Phase 7 — Raids (implemented, awaiting playtest).**
  - **Starting one:** a mod's `!raid` turns the open lobby into a raid lobby (60s,
    counts down even while empty), or, mid-skirmish, queues a raid for the next
    lobby. `!raidvote` works in a skirmish lobby only while a mod has run
    `!enableraidvote` (off by default; `!disableraidvote` turns it back off);
    it needs at least 2 unique voters and half the lobby. `!endraid` (mod)
    cancels a queued raid, reverts a raid lobby to a skirmish lobby, or ends a
    running raid and opens the chests banked so far. A raid lobby nobody joins
    lapses back to skirmishes.
  - **Flow:** five battles against the same Frost Wyrm (variant still picked
    from the party), each stage scaling boss HP / hit damage: ×0.8/0.85,
    ×1.0/1.0, ×1.1/1.05, ×1.2/1.15, ×1.3/1.25. The party is fully restored
    between battles; a 30s intermission screen (`!startbattle` skips it) then
    the next battle starts. Classes lock; there are no mid-raid fills or swaps,
    and `!join` during a raid queues for the lobby after it. A raider who flees
    is out of the raid. Each battle is still recorded as its own fight (XP,
    stats, history), so levels can rise mid-raid.
  - **Rewards:** raid battles skip the per-win drop roll. Each cleared battle
    banks a chest, plus one bonus chest for a full clear (max 6). When the raid
    ends, every raider still in the party who took part in ≥ 50% of their rounds
    opens all of them: one guaranteed item per chest, chest n with luck
    1 + 0.2 × (n − 1), auto-equipped if it's an upgrade.
  - **Balance** (`node scripts/balance-sim.js --raid`): new Tank/Mage/Cleric
    party 76% full clear playing well / 33% sloppily; ungeared veterans (who face
    the Powerful Wyrm) ~35–45%; rare-geared veterans ~64%; epic-geared ~83%.
    Stage 5 is the wall. An earlier, steeper curve gave ungeared veterans only
    17–25%.
  - **Overlay:** the mode chip reads SKIRMISH / RAID in the lobby and RAID n/5
    through a raid. The raid lobby swaps TOP HEROES for a raid panel (battle
    track, rules) and previews battle 1's HP; a skirmish lobby shows
    "RAID VOTE · !raidvote x / y" while voting is on. The intermission screen
    reuses the results layout with a RAID PROGRESS panel (battle track with each
    stage's multipliers, the next battle's HP and hit scale, chests banked) and a
    NEXT BATTLE countdown. The raid summary (RAID CLEARED! / RAID OVER /
    RAID ENDED) shows each raider's opened items (equipped ones ticked), raid
    totals with badges, and level-ups. New pixel chest sprite in sprites.js.
- **Stream controls (implemented, awaiting playtest).** Asked for during raid
  playtesting:
  - `!leave` / `!flee` (anyone): leaves the queue, the lobby (also withdrawing a
    raid vote), the fight or the raid. A fight leave frees the slot for the queue
    and is noted at the top of the next round's log. XP for rounds already fought
    is kept (saved with the fight, not finished, so no win bonus or loot); a
    raider who leaves forfeits the raid's chests, which stay the reward for
    sticking it out. If everyone leaves, the battle is called off.
  - `!kick <name|slot>` (mods): the same removal, plus the viewer can't `!join`
    again until the next lobby opens. Names match like `!heal` targets (exact,
    unique prefix, unique partial; `@` optional); a number is the lobby position
    or fight slot.
  - `!pause` / `!resume` (mods): freezes every countdown (lobby, input round,
    intermission, results). Actions can still be locked in. The overlay timer
    reads PAUSED.
  - `!endbattle` (mods): calls off the skirmish in progress. It's recorded with
    outcome `"ended"`: XP for every round fought, no win bonus, no loot drop
    roll. The results screen reads BATTLE ENDED. In a raid it's `!endraid`, and
    a raid battle cut short is now also recorded as `"ended"` rather than a loss.
  - `!skip` (mods): a general "move on now". The lobby starts the battle, an
    input round resolves immediately, and the intermission or results screen
    advances. `!skip`, `!startbattle` and `!endbattle` all lift a pause.
  - Fixed: any broadcast during a results or intermission screen (a `!join` to
    the queue, an avatar arriving) dropped the screen's data and blanked the
    overlay back to the battlefield. The timed screen's data now persists until
    it ends.
  - README section 8 rewritten as the player / mod command reference (it still
    described Phase 1).
- **Manual start, closing and last call (implemented, awaiting playtest).**
  - `!manualmode` / `!automode` (mods): the plan's long-standing *Streamer
    Control* fight mode. In manual mode no lobby counts down, skirmish or raid;
    the overlay timer reads STANDBY and the lobby text says the streamer starts
    the battle (`!startbattle` / `!skip`). Raid intermissions still auto-advance
    (decided for Phase 7). Switching to auto in an open lobby starts a fresh
    countdown.
  - New `"closed"` phase: no lobby, no timers, `!join` ignored. The overlay shows
    a sleeping-wyrm "THE WYRM SLEEPS" card with the TOP HEROES leaderboard.
  - `!closegame` (mods): blocks new joins and clears the queue (and any raid
    called with `!raid`). An open lobby closes at once; a fight, raid or results
    screen in progress plays out, then the game closes instead of opening a lobby.
  - `!closequeue` (mods): last call. New joins are refused (queued viewers can
    still switch class, and anyone can `!leave`), but everyone already in the
    lobby or queue plays: mid-fight fills keep draining the queue, and any
    leftovers get one more lobby. When a lobby would open with nobody waiting,
    the game closes. An emptied last-call lobby closes too. `!raidvote` is off
    during last call. The overlay shows a red LAST CALL chip, "last call · joins
    closed" on the party strip, and CLOSED on empty lobby seats.
  - `!opengame` (mods): from closed, opens a fresh lobby; during last call or a
    pending close, re-opens joins and the game carries on. `!raid` while closed
    makes the reopened lobby a raid lobby.
  - Config defaults: `MANUAL_START_DEFAULT` (false) and `GAME_OPEN_ON_START`
    (true; false makes the server boot closed so nothing runs before the stream
    goes live). Runtime toggles reset to these on restart.
  - Lobby phase text now comes from the overlay (it covers raid / manual / last
    call), not a server message that vanished after the first broadcast.
- **Phase 7 and the stream controls playtested** (2026-11-17).
- **Phase 8 — Boss variety and raid tiers (implemented, awaiting playtest).**
  - **Move kinds:** the move ids became generic kinds that every boss draws on
    under its own names: swipe (claw), strike (breath), windup/power, counter,
    storm (blizzard). Three new signature kinds: eruption, curse and chain.
    Boss numbers live in `BOSSES` in `gameConfig.js` (damage per kind, move
    weights per HP phase, `damageTaken`, `hpMultiplier` for pace).
    Presentation is in the new `src/bosses.js`. Variants are generic: Powerful
    gives strike and chain one extra target and enrages at 50%.
  - **Frost Wyrm** (ice, weak to fire ×1.25; biome: ice): unchanged numbers.
  - **Ember Golem** (fire, resists fire ×0.6; volcano): Eruption hits everyone,
    and anyone who didn't defend Burns for 3 rounds (8/round). A Cleric's heal
    douses it. Stone Fist, Magma Slam, Meteor Crush, Obsidian Spikes.
  - **Shadow Lich** (shadow, weak to holy ×2, i.e. Cleric attacks; crypt):
    Hex of Decay drains one player for 3 rounds (12/round) unless a Cleric
    heals them. It never re-hexes a hexed player and stays single-target on
    Powerful. The Lesser Lich never casts it: with no Cleric there's no answer,
    and a solo Mage wiped 54% even playing well. Shadow Bolt, Soul Spear, Bone
    Ward, Death Wail (its unblockable storm).
  - **Storm Roc** (storm, weak to physical ×1.2; sky): Chain Lightning arcs
    through a run of adjacent slots (35% of the living party, at least 2; +1 on
    Powerful). Only defend softens it; taunt can't draw it. A flat 3-target chain
    made every 3-player round an "everyone defend" round and stretched fights to
    18–20 rounds. Talon Rake, Dive Bomb, Thunderclap, Static Field.
  - **Elements:** `!attack` is physical (holy for a Cleric) and `!fire` is
    fire. Boss HP is sized with each class's main damage type, so weaknesses
    change who shines rather than fight length. The overlay shows WEAK/RESISTS
    chips, and weakness hits pop pale gold with ▲ (resisted: grey ▼).
  - **Statuses:** Burn and Hex tick after players act and before the boss's
    move, so a Cleric's heal that round stops the tick. Untargeted heals now
    prefer burning or hexed players. Falling clears both.
  - **Balance:** every boss lands in the Wyrm's danger band. Sensible / sloppy
    KOs per fight for a new Tank/Mage/Cleric party: Wyrm 0.31/0.78, Golem
    0.24/0.68, Lich 0.14/0.56, Roc 0.27/0.87; wipes ≤ 3%. Veterans vs Powerful
    (TMC @15, sensible): Wyrm 4%, Golem 0%, Lich 7%, Roc 0% wipes. Fights run
    about 14–19 rounds.
  - **Skirmishes:** a random boss each lobby (never the last one fought),
    shown in the lobby with its sprite, chips and signature hint. `!boss
    <name>` (mods) picks it, now in a skirmish lobby or for the next one
    otherwise; `!boss random` clears it.
  - **Raids:** the lineup is drawn when the raid lobby opens (every boss once in
    shuffled order, then a final rematch against any boss but battle 4's) and
    shown on the raid track as boss sprites. Tier is fixed at the start from
    average power: Normal (any party without a Cleric, or below 1.14), Heroic
    (≥ 1.14, the Powerful threshold; chest luck ×1.25), Mythic (≥ 1.30, e.g.
    L50 or L30 + rare gear; chest luck ×1.5, boss damage ×1.1). Simulated full
    clears (`--raid`, averaged over bosses): new TMC 92% sensible / 36%
    sloppy; Heroic ungeared veterans 51–59%; Mythic L50 ungeared 38%; rare-
    geared Heroic 76%; epic Mythic 72–77%.
  - **Overlay:** boss sprites moved from the HTML into `sprites.js` (three new
    placeholder bosses); per-biome battlefield backdrops; element chips by the
    boss name and in the lobby; Burn/Hex badges with rounds left on sprites
    and in the status window; purple Hex and yellow chain reticles; chain hits
    animate slot by slot; CURED pops on a cleansing heal; tier chips on the
    raid panel, intermission and summary.
  - **Sim:** `balance-sim.js` takes `--boss <id|all>` and `--exact`, plays the
    new mechanics sensibly (defend through eruptions and marked chains, heal
    the afflicted first, defend while afflicted with no Cleric up), and raid
    mode averages over bosses with the party's tier damage.
