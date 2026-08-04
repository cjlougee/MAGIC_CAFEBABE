import { defineConfig } from 'vitest/config';

// Deliberately plugin-free: everything under tests/ exercises the pure simulation,
// which needs no JSX transform and no browser environment. That is the point of the
// sim/render firewall — the game is testable in plain Node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
