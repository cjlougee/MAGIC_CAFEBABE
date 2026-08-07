/**
 * The bridge from a 60fps simulation to a React tree that must not re-render at 60fps.
 *
 * The engine pushes here roughly ten times a second. React subscribes through
 * useSyncExternalStore. State is replaced wholesale rather than mutated, because
 * useSyncExternalStore compares by reference to decide whether to re-render.
 */

import type { Tool } from '../input/worldInput';
import type { EntityId } from '../sim/core/entityStore';
import { Buildable, type BuildableId } from '../sim/defs/buildables';
import type { SimSnapshot } from '../sim/snapshot';
import type { GameSpeed } from './gameLoop';

export interface UiState {
  readonly snapshot: SimSnapshot | null;
  readonly speed: GameSpeed;
  readonly fps: number;
  readonly ready: boolean;
  /** View state, not simulation state — where the player is looking, not what is true. */
  readonly selectedPawnId: EntityId | null;
  readonly tool: Tool;
  /** Which blueprint the build tool would place. */
  readonly buildable: BuildableId;
  readonly showWorkPanel: boolean;
  readonly showMenu: boolean;
}

const INITIAL: UiState = {
  snapshot: null,
  speed: 1,
  fps: 0,
  ready: false,
  selectedPawnId: null,
  tool: 'select',
  buildable: Buildable.Wall,
  showWorkPanel: false,
  showMenu: false,
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
