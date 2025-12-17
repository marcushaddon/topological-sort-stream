import * as fc from "fast-check";
import { DAGArb, FloatDAG, FloatNode } from "./DAGArbitrary";
import { topologicallySorted } from "./TopologicalSortStream.test";

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

describe("FloatNode sanity check", () => {
  it("implements lt correctly", () => {
    fc.assert(
      fc.property(fc.float(), fc.float(), (numA, numB) => {
        const nodeA = new FloatNode(numA);
        const nodeB = new FloatNode(numB);

        return (
          (Math.abs(numA - numB) > 1 && nodeA.lt(nodeB)) ||
          nodeB.lt(nodeA) ||
          (!nodeA.lt(nodeB) && !nodeB.lt(nodeA))
        );
      })
    );
  });
});

describe("DAGArb", () => {
  it("shuffles its nodes", () => {
    fc.property(new DAGArb(), (dag) => {
      const shuffled = dag.nodesShuffled(1);
      return (
        shuffled.length === dag.size &&
        shuffled.some((node, n) => {
          return n < dag.size - 1 && shuffled[n + 1].lt(node);
        }) &&
        !topologicallySorted(shuffled)
      );
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
