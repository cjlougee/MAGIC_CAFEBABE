/**
 * The selected colonist, in detail.
 *
 * The thoughts list is the important part. Mood as a bare number is a mystery the
 * player can only respond to by guessing; mood as a *list of reasons* is a problem they
 * can act on. Every entry here corresponds to a thought the simulation actually holds —
 * nothing is invented for display.
 */

import type { PawnSummary } from '../sim/snapshot';

interface ColonistPanelProps {
  readonly pawn: PawnSummary;
  readonly onClose: () => void;
}

function moodLabel(mood: number): string {
  if (mood >= 0.75) return 'content';
  if (mood >= 0.5) return 'fine';
  if (mood >= 0.3) return 'unhappy';
  if (mood >= 0.2) return 'miserable';
  return 'breaking';
}

export function ColonistPanel({ pawn, onClose }: ColonistPanelProps) {
  return (
    <section className="colonist-panel">
      <header className="colonist-panel__head">
        <h2 className="colonist-panel__name">{pawn.name}</h2>
        <span className="colonist-panel__activity">{pawn.activity}</span>
        <button type="button" className="colonist-panel__close" onClick={onClose} title="Close">
          ✕
        </button>
      </header>

      <div className="colonist-panel__body">
        {pawn.needs.map((need) => (
          <Bar key={need.label} label={need.label} value={need.value} warn={need.low} />
        ))}
        <Bar label="Health" value={pawn.health} warn={pawn.health < 0.5} />
        <Bar label="Mood" value={pawn.mood} warn={pawn.mood < 0.3} note={moodLabel(pawn.mood)} />

        <h3 className="colonist-panel__subhead">Thoughts</h3>
        {pawn.thoughts.length === 0 ? (
          <p className="colonist-panel__empty">Nothing much on their mind.</p>
        ) : (
          <ul className="thoughts">
            {pawn.thoughts.map((thought, index) => (
              <li key={`${thought.label}:${index}`} className="thought">
                <span>{thought.label}</span>
                <span className={thought.mood >= 0 ? 'thought__good' : 'thought__bad'}>
                  {thought.mood >= 0 ? '+' : ''}
                  {Math.round(thought.mood * 100)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface BarProps {
  readonly label: string;
  readonly value: number;
  readonly warn: boolean;
  readonly note?: string;
}

function Bar({ label, value, warn, note }: BarProps) {
  return (
    <div className="bar">
      <span className="bar__label">{label}</span>
      <span className="bar__track">
        <span
          className={`bar__fill${warn ? ' is-warning' : ''}`}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </span>
      <span className="bar__value">{note ?? `${Math.round(value * 100)}%`}</span>
    </div>
  );
}
