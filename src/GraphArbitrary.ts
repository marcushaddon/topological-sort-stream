import * as fc from "fast-check";
import { Commit } from "./TopologicalCommitStream";

export class Graph {
  private commits = new Map<string, Commit>();
  private _mainHead?: string;
  get mainHead(): string | undefined {
    return this._mainHead;
  }
  protected heads = new Set<string>();

  get size(): number {
    return this.commits.size;
  }

  public add(commit: Commit) {
    this.commits.set(commit.ref, commit);
    if (commit.metadata.main) {
      this._mainHead = commit.ref;
    }
    if (!commit.baseRef) {
      return;
    }
    // maybe remove heads
    if (commit.metadata.main) {
      this.heads.delete(commit.baseRef);
      if (commit.mergeRef) this.heads.delete(commit.mergeRef);
    } else if (
      !commit.mergeRef &&
      !this.commits.get(commit.baseRef)!.metadata.main
    ) {
      // all non main commits have baseRef
      this.heads.delete(commit.baseRef!);
    } // dont remove any heads for non main merges

    // maybe add head (all edits and main merges)
    if (!commit.mergeRef || commit.metadata.main) {
      this.heads.add(commit.ref);
    }
  }

  public get(ref: string): Commit | undefined {
    return this.commits.get(ref);
  }

  public shrinkOnce() {
    // choose random head, delete it from heads and from commits
    // add it's base and possibly mergeRef back to heads
    // BOTH contigent on there being no other commits
    // const headToRemove =
  }
}

export class CommitGraphArb extends fc.Arbitrary<Graph> {
  private refIdx = 0;
  constructor() {
    super();
  }

  generate(mrng: fc.Random, biasFactor: number | undefined): fc.Value<Graph> {
    const root: Commit = {
      ref: fc.string().generate(mrng, biasFactor).value,
      metadata: { main: true },
    };

    const graph = new Graph();
    graph.add(root);
    const heads = new Set<string>([root.ref]);

    // for random iterations, add commit such that graph is valid
    // commits can be to:
    // - advance main (keep track of main head)
    // - advance random branch
    // - merge branch, random main assignment
    for (let i = 0; i < mrng.nextInt(); i++) {
      const commit = this.addCommit(graph, heads, mrng);
      graph.add(commit);
    }

    return new fc.Value(graph, undefined);
  }

  private addCommit(graph: Graph, heads: Set<string>, mrng: fc.Random): Commit {
    // pick random head
    const idx = mrng.nextInt() % heads.size;
    const head = [...heads.values()][idx];
    const baseCommit = graph.get(head)!;

    const ref = this.makeRef();
    // if its main, advance it (random assignment of main)
    // if its not, either advance it or merge it (random assignment of main)
    const newCommit: Commit = baseCommit.metadata.main
      ? {
          ref,
          baseRef: baseCommit.ref,
          metadata: { main: mrng.nextDouble() > 0.8 },
        }
      : mrng.nextDouble() > 0.7
      ? {
          ref,
          baseRef: baseCommit.ref,
          metadata: { main: false },
        }
      : {
          ref,
          baseRef: graph.mainHead,
          mergeRef: baseCommit.ref,
          metadata: { main: mrng.nextDouble() > 0.5 },
        };

    return newCommit;
  }

  private makeRef() {
    return `${this.refIdx++}`;
  }

  canShrinkWithoutContext(value: unknown): value is Graph {
    // assure that value is graph and graph.size > 1 ?
    return false;
  }

  shrink(
    value: Graph,
    context: unknown | undefined
  ): fc.Stream<fc.Value<Graph>> {
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
