# CLAUDE.md

Context for Claude Code when working in this repository. Read this first before
making changes.

## What this project is

A collaborative, round-based PvE boss-fight game for Twitch chat, presented as a
Final-Fantasy-style battle screen. Viewers type chat commands (`!join`, `!attack`,
`!defend`); the server resolves everyone's most recent command once per round and
pushes updated game state to a browser overlay (captured in OBS).

**Full design roadmap, phase-by-phase plan, and the "ideas log" of parked
future features all live in `twitch-boss-fight-plan.md` in the project folder
— read that before starting work on a new phase or feature, since it documents
design decisions and the reasoning behind them. The plan is deliberately kept
out of git (it's in `.gitignore`): keep updating it locally, and don't link to it
from published files like the README.**

## Current status

Phases 1–4 are complete (core loop, heal, classes, party management, targeted
commands), plus a boss rework (weighted-random announced moves, enrage, Lesser
variant, risk/reward bonus) and an overlay reskinned to the mockup's Battle
layout. **Phase 5a** (persistence: XP, levels, stats, results screen,
leaderboard) and **5b** (levels grant power, boss scales to party power,
Powerful variant), **Phase 6** (gear drops: chance-per-win personal loot,
auto-equip upgrades, weapons = power / armor = defense, gear drawn on
sprites), **Phase 7** (raids: five escalating battles with intermissions, locked
classes, chests banked per win and opened at the end) and the stream controls
(`!leave` / `!flee` for players; `!pause`, `!resume`, `!skip`, `!endbattle`,
`!kick`, `!manualmode` / `!automode`, `!closequeue` / `!closegame` /
`!opengame` for mods) are playtested. **Phase 8** (four bosses — Frost Wyrm,
Ember Golem, Shadow Lich, Storm Roc — each with a signature move, an elemental
weakness/resistance and its own biome; random skirmish boss with a mod's
`!boss` override; mixed-boss raids with Normal/Heroic/Mythic tiers) is
implemented and awaiting playtest. The full chat command reference is in
README.md ("Chat commands"); README screenshots live in docs/images/.
Manual equipping waits for the Phase 9 companion app. See `twitch-boss-fight-plan.md` for the full phase list, plus the
"Progression & Balance" and "Party, Participation & Stream Ops" sections for
decided design rules. Do not start work on later phases (classes, targeted
commands, persistence, gear, raids, the web companion app) unless explicitly
asked — the project is being built in a deliberate crawl/walk/run order and
each phase is meant to be validated before the next is layered on.

## Architecture

```
src/
  gameConfig.js    - ALL tunable numbers (damage, HP, timer lengths) live here.
                     Prefer changing a value here over hardcoding elsewhere.
  bosses.js        - the bosses' presentation: names, per-boss move names,
                     element, biome, lobby hint, and name lookup for !boss.
                     Their numbers (damage per move kind, move weights by HP
                     phase, damage taken by type, pace) are BOSSES in gameConfig.js.
  bossMoves.js     - move selection: weighted-random picks of move *kinds*
                     (swipe, strike, windup/power, counter, storm, eruption,
                     curse, chain) from the boss's pool for its HP phase,
                     announced to chat before players commit, plus the warning
                     and headline text.
  fight.js         - createFight() + resolveRound(), the core game logic.
                     This is intentionally decoupled from Express/Socket.IO/
                     tmi.js — it's plain functions operating on a fight state
                     object, so it can be tested/reasoned about in isolation.
  gameLoop.js      - orchestrates phases (lobby -> input -> resolving ->
                     results -> repeat/ended; raids add "intermission" between
                     battles; "closed" when no game is running), skirmish vs.
                     raid mode, stream controls, timers, and broadcasts state
                     to connected overlay clients via Socket.IO. Tallies each
                     fight's per-player stats and hands them to progress.js.
  power.js         - playerPower(level, gearPower): the one multiplier that turns
                     progression into strength (max HP, damage, healing) and
                     sizes the boss.
  loot.js          - gear drops (Phase 6): rolling items (rarity, slot, name,
                     stat) and totaling an equipped set into power/defense plus
                     a per-slot "look" the overlay draws. Pure functions; the
                     items table and auto-equip live in progress.js.
  progress.js      - persistence (Phase 5a): SQLite via Node's built-in
                     node:sqlite (needs Node >= 22.13). Per-user, per-class
                     profiles (XP, level, lifetime stats), fight history, and
                     per-boss/variant win counters, plus the XP/level math.
                     Like fight.js, no Twitch/Socket.IO dependencies. The DB
                     lives in data/ (gitignored); --offline uses a separate
                     data/offline.db so fake chatters never touch real profiles.
  server.js        - wires everything together: Express static server for the
                     overlay, Socket.IO, and the tmi.js Twitch chat listener.
                     Also owns the OAuth refresh-token flow (see twitchAuth.js).
  twitchAuth.js    - exchanges a refresh token for a fresh access token against
                     a registered Twitch application (Client ID/Secret).

scripts/
  get-twitch-token.js - ONE-TIME setup script. Do not fold this into the main
                        server; it's a standalone OAuth authorization-code flow
                        used once to obtain the initial refresh token.
  balance-sim.js      - plays hundreds of fights through resolveRound() with
                        scripted chat styles (sensible/sloppy/risky) and reports
                        length, KOs, revives, wipe rate per party (members can
                        have levels, "tank@30"). `--set KEY=JSON` tries a config
                        value without editing gameConfig.js.
  screenshot.js       - headless overlay screenshots (see Running the project).

public/
  overlay.html/css/js - the OBS browser-source overlay. Plain HTML/CSS/JS, no
                        build step. Renders whatever state the server pushes
                        over Socket.IO ("state" events). Three screens follow
                        the full-vision mockup: Battle (side-view battlefield,
                        combat log, FF-style party status window), Lobby (class
                        cards, boss preview + variant meter, leaderboard, roster)
                        and Victory/results (loot drops, stats, badges, level-ups,
                        next-lobby countdown), which also serves as the raid
                        intermission and raid summary; renderScreens() switches them.
  sprites.js          - placeholder pixel art as SVG rect lists (class sprites,
                        tombstone, action icons). Parts are tagged with gear
                        slots so equipped rarity recolors them; rare/epic add
                        flourishes, trinkets add a glow. Real art comes later —
                        don't add asset-loading complexity yet.
```

## Key design principles (don't undo these without discussion)

- **Round-based resolution is the core anti-spam mechanic.** Each unique user's
  *last* command before the round locks is what counts — spamming the same
  command does nothing extra. Any change to input handling must preserve this.
- **Individual player HP, not a shared team pool.** A player's own choices and
  survival matter to them personally; dead players contribute nothing to that
  round's damage output.
- **Boss moves are weighted-random but always announced.** The move for a round
  is chosen when the input phase opens and shown to chat (with the targets of a
  strike, Hex or Chain Lightning) before anyone commits — unpredictable, never
  unfair. Unannounced moves (swipes) must stay light. Randomness was an explicit
  ask (2026-11-17).
- **`!defend` mitigates incoming boss damage by 90%** (`DEFEND_MITIGATION`) and
  lets a surviving defender recover 12% max HP (`DEFEND_RECOVERY_PERCENT`), which
  is what keeps healer-less parties viable. Exceptions: Counter only punishes
  attackers (a clean avoid/don't choice); storm moves (Blizzard, Death Wail)
  ignore defend and taunt cover — only healing answers them; Burn and Hex ticks
  ignore defend and are lifted by a Cleric's heal; Chain Lightning ignores taunt.
- **Every boss sits in the same danger band.** New bosses are tuned with
  `balance-sim.js --boss <id>` until KOs, wipes and fight length match the Frost
  Wyrm's for the same parties. A weakness changes who shines, not fight length
  (boss HP accounts for it). A signature move that only a Cleric can answer is
  left out of the Lesser variant (no-Cleric parties).
- **Balance is measured, not guessed.** Boss damage, class `expectedDamage`,
  variants and level power were tuned with `node scripts/balance-sim.js`; re-run
  it after changing class kits, boss moves, damage numbers or power scaling
  rather than eyeballing them.
- **Levels never change relative danger.** Boss HP scales with party power and
  each boss hit scales with the power of the player it lands on, so a newcomer
  in a veteran party takes newcomer-sized hits; veterans carry through bigger
  damage and healing. The Powerful variant (high average level) is where
  veterans find extra challenge. Gear's **defense** is the exception that does
  reduce relative danger — it's the reward for grinding loot, so keep defense a
  separate stat rather than folding it into power.
- **Missing/no input defaults to "defend"**, not "attack" — a deliberate safer
  default for players who don't respond in time.
- Damage/HP/timer numbers are placeholders meant to be tuned via
  `gameConfig.js` — don't scatter magic numbers into other files.

## Running the project

```bash
npm install                 # first time only
cp .env.example .env        # then fill in TWITCH_CLIENT_ID/SECRET, bot username, channel
npm run get-token           # one-time OAuth setup to obtain TWITCH_REFRESH_TOKEN
npm start                   # runs the server + connects to Twitch chat
npm run offline             # no Twitch: fake chat from stdin or POST /dev/chat
```

**Offline mode** (`--offline`) skips Twitch and binds to 127.0.0.1. Send fake chat
by typing `<name> <message>` into the server's terminal, or with
`curl -X POST localhost:3000/dev/chat -H 'Content-Type: application/json' -d '{"user":"JonEFive","message":"!join"}'`.
`GET /dev/state` returns the latest broadcast state. Fake users get IDs like
`dev-jonefive` and count as mods (so `!startbattle` works). Use a different
`PORT` if the real server is already running on 3000.

**Screenshots** (`npm run screenshot`, needs a one-time
`npx playwright install chromium`): captures the overlay at 1280x720 into
`screenshots/` (gitignored) for checking visual changes. `--frames N --interval MS`
captures a burst; `--base http://localhost:3999 --round "JonEFive !taunt" "Melody !fire"`
(offline server only) waits for an input phase, sends the commands, and captures
the resolution animation frame by frame. Prefer this over guessing when changing
`public/`.

Overlay is served at `http://localhost:3000/overlay.html` (add as an OBS Browser
Source, 1280x720, transparent background). Test in a regular browser tab first
before wiring up OBS — much faster to iterate on.

## Conventions

- Plain Node.js (CommonJS `require`/`module.exports`), no TypeScript, no build
  step, no framework beyond Express + Socket.IO + tmi.js. Keep it that way
  unless asked to change it — this project deliberately favors simplicity.
- Tests live in `test/` and run with `npm test` (Node's built-in `node:test`, no
  extra dependencies). They drive the real game loop with mocked timers
  (`mock.timers.enable(...)`) and an in-memory store
  (`openProgressStore(":memory:")`), so the whole suite takes about a second.
  Each `check(label, ok)` registers its own test. Run `npm test` after any change
  and add checks for new behavior. For quick experiments, an inline
  `node -e "..."` simulation is still fine.
- No linter/formatter configured yet — match the existing style (2-space
  indent, semicolons, double quotes) if adding new files.
- Never commit `.env` — it holds real Twitch credentials. `.env.example` is the
  template that's safe to commit.

## When implementing a new phase

1. Re-read the relevant phase section in `twitch-boss-fight-plan.md` first.
2. Prefer additive changes over rewrites — later phases are designed to layer
   on top of earlier ones without needing to redo prior work.
3. After implementing, update `twitch-boss-fight-plan.md`'s Change Log section
   with a brief note of what was done, so the plan doc stays an accurate
   record of the project's actual state.
