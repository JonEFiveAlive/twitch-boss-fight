// Player power: the single multiplier that turns progression into strength. It
// scales a player's max HP, damage and healing (fight.js) and sizes the boss to the
// party (boss HP, hit damage, variant). Levels and gear both feed it.
const { STAT_LEVEL_CAP, LEVEL_POWER_BONUS_MAX } = require("./gameConfig");

// Ease-out curve: early levels give the biggest gains, flattening to the cap.
function levelPowerBonus(level) {
  const progress = Math.min(Math.max(level - 1, 0), STAT_LEVEL_CAP - 1) / (STAT_LEVEL_CAP - 1);
  return LEVEL_POWER_BONUS_MAX * (1 - (1 - progress) ** 2);
}

// gearPower: the power bonus from equipped gear (see loot.js gearBonuses).
function playerPower(level, gearPower = 0) {
  return 1 + levelPowerBonus(level) + gearPower;
}

module.exports = { playerPower };
