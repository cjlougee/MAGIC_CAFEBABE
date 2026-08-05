import { useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from '../ui/HUD';
import { Engine } from './engine';
import { UiStore } from './uiStore';

/** Randomised per session so opening the game twice shows two different worlds. */
const INITIAL_SEED = Math.floor(Math.random() * 1_000_000);

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => new UiStore(), []);
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let created: Engine | null = null;

    // Engine creation is async (Pixi's WebGL context init), so a fast unmount can
    // land before it resolves. The flag makes sure we tear down what we built.
    Engine.create(host, INITIAL_SEED, store)
      .then((engineInstance) => {
        if (cancelled) {
          engineInstance.destroy();
          return;
        }
        created = engineInstance;
        setEngine(engineInstance);
        engineInstance.loop.start();
      })
      .catch((error: unknown) => {
        console.error('Engine failed to start', error);
      });

    return () => {
      cancelled = true;
      created?.destroy();
    };
  }, [store]);

  return (
    <div className="app">
      <div className="viewport" ref={hostRef} />
      <HUD store={store} engine={engine} />
      <footer className="controls-hint">
        <kbd>Left-click</kbd> select · <kbd>Right-click</kbd> move here · <kbd>Drag</kbd> pan ·{' '}
        <kbd>Wheel</kbd> zoom · <kbd>WASD</kbd> scroll · <kbd>Space</kbd> pause ·{' '}
        <kbd>1</kbd>–<kbd>3</kbd> speed
      </footer>
    </div>
  );
}
