/**
 * What is standing on this cell, and the two things you can do to it.
 *
 * Until M11 a wall was not a click target at all. Everything the player could select was
 * something that moved or something that carried bills, so the only way to take down one
 * misplaced wall was to pick the deconstruct tool and drag a rectangle over it — reaching
 * for the tool built for tidying a whole area in order to express a single mistake, and
 * hoping the drag caught nothing else.
 *
 * The panel deliberately does *not* try to be the bill panel as well. A bench gets both,
 * stacked in the rail, because "what is this" and "what should it make" are different
 * questions and the second one is much longer than the first.
 */

import type { StructureSummary } from '../sim/snapshot';

interface StructurePanelProps {
  readonly structure: StructureSummary;
  readonly onDeconstruct: () => void;
  readonly onCancelDeconstruct: () => void;
  readonly onSetLocked: (locked: boolean) => void;
  readonly onReleaseOwner: () => void;
  readonly onClose: () => void;
}

export function StructurePanel({
  structure,
  onDeconstruct,
  onCancelDeconstruct,
  onSetLocked,
  onReleaseOwner,
  onClose,
}: StructurePanelProps) {
  const footprint =
    structure.width === 1 && structure.height === 1
      ? null
      : `${structure.width}×${structure.height}`;

  return (
    <section className="structure-panel">
      <header className="structure-panel__head">
        <h2 className="structure-panel__name">{structure.name}</h2>
        <span className="structure-panel__where">
          {structure.x}, {structure.y}
          {footprint && <span className="structure-panel__size"> · {footprint}</span>}
        </span>
        <button type="button" className="structure-panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <div className="structure-panel__body">
        {/*
          Only shown for something that can actually be barred. A lock control on a wall
          would be a button that visibly does nothing, which teaches the player that the
          panel lies.
        */}
        {structure.locked !== null && (
          <button
            type="button"
            className={`structure-panel__toggle${structure.locked ? ' is-on' : ''}`}
            onClick={() => onSetLocked(!structure.locked)}
            title={
              structure.locked
                ? 'Colonists cannot pass. It still seals the room.'
                : 'Bar it. Colonists will path around; the room stays sealed.'
            }
          >
            {structure.locked ? 'Locked' : 'Unlocked'}
          </button>
        )}

        {/*
          Only for something that can be owned, and it says so even when nobody has
          claimed it — "Unclaimed" is a fact about the bed, where the absence of the row
          entirely is a fact about walls. A colonist claims a bed by sleeping in it; this
          is the only way to undo that, so without the row the state would be invisible
          and permanent.
        */}
        {structure.owner && (
          <div className="structure-panel__owner">
            <span className="structure-panel__note">
              {structure.owner.name ? `${structure.owner.name}'s` : 'Unclaimed'}
            </span>
            {structure.owner.name && (
              <button
                type="button"
                className="structure-panel__release"
                onClick={onReleaseOwner}
                title="Give it up. The next colonist to sleep here claims it."
              >
                Release
              </button>
            )}
          </div>
        )}

        {/*
          The order and its undo are one button, because "did that register?" is the
          question this whole milestone exists to answer. A marked structure says so
          rather than looking exactly like an unmarked one.
        */}
        {structure.canDeconstruct ? (
          structure.markedForDeconstruct ? (
            <button
              type="button"
              className="structure-panel__cancel"
              onClick={onCancelDeconstruct}
              title="Call off the demolition"
            >
              Marked — cancel
            </button>
          ) : (
            <button
              type="button"
              className="structure-panel__demolish"
              onClick={onDeconstruct}
              title="Mark for demolition. Half the materials come back."
            >
              ✕ Deconstruct
            </button>
          )
        ) : (
          <p className="structure-panel__note">
            The colony did not build this, so there is nothing to salvage from it.
          </p>
        )}
      </div>
    </section>
  );
}
