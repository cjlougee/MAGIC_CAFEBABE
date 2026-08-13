import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Largest frame we will accept. A 4K canvas encodes to a few MB; this is slack, not a target. */
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;

/**
 * Writes a captured frame to `art/scenes/<name>.png`.
 *
 * A file on disk rather than a screenshot, because a screenshot is downscaled, needs the
 * browser window to be composited, and cannot be diffed or linked. Reading the game's own
 * canvas costs one call and produces the real pixels at full size.
 *
 * `apply: 'serve'` keeps every line of this out of production builds.
 */
function sceneCapture(): Plugin {
  return {
    name: 'scene-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        // Sanitised, not trusted. A dev server is still a server, and `../` in a filename
        // is the oldest hole there is.
        const name = (url.searchParams.get('name') ?? '').replace(/[^a-z0-9._-]/gi, '');
        if (req.method !== 'POST' || !name) {
          res.statusCode = 400;
          res.end('POST with a ?name of [a-z0-9._-]');
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_CAPTURE_BYTES) req.destroy();
          else chunks.push(chunk);
        });
        req.on('end', () => {
          const dir = join(process.cwd(), 'art', 'scenes');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${name}.png`), Buffer.concat(chunks));
          res.statusCode = 200;
          res.end(`art/scenes/${name}.png`);
        });
      });
    },
  };
}

// Test config lives in vitest.config.ts, not here. Vitest ships its own nested copy
// of Vite, so a `test` block in this file makes TypeScript compare two structurally
// identical but distinct Plugin types and fail. Separate files, separate type graphs.
export default defineConfig({
  plugins: [react(), sceneCapture()],
  resolve: {
    alias: {
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
    },
  },
  server: {
    /*
     * 5173 by default, overridable by PORT.
     *
     * A hard-coded port means a second dev server — a second session, a second checkout —
     * cannot start at all, and the tooling that launches one has no way to move it out of
     * the way. The env var costs nothing and makes the project work wherever it is put.
     */
    port: Number(process.env.PORT) || 5173,
  },
});
