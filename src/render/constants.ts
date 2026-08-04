/** Presentation constants. The simulation works in tiles and knows none of this. */

/**
 * 2:1 dimetric projection — a tile is twice as wide as it is tall.
 *
 * This is the ratio essentially every 2D isometric game uses, rather than true 30°
 * isometric (which needs a √3 ratio). 2:1 lands on whole pixels, so diamonds tessellate
 * exactly with no seams and no sub-pixel shimmer when the camera moves.
 */
export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_TILE_W = TILE_W / 2;
export const HALF_TILE_H = TILE_H / 2;

/** Zoom bounds, chosen so the sprite pool stays bounded (see TerrainLayer). */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;
export const DEFAULT_ZOOM = 1;

/**
 * Extra tiles searched past the viewport edge.
 *
 * Larger than the top-down version needed: the visible region is a diamond in tile
 * space rather than a rectangle, and tall tiles extend upward on screen, so a tile
 * whose base sits below the bottom edge can still have its top face visible.
 */
export const VIEW_MARGIN_TILES = 4;
