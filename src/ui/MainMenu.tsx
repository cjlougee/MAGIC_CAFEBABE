/**
 * The menu, and the save browser.
 *
 * An overlay on the running game rather than a separate screen: a colony sim is a thing
 * you dip in and out of, and a full-screen menu that hides the map makes saving feel like
 * leaving. The game pauses while it is open.
 *
 * Saving defaults to creating a *new* slot with the day as its name, because the common
 * mistake is overwriting a colony you wanted to keep. Overwriting is available per-row,
 * where the thing being replaced is visible.
 */

import { useEffect, useState } from 'react';
import {
  deleteSave,
  listSaves,
  newSlotId,
  suggestedName,
  type SaveSlot,
  type SaveStats,
} from '../app/saveStorage';

interface MainMenuProps {
  readonly stats: SaveStats;
  readonly onClose: () => void;
  readonly onSave: (id: string, name: string) => boolean;
  readonly onLoad: (id: string) => boolean;
  readonly onNewWorld: () => void;
}

function describe(slot: SaveSlot): string {
  const colonists = `${slot.colonists} colonist${slot.colonists === 1 ? '' : 's'}`;
  return `Day ${slot.day} · ${colonists} · ${new Date(slot.savedAt).toLocaleString()}`;
}

export function MainMenu({ stats, onClose, onSave, onLoad, onNewWorld }: MainMenuProps) {
  const [slots, setSlots] = useState<SaveSlot[]>([]);
  const [name, setName] = useState(suggestedName(stats));
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // Re-read on open rather than holding state: another tab may have saved since.
  useEffect(() => setSlots(listSaves()), []);

  const refresh = () => setSlots(listSaves());

  const saveTo = (id: string, slotName: string) => {
    if (onSave(id, slotName)) {
      refresh();
      setMessage(`Saved “${slotName.trim() || suggestedName(stats)}”.`);
    } else {
      setMessage('Could not save — storage is full or unavailable.');
    }
  };

  const handleLoad = (id: string) => {
    if (onLoad(id)) onClose();
    else {
      refresh();
      setMessage('That save could not be read.');
    }
  };

  const handleDelete = (slot: SaveSlot) => {
    if (confirmingDelete !== slot.id) {
      // Two clicks, because there is no undo once a colony is gone.
      setConfirmingDelete(slot.id);
      setMessage(`Delete “${slot.name}”? Click again to confirm.`);
      return;
    }
    deleteSave(slot.id);
    setConfirmingDelete(null);
    refresh();
    setMessage(`Deleted “${slot.name}”.`);
  };

  return (
    <div className="menu-backdrop" onClick={onClose}>
      <section className="menu" onClick={(event) => event.stopPropagation()}>
        <header className="menu__head">
          <h2 className="menu__title">MAGIC_CAFEBABE</h2>
          <span className="menu__subtitle">paused</span>
        </header>

        <div className="menu__body">
          <div className="menu__save-row">
            <input
              className="menu__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={suggestedName(stats)}
              aria-label="Name for the new save"
            />
            <button
              type="button"
              className="menu__button menu__button--compact"
              onClick={() => saveTo(newSlotId(), name)}
            >
              Save as new
            </button>
          </div>

          <h3 className="menu__subhead">Saved colonies</h3>
          {slots.length === 0 ? (
            <p className="menu__note">Nothing saved yet.</p>
          ) : (
            <ul className="slots">
              {slots.map((slot) => (
                <li key={slot.id} className="slot">
                  <div className="slot__text">
                    <span className="slot__name">{slot.name}</span>
                    <span className="slot__detail">{describe(slot)}</span>
                  </div>
                  <div className="slot__actions">
                    <button type="button" className="slot__action" onClick={() => handleLoad(slot.id)}>
                      Load
                    </button>
                    <button
                      type="button"
                      className="slot__action"
                      title="Replace this save with the current colony"
                      onClick={() => saveTo(slot.id, slot.name)}
                    >
                      Overwrite
                    </button>
                    <button
                      type="button"
                      className={`slot__action slot__action--danger${
                        confirmingDelete === slot.id ? ' is-confirming' : ''
                      }`}
                      onClick={() => handleDelete(slot)}
                    >
                      {confirmingDelete === slot.id ? 'Sure?' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="menu__footer">
            <button type="button" className="menu__button" onClick={onClose}>
              Resume
            </button>
            <button type="button" className="menu__button menu__button--danger" onClick={onNewWorld}>
              Abandon and start over
            </button>
          </div>

          {message && <p className="menu__note">{message}</p>}
        </div>
      </section>
    </div>
  );
}
