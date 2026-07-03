import * as fc from "fast-check";
import { CommitDAGArb, CommitDAG } from "./CommitGraphArbitrary";
import { topologicallySorted } from "./CommitSortStream.test";
import { Commit } from "./CommitSortStream";
import { walkBaseRefs } from "./CommitGraphTools";

export const noCycles = (g: CommitDAG): boolean => {
  const adjacencies = g.getAdjacencies();
  const nodeIds = g.getRefs();
  while (nodeIds.length > 0) {
    const nextLeafIdx = nodeIds.findIndex((nodeId) => {
      const edges = adjacencies.get(nodeId);
      return !edges || edges.size === 0;
    });

    if (nextLeafIdx === -1) {
      return false;
    }

    const leafId = nodeIds[nextLeafIdx];
    adjacencies.delete(leafId);
    for (const edges of adjacencies.values()) {
      edges.delete(leafId);
    }
    nodeIds.splice(nextLeafIdx, 1);
  }

  return true;
};

export const monotonicMain = (g: CommitDAG): boolean => {
  let current = g.getMainHead();
  const mainBranch = g.getMainCommits();
  while (current) {
    mainBranch.delete(current);
    const base = g.getCommit(current)!;
    if (!base.main) {
      return false;
    }
    current = base.baseRef;
  }

  return mainBranch.size === 0;
};

export const mergeIsOk = (merge: Commit, g: CommitDAG): boolean => {
  // a self merge is a merge where the baseRef is also the baseRef of the mergeRef
  const base = g.getCommit(merge.baseRef!);
  const mergee = g.getCommit(merge.mergeRef!);
  const bothExist = !!base && !!mergee;
  if (!bothExist) {
    return false;
  }
  const oneIsMain = base?.main && !mergee?.main;
  if (!oneIsMain) {
    return false;
  }

  const mergeeResult = walkBaseRefs(mergee, g, (c) => c.main);
  if (mergeeResult?.path.some((c) => !c.main && !!c.mergeRef)) {
    return false;
  }
  const viableMergeRoot = walkBaseRefs(
    base,
    g,
    (c) => c.ref === mergeeResult?.commit.ref
  );

  return !!viableMergeRoot;
};

describe("DAGArb", () => {
  it("shuffles its nodes", () => {
    fc.property(new CommitDAGArb(), (dag) => {
      const shuffled = dag.commitsShuffled();
      return shuffled.length === dag.size && !topologicallySorted(shuffled);
    });
  });
  it.todo("is topologically sorted");
  it.todo("clones adjacencies correctly");

  it("does not create cycles", () => {
    fc.assert(
      fc.property(new CommitDAGArb(), (dag) => {
        expect(noCycles(dag)).toBeTruthy();
      }),
      { numRuns: 100, verbose: true }
    );
  });

  it("has monotonic main", () => {
    fc.assert(
      fc.property(new CommitDAGArb(), (dag) => {
        expect(monotonicMain(dag));
      }),
      {
        numRuns: 100,
      }
    );
  });

  it("does not contain invalid merges", () => {
    fc.assert(
      fc.property(new CommitDAGArb(), (dag) => {
        const merges = dag.filter((c) => !!c.mergeRef);
        console.log(`graph has ${merges.length} merges`);
        expect(merges.every((merge) => mergeIsOk(merge, dag)));
      })
    );
  });
});
