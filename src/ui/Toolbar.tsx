/**
 * Tool selection.
 *
 * The select tool commands individuals; the area tools express standing intent the
 * colony fulfils on its own. That split is the control model made visible, so the two
 * groups are separated in the bar rather than presented as one flat list.
 */

import type { Tool } from '../input/worldInput';
import { BUILDABLE_DEFS, type BuildableId } from '../sim/defs/buildables';
import { ITEM_DEFS } from '../sim/defs/items';

interface ToolOption {
  readonly tool: Tool;
  readonly label: string;
  readonly hint: string;
}

const TOOLS: readonly ToolOption[] = [
  { tool: 'select', label: 'Select', hint: 'Click a colonist, right-click to send them (Esc)' },
  { tool: 'mine', label: 'Mine', hint: 'Drag over rock or bulkheads to mark them for mining' },
  {
    tool: 'deconstruct',
    label: 'Deconstruct',
    hint: 'Drag over finished walls, doors, or floors to have them taken down for half their materials',
  },
  { tool: 'stockpile', label: 'Stockpile', hint: 'Drag to mark where loose items should be stored' },
  { tool: 'erase', label: 'Erase', hint: 'Drag to clear designations, stockpiles, and blueprints' },
];

function costLabel(id: BuildableId): string {
  return BUILDABLE_DEFS[id].cost
    .map((cost) => `${cost.count} ${ITEM_DEFS[cost.def].name}`)
    .join(', ');
}

interface ToolbarProps {
  readonly active: Tool;
  readonly buildable: BuildableId;
  readonly workPanelOpen: boolean;
  readonly onPick: (tool: Tool) => void;
  readonly onPickBuildable: (buildable: BuildableId) => void;
  readonly onToggleWork: () => void;
}

export function Toolbar({
  active,
  buildable,
  workPanelOpen,
  onPick,
  onPickBuildable,
  onToggleWork,
}: ToolbarProps) {
  return (
    <>
      {/* The architect row only appears while building, so the bar stays readable. */}
      {active === 'build' && (
        <nav className="toolbar toolbar--architect">
          {BUILDABLE_DEFS.map((def) => (
            <button
              key={def.id}
              type="button"
              title={`${def.description} — costs ${costLabel(def.id)}`}
              className={`toolbar__button${buildable === def.id ? ' is-active' : ''}`}
              onClick={() => onPickBuildable(def.id)}
            >
              {def.name}
              <span className="toolbar__cost">{costLabel(def.id)}</span>
            </button>
          ))}
        </nav>
      )}

      <nav className="toolbar">
        {TOOLS.map((option) => (
          <button
            key={option.tool}
            type="button"
            title={option.hint}
            className={`toolbar__button${active === option.tool ? ' is-active' : ''}`}
            onClick={() => onPick(option.tool)}
          >
            {option.label}
          </button>
        ))}

        <button
          type="button"
          title="Place blueprints — colonists deliver materials, then build"
          className={`toolbar__button${active === 'build' ? ' is-active' : ''}`}
          onClick={() => onPick('build')}
        >
          Build
        </button>

        <span className="toolbar__divider" />

        <button
          type="button"
          title="Set which colonists do which work, and in what order"
          className={`toolbar__button${workPanelOpen ? ' is-active' : ''}`}
          onClick={onToggleWork}
        >
          Work
        </button>
      </nav>
    </>
  );
}
