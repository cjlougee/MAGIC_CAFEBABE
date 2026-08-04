import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Test config lives in vitest.config.ts, not here. Vitest ships its own nested copy
// of Vite, so a `test` block in this file makes TypeScript compare two structurally
// identical but distinct Plugin types and fail. Separate files, separate type graphs.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
