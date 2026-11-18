# Twitch Chat Boss Fight — Phase 1

A collaborative, round-based PvE boss fight for Twitch chat. Viewers type `!join`,
then `!attack` or `!defend` each round; the game resolves everyone's last command
together and updates a live overlay you capture in OBS.

This is the **Phase 1** build: no classes, no persistence, no gear — just the core
loop, so you can validate it's fun to watch before anything else gets added.

---

## What's included

```
twitch-boss-fight/
├── package.json
├── .env.example
├── src/
│   ├── gameConfig.js     - all tunable numbers (damage, timers, HP) in one place
│   ├── bossRotation.js   - the scripted boss move rotation
│   ├── fight.js          - core resolveRound() logic
│   ├── gameLoop.js        - phase/timer orchestration, broadcasts state to overlay
│   └── server.js          - ties it together: web server + Twitch chat listener
└── public/
    ├── overlay.html
    ├── overlay.css
    └── overlay.js          - renders the state pushed from the server
```

---

## 1. Prerequisites

- **Node.js** version 18 or later. Check with `node --version`; if you don't have
  it, install from https://nodejs.org.
- A **Twitch account to use as the bot**. This can be your own streaming account,
  or (recommended, so bot messages don't look like they're from you) a second,
  free Twitch account created just for this purpose.

## 2. Install dependencies

Open a terminal in the `twitch-boss-fight` folder and run:

```bash
npm install
```

This downloads `express`, `socket.io`, `tmi.js`, and `dotenv` into a `node_modules`
folder.

## 3. Register a Twitch application and get your Client ID/Secret

1. Go to https://dev.twitch.tv/console and log in with your main Twitch account
   (this is your *developer* account — separate from whichever account the bot
   logs in as).
2. Click **Register Your Application**.
3. Fill in:
   - **Name** — anything unique (e.g. "YourChannel Boss Fight")
   - **OAuth Redirect URLs** — add exactly `http://localhost:3001/oauth/callback`
     (this is used only for the one-time setup script below; you'll add your real
     production URL here later when Phase 8's web app exists)
   - **Category** — "Chat Bot" or "Application Integration" both work
4. Save it. You'll see a **Client ID** immediately, and can generate a
   **Client Secret** on the same page — treat the secret like a password.

## 4. Configure your environment

Copy the example env file:

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — from step 3
- `TWITCH_BOT_USERNAME` — the bot account's Twitch username
- `TWITCH_CHANNEL` — your channel name, lowercase, no `#`
- `TWITCH_REDIRECT_URI` — leave as the default unless you changed it in step 3
- `PORT` — leave as `3000` unless that port is already in use
- Leave `TWITCH_REFRESH_TOKEN` blank for now — the next step fills it in

## 5. Get your bot's refresh token (one-time)

```bash
npm run get-token
```

This starts a tiny local script and prints an authorization URL. Before opening
it:

1. In your browser, **log in to Twitch as your bot account** (not your streamer
   account) — whichever account is logged in when you click Authorize is the
   account the bot will act as.
2. Open the printed URL and click **Authorize**.
3. The terminal will print a line like:
   ```
   TWITCH_REFRESH_TOKEN=abcd1234...
   ```
   Copy that whole line into your `.env` file.

You only need to do this once. From here on, the server refreshes its own
access token automatically in the background — no more manually regenerating
tokens every couple months.

## 6. Run the server

```bash
npm start
```

You should see something like:

```
Overlay server running at http://localhost:3000/overlay.html
Connected to Twitch chat (irc-ws.chat.twitch.tv:443), channel: your_channel_name
```

If you see a connection error instead, double-check your `.env` values — the most
common issues are a stale/expired token or a typo in the channel name.

## 7. Add the overlay to OBS

1. In OBS, add a new **Browser Source**.
2. Set the URL to: `http://localhost:3000/overlay.html`
3. Set width/height to **1280 x 720** (matches the overlay's layout).
4. Leave "Shutdown source when not visible" **unchecked** so the game state
   doesn't reset when you switch scenes.
5. The background is transparent, so it will sit cleanly over your existing
   scene/webcam layout.

## 8. Playing a fight

The overlay opens in the **lobby**: viewers `!join` and the battle starts when
the lobby countdown runs out (20 seconds after the first join; see
`LOBBY_JOIN_SECONDS`). Each round, chat has `INPUT_WINDOW_SECONDS` to choose an
action. Only your **last** command before the round locks counts, and anyone
who doesn't choose defends.

### Player commands

| Command | What it does |
| --- | --- |
| `!join [tank\|mage\|cleric]` | Join the lobby (or the queue, if a fight is on or the party is full). Plain `!join` picks the class the party needs; joining again in the lobby switches class. |
| `!leave` (or `!flee`) | Drop out of the lobby or queue, or flee the fight in progress. XP for rounds already fought is kept; a raider who leaves forfeits the raid's chests. |
| `!attack`, `!defend` | Everyone. |
| `!taunt` | Tank: take the Frost Breath and shield the party. |
| `!fire` | Mage: big damage, costs MP. |
| `!heal [slot / name / self]`, `!revive [slot / name]` | Cleric. No target = auto-pick. |
| `!raidvote` | Vote to make this lobby a raid (only while a mod has voting on). |

### Mod / broadcaster commands

| Command | What it does |
| --- | --- |
| `!startbattle` | Start the battle now (lobby), or the next raid battle (intermission). |
| `!skip` | Move on now: start the battle, resolve the current round, or leave the results / intermission screen. Also lifts a pause. |
| `!pause` / `!resume` | Freeze / unfreeze whatever countdown is running (lobby, round, intermission, results). Players can still lock in actions while paused. |
| `!endbattle` | Call off the fight in progress (or the raid). Everyone keeps the XP for rounds fought; a raid opens the chests banked so far. No loot for a called-off skirmish. |
| `!boss <name>` / `!boss random` | Choose the next skirmish's boss (`wyrm`, `golem`, `lich`, `roc`): right away in a skirmish lobby, otherwise for the next one. Raids use their own lineup. |
| `!kick <name or slot>` | Remove someone from the lobby, queue, fight or raid. They can `!join` again from the next lobby. |
| `!raid` | Turn the open lobby into a raid lobby, or queue a raid for after the current fight. |
| `!endraid` | Cancel a queued raid, turn a raid lobby back into a skirmish lobby, or end a running raid. |
| `!enableraidvote` / `!disableraidvote` | Let chat start raids with `!raidvote` (off by default). |
| `!manualmode` / `!automode` | Manual: lobbies don't count down; the overlay shows STANDBY until a mod types `!startbattle` (or `!skip`). Auto (default): lobbies start on their own. |
| `!closequeue` | Last call: no new joins, but everyone already in the lobby or queue still gets to play. Once the queue is empty and the last battle ends, the game closes. |
| `!closegame` | Close now: no new joins and the queue is cleared. An open lobby closes immediately; a fight or raid in progress plays out first (`!endbattle` to stop it now). |
| `!opengame` | Reopen: starts a fresh lobby when closed, or cancels a last call / pending close. |

While the game is closed the overlay shows a "The Wyrm Sleeps" card with the
leaderboard, and `!join` is ignored. To have the server start closed (so nothing
runs before you go live), set `GAME_OPEN_ON_START: false` in `gameConfig.js`;
`MANUAL_START_DEFAULT: true` likewise starts in manual mode. The `!manualmode`
and open/closed settings reset to these defaults when the server restarts.

## 9. Tuning the numbers

Everything balance-related lives in `src/gameConfig.js` — damage values, HP
totals, defend mitigation percentage, and timer lengths. Change a number, restart
the server (`Ctrl+C` then `npm start` again), and the new values take effect
immediately. No other files need to change for basic balance tweaks.

## 10. What's deliberately NOT in Phase 1

Per the project plan, these are coming in later phases and are intentionally left
out for now: classes, targeted commands (e.g. `!heal player2`), persistence
across streams, gear, raids (multi-battle sequences), and the web companion app.
See `twitch-boss-fight-plan.md` (the planning doc) for the full roadmap.

## Troubleshooting

- **"Failed to connect to Twitch chat" / token refresh errors** — double check
  `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REFRESH_TOKEN` in
  `.env`. If the refresh token was ever revoked (e.g. you removed the app's
  access from your Twitch account settings), re-run `npm run get-token`.
- **`npm run get-token` fails or the redirect never completes** — the redirect
  URI must match *exactly* (including `http://` and the port) between your
  `.env`'s `TWITCH_REDIRECT_URI` and the URL registered in the Twitch dev
  console for your application.
- **Overlay shows nothing / blank page in OBS** — make sure `npm start` is still
  running in a terminal (closing the terminal stops the server), and that the
  Browser Source URL exactly matches `http://localhost:3000/overlay.html`.
- **Commands aren't registering** — commands are case-insensitive but must match
  exactly (`!attack`, `!join mage`, `!startbattle`, ...) with no extra text
  before them in the message.
