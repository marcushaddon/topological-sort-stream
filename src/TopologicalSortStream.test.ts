// import * as fc from "fast-check";
import * as fc from "fast-check";
import { TopologicalSortStream } from "./TopologicalSortStream";
import type { DAGNode } from "./TopologicalSortStream";
import { DAGArb, FloatNode } from "./DAGArbitrary";

// this is mismatched with our graph arbitrary
// just because two nodes are strictly ordered as floats (1.2 < 3.6)
// doesnt mean they are ancestors in the graph, the way we are building it
// we would either need to walk the graph to validate
// we could uyse a
export const topologicallySorted = (nodes: FloatNode[]): boolean => {
  while (nodes.length > 0) {
    const first = nodes.shift()!;
    if (first.ancestors().length > 0) {
      return false;
    }

    for (const node of nodes) {
      node.removeAncestor(first.val);
    }
  }

  return true;
};

const nodeImpl = (testNode: {
  _id: string;
  _ancestors: string[];
}): DAGNode<string> => ({
  ...testNode,
  id() {
    return testNode._id;
  },
  ancestors() {
    return testNode._ancestors;
  },
  data: testNode._id,
});

export const makeBranch = ({
  name,
  length,
  base,
}: {
  name: string;
  length: number;
  base?: DAGNode<string>;
}): DAGNode<string>[] =>
  [...Array(length)].reduce((branch: DAGNode<string>[], _, n) => {
    const prev = branch.length === 0 ? base : branch[branch.length - 1];
    return [
      ...branch,
      nodeImpl({
        _id: `${name}${n}`,
        _ancestors: prev ? [prev.id()] : [],
      }),
    ];
  }, []);

export const makeMerge = (
  branch1: DAGNode<string>[],
  branch2: DAGNode<string>[]
): DAGNode<string> => {
  if (branch1.length === 0 || branch2.length === 0) {
    throw new Error("Cant merge empty branches");
  }

  const head1 = branch1[branch1.length - 1];
  const head2 = branch2[branch2.length - 1];

  return nodeImpl({
    _id: `merge(${head1.id()}+${head2.id()})`,
    _ancestors: [head1.id(), head2.id()],
  });
};

const newLocalOnlyStream = () =>
  new TopologicalSortStream(new Map(), async () => undefined);

describe("TopologicalSortStream", () => {
  it("linear events", async () => {
    const branch = makeBranch({
      name: "test",
      length: 3,
    });

    const stream = newLocalOnlyStream();
    const firstRes = await stream.write(branch[0]);
    const secondRes = await stream.write(branch[1]);
    const thirdRes = await stream.write(branch[2]);

    expect(firstRes.length).toEqual(1);
    expect(firstRes[0].id()).toEqual(branch[0].id());

    expect(secondRes.length).toEqual(1);
    expect(secondRes[0].id()).toEqual(branch[1].id());

    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].id()).toEqual(branch[2].id());
  });

  it("handles one out of order linear", async () => {
    const branch = makeBranch({
      name: "test",
      length: 3,
    });

    const stream = newLocalOnlyStream();
    const secondRes = await stream.write(branch[1]);

    // out of order!
    expect(secondRes.length).toEqual(0);

    const firstRes = await stream.write(branch[0]);

    expect(firstRes.length).toEqual(2);
    expect(firstRes[0].id()).toEqual(branch[0].id());
    expect(firstRes[1].id()).toEqual(branch[1].id());

    const thirdRes = await stream.write(branch[2]);

    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].id()).toEqual(branch[2].id());
  });

  it("handles out of order merge", async () => {
    const branch1 = makeBranch({
      name: "branch1",
      length: 3,
    });

    const root = branch1[1];

    const branch2 = makeBranch({
      name: "branch2",
      length: 2,
      base: root,
    });

    const mergeCommit = makeMerge(branch1, branch2);

    const stream = newLocalOnlyStream();
    await Promise.all(branch1.map((commit) => stream.write(commit)));

    const mergeRes = await stream.write(mergeCommit);
    expect(mergeRes.length).toEqual(0);

    // this is in order, but not enought to resolve the merge
    const branch2Res1 = await stream.write(branch2[0]);
    expect(branch2Res1.length).toEqual(1);

    const branch2Res2 = await stream.write(branch2[1]);
    expect(branch2Res2.length).toEqual(2);
    expect(branch2Res2[0].id()).toEqual(branch2[1].id());
    expect(branch2Res2[1].id()).toEqual(mergeCommit.id());
  });

  it("emits entire graph in topological order (no cache invalidation)", async () => {
    fc.assert(
      fc.asyncProperty(new DAGArb(), async (dag) => {
        const cache = new Map<string, FloatNode>();
        // ffr, i think we'll need to use scheduler.scheduleFunction in our mock fetch item
        // to test races with async fetching
        const fetchItem = jest
          .fn()
          .mockImplementation((id: string) => Promise.resolve(cache.get(id)));

        const uut = new TopologicalSortStream<FloatNode>(cache, fetchItem);

        const unorderedNodes = dag.nodesShuffled();
        const orderedNodes: FloatNode[] = [];

        for (let i = 0; i < unorderedNodes.length; i++) {
          const node = unorderedNodes[i];
          const orderedBatch = await uut.write(node);
          orderedNodes.push(...orderedBatch);
        }

        expect(orderedNodes.length).toEqual(dag.size);
        expect(topologicallySorted(orderedNodes)).toBeTruthy();
      }),
      {
        numRuns: 20,
      }
    );
  });
});
