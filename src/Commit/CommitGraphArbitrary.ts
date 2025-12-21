import * as fc from "fast-check";
import { Commit } from "./CommitSortStream";

const MAX_SIZE = 4000;

export class CommitDAG {
  private random: fc.Random;
  private edits = new Set<string>();
  private mainMerges = new Set<string>();
  private nonMainMerges = new Set<string>();
  private editHeads = new Set<string>();
  // for shrinking
  private frontier = new Set<string>();
  private adjacencies = new Map<string, Set<string>>();
  private topSortedCommits: Commit[] = [];

  // for 'cloning' adjacencies so topSort property can mutate it safely
  public getAdjacencies(): Map<string, Set<string>> {
    return new Map<string, Set<string>>(
      Array.from(this.adjacencies.entries()).map(([from, to]) => [
        from,
        new Set(Array.from(to.values())),
      ])
    );
  }

  public getRefs(): string[] {
    return this.topSortedCommits.map((commit) => commit.ref);
  }

  constructor(random: fc.Random, _bias: number | undefined) {
    this.random = random;
    const count = random.nextInt(1, MAX_SIZE);

    // Q: how do we ensure we add commits in a top sort order?
    // just

    for (let i = 0; i < count; i++) {
      // if graph empty
      // add an edit, main = true
      if (this.size === 0) {
        this.addCommit({
          ref: i.toString(),
          main: true,
        });
        continue;
      }
      throw new Error("BOOKMARK! IMPLEMENT THIS NEXT");
      // else choose from:
      // add an edit (maybe biased to advancing a head, but possibly on some random edit or main merge commit) (possibly marking main if base is main)
      // pick a random head and merging it into current main head, maybe marking main
    }
  }

  private addCommit(c: Commit) {
    // anytime we add any commit,
    // if an edit or main merge, remove its base from heads, add it to heads
    // add it to frontier, remove deps from frontier
    // if it is a merge, and is main, remove its mergeRef from heads
    if (c.baseRef) {
      this.frontier.delete(c.baseRef);
      this.indexChild(c.baseRef, c.ref);
    }
    if (c.mergeRef) {
      this.indexChild(c.mergeRef, c.ref);
      this.frontier.delete(c.mergeRef);
      if (c.main) {
        this.mainMerges.add(c.ref);
      } else {
        this.nonMainMerges.add(c.ref);
      }
    } else {
      this.edits.add(c.ref);
    }
    if (!c.mergeRef || (c.mergeRef && c.main)) {
      if (c.baseRef) this.editHeads.delete(c.baseRef);
    }
  }

  private indexChild(parent: string, child: string) {
    const existing = this.adjacencies.get(parent);
    if (existing) {
      existing.add(child);
    } else {
      this.adjacencies.set(parent, new Set([child]));
    }
  }

  //   private removeCommit(ref: string) {
  //     // pick random fronte
  //     throw new Error(`TODO: remote ${ref}`);
  //   }

  get size(): number {
    return this.editHeads.size + this.mainMerges.size + this.nonMainMerges.size;
  }

  public shrinkOnce() {
    // pick random frontier
  }

  public commitsShuffled(): Commit[] {
    // returning 1 when a < b puts commits out of order
    // randomly decide whether to disorder commits, with
    // probability approaching 1 with bias
    return [...this.topSortedCommits].sort(() => {
      // the result that will maybe result in these
      // two items being out of or in order
      return this.random.nextDouble() > 0.5 ? 1 : -1;
    });
  }
}

export class CommitDAGArb extends fc.Arbitrary<CommitDAG> {
  generate(
    mrng: fc.Random,
    biasFactor: number | undefined
  ): fc.Value<CommitDAG> {
    return new fc.Value(new CommitDAG(mrng, biasFactor), undefined);
  }

  canShrinkWithoutContext(value: unknown): value is CommitDAG {
    return value instanceof CommitDAG && value.size > 0;
  }

  shrink(
    value: CommitDAG,
    _context: unknown | undefined
  ): fc.Stream<fc.Value<CommitDAG>> {
    return new fc.Stream(
      (function* () {
        while (value.size > 1) {
          value.shrinkOnce();
          yield new fc.Value(value, undefined);
        }
      })()
    );
  }
}
