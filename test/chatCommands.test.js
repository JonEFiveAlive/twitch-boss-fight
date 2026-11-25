// Chat parsing (src/chatCommands.js): aliases and the invisible characters chat
// clients append to dodge Twitch's 30-second duplicate-message filter, plus heal
// targets that survive extra words (through the real game loop).
const { test, mock } = require("node:test");
const assert = require("node:assert");
mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
const P = "../src/";
const { parseChatMessage, COMMAND_ALIASES } = require(P + "chatCommands");
const { createGameLoop } = require(P + "gameLoop");
const { openProgressStore } = require(P + "progress");
const cfg = require(P + "gameConfig");

const check = (label, ok) => test(label, () => assert.ok(ok, label));
const parsed = (msg) => parseChatMessage(msg);
const TAG = String.fromCodePoint(0xE0000); // what Chatterino appends to a repeated message
const ZWSP = String.fromCodePoint(0x200B); // zero-width space
const CGJ = String.fromCodePoint(0x034F);  // combining grapheme joiner, used the same way

// --- Aliases ---
check("!a, !atk and !attack all attack", ["!a", "!atk", "!attack", "!A"].every(m => parsed(m).command === "!attack"));
check("!d, !def and !defend all defend", ["!d", "!def", "!defend"].every(m => parsed(m).command === "!defend"));
check("!h heals, keeping its target", parsed("!h 2").command === "!heal" && parsed("!h 2").arg === "2");
check("class skills have no short aliases (!t, !f, !r stay free)",
  !["!t", "!f", "!r"].some(a => a in COMMAND_ALIASES) && parsed("!f").command === "!f");
check("every alias points at a real action command",
  Object.values(COMMAND_ALIASES).every(c => cfg.CLASSES.tank.actions.concat(cfg.CLASSES.cleric.actions).includes(c.slice(1))));

// --- Extra words and invisible characters ---
check("extra words become the argument (!attack 2)", parsed("!attack 2").command === "!attack" && parsed("!attack 2").arg === "2");
check("Chatterino's appended tag character is stripped (with a space)", parsed(`!attack ${TAG}`).command === "!attack" && parsed(`!attack ${TAG}`).arg === null);
check("...and without one", parsed(`!attack${TAG}`).command === "!attack");
check("a combining grapheme joiner is stripped", parsed(`!defend ${CGJ}`).command === "!defend" && parsed(`!defend ${CGJ}`).arg === null);
check("a heal target keeps working with a tag character", parsed(`!heal 2 ${TAG}`).arg === "2");
check("zero-width spaces inside a command are stripped", parsed(`!at${ZWSP}tack`).command === "!attack");
check("whole-message commands match after stripping (!startbattle + tag)", parsed(`!startbattle ${TAG}`).text === "!startbattle");
check("rawArg keeps a title's capitals", parsed("!title Raid Legend").rawArg === "Raid Legend");
check("an empty or invisible-only message parses to nothing", parsed("").command === "" && parsed(TAG).command === "");

// --- Heal targets with extra words, through the game loop ---
const store = openProgressStore(":memory:");
let state;
const game = createGameLoop({ on() {}, emit(_, s) { state = s; } }, { store, announce() {} });
game.handleJoin("id-ann", "Ann", "tank");
game.handleJoin("id-mel", "Melody", "mage");
game.handleJoin("id-cat", "Cat", "cleric");
game.handleForceStart(true);
const slotOf = (id) => state.fight.players[id].slot;
const healTarget = (arg) => { game.handleAction("id-cat", "heal", arg); return state.pendingTargets["id-cat"]; };

check("the fight is in its input phase", state.phase === "input");
check("!heal <slot> still targets that slot", healTarget(String(slotOf("id-mel"))) === "id-mel");
check("!heal <slot> <extra words> keeps the slot", healTarget(`${slotOf("id-mel")} again`) === "id-mel");
check("!heal <name> <extra words> keeps the name", healTarget("mel please") === "id-mel");
check("!heal self still works with extra words", healTarget("self .") === "id-cat");
check("an unknown target still auto-targets (null)", healTarget("nobody here") === null);
