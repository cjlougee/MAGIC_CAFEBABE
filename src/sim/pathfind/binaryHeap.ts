/**
 * Min-heap over cell indices, keyed by f-score.
 *
 * A* spends most of its time picking the cheapest open node. A linear scan makes that
 * O(n) per step and turns pathfinding into the simulation's hot spot; a heap makes it
 * O(log n).
 *
 * Stores raw indices in a growable Int32Array rather than objects, so a search over a
 * few thousand cells allocates nothing and produces no garbage.
 */

export class BinaryHeap {
  private items: Int32Array;
  private count = 0;

  /** Scores are read from a caller-owned array, indexed by the values pushed. */
  constructor(
    private scores: Int32Array,
    capacity = 256,
  ) {
    this.items = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Points the heap at a new score array and empties it. */
  reset(scores: Int32Array): void {
    this.scores = scores;
    this.count = 0;
  }

  push(value: number): void {
    if (this.count === this.items.length) this.grow();
    this.items[this.count] = value;
    this.siftUp(this.count);
    this.count++;
  }

  /** Removes and returns the lowest-scoring value. Returns -1 when empty. */
  pop(): number {
    if (this.count === 0) return -1;
    const top = this.items[0];
    this.count--;
    if (this.count > 0) {
      this.items[0] = this.items[this.count];
      this.siftDown(0);
    }
    return top;
  }

  private grow(): void {
    const larger = new Int32Array(this.items.length * 2);
    larger.set(this.items);
    this.items = larger;
  }

  private siftUp(start: number): void {
    let index = start;
    const value = this.items[index];
    const score = this.scores[value];

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.scores[this.items[parent]] <= score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = value;
  }

  private siftDown(start: number): void {
    let index = start;
    const value = this.items[index];
    const score = this.scores[value];
    const half = this.count >> 1;

    while (index < half) {
      let child = index * 2 + 1;
      const right = child + 1;
      if (right < this.count && this.scores[this.items[right]] < this.scores[this.items[child]]) {
        child = right;
      }
      if (this.scores[this.items[child]] >= score) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = value;
  }
}
