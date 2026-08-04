/**
 * The bridge from a 60fps simulation to a React tree that must not re-render at 60fps.
 *
 * The engine pushes here roughly ten times a second. React subscribes through
 * useSyncExternalStore. State is replaced wholesale rather than mutated, because
 * useSyncExternalStore compares by reference to decide whether to re-render.
 */

import type { SimSnapshot } from '../sim/snapshot';
import type { GameSpeed } from './gameLoop';

export interface UiState {
  readonly snapshot: SimSnapshot | null;
  readonly speed: GameSpeed;
  readonly fps: number;
  readonly ready: boolean;
}

const INITIAL: UiState = {
  snapshot: null,
  speed: 1,
  fps: 0,
  ready: false,
};

export class UiStore {
  private state: UiState = INITIAL;
  private readonly listeners = new Set<() => void>();

  getState = (): UiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
