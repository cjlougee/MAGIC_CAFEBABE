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
import type { SelectMode, Tool } from '../input/worldInput';
import type { EntityId } from '../sim/core/entityStore';
import type { PawnSummary, ResourceSummary } from '../sim/snapshot';
import { AlertsPanel } from './AlertsPanel';
import { BillPanel } from './BillPanel';
import { StructurePanel } from './StructurePanel';
import { ColonistPanel } from './ColonistPanel';
import { DebugPanel } from './DebugPanel';
import { Minimap } from './Minimap';
import { PartyPanel } from './PartyPanel';
import { OrderCursor } from './OrderCursor';
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
    selectedPawnIds,
    selectedStructureId,
    tool,
    buildable,
    buildRotation,
    showWorkPanel,
    showMenu,
    showDebug,
    instantBuild,
    orderPing,
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
        else if (selectedPawnIds.length > 0) engine.select(null);
        else store.update({ showMenu: !state.showMenu });
        return;
      }

      if (event.code === 'Backquote' && import.meta.env.DEV) {
        store.update({ showDebug: !state.showDebug });
        return;
      }

      /*
       * Q and E turn the pending blueprint — but only while the build tool is up.
       *
       * ADR 0005 forbids an input that means different things depending on state, and
       * this is deliberately the exception it allows for: the rule is about *state the
       * player cannot see*. Which tool is active is the most visible state in the game —
       * the toolbar highlights it, the cursor changes, the architect row is open, and the
       * hint bar changes to say Q/E turn. Escape and right-click both still leave the
       * tool, so nothing is trapped behind the borrowed key.
       */
      if (engine.canRotate && (event.code === 'KeyQ' || event.code === 'KeyE')) {
        engine.rotateBuildable(event.code === 'KeyE' ? 1 : -1);
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
  }, [engine, speed, state, selectedPawnIds, store]);

  const party = snapshot?.pawns.filter((pawn) => selectedPawnIds.includes(pawn.id)) ?? [];
  // The colonist panel is for *a* colonist. With a party selected the party panel takes
  // over, because per-pawn needs and thoughts for six people is a wall, not information.
  const selected = party.length === 1 ? party[0] : null;
  // Looked up fresh each snapshot rather than held, so a structure that is deconstructed
  // while its panel is open simply closes instead of describing something gone.
  const selectedStructure =
    snapshot?.structures.find((s) => s.id === selectedStructureId) ?? null;
  // A bench gets both panels. "What is this" and "what should it make" are different
  // questions, and the second is far longer than the first.
  const selectedBench = snapshot?.benches.find((bench) => bench.id === selectedStructureId) ?? null;

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
        selectedIds={selectedPawnIds}
        onPick={(id, mode) => engine?.focusPawn(id, mode)}
      />

      <Toolbar
        active={tool}
        buildable={buildable}
        buildRotation={buildRotation}
        workPanelOpen={showWorkPanel}
        onPick={(next) => engine?.setTool(next)}
        onPickBuildable={(next) => engine?.setBuildable(next)}
        onToggleWork={() => store.update({ showWorkPanel: !showWorkPanel })}
      />

      <AlertsPanel alerts={snapshot.alerts} />

      <OrderCursor ping={orderPing} />

      {engine && (
        <Minimap
          engine={engine}
          mapWidth={snapshot.mapWidth}
          mapHeight={snapshot.mapHeight}
          pois={snapshot.pois}
          landingSite={snapshot.landingSite}
          pawns={snapshot.pawns}
          tick={snapshot.tick}
        />
      )}

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

      {/*
        One rail, so the panels stack instead of covering one another. The party controls
        and a colonist's sheet were both absolutely positioned in the same corner, so
        selecting a single colonist hid the very controls that acted on them — and closing
        the sheet cleared the selection, which took the party panel with it.
      */}
      {!showWorkPanel && (party.length > 0 || selectedStructure) && (
        <div className="side-rail">
          {party.length > 0 && engine && (
            <PartyPanel
              party={party}
              places={snapshot.pois}
              onSetDrafted={(pawnId, drafted) => engine.setDrafted(pawnId, drafted)}
              onSetPartyDrafted={(drafted) => engine.setPartyDrafted(drafted)}
              onTravelTo={(poi) => engine.orderPartyTo(poi)}
              onClose={() => engine.select(null)}
            />
          )}

          {selected && <ColonistPanel pawn={selected} onClose={() => engine?.select(null)} />}

          {selectedStructure && engine && (
            <StructurePanel
              structure={selectedStructure}
              onDeconstruct={() => engine.markDeconstruct(selectedStructure.x, selectedStructure.y)}
              onCancelDeconstruct={() =>
                engine.cancelDesignation(selectedStructure.x, selectedStructure.y)
              }
              onSetLocked={(locked) => engine.setLocked(selectedStructure.id, locked)}
              onClose={() => engine.selectStructure(null)}
            />
          )}

          {selectedBench && (
            <BillPanel
              bench={selectedBench}
              onAdd={(recipe) => engine?.addBill(selectedBench.id, recipe)}
              onRemove={(recipe) => engine?.removeBill(selectedBench.id, recipe)}
              onSetCount={(recipe, untilCount) =>
                engine?.setBillCount(selectedBench.id, recipe, untilCount)
              }
              onClose={() => engine?.selectStructure(null)}
            />
          )}
        </div>
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
          selectedId={selected?.id ?? null}
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
  readonly selectedIds: readonly EntityId[];
  /** Modifier-aware, so a party can be built from the roster as well as from the map. */
  readonly onPick: (id: EntityId, mode: SelectMode) => void;
}

/**
 * The colony roster. Clicking a name selects that colonist and pans to them, which is
 * how you find someone who has wandered off the screen.
 */
function ColonistStrip({ pawns, selectedIds, onPick }: ColonistStripProps) {
  if (pawns.length === 0) return null;

  return (
    <aside className="colonists">
      {pawns.map((pawn) => {
        const classes = [
          'colonist',
          selectedIds.includes(pawn.id) ? 'is-selected' : '',
          pawn.drafted ? 'is-drafted' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={pawn.id}
            type="button"
            className={classes}
            onClick={(event) =>
              onPick(
                pawn.id,
                event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : 'replace',
              )
            }
            title={`${pawn.name} — (${pawn.x}, ${pawn.y})${pawn.drafted ? ' · drafted' : ''}`}
          >
            <span className="colonist__name">
              {/* The one colonist you are. A mark rather than a label, so the roster
                  stays scannable and nobody is described as "(you)". */}
              {pawn.playerCharacter && <span className="colonist__you">◆</span>}
              {pawn.name}
            </span>
            <span className="colonist__state">
              {pawn.carrying ? `${pawn.activity} · ${pawn.carrying}` : pawn.activity}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
