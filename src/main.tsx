import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyPaletteToCss } from './ui/applyPalette';
import './styles.css';

applyPaletteToCss();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

// Deliberately not wrapped in StrictMode: its double-invoked effects would create,
// destroy, and recreate the WebGL context on every mount. The engine's own
// cancellation guard covers the real unmount case.
createRoot(container).render(<App />);
