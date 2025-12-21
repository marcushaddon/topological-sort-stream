import * as fc from "fast-check";
import { CommitDAGArb, CommitDAG } from "./CommitGraphArbitrary";
import { topologicallySorted } from "./CommitSortStream.test";

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
});
