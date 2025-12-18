import * as fc from "fast-check";
import { TopologicalSortStream } from "./TopologicalSortStream";
import type { DAGNode, NodeCache } from "./TopologicalSortStream";
import { DAGArb, IntNode } from "./DAGArbitrary";

export const topologicallySorted = (nodes: IntNode[]): boolean => {
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

export const joinBranches = (
  ...branches: DAGNode<string>[][]
): DAGNode<string> => {
  if (branches.length < 2) {
    throw new Error("Must join at least 2 branches");
  }
  if (branches.some((branch) => branch.length === 0)) {
    throw new Error("Cant join empty branches");
  }

  const heads = branches.map((branch) => branch[branch.length - 1]);

  const joinId = heads.map((head) => head.id()).join("+");
  return nodeImpl({
    _id: `merge(${joinId})`,
    _ancestors: heads.map((head) => head.id()),
  });
};

const newLocalOnlyStream = () =>
  new TopologicalSortStream(new Map(), async () => undefined);

class CacheWithInvalidation<T extends DAGNode<unknown>>
  implements NodeCache<T>
{
  private capacity: number;
  private cached = new Map<string, T>();
  private repo = new Map<string, T>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  public has(id: string) {
    return this.cached.has(id);
  }

  public delete(id: string) {
    return this.cached.delete(id);
  }

  public set(id: string, node: T) {
    this.cached.set(id, node);
    while (this.cached.size > this.capacity) {
      // SAFETY: as long as capacity is > 0, then size > capcity
      // ensures next entry is defined
      const oldest = this.cached.entries().next()!.value![1];
      this.cached.delete(oldest.id());
      this.repo.set(oldest.id(), oldest);
    }

    return this;
  }

  public getFromRepo(id: string): T | undefined {
    const res = this.repo.get(id);

    return res;
  }
}

// utilitiy for splitting items into batches of specified
// sizes given that sum(sizes) != items.length
const makeBatches = <T>(items: T[], sizes: number[]): T[][] => {
  let batchIdx = 0;
  let itemIdx = 0;
  const batches: T[][] = [];
  while (itemIdx < items.length) {
    const batchSize = sizes[batchIdx];
    batches.push(items.slice(itemIdx, itemIdx + batchSize));
    itemIdx += batchSize;
    batchIdx = (batchIdx + 1) % sizes.length;
  }

  return batches;
};

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

    // each write op immediately resolves to the input,
    // as they are in order
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

    // first write op is no longer orphaned
    expect(firstRes.length).toEqual(2);
    expect(firstRes[0].id()).toEqual(branch[0].id());
    expect(firstRes[1].id()).toEqual(branch[1].id());

    const thirdRes = await stream.write(branch[2]);

    // in order again
    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].id()).toEqual(branch[2].id());
  });

  it("handles out of order join", async () => {
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

    const join = joinBranches(branch1, branch2);

    const stream = newLocalOnlyStream();
    await Promise.all(branch1.map((node) => stream.write(node)));

    const mergeRes = await stream.write(join);
    // we don't have the nodes of the branch we are joining yet
    expect(mergeRes.length).toEqual(0);

    // this is in order, but not enought to resolve the join
    const branch2Res1 = await stream.write(branch2[0]);
    expect(branch2Res1.length).toEqual(1);

    const branch2Res2 = await stream.write(branch2[1]);
    // in order, AND recovers the join
    expect(branch2Res2.length).toEqual(2);
    expect(branch2Res2[0].id()).toEqual(branch2[1].id());
    expect(branch2Res2[1].id()).toEqual(join.id());
  });

  it("PROPERTY: emits entire graph in topological order (no cache invalidation, unscheduled)", async () => {
    await fc.assert(
      fc.asyncProperty(new DAGArb(), async (dag) => {
        // nodes are never evicted
        const cache = new Map<string, IntNode>();
        const fetchItem = jest
          .fn()
          .mockImplementation((id: string) => Promise.resolve(cache.get(id)));

        const uut = new TopologicalSortStream<IntNode>(cache, fetchItem);
        const orderedNodes: IntNode[] = [];

        // example usage where orderedNodes represents our 'sink'
        // that assumes topological order
        const writeInOrder = async (node: IntNode) => {
          const orderedBatch = await uut.write(node);
          orderedNodes.push(...orderedBatch);
        };

        const unorderedNodes = dag.nodesShuffled();

        // consumer writes without waiting for results
        await Promise.all(unorderedNodes.map((node) => writeInOrder(node)));

        expect(orderedNodes.length).toEqual(dag.size);
        expect(topologicallySorted(orderedNodes)).toBeTruthy();
      }),
      {
        numRuns: 20,
      }
    );
  });

  const topolgicalSortProperty = fc.asyncProperty(
    new DAGArb(),
    fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 50 }),
    fc.scheduler(),
    async (dag, batchSizes, s) => {
      const cache = new CacheWithInvalidation<IntNode>(10);

      const fetchItem = async (id: string) => {
        return cache.getFromRepo(id);
      };

      const fetchItemScheduled = (id: string) => s.schedule(fetchItem(id));

      const uut = new TopologicalSortStream<IntNode>(cache, fetchItemScheduled);

      const writeInOrder = async (node: IntNode) => {
        const orderedBatch = await uut.write(node);
        orderedNodes.push(...orderedBatch);
      };

      const unorderedNodes = dag.nodesShuffled();
      const orderedNodes: IntNode[] = [];

      const batches = makeBatches(unorderedNodes, batchSizes);

      for (const batch of batches) {
        for (const node of batch) {
          void writeInOrder(node);
        }

        // causes any fetchItem calls to resolve in order
        // unrelated to call order
        await s.waitIdle();
      }

      expect(orderedNodes.length).toEqual(dag.size);
      expect(topologicallySorted(orderedNodes)).toBeTruthy();
    }
  );

  it("emits entire graph in topological order (with cache invalidation, scheduling)", async () => {
    await fc.assert(topolgicalSortProperty, {
      numRuns: 20,
      endOnFailure: true,
    });
  });

  it("repro 1", async () => {
    await fc.assert(topolgicalSortProperty, {
      seed: -833764443,
      path: "5",
      endOnFailure: true,
    });
  });
});
