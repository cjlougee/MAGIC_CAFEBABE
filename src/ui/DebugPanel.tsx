/**
 * Cheats, for developing against.
 *
 * Exists because the slowest part of working on this game is *arriving at the situation
 * you want to look at*: waiting out a day to see a campfire at night, hunting the map for
 * rock so a wall can be afforded, watching colonists gather before anything can be built.
 * None of that is testing the change in front of you.
 *
 * Rendered only in a dev build. It is not a cheat menu the player can find — it is a
 * workbench that ships nowhere.
 */

import { ItemDef, ITEM_DEFS, type ItemDefId } from '../sim/defs/items';
import { MAX_ZOOM, MIN_ZOOM } from '../render/constants';

interface DebugPanelProps {
  readonly instantBuild: boolean;
  readonly zoom: number;
  readonly onSetHour: (hour: number) => void;
  readonly onAdvanceHours: (hours: number) => void;
  readonly onGive: (item: ItemDefId, count: number) => void;
  readonly onFinishBlueprints: () => void;
  readonly onToggleInstantBuild: (instant: boolean) => void;
  readonly onSetZoom: (zoom: number) => void;
  readonly onClose: () => void;
}

/**
 * Zoom presets, because finding a specific zoom by wheel is fiddly and comparing two
 * changes at *different* zooms is not a comparison. `Far` is the bound itself, which is
 * the one worth pinning: on a 512² world it is where you go to see how the country reads
 * rather than how a tile does.
 */
const ZOOMS: readonly { readonly label: string; readonly zoom: number }[] = [
  { label: 'Far', zoom: MIN_ZOOM },
  { label: '0.5x', zoom: 0.5 },
  { label: '1x', zoom: 1 },
  { label: 'Close', zoom: MAX_ZOOM },
];

/** Enough of each to do something with, not so much that stack spill dominates. */
const HANDOUTS: readonly { readonly item: ItemDefId; readonly count: number }[] = [
  { item: ItemDef.Stone, count: 200 },
  { item: ItemDef.Scrap, count: 100 },
  { item: ItemDef.RawFood, count: 100 },
  { item: ItemDef.Meal, count: 10 },
];

const HOURS: readonly { readonly label: string; readonly hour: number }[] = [
  { label: 'Dawn', hour: 6 },
  { label: 'Noon', hour: 12 },
  { label: 'Dusk', hour: 19 },
  { label: 'Night', hour: 23 },
];

export function DebugPanel({
  instantBuild,
  zoom,
  onSetHour,
  onAdvanceHours,
  onGive,
  onFinishBlueprints,
  onToggleInstantBuild,
  onSetZoom,
  onClose,
}: DebugPanelProps) {
  return (
    <section className="debug-panel">
      <header className="debug-panel__head">
        <h2 className="debug-panel__title">Debug</h2>
        <button type="button" className="debug-panel__close" onClick={onClose} title="Close (`)">
          ✕
        </button>
      </header>

      <div className="debug-panel__body">
        <h3 className="debug-panel__group">Skip to</h3>
        <div className="debug-panel__row">
          {HOURS.map((entry) => (
            <button
              type="button"
              key={entry.hour}
              className="debug-btn"
              onClick={() => onSetHour(entry.hour)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* Distinct from "skip to": this one actually runs the world, so colonists
            eat, build and finish what they were doing on the way. */}
        <h3 className="debug-panel__group">Simulate</h3>
        <div className="debug-panel__row">
          <button type="button" className="debug-btn" onClick={() => onAdvanceHours(1)}>
            +1 hour
          </button>
          <button type="button" className="debug-btn" onClick={() => onAdvanceHours(6)}>
            +6 hours
          </button>
        </div>

        <h3 className="debug-panel__group">Give</h3>
        <div className="debug-panel__row">
          {HANDOUTS.map((handout) => (
            <button
              type="button"
              key={handout.item}
              className="debug-btn"
              onClick={() => onGive(handout.item, handout.count)}
            >
              +{handout.count} {ITEM_DEFS[handout.item].name}
            </button>
          ))}
        </div>

        <h3 className="debug-panel__group">Zoom · {zoom.toFixed(2)}x</h3>
        <div className="debug-panel__row">
          {ZOOMS.map((entry) => (
            <button
              type="button"
              key={entry.label}
              className="debug-btn"
              onClick={() => onSetZoom(entry.zoom)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <h3 className="debug-panel__group">Building</h3>
        <div className="debug-panel__row">
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={instantBuild}
              onChange={(event) => onToggleInstantBuild(event.target.checked)}
            />
            Place finished
          </label>
          <button type="button" className="debug-btn" onClick={onFinishBlueprints}>
            Finish queued
          </button>
        </div>
      </div>
    </section>
  );
}
