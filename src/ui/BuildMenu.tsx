/**
 * The architect menu.
 *
 * It was one undivided row of `BUILDABLE_DEFS` rendered as words. That worked at six
 * entries and does not at eighteen, for two separate reasons that needed two separate
 * answers: there are too many to scan, so they are grouped; and a word is a poor
 * description of a shape, so each one shows its own sprite.
 *
 * The sprite is the game's, not a picture of it — see `render/art/thumbnail.ts`.
 */

import { useEffect, useRef, useState } from 'react';
import { drawBuildableThumbnail } from '../render/art/thumbnail';
import {
  buildableDef,
  BUILDABLE_DEFS,
  BUILD_CATEGORIES,
  type BuildCategory,
  type BuildableId,
} from '../sim/defs/buildables';
import { ITEM_DEFS } from '../sim/defs/items';

function costLabel(id: BuildableId): string {
  return BUILDABLE_DEFS[id].cost
    .map((cost) => `${cost.count} ${ITEM_DEFS[cost.def].name}`)
    .join(', ');
}

/**
 * One buildable's sprite, painted straight onto a canvas.
 *
 * A canvas rather than an `<img>` with a data URL: the pixels already exist as RGBA, so
 * `putImageData` is a copy where a data URL would mean encoding a PNG in the browser to
 * immediately decode it again.
 *
 * The canvas keeps the sprite's own pixel size and is scaled down by **one factor shared
 * across the whole set** (`THUMBNAIL_SCALE`), so a 2×2 table is twice a 1×1 stool on
 * screen because it is twice a stool in the game. Fitting each sprite to a box instead
 * normalises the wrong dimension and makes the biggest furniture read smallest, which is
 * the opposite of the reason to show a picture at all.
 */
function Thumbnail({ buildable }: { readonly buildable: BuildableId }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current) drawBuildableThumbnail(ref.current, buildable);
  }, [buildable]);

  return <canvas ref={ref} className="build-menu__sprite" aria-hidden />;
}

interface BuildMenuProps {
  readonly buildable: BuildableId;
  readonly onPickBuildable: (buildable: BuildableId) => void;
}

/**
 * Clicking a menu button must not leave the keyboard focused on it.
 *
 * The player's *next* input after picking a buildable is Q, E, or a click on the map — the
 * gesture continues on the world, not in the menu. But a click focuses the button, and the
 * browser reveals `:focus-visible` the moment it sees a real key, so the first press of E
 * put Chrome's orange ring around whichever item was last clicked. The rotation worked; it
 * simply looked as though the key had done something to the menu.
 *
 * `preventDefault` on mousedown suppresses the focus without touching the click, so Tab
 * still reaches these and *there* the ring is wanted and correct.
 */
const keepFocusOffTheMenu = (event: { preventDefault: () => void }) => event.preventDefault();

export function BuildMenu({ buildable, onPickBuildable }: BuildMenuProps) {
  /*
   * Which tab is open is **this component's own state**, and it lives here rather than in
   * `Toolbar` for a reason worth stating: the menu is unmounted whenever the build tool is
   * not selected, so the initial value is recomputed every time it opens — which is what
   * makes "opening the menu shows you the thing you are holding" true rather than only
   * true the first time. Held in `Toolbar`, which never unmounts, it would have been
   * seeded once from the default buildable and never re-derived.
   *
   * It is not engine state at all. It changes nothing about the world and nothing about
   * what a click will do — the selected buildable still decides that — so putting it
   * through the command queue and the snapshot would be ceremony for a value only this
   * component reads.
   */
  const [category, setCategory] = useState<BuildCategory>(buildableDef(buildable).category);
  const shown = BUILDABLE_DEFS.filter((def) => def.category === category);

  return (
    <div className="build-menu">
      <nav className="build-menu__tabs">
        {BUILD_CATEGORIES.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`build-menu__tab${category === tab.id ? ' is-active' : ''}`}
            onMouseDown={keepFocusOffTheMenu}
            onClick={() => setCategory(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="build-menu__items">
        {shown.map((def) => (
          <button
            key={def.id}
            type="button"
            title={`${def.description} — costs ${costLabel(def.id)}`}
            className={`build-menu__item${buildable === def.id ? ' is-active' : ''}`}
            onMouseDown={keepFocusOffTheMenu}
            onClick={() => onPickBuildable(def.id)}
          >
            <Thumbnail buildable={def.id} />
            <span className="build-menu__name">{def.name}</span>
            <span className="build-menu__cost">{costLabel(def.id)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
