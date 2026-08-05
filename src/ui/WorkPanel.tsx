/**
 * The work priority grid — the main lever the player has over an autonomous colony.
 *
 * Lower numbers are more urgent and 0 means "never", which is RimWorld's convention.
 * It reads backwards cold, so the header says so outright rather than leaving the
 * player to work it out by experiment.
 */

import { WORK_TYPE_DEFS, PRIORITY_LOWEST } from '../sim/defs/workTypes';
import type { WorkTypeId } from '../sim/defs/workTypes';
import type { PawnSummary } from '../sim/snapshot';

interface WorkPanelProps {
  readonly pawns: readonly PawnSummary[];
  readonly selectedId: number | null;
  readonly onSet: (pawnId: number, workType: WorkTypeId, priority: number) => void;
  readonly onClose: () => void;
}

/** Cycles 0 → 1 → 2 → 3 → 4 → 0, so one control covers the whole range. */
function nextPriority(current: number): number {
  return current >= PRIORITY_LOWEST ? 0 : current + 1;
}

export function WorkPanel({ pawns, selectedId, onSet, onClose }: WorkPanelProps) {
  return (
    <section className="work-panel">
      <header className="work-panel__head">
        <h2 className="work-panel__title">Work priorities</h2>
        <span className="work-panel__legend">1 is most urgent · 0 is never</span>
        <button type="button" className="work-panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <table className="work-table">
        <thead>
          <tr>
            <th className="work-table__name">Colonist</th>
            {WORK_TYPE_DEFS.map((def) => (
              <th key={def.id} title={def.description}>
                {def.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pawns.map((pawn) => (
            <tr key={pawn.id} className={selectedId === pawn.id ? 'is-selected' : undefined}>
              <td className="work-table__name">{pawn.name}</td>
              {WORK_TYPE_DEFS.map((def) => {
                const priority = pawn.priorities[def.id] ?? 0;
                return (
                  <td key={def.id}>
                    <button
                      type="button"
                      className={`priority priority--${priority}`}
                      title={`${pawn.name} · ${def.label} — click to change`}
                      onClick={() => onSet(pawn.id, def.id as WorkTypeId, nextPriority(priority))}
                    >
                      {priority === 0 ? '–' : priority}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
