/**
 * Bringing an old save up to the current shape.
 *
 * There is nothing to migrate yet — version 1 is the first format. The machinery exists
 * anyway because the alternative is discovering you need it *after* shipping a save
 * format, at which point every existing colony is already unreadable.
 *
 * **Each step upgrades by exactly one version and never skips.** A chain of small,
 * individually-obvious transforms stays reviewable; one big "handle any old shape"
 * function does not.
 */

import { SAVE_VERSION, type SaveData } from './serialize';

export class SaveVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveVersionError';
  }
}

/** One step up the chain. Add one per format change; never edit an existing step. */
type MigrationStep = (save: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being upgraded *from*. */
const STEPS: Record<number, MigrationStep> = {
  // 1: (save) => ({ ...save, version: 2, /* the v2 change */ }),
};

/**
 * Validates and upgrades raw parsed JSON.
 *
 * Throws rather than guessing. A save from a *newer* build cannot be safely down-graded,
 * and silently loading it half-understood would corrupt a colony rather than refuse it.
 */
export function migrate(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaveVersionError('Save file is not an object');
  }

  let save = raw as Record<string, unknown>;
  const version = save.version;

  if (typeof version !== 'number') {
    throw new SaveVersionError('Save file has no version');
  }
  if (version > SAVE_VERSION) {
    throw new SaveVersionError(
      `Save is from a newer version (${version}); this build understands up to ${SAVE_VERSION}`,
    );
  }

  let current = version;
  while (current < SAVE_VERSION) {
    const step = STEPS[current];
    if (!step) {
      throw new SaveVersionError(`No migration from save version ${current}`);
    }
    save = step(save);
    current = save.version as number;
  }

  return save as unknown as SaveData;
}
