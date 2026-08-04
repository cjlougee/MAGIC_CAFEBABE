/** Simulation constants. Purely temporal and spatial — nothing about presentation. */

/** Simulation steps per real second at 1x speed. */
export const TICK_RATE = 60;

export const MS_PER_TICK = 1000 / TICK_RATE;

/**
 * RimWorld's time scale, adopted because it is well-tuned: long enough that a day
 * feels like a day, short enough that you see consequences in one sitting.
 * 60000 ticks/day at 60 tps ≈ 16.7 real minutes per in-game day at 1x.
 */
export const TICKS_PER_HOUR = 2500;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;

/**
 * Colonies land at 08:00. Opening the game at midnight would mean the player's first
 * impression is a dark screen and pawns immediately wanting to sleep.
 */
export const STARTING_TICK = TICKS_PER_HOUR * 8;

/** Slice 1 map size. Designed to scale to 250x250 without structural change. */
export const DEFAULT_MAP_SIZE = 128;

/**
 * Base movement cost of an open tile. Terrain costs are expressed relative to this
 * so pathfinding can stay in integers.
 */
export const BASE_MOVE_COST = 10;

/** Sentinel walk cost meaning "cannot be entered". */
export const IMPASSABLE = 0;
