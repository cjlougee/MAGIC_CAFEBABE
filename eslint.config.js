import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The `src/sim/**` override is one of the project's three enforcement rules
 * (see CLAUDE.md). It is backed by tests/architecture.test.ts, which is the
 * authoritative gate — lint here is just the fast feedback loop.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // RULE 1 + RULE 2: the simulation core is pure, deterministic, and headless.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'pixi.js/*'], message: 'sim/ must not import the renderer.' },
            { group: ['react', 'react-dom', 'react/*'], message: 'sim/ must not import UI.' },
            {
              group: ['**/render/**', '**/ui/**', '**/app/**', '@render/*', '@ui/*', '@app/*'],
              message: 'sim/ must not import from render/, ui/, or app/.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'sim/ must be headless.' },
        { name: 'document', message: 'sim/ must be headless.' },
        { name: 'localStorage', message: 'sim/ must be headless.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'sim/ must use the seeded Rng from world state. Determinism is non-negotiable.',
        },
      ],
    },
  },
);
