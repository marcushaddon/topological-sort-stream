import * as fc from "fast-check";
import { DAGArb, IntDAG } from "./DAGArbitrary";
import { topologicallySorted } from "./TopologicalSortStream.test";

const noCycles = (g: IntDAG): boolean => {
  const adjacencies = g.getAdjacencies();
  const nodeIds = g.getNodeIds();
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
    fc.property(new DAGArb(), (dag) => {
      const shuffled = dag.nodesShuffled();
      return shuffled.length === dag.size && !topologicallySorted(shuffled);
    });
  });
  it("will create branchs", () => {
    // are there conditions under which we MUST create branchs? can we make it so?
  });

  it("does not create cycles", () => {
    fc.assert(
      fc.property(new DAGArb(), (dag) => {
        expect(noCycles(dag)).toBeTruthy();
      }),
      { numRuns: 100, verbose: true }
    );
  });
});
