/**
 * The top bar.
 *
 * Reads a published snapshot; never reads World. Keeping this boundary strict is what
 * lets the simulation stay headless and testable.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { Engine } from '../app/engine';
import type { GameSpeed } from '../app/gameLoop';
import type { UiStore } from '../app/uiStore';

const SPEEDS: ReadonlyArray<{ value: GameSpeed; label: string; title: string }> = [
  { value: 0, label: '❚❚', title: 'Pause (Space)' },
  { value: 1, label: '1x', title: 'Normal speed (1)' },
  { value: 2, label: '2x', title: 'Fast (2)' },
  { value: 3, label: '3x', title: 'Very fast (3)' },
];

interface HUDProps {
  readonly store: UiStore;
  readonly engine: Engine | null;
}

export function HUD({ store, engine }: HUDProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { snapshot, speed, fps, ready } = state;

  useEffect(() => {
    if (!engine) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (event.code === 'Space') {
        event.preventDefault();
        engine.setSpeed(speed === 0 ? 1 : 0);
        return;
      }
      const digit = { Digit1: 1, Digit2: 2, Digit3: 3 }[event.code];
      if (digit) engine.setSpeed(digit as GameSpeed);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, speed]);

  if (!ready || !snapshot) {
    return (
      <header className="hud">
        <span className="hud__title">MAGIC_CAFEBABE</span>
        <span className="hud__loading">generating world…</span>
      </header>
    );
  }

  return (
    <header className="hud">
      <span className="hud__title">MAGIC_CAFEBABE</span>

      <div className="hud__group">
        <span className="hud__label">Day</span>
        <span className="hud__value hud__value--accent">{snapshot.day + 1}</span>
        <span className="hud__value">{snapshot.clock}</span>
        <DaylightPip daylight={snapshot.daylight} />
      </div>

      <div className="hud__group hud__speeds">
        {SPEEDS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            className={`hud__speed${speed === option.value ? ' is-active' : ''}`}
            onClick={() => engine?.setSpeed(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="hud__group">
        <span className="hud__label">Seed</span>
        <span className="hud__value">{snapshot.seed}</span>
        <button
          type="button"
          className="hud__button"
          title="Generate a new world"
          onClick={() => engine?.regenerate(Math.floor(Math.random() * 1_000_000))}
        >
          New world
        </button>
      </div>

      <div className="hud__group hud__group--right">
        <span className="hud__label">Tick</span>
        <span className="hud__value">{snapshot.tick.toLocaleString()}</span>
        <span className="hud__label">FPS</span>
        <span className="hud__value">{fps}</span>
      </div>
    </header>
  );
}

/** A small sun/moon indicator — makes the day/night wash legible as intentional. */
function DaylightPip({ daylight }: { readonly daylight: number }) {
  return (
    <span
      className="hud__pip"
      title={`Daylight ${Math.round(daylight * 100)}%`}
      style={{ opacity: 0.35 + daylight * 0.65 }}
    >
      {daylight > 0.5 ? '☀' : daylight > 0 ? '◑' : '☾'}
    </span>
  );
}
