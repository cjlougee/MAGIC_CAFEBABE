/**
 * Tool selection.
 *
 * The select tool commands individuals; the area tools express standing intent the
 * colony fulfils on its own. That split is the control model made visible, so the two
 * groups are separated in the bar rather than presented as one flat list.
 */

import type { Tool } from '../input/worldInput';

interface ToolOption {
  readonly tool: Tool;
  readonly label: string;
  readonly hint: string;
}

const TOOLS: readonly ToolOption[] = [
  { tool: 'select', label: 'Select', hint: 'Click a colonist, right-click to send them (Esc)' },
  { tool: 'mine', label: 'Mine', hint: 'Drag over rock or bulkheads to mark them for mining' },
  { tool: 'stockpile', label: 'Stockpile', hint: 'Drag to mark where loose items should be stored' },
  { tool: 'erase', label: 'Erase', hint: 'Drag to clear designations and stockpiles' },
];

interface ToolbarProps {
  readonly active: Tool;
  readonly workPanelOpen: boolean;
  readonly onPick: (tool: Tool) => void;
  readonly onToggleWork: () => void;
}

export function Toolbar({ active, workPanelOpen, onPick, onToggleWork }: ToolbarProps) {
  return (
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
  );
}
