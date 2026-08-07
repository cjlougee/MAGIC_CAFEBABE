/**
 * "What is still needed here?"
 *
 * Shared by construction sites and workbenches, because loading a bench and delivering
 * to a blueprint are the same problem wearing different clothes: a list of required
 * materials, a record of what has arrived, and three questions about the gap between
 * them. Two implementations would eventually disagree about what "still needs two
 * stone" means, and the disagreement would show up as a colonist standing at a bench
 * doing nothing.
 *
 * A **ledger** is materials-on-hand indexed by `ItemDefId`, so a lookup is an array
 * index rather than a search. Dense rather than sparse: `ITEM_DEFS.length` is small,
 * and a flat array cannot develop a second opinion about a missing key.
 */

import { ITEM_DEFS, type ItemDefId } from '../defs/items';

/** A material and how much of it something wants. */
export interface MaterialNeed {
  readonly def: ItemDefId;
  readonly count: number;
}

/** A fresh, empty ledger. */
export function emptyLedger(): number[] {
  return new Array<number>(ITEM_DEFS.length).fill(0);
}

/** How much more of `item` is still wanted here. Zero when satisfied or unwanted. */
export function outstandingOf(
  ledger: readonly number[],
  needs: readonly MaterialNeed[],
  item: ItemDefId,
): number {
  const required = needs.find((need) => need.def === item);
  if (!required) return 0;
  return Math.max(0, required.count - ledger[item]);
}

/** True once everything has arrived and only labour remains. */
export function hasAllOf(ledger: readonly number[], needs: readonly MaterialNeed[]): boolean {
  return needs.every((need) => ledger[need.def] >= need.count);
}

/** Whatever is still short, for a giver to go looking for. */
export function missingOf(
  ledger: readonly number[],
  needs: readonly MaterialNeed[],
): ItemDefId[] {
  return needs.filter((need) => ledger[need.def] < need.count).map((need) => need.def);
}

/** Everything held, as drops. Used when a bill is cancelled or a bench comes down. */
export function ledgerContents(ledger: readonly number[]): MaterialNeed[] {
  const held: MaterialNeed[] = [];
  for (let def = 0; def < ledger.length; def++) {
    if (ledger[def] > 0) held.push({ def: def as ItemDefId, count: ledger[def] });
  }
  return held;
}
