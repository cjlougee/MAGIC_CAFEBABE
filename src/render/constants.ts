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

/**
 * Vertical offset of one z-level, in world pixels.
 *
 * Unused while the map is one level deep, but the projection takes z now so that
 * adding levels doesn't mean revisiting every call site. Chosen slightly taller than
 * the tallest terrain relief (bulkheads at 22px) so a full level reads as a storey
 * rather than as a bump. Current terrain heights are decorative sub-level relief and
 * will need reconciling against this when levels actually land.
 */
export const LEVEL_HEIGHT = 24;

/**
 * Zoom bounds, chosen so the sprite pool stays bounded (see GroundLayer).
 *
 * `MIN_ZOOM` was 0.35 when the world was 128 tiles across, where it showed a useful
 * fraction of the map. On a 512² world that is a keyhole, so it is loosened to 0.2 —
 * about 5,000 pooled sprites, which Pixi draws comfortably.
 *
 * It is deliberately *not* loosened far enough to fit the whole world on screen. At the
 * zoom that would take, a tile is under eight pixels and the art is mush; the answer to
 * "where am I in the world" is a minimap, not a zoom level. See docs/ROADMAP.md, M8.
 */
export const MIN_ZOOM = 0.2;
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
