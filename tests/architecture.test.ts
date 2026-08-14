/**
 * Enforcement rules 1 and 2, mechanically.
 *
 * ESLint checks the same things faster, but this is the authoritative gate: it runs
 * in CI, it can't be silenced with an inline disable comment, and it fails loudly
 * with the exact file and offending line.
 *
 * If you are here because this test is failing: the fix is to change the code, not
 * the rule. See CLAUDE.md for why these two constraints are load-bearing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM_DIR = join(ROOT, 'src', 'sim');
const SCENARIOS_DIR = join(ROOT, 'src', 'scenarios');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Comments legitimately *mention* the things we ban (this file's own header does),
 * so scanning has to look at code only. The `[^:]` guard keeps `https://` intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importSources(code: string): string[] {
  const pattern =
    /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];
  for (const match of code.matchAll(pattern)) {
    found.push(match[1] ?? match[2] ?? match[3]);
  }
  return found;
}

const FORBIDDEN_IMPORTS: ReadonlyArray<{ test: RegExp; why: string }> = [
  { test: /^pixi\.js(\/|$)/, why: 'the renderer' },
  { test: /^react(-dom)?(\/|$)/, why: 'UI framework' },
  { test: /^@(render|ui|app)\//, why: 'a presentation layer' },
  { test: /(^|\/)\.\.\/(render|ui|app|input)(\/|$)/, why: 'a presentation layer' },
  { test: /^\.\.\/\.\.\/(render|ui|app|input)(\/|$)/, why: 'a presentation layer' },
];

const simFiles = collectFiles(SIM_DIR);
const scenarioFiles = collectFiles(SCENARIOS_DIR);
const artFiles = collectFiles(join(ROOT, 'src', 'render', 'art'));

/** The layering rule, stated once so both the sim and the scenarios can be held to it. */
function expectNoPresentationImports(file: string, layer: string): void {
  const code = stripComments(readFileSync(file, 'utf8'));
  const violations = importSources(code).filter((source) =>
    FORBIDDEN_IMPORTS.some((rule) => rule.test.test(source)),
  );
  expect(violations, `${layer} must not import ${violations.join(', ')}`).toEqual([]);
}

describe('enforcement rule 1: src/sim is pure', () => {
  it('finds simulation sources to check', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  it.each(simFiles.map((f) => [relative(ROOT, f), f] as const))(
    '%s imports nothing from the presentation layers',
    (_label, file) => expectNoPresentationImports(file, 'sim/'),
  );

  it.each(simFiles.map((f) => [relative(ROOT, f), f] as const))(
    '%s touches no browser globals',
    (_label, file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      const globals = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator'];
      const found = globals.filter((g) => new RegExp(`\\b${g}\\s*[.\\[]`).test(code));
      expect(found, `sim/ must run headless; found ${found.join(', ')}`).toEqual([]);
    },
  );
});

/*
 * Scenarios sit between the two: they build worlds *for* the renderer to photograph, but
 * they build them out of `sim/` alone, so a scenario stays runnable in a headless test and
 * cannot start describing the world in terms of how it is drawn.
 *
 * Only the layering rule applies here. The rest of rule 1 is the simulation's alone — a
 * scenario is free to be as un-deterministic as it likes in principle; it just never is,
 * because everything it can reach for is.
 */
describe('src/scenarios builds worlds out of sim/ alone', () => {
  it('finds scenario sources to check', () => {
    expect(scenarioFiles.length).toBeGreaterThan(0);
  });

  it.each(scenarioFiles.map((f) => [relative(ROOT, f), f] as const))(
    '%s imports nothing from the presentation layers',
    (_label, file) => expectNoPresentationImports(file, 'scenarios/'),
  );
});

describe('enforcement rule 2: no unseeded randomness', () => {
  it.each(simFiles.map((f) => [relative(ROOT, f), f] as const))(
    '%s does not call Math.random()',
    (_label, file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(
        /Math\s*\.\s*random\s*\(/.test(code),
        'sim/ must draw from the seeded Rng in world state',
      ).toBe(false);
    },
  );

  /*
   * **`render/art` is outside enforcement rule 2 and held to it anyway**, which CLAUDE.md
   * has said since M12 with nothing enforcing it.
   *
   * Determinism here is not about save/load — it is about the harness. Art that redrew
   * differently on each run could not be asserted on, could not be diffed, and could not
   * be regenerated identically after a context loss, and every measurement in
   * `tests/art.test.ts` and every number in `art/report.json` rests on it. Seed a hash, as
   * `terrainArt` does per `(id, variant)` and `model/surface.ts` does per material.
   *
   * Only `render/art`, deliberately. The layers above it may legitimately want an unseeded
   * number for something that is not art — a jitter on a transition, say — and widening
   * this to all of `render/` would be asserting a rule nobody has stated.
   */
  it.each(artFiles.map((f) => [relative(ROOT, f), f] as const))(
    '%s does not call Math.random() either',
    (_label, file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(
        /Math\s*\.\s*random\s*\(/.test(code),
        'art must be reproducible — seed a hash, as terrainArt and surface.ts do',
      ).toBe(false);
    },
  );
});
