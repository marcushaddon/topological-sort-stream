import * as fc from "fast-check";
import { Commit } from "./CommitSortStream";

// const MAX_SIZE = 10;

export class CommitDAG {
  private random: fc.Random;
  private allCommits = new Map<string, Commit>();
  private edits = new Set<string>();
  private mainBranch = new Set<string>();
  private mainMerges = new Set<string>();
  private nonMainMerges = new Set<string>();
  private editHeads = new Set<string>();
  private mainHead?: string;
  // set of commits with no children, for shrinking
  private frontier = new Set<string>();
  private adjacencies = new Map<string, Set<string>>();

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
    return Array.from(this.allCommits.values()).map((c) => c.ref);
  }

  constructor(random: fc.Random, _bias: number | undefined) {
    this.random = random;
    const count = 4; //random.nextInt(1, MAX_SIZE);

    // Q: how do we ensure we add commits in a top sort order?
    // just

    for (let i = 0; i < count; i++) {
      // if graph empty
      // add an edit, main = true
      if (this.size === 0) {
        this.addCommit({
          ref: this.nextRef(),
          main: true,
        });
        continue;
      }

      const nextRand = random.nextDouble();
      // TODO(marcus): dont waste iterations
      while (this.size < count) {
        if (nextRand < 0.25 && this.editHeads.size > 0) {
          this.maybeMergeHead();
        } else if (nextRand > 0.25 && this.editHeads.size > 0) {
          // advance edit head
          this.advanceEditHead();
        } else if (nextRand < 0.25) {
          this.maybeBranch();
        } else {
          // advance main
          this.advanceMain();
        }
      }

      // add an edit (maybe biased to advancing a head, but possibly on some random edit or main merge commit) (possibly marking main if base is main)
      // pick a random head and merging it into current main head, maybe marking main
      console.log("dbg");
    }
  }

  private advanceEditHead() {
    const baseRef = Array.from(this.editHeads)[
      Math.floor(this.random.nextDouble() * this.editHeads.size)
    ];
    const edit: Commit = {
      ref: this.nextRef(),
      baseRef,
      main: false,
    };
    this.addCommit(edit);
  }

  private advanceMain() {
    const commit: Commit = {
      ref: this.nextRef(),
      baseRef: this.mainHead,
      main: this.random.nextDouble() > 0.7,
    };

    this.addCommit(commit);
  }

  private maybeMergeHead() {
    // add merge
    const head = Array.from(this.editHeads)[
      Math.floor(this.random.nextDouble() * this.editHeads.size)
    ];

    const merge: Commit = {
      ref: this.nextRef(),
      baseRef: this.mainHead,
      mergeRef: head,
      main: this.random.nextDouble() > 0.7,
    };

    this.addCommit(merge);
  }

  private maybeBranch() {
    // add edit
    const baseRef = Array.from(this.edits)[
      Math.floor(this.random.nextDouble() * this.edits.size)
    ];
    const edit: Commit = {
      ref: this.nextRef(),
      baseRef,
      main: false,
    };
    this.addCommit(edit);
  }

  private addCommit(c: Commit) {
    this.allCommits.set(c.ref, c);
    // anytime we add any commit,
    // if an edit or main merge, remove its base from heads, add it to heads
    // add it to frontier, remove deps from frontier
    // if it is a merge, and is main, remove its mergeRef from heads
    if (c.baseRef) {
      this.frontier.delete(c.baseRef);
      this.frontier.add(c.ref);
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

    if (!c.mergeRef && !c.main) {
      this.editHeads.add(c.ref);
    }

    if (c.main) {
      this.mainHead = c.ref;
      this.mainBranch.add(c.ref);
    }
  }

  private nextRef(): string {
    return `${this.size}`;
  }

  private indexChild(parent: string, child: string) {
    const existing = this.adjacencies.get(parent);
    if (existing) {
      existing.add(child);
    } else {
      this.adjacencies.set(parent, new Set([child]));
    }
  }

  private removeCommit(ref: string) {
    const commit = this.getCommit(ref)!;
    this.allCommits.delete(ref);
    this.editHeads.delete(ref);
    this.mainMerges.delete(ref);
    this.nonMainMerges.delete(ref);
    this.mainBranch.delete(ref);
    this.edits.delete(ref);
    this.frontier.delete(ref);
    if (commit.baseRef && this.adjacencies.get(commit.baseRef)?.size) {
      // only add if no other comits depend on it
      this.frontier.add(commit.baseRef);
    }
    if (commit.mergeRef && this.adjacencies.get(commit.mergeRef)?.size) {
      // only add if no other commits depend on it
      this.frontier.add(commit.mergeRef);
    }

    if (ref === this.mainHead) {
      this.mainHead = commit.baseRef;
    }
  }

  public getMainHead() {
    return this.mainHead;
  }

  public getMainCommits() {
    return new Set<string>(Array.from(this.mainBranch.values()));
  }

  public getCommit(ref: string) {
    return this.allCommits.get(ref);
  }

  get size(): number {
    return this.allCommits.size;
  }

  public shrinkOnce() {
    // to shrink, we retreat the frontier
    const toRemove = Array.from(this.frontier)[
      Math.floor(this.random.nextDouble() * this.frontier.size)
    ];

    this.removeCommit(toRemove);
  }

  public commitsShuffled(): Commit[] {
    // returning 1 when a < b puts commits out of order
    // randomly decide whether to disorder commits, with
    // probability approaching 1 with bias
    return Array.from(this.allCommits.values()).sort(() => {
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
