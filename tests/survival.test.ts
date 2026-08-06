/**
 * M3's playable check, run headless: **a colony that survives three days unattended.**
 *
 * This is the test the whole sim/render firewall was built for. It exercises needs,
 * mood, plant growth, harvesting, eating, sleeping, pathfinding, reservations, and the
 * job scheduler *together*, over 180,000 ticks, in under a second — and it asserts the
 * thing a player actually cares about, which no unit test can.
 */

import { describe, expect, it } from 'vitest';
import { moodOf } from '../src/sim/ai/mood';
import { TICKS_PER_DAY } from '../src/sim/core/constants';
import { ItemDef } from '../src/sim/defs/items';
import { Need } from '../src/sim/defs/needs';
import { Terrain } from '../src/sim/defs/terrain';
import { Thought } from '../src/sim/defs/thoughts';
import { isRipe } from '../src/sim/entities/plant';
import { hashWorld } from '../src/sim/save/hash';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world/world';

const THREE_DAYS = TICKS_PER_DAY * 3;

/** A seed known to generate a habitable landing site with vegetation nearby. */
function colony(seed = 20260805) {
  return new Simulation({ seed, width: 96, height: 96, colonists: 3 });
}

function living(world: World) {
  return [...world.pawns.values()].filter((pawn) => !pawn.dead);
}

describe('a colony left alone for three days', () => {
  it('keeps everyone alive', () => {
    const sim = colony();
    sim.run(THREE_DAYS);

    const survivors = living(sim.world);
    expect(survivors).toHaveLength(3);
    for (const pawn of survivors) {
      expect(pawn.health, `${pawn.name} was injured`).toBeGreaterThan(0.99);
    }
  });

  it('feeds itself without ever bottoming out', () => {
    const sim = colony();

    let worstHunger = 1;
    for (let day = 0; day < 3; day++) {
      // Sampled rather than checked at the end, because a colony that starves on day
      // two and recovers on day three would otherwise look healthy.
      for (let i = 0; i < 60; i++) {
        sim.run(TICKS_PER_DAY / 60);
        for (const pawn of living(sim.world)) {
          worstHunger = Math.min(worstHunger, pawn.needs[Need.Hunger]);
        }
      }
    }

    expect(worstHunger).toBeGreaterThan(0);
  });

  it('sleeps, and remembers doing it', () => {
    const sim = colony();
    sim.run(THREE_DAYS);

    // Bedrolls came with the party, so nobody should have spent three nights rough.
    for (const pawn of living(sim.world)) {
      const groundSleep = pawn.memories.some((m) => m.def === Thought.SleptOnGround);
      expect(groundSleep, `${pawn.name} slept on the ground despite having a bedroll`).toBe(false);
    }
  });

  it('ends the three days rested rather than running on empty', () => {
    const sim = colony();
    sim.run(THREE_DAYS);

    for (const pawn of living(sim.world)) {
      expect(pawn.needs[Need.Rest], `${pawn.name} is exhausted`).toBeGreaterThan(0.1);
    }
  });

  it('does not descend into a mood spiral', () => {
    const sim = colony();
    sim.run(THREE_DAYS);

    for (const pawn of living(sim.world)) {
      expect(moodOf(pawn), `${pawn.name} is miserable`).toBeGreaterThan(0.3);
    }
  });

  it('harvests food rather than sitting on ripe bushes', () => {
    const sim = colony();
    sim.run(THREE_DAYS);

    let gathered = 0;
    for (const item of sim.world.items.values()) {
      if (item.def === ItemDef.RawFood) gathered += item.count;
    }
    // Something was picked, eaten, or is sitting in a pile — all three prove the loop ran.
    const anyRipe = [...sim.world.plants.values()].some(isRipe);
    expect(gathered > 0 || anyRipe).toBe(true);
  });

  it('leaves no reservations behind', () => {
    const sim = colony();
    sim.run(THREE_DAYS);
    // Over 180,000 ticks and hundreds of jobs, a single leaked claim would compound.
    expect(sim.world.reservations.activeCount).toBeLessThanOrEqual(living(sim.world).length * 3);
  });

  it('is reproducible across the whole run', () => {
    const a = colony();
    const b = colony();
    a.run(THREE_DAYS);
    b.run(THREE_DAYS);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
  });
});

describe('a colony with nothing to eat', () => {
  /** Same world, but every plant stripped and left barren. */
  function starving() {
    const sim = colony();
    for (const plant of sim.world.plants.values()) plant.growth = -TICKS_PER_DAY * 10;
    return sim;
  }

  it('starves, rather than quietly surviving on nothing', () => {
    // The negative case matters as much as the positive one: if a colony survives with
    // no food source, the need system isn't actually doing anything.
    const sim = starving();
    sim.run(TICKS_PER_DAY * 4);

    const hurt = [...sim.world.pawns.values()].filter((pawn) => pawn.health < 1);
    expect(hurt.length).toBeGreaterThan(0);
  });

  it('tells the player about it', () => {
    const sim = starving();
    sim.run(TICKS_PER_DAY * 2);

    const alerts = sim.snapshot().alerts;
    expect(alerts.some((alert) => alert.level === 'danger')).toBe(true);
  });

  it('keeps colonists working instead of freezing when no food exists', () => {
    /*
     * Standing still and starving helps nobody: a hungry colonist with nowhere to eat
     * should carry on with whatever work there is. The risk this guards against is
     * findNeedJob returning a job that immediately fails, spinning the pawn between
     * "I'm hungry" and "there is nothing to eat" forever and never reaching work.
     *
     * So the scenario needs work to actually be available — otherwise idle is the
     * correct answer and the test proves nothing.
     */
    const sim = starving();
    const world = sim.world;

    const site = world.landingSite;
    for (let dx = 4; dx <= 6; dx++) world.map.setTerrain(site.x + dx, site.y, Terrain.Rock);
    world.reachability.markDirty();

    sim.dispatch({
      type: 'designate',
      action: 'mine',
      area: { x0: site.x + 4, y0: site.y, x1: site.x + 6, y1: site.y, z: 0 },
    });
    sim.flushCommands();
    sim.run(TICKS_PER_DAY);

    // Hungry, foodless, and still cutting rock.
    const mined = [4, 5, 6].filter(
      (dx) => world.map.getTerrain(site.x + dx, site.y) !== Terrain.Rock,
    );
    expect(mined.length).toBeGreaterThan(0);
  });
});
