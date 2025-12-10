import * as fc from "fast-check";
import { DAGArb, FloatDAG } from "./DAGArbitrary";

const noCycles = (g: FloatDAG): boolean => {
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
    // OH we need to filter out any adjacencies for the leaf. so any node where node -> leaf, needs to have leaf removed
    nodeIds.splice(nextLeafIdx, 1);
  }

  return true;
};

describe("DAGArb", () => {
  it("does not create cycles", () => {
    fc.assert(
      fc.property(new DAGArb(), (dag) => {
        expect(noCycles(dag)).toBeTruthy();
      }),
      { seed: -975978031, numRuns: 50 }
    );
  });
});
