/**
 * The menu.
 *
 * Deliberately an overlay on the running game rather than a separate screen: a colony sim
 * is a thing you dip in and out of, and a full-screen menu that hides the map makes
 * saving feel like leaving. The game pauses while it is open.
 */

import { useEffect, useState } from 'react';
import { readSaveInfo, type SaveInfo } from '../app/saveStorage';

interface MainMenuProps {
  readonly onClose: () => void;
  readonly onSave: () => boolean;
  readonly onLoad: () => boolean;
  readonly onNewWorld: () => void;
}

function describe(info: SaveInfo): string {
  const when = new Date(info.savedAt);
  const colonists = `${info.colonists} colonist${info.colonists === 1 ? '' : 's'}`;
  return `Day ${info.day} · ${colonists} · ${when.toLocaleString()}`;
}

export function MainMenu({ onClose, onSave, onLoad, onNewWorld }: MainMenuProps) {
  const [info, setInfo] = useState<SaveInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Re-read on open rather than holding state: another tab may have saved since.
  useEffect(() => setInfo(readSaveInfo()), []);

  const handleSave = () => {
    if (onSave()) {
      setInfo(readSaveInfo());
      setMessage('Colony saved.');
    } else {
      setMessage('Could not save — storage is unavailable.');
    }
  };

  const handleLoad = () => {
    if (onLoad()) onClose();
    else setMessage('That save could not be read.');
  };

  return (
    <div className="menu-backdrop" onClick={onClose}>
      <section className="menu" onClick={(event) => event.stopPropagation()}>
        <header className="menu__head">
          <h2 className="menu__title">MAGIC_CAFEBABE</h2>
          <span className="menu__subtitle">paused</span>
        </header>

        <div className="menu__body">
          <button type="button" className="menu__button" onClick={onClose}>
            Resume
          </button>
          <button type="button" className="menu__button" onClick={handleSave}>
            Save colony
          </button>
          <button
            type="button"
            className="menu__button"
            onClick={handleLoad}
            disabled={info === null}
            title={info ? describe(info) : 'No saved colony'}
          >
            Load colony
          </button>
          <button type="button" className="menu__button menu__button--danger" onClick={onNewWorld}>
            Abandon and start over
          </button>

          <p className="menu__note">
            {message ?? (info ? describe(info) : 'No saved colony yet.')}
          </p>
        </div>
      </section>
    </div>
  );
}
