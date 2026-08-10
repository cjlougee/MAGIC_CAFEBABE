import { useSyncExternalStore, useEffect, useMemo, useRef, useState } from 'react';
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

  // Only for the hint bar, which has to say what Q currently does.
  const building = useSyncExternalStore(store.subscribe, store.getState).tool === 'build';

  return (
    <div className="app">
      <div className="viewport" ref={hostRef} />
      <HUD store={store} engine={engine} />
      <footer className="controls-hint">
        <kbd>Right-drag</kbd> pan · <kbd>Right-click</kbd> order / cancel tool ·{' '}
        <kbd>Left-drag</kbd> select or use tool · <kbd>Ctrl</kbd> add · <kbd>Shift</kbd> range ·{' '}
        <kbd>Wheel</kbd> zoom · <kbd>WASD</kbd> scroll · <kbd>Space</kbd> pause ·{' '}
        {/*
          Q changes meaning while the build tool is up, so the hint has to change with it.
          That is what keeps it inside ADR 0005 rather than in breach of it: the rule
          forbids an input that depends on state the player cannot see.
        */}
        {building ? (
          <>
            <kbd>Q</kbd>
            <kbd>E</kbd> turn · <kbd>Esc</kbd> leave the tool
          </>
        ) : (
          <>
            <kbd>Q</kbd>
            <kbd>M</kbd>
            <kbd>B</kbd>
            <kbd>C</kbd>
            <kbd>X</kbd> tools
          </>
        )}
      </footer>
    </div>
  );
}
