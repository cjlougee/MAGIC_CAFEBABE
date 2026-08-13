/**
 * The scenario harness, checked headless.
 *
 * Scenarios exist so a game state can be *looked at* cheaply, but the states they build
 * must be states the game could actually reach. These tests hold that line: everything
 * here runs with no renderer, which is the same property the simulation has had since M0.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { createWorld } from '../src/sim/world/world';

describe('Simulation.install', () => {
  it('replaces the world and drops queued commands aimed at the old one', () => {
    const sim = new Simulation();
    const before = sim.world;

    // A command queued against the old world must not land on the new one — the same
    // reason `load` drains before swapping.
    sim.dispatch({ type: 'regenerate', seed: 99 });
    const fresh = createWorld(1234, { width: 32, height: 32, colonists: 2 });
    sim.install(fresh);

    expect(sim.world).toBe(fresh);
    expect(sim.world).not.toBe(before);

    sim.tick();
    expect(sim.world).toBe(fresh);
  });
});
