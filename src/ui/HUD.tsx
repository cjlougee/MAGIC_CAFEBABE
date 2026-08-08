/**
 * The chrome: top bar, colonist roster, toolbar, and work panel.
 *
 * Reads a published snapshot; never reads World. Keeping this boundary strict is what
 * lets the simulation stay headless and testable.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { Engine } from '../app/engine';
import type { GameSpeed } from '../app/gameLoop';
import type { UiStore } from '../app/uiStore';
import type { Tool } from '../input/worldInput';
import type { EntityId } from '../sim/core/entityStore';
import type { PawnSummary, ResourceSummary } from '../sim/snapshot';
import { AlertsPanel } from './AlertsPanel';
import { BillPanel } from './BillPanel';
import { ColonistPanel } from './ColonistPanel';
import { DebugPanel } from './DebugPanel';
import { MainMenu } from './MainMenu';
import { Toolbar } from './Toolbar';
import { WorkPanel } from './WorkPanel';

const SPEEDS: ReadonlyArray<{ value: GameSpeed; label: string; title: string }> = [
  { value: 0, label: '❚❚', title: 'Pause (Space)' },
  { value: 1, label: '1x', title: 'Normal speed (1)' },
  { value: 2, label: '2x', title: 'Fast (2)' },
  { value: 3, label: '3x', title: 'Very fast (3)' },
];

const TOOL_KEYS: Record<string, Tool> = {
  KeyQ: 'select',
  KeyM: 'mine',
  KeyB: 'stockpile',
  KeyX: 'erase',
  KeyC: 'build',
};

interface HUDProps {
  readonly store: UiStore;
  readonly engine: Engine | null;
}

export function HUD({ store, engine }: HUDProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const {
    snapshot,
    speed,
    fps,
    ready,
    selectedPawnId,
    selectedBenchId,
    tool,
    buildable,
    showWorkPanel,
    showMenu,
    showDebug,
    instantBuild,
  } = state;

  // The menu is a pause, not a screen: the world should not advance behind it.
  useEffect(() => {
    if (showMenu && engine && engine.loop.speed !== 0) engine.setSpeed(0);
  }, [showMenu, engine]);

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
      if (event.code === 'Escape') {
        // One key backs out of whatever you're in — a tool, a selection, and finally to
        // the menu when there is nothing left to back out of.
        if (state.tool !== 'select') engine.setTool('select');
        else if (selectedPawnId !== null) engine.select(null);
        else store.update({ showMenu: !state.showMenu });
        return;
      }

      if (event.code === 'Backquote' && import.meta.env.DEV) {
        store.update({ showDebug: !state.showDebug });
        return;
      }

      const nextTool = TOOL_KEYS[event.code];
      if (nextTool) {
        engine.setTool(nextTool);
        return;
      }

      const digit = { Digit1: 1, Digit2: 2, Digit3: 3 }[event.code];
      if (digit) engine.setSpeed(digit as GameSpeed);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, speed, state, selectedPawnId, store]);

  const selected = snapshot?.pawns.find((pawn) => pawn.id === selectedPawnId) ?? null;
  // Looked up fresh each snapshot rather than held, so a bench that is deconstructed
  // while its panel is open simply closes instead of describing something gone.
  const selectedBench = snapshot?.benches.find((bench) => bench.id === selectedBenchId) ?? null;

  if (!ready || !snapshot) {
    return (
      <header className="hud">
        <span className="hud__title">MAGIC_CAFEBABE</span>
        <span className="hud__loading">generating world…</span>
      </header>
    );
  }

  return (
    <>
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

        <Resources resources={snapshot.resources} />

        <div className="hud__group hud__group--right">
          <span className="hud__label">Ripe</span>
          <span className="hud__value">{snapshot.ripePlants}</span>
          <span className="hud__label">Rooms</span>
          <span className="hud__value">{snapshot.rooms}</span>
          {/* "Sites" meant nothing to anyone; this is the queue of unbuilt blueprints. */}
          <span className="hud__label">To build</span>
          <span className="hud__value">{snapshot.constructionSites}</span>
          <button
            type="button"
            className="hud__button"
            title="Save, load, or start over (Esc)"
            onClick={() => store.update({ showMenu: true })}
          >
            Menu
          </button>
          <span className="hud__label">FPS</span>
          <span className="hud__value">{fps}</span>
        </div>
      </header>

      <ColonistStrip
        pawns={snapshot.pawns}
        selectedId={selectedPawnId}
        onPick={(id) => engine?.focusPawn(id)}
      />

      <Toolbar
        active={tool}
        buildable={buildable}
        workPanelOpen={showWorkPanel}
        onPick={(next) => engine?.setTool(next)}
        onPickBuildable={(next) => engine?.setBuildable(next)}
        onToggleWork={() => store.update({ showWorkPanel: !showWorkPanel })}
      />

      <AlertsPanel alerts={snapshot.alerts} />

      {showMenu && engine && (
        <MainMenu
          stats={engine.saveStats()}
          onClose={() => store.update({ showMenu: false })}
          onSave={(id, saveName) => engine.saveGame(id, saveName)}
          onLoad={(id) => engine.loadGame(id)}
          onNewWorld={() => {
            engine.regenerate(Math.floor(Math.random() * 1_000_000));
            store.update({ showMenu: false });
          }}
        />
      )}

      {selected && !showWorkPanel && (
        <ColonistPanel pawn={selected} onClose={() => engine?.select(null)} />
      )}

      {selectedBench && !showWorkPanel && (
        <BillPanel
          bench={selectedBench}
          onAdd={(recipe) => engine?.addBill(selectedBench.id, recipe)}
          onRemove={(recipe) => engine?.removeBill(selectedBench.id, recipe)}
          onSetCount={(recipe, untilCount) =>
            engine?.setBillCount(selectedBench.id, recipe, untilCount)
          }
          onClose={() => engine?.selectBench(null)}
        />
      )}

      {showDebug && engine && import.meta.env.DEV && (
        <DebugPanel
          instantBuild={instantBuild}
          // Render state, so it is read rather than subscribed to. The readout refreshes
          // whenever the snapshot does — ~10Hz, which is plenty for a number.
          zoom={engine.cameraZoom}
          onSetHour={(hour) => engine.debugSetHour(hour)}
          onAdvanceHours={(hours) => engine.debugAdvanceHours(hours)}
          onGive={(item, count) => engine.debugGive(item, count)}
          onFinishBlueprints={() => engine.debugFinishBlueprints()}
          onToggleInstantBuild={(instant) => engine.setInstantBuild(instant)}
          onSetZoom={(zoom) => engine.debugSetZoom(zoom)}
          onClose={() => store.update({ showDebug: false })}
        />
      )}

      {showWorkPanel && (
        <WorkPanel
          pawns={snapshot.pawns}
          selectedId={selectedPawnId}
          onSet={(pawnId, workType, priority) =>
            engine?.setWorkPriority(pawnId, workType, priority)
          }
          onClose={() => store.update({ showWorkPanel: false })}
        />
      )}
    </>
  );
}

function Resources({ resources }: { readonly resources: readonly ResourceSummary[] }) {
  return (
    <div className="hud__group">
      {resources.map((resource) => (
        <span key={resource.def} className="resource" title={resource.name}>
          <span className="hud__label">{resource.name}</span>
          <span className="hud__value">{resource.count}</span>
        </span>
      ))}
    </div>
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

interface ColonistStripProps {
  readonly pawns: readonly PawnSummary[];
  readonly selectedId: EntityId | null;
  readonly onPick: (id: EntityId) => void;
}

/**
 * The colony roster. Clicking a name selects that colonist and pans to them, which is
 * how you find someone who has wandered off the screen.
 */
function ColonistStrip({ pawns, selectedId, onPick }: ColonistStripProps) {
  if (pawns.length === 0) return null;

  return (
    <aside className="colonists">
      {pawns.map((pawn) => (
        <button
          key={pawn.id}
          type="button"
          className={`colonist${selectedId === pawn.id ? ' is-selected' : ''}`}
          onClick={() => onPick(pawn.id)}
          title={`${pawn.name} — (${pawn.x}, ${pawn.y})`}
        >
          <span className="colonist__name">{pawn.name}</span>
          <span className="colonist__state">
            {pawn.carrying ? `${pawn.activity} · ${pawn.carrying}` : pawn.activity}
          </span>
        </button>
      ))}
    </aside>
  );
}
