/**
 * The party: who is under direct command, and how to give them back.
 *
 * Appears whenever anyone is selected, because draft is now implicit in giving an order
 * and a player who does not know a colonist has left the work pool will spend a long
 * time wondering why nothing is getting built. This panel is the answer to "why has
 * everyone stopped working" being visible rather than deduced.
 */

import type { EntityId } from '../sim/core/entityStore';
import type { PawnSummary, PoiSummary } from '../sim/snapshot';

interface PartyPanelProps {
  readonly party: readonly PawnSummary[];
  readonly places: readonly PoiSummary[];
  readonly onUndraft: (pawnId: EntityId) => void;
  readonly onUndraftAll: () => void;
  readonly onTravelTo: (poi: PoiSummary) => void;
  readonly onClose: () => void;
}

export function PartyPanel({
  party,
  places,
  onUndraft,
  onUndraftAll,
  onTravelTo,
  onClose,
}: PartyPanelProps) {
  const drafted = party.filter((pawn) => pawn.drafted);

  return (
    <section className="party">
      <header className="party__head">
        <h2 className="party__title">
          Party · {party.length}
          {drafted.length > 0 && <span className="party__drafted"> · {drafted.length} drafted</span>}
        </h2>
        <button type="button" className="party__close" onClick={onClose} title="Deselect (Esc)">
          ✕
        </button>
      </header>

      <ul className="party__members">
        {party.map((pawn) => (
          <li key={pawn.id} className="party__member">
            <span className="party__name">
              {pawn.playerCharacter && <span className="colonist__you">◆</span>}
              {pawn.name}
            </span>
            <span className="party__state">
              {/* An order nobody can carry out is called out here as well as in the
                  alerts panel — this is the panel you are looking at when you gave it. */}
              {pawn.orderUnreachable ? 'cannot get there' : pawn.activity}
            </span>
            {pawn.drafted && (
              <button
                type="button"
                className="party__release"
                onClick={() => onUndraft(pawn.id)}
                title="Back to work"
              >
                ⏎
              </button>
            )}
          </li>
        ))}
      </ul>

      {drafted.length > 0 && (
        <button type="button" className="party__release-all" onClick={onUndraftAll}>
          Everyone back to work
        </button>
      )}

      {places.length > 0 && (
        <>
          <h3 className="party__group">Send to</h3>
          <ul className="party__places">
            {places.map((poi) => (
              <li key={poi.id}>
                <button
                  type="button"
                  className="party__place"
                  onClick={() => onTravelTo(poi)}
                  title={`${poi.kind} — ${poi.distance} tiles from the landing site`}
                >
                  <span className="party__place-name">{poi.name}</span>
                  <span className="party__place-distance">{poi.distance}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
