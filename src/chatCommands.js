// Chat message parsing: turns a raw Twitch message into { command, arg }.
// Pure functions, no Twitch dependency, so they can be tested directly.
//
// Twitch rejects a message identical to one the same viewer sent in the last 30
// seconds, and rounds are shorter than that. So a player who attacks every round
// needs more than one way to say it:
//   - short aliases for the universal actions (!a / !atk / !attack ...), and
//   - anything after a command is ignored (!attack 1, !attack 2 ...), and
//   - the invisible characters chat clients (Chatterino, 7TV) append to dodge the
//     duplicate filter are stripped before parsing.
//
// Alias rule: single letters are reserved for the universal actions every class
// has (attack, defend) plus heal. Class skills (!taunt, !fire, !revive) keep their
// full word, so future skills (e.g. !ice, or !magic fire) can't collide with them.

const COMMAND_ALIASES = {
  "!a": "!attack",
  "!atk": "!attack",
  "!d": "!defend",
  "!def": "!defend",
  "!h": "!heal"
};

// Zero-width and other invisible characters: soft hyphen, combining grapheme joiner,
// Mongolian vowel separator, zero-width space/joiners and direction marks, word
// joiner and invisible operators, braille blank, BOM, and the Unicode tag block
// (Chatterino appends U+E0000).
const INVISIBLE_CHARS = /[\u00AD\u034F\u180E\u200B-\u200F\u2060-\u2064\u2800\uFEFF\u{E0000}-\u{E007F}]/gu;

function stripInvisible(text) {
  return String(text ?? "").replace(INVISIBLE_CHARS, "");
}

/**
 * Parses a chat message. Returns
 *   { text, command, arg, rawArg }
 * text: the whole message, cleaned and lowercased; command: the first word with
 * aliases resolved ("!a" -> "!attack"); arg: the rest, lowercased (null if none);
 * rawArg: the rest with its original capitals (for titles).
 */
function parseChatMessage(message) {
  const clean = stripInvisible(message).trim();
  const [first = "", ...rest] = clean.split(/\s+/);
  const word = first.toLowerCase();
  const rawArg = rest.join(" ") || null;
  return {
    text: clean.toLowerCase(),
    command: COMMAND_ALIASES[word] ?? word,
    arg: rawArg && rawArg.toLowerCase(),
    rawArg
  };
}

module.exports = { COMMAND_ALIASES, stripInvisible, parseChatMessage };
