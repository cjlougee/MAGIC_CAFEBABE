/**
 * A workbench's standing orders.
 *
 * The quota is the whole interface. A bill does not say "cook five times", it says "keep
 * ten meals" — so the panel's job is to make the target obviously editable and to explain
 * why the bench is idle when it is. "10 of 10" and "waiting for Raw Food" are very
 * different problems, and a panel that showed only the order would leave the player
 * guessing which one they had.
 */

import type { BenchSummary } from '../sim/snapshot';
import type { RecipeId } from '../sim/defs/recipes';

interface BillPanelProps {
  readonly bench: BenchSummary;
  readonly onAdd: (recipe: RecipeId) => void;
  readonly onRemove: (recipe: RecipeId) => void;
  readonly onSetCount: (recipe: RecipeId, untilCount: number) => void;
  readonly onClose: () => void;
}

export function BillPanel({ bench, onAdd, onRemove, onSetCount, onClose }: BillPanelProps) {
  return (
    <section className="bill-panel">
      <header className="bill-panel__head">
        <h2 className="bill-panel__name">{bench.name}</h2>
        <span className="bill-panel__where">
          {bench.x}, {bench.y}
        </span>
        <button type="button" className="bill-panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <div className="bill-panel__body">
        {bench.bills.length === 0 ? (
          <p className="bill-panel__empty">No standing orders. Nothing will be made here.</p>
        ) : (
          bench.bills.map((bill) => {
            const met = bill.held >= bill.untilCount;
            return (
              <div className="bill" key={bill.recipe}>
                <div className="bill__row">
                  <span className="bill__name">{bill.name}</span>
                  <button
                    type="button"
                    className="bill__remove"
                    onClick={() => onRemove(bill.recipe)}
                    title="Remove this order"
                  >
                    ✕
                  </button>
                </div>

                <div className="bill__row">
                  <span className="bill__label">Keep</span>
                  <button
                    type="button"
                    className="bill__step"
                    onClick={() => onSetCount(bill.recipe, bill.untilCount - 1)}
                    disabled={bill.untilCount <= 0}
                    title="Fewer"
                  >
                    −
                  </button>
                  <span className="bill__count">{bill.untilCount}</span>
                  <button
                    type="button"
                    className="bill__step"
                    onClick={() => onSetCount(bill.recipe, bill.untilCount + 1)}
                    title="More"
                  >
                    +
                  </button>
                </div>

                {/* Why it is or isn't working, in the bench's own words. */}
                <p className={`bill__status${met ? ' is-met' : ''}`}>
                  {met
                    ? `Stocked — ${bill.held} of ${bill.untilCount}.`
                    : bill.waitingFor.length > 0
                      ? `${bill.held} of ${bill.untilCount}. Waiting for ${bill.waitingFor.join(', ')}.`
                      : `${bill.held} of ${bill.untilCount}. Ready to cook.`}
                </p>
              </div>
            );
          })
        )}

        {bench.available.length > 0 && (
          <div className="bill-panel__add">
            {bench.available.map((recipe) => (
              <button
                type="button"
                key={recipe.recipe}
                className="bill-panel__addButton"
                onClick={() => onAdd(recipe.recipe)}
              >
                + {recipe.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
