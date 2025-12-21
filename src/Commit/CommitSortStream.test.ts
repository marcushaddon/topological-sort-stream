import * as fc from "fast-check";
import { ancestors, TopologicalSortStream } from "./CommitSortStream";
import type { Commit, CommitCache } from "./CommitSortStream";
import { CommitDAGArb } from "./CommitGraphArbitrary";

export const topologicallySorted = (commits: Commit[]): boolean => {
  while (commits.length > 0) {
    const first = commits.shift()!;
    if (ancestors(first).length > 0) {
      return false;
    }

    for (const commit of commits) {
      if (commit.baseRef === first.ref) {
        commit.baseRef = undefined;
      }
      if (commit.mergeRef === first.ref) {
        commit.mergeRef = undefined;
      }
    }
  }

  return true;
};

export const makeBranch = ({
  name,
  length,
  base,
}: {
  name: string;
  length: number;
  base?: Commit;
}): Commit[] =>
  [...Array(length)].reduce((branch: Commit[], _, n) => {
    const prev = branch.length === 0 ? base : branch[branch.length - 1];
    return [
      ...branch,
      {
        ref: `${name}${n}`,
        baseRef: prev?.ref,
      },
    ];
  }, []);

export const joinBranches = (a: Commit[], b: Commit[]): Commit => {
  if ([a, b].some((branch) => branch.length === 0)) {
    throw new Error("Cant join empty branches");
  }

  const [aHead, bHead] = [a, b].map((branch) => branch[branch.length - 1]);

  const joinId = `${aHead.ref}+${bHead.ref}}`;

  return {
    ref: `merge(${joinId})`,
    baseRef: aHead.ref,
    mergeRef: bHead.ref,
    main: false,
  };
};

const newLocalOnlyStream = () =>
  new TopologicalSortStream(new Map(), async () => undefined);

class CacheWithInvalidation implements CommitCache {
  private capacity: number;
  private cached = new Map<string, Commit>();
  private repo = new Map<string, Commit>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  public has(id: string) {
    return this.cached.has(id);
  }

  public delete(id: string) {
    return this.cached.delete(id);
  }

  public set(id: string, node: Commit) {
    this.cached.set(id, node);
    while (this.cached.size > this.capacity) {
      // SAFETY: as long as capacity is > 0, then size > capcity
      // ensures next entry is defined
      const oldest = this.cached.entries().next()!.value![1];
      this.cached.delete(oldest.ref);
      this.repo.set(oldest.ref, oldest);
    }

    return this;
  }

  public getFromRepo(id: string): Commit | undefined {
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
    expect(firstRes[0].ref).toEqual(branch[0].ref);

    expect(secondRes.length).toEqual(1);
    expect(secondRes[0].ref).toEqual(branch[1].ref);

    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].ref).toEqual(branch[2].ref);
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
    expect(firstRes[0].ref).toEqual(branch[0].ref);
    expect(firstRes[1].ref).toEqual(branch[1].ref);

    const thirdRes = await stream.write(branch[2]);

    // in order again
    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].ref).toEqual(branch[2].ref);
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
    expect(branch2Res2[0].ref).toEqual(branch2[1].ref);
    expect(branch2Res2[1].ref).toEqual(join.ref);
  });

  it("PROPERTY: outgoing topological order (no cache invalidation, unscheduled)", async () => {
    await fc.assert(
      fc.asyncProperty(new CommitDAGArb(), async (dag) => {
        // nodes are never evicted
        const cache = new Map<string, Commit>();
        const fetchItem = jest
          .fn()
          .mockImplementation((id: string) => Promise.resolve(cache.get(id)));

        const uut = new TopologicalSortStream(cache, fetchItem);
        const orderedNodes: Commit[] = [];

        // example usage where orderedNodes represents our 'sink'
        // that assumes topological order
        const writeInOrder = async (node: Commit) => {
          const orderedBatch = await uut.write(node);
          orderedNodes.push(...orderedBatch);
        };

        const unorderedNodes = dag.commitsShuffled();

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
    new CommitDAGArb(),
    fc.integer({ min: 0, max: 1000 }),
    fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 50 }),
    fc.scheduler(),
    async (dag, cacheSize, batchSizes, s) => {
      const cache = new CacheWithInvalidation(cacheSize);

      const fetchItem = async (id: string) => {
        return cache.getFromRepo(id);
      };

      const fetchItemScheduled = (id: string) => s.schedule(fetchItem(id));

      const uut = new TopologicalSortStream(cache, fetchItemScheduled);

      const writeInOrder = async (node: Commit) => {
        const orderedBatch = await uut.write(node);
        orderedNodes.push(...orderedBatch);
      };

      const unorderedNodes = dag.commitsShuffled();
      const orderedNodes: Commit[] = [];

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

  it("PROPERTRY: outgoing topological order (with cache invalidation, scheduled promises)", async () => {
    await fc.assert(topolgicalSortProperty, {
      numRuns: 100,
      endOnFailure: true,
    });
  });

  /**
   * A case where the graph is a <- b.
   * The nodes are written b, a without awaiting, and
   * the call to `haveSeen(a)` (while processing b)
   * does not resolve until after a has already been written.
   */
  it("repro 1", async () => {
    await fc.assert(topolgicalSortProperty, {
      seed: -833764443,
      path: "5",
      endOnFailure: true,
    });
  });
});
