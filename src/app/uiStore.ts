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

/**
 * Where and when the player last issued a move order, in screen pixels.
 *
 * `id` rather than a timestamp because replaying matters: ordering the same tile twice
 * must play the animation twice, and two identical positions are indistinguishable
 * without a counter.
 */
export interface OrderPing {
  readonly x: number;
  readonly y: number;
  readonly id: number;
}

export interface UiState {
  readonly snapshot: SimSnapshot | null;
  readonly speed: GameSpeed;
  readonly fps: number;
  readonly ready: boolean;
  /**
   * View state, not simulation state — where the player is looking, not what is true.
   *
   * A list rather than one id, because a party is the unit of command from M9 onward.
   * Empty means nothing selected; panels that only make sense for one colonist show when
   * there is exactly one.
   */
  readonly selectedPawnIds: readonly EntityId[];
  /** The workbench whose bills are open, if any. */
  readonly selectedStructureId: EntityId | null;
  /** Debug panel visibility, and whether Build raises finished structures. */
  readonly showDebug: boolean;
  readonly instantBuild: boolean;
  readonly tool: Tool;
  /** Which blueprint the build tool would place. */
  readonly buildable: BuildableId;
  readonly showWorkPanel: boolean;
  readonly showMenu: boolean;
  /** The click animation's position, or null before the first order. */
  readonly orderPing: OrderPing | null;
}

const INITIAL: UiState = {
  snapshot: null,
  speed: 1,
  fps: 0,
  ready: false,
  selectedPawnIds: [],
  selectedStructureId: null,
  showDebug: false,
  instantBuild: false,
  tool: 'select',
  buildable: Buildable.Wall,
  orderPing: null,
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
