import * as fc from "fast-check";
import {
  printCommit,
  TopologicalSortStream2 as TopologicalSortStream,
} from "./CommitSortStream";
import type { Commit } from "./CommitSortStream";
import { CommitDAGArb } from "./CommitGraphArbitrary";

export const topologicallySorted = (commits: Commit[]): boolean => {
  const deleted = new Set<string>();
  while (commits.length > 0) {
    const first = commits.shift()!;
    const hasAncestors =
      (first.baseRef && !deleted.has(first.baseRef)) ||
      (first.mergeRef && !deleted.has(first.mergeRef));
    if (hasAncestors) {
      return false;
    }

    // TODO: replace with set of delete for speed
    deleted.add(first.ref);
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
        ref: `${name}_${n}`,
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

const newLookup = () => {
  const map = new Map<string, Commit>();

  return {
    map,
    lookup: async (ref: string) => map.get(ref),
    write: (commits: Commit[]) =>
      commits.forEach((commit) => map.set(commit.ref, commit)),
  };
};
const newLocalOnlyStream = () => {
  const { lookup, write } = newLookup();

  return {
    write,
    stream: new TopologicalSortStream(lookup),
  };
};

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

    const { write, stream } = newLocalOnlyStream();
    const firstRes = await stream.write(branch[0]);
    write(firstRes);
    const secondRes = await stream.write(branch[1]);
    write(secondRes);
    const thirdRes = await stream.write(branch[2]);
    write(thirdRes);

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

    const { write, stream } = newLocalOnlyStream();
    const secondRes = await stream.write(branch[1]);
    write(secondRes);

    // out of order!
    expect(secondRes.length).toEqual(0);
    expect(stream.currentOrphanCount()).toEqual(1);

    const firstRes = await stream.write(branch[0]);
    write(firstRes);

    // first write op is no longer orphaned
    expect(firstRes.length).toEqual(2);
    expect(firstRes[0].ref).toEqual(branch[0].ref);
    expect(firstRes[1].ref).toEqual(branch[1].ref);

    const thirdRes = await stream.write(branch[2]);

    // in order again
    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].ref).toEqual(branch[2].ref);
  });

  it("handles writing concurrent in order", async () => {
    const branch = makeBranch({
      name: "list",
      length: 2,
    });

    const store = new Map<string, Commit>();
    const lookup = async (ref: string) =>
      new Promise<Commit | undefined>((res) => res(store.get(ref)));
    const stream = new TopologicalSortStream(lookup);
    const writeAndForward = async (c: Commit) => {
      const res = await stream.write(c);
      for (const c of res) {
        store.set(c.ref, c);
      }
      return res;
    };

    const result = await Promise.all(branch.map(writeAndForward));
    // const result: Commit[][] = [];
    // for (const c of branch) {
    //   const res = await stream.write(c);
    //   result.push(res);
    //   write(res);
    // }

    expect(result.every((r) => r.length === 1)).toBeTruthy();
    expect(stream.currentOrphans.length).toEqual(0);
  });

  it("handles out of order merge", async () => {
    const branch1 = makeBranch({
      name: "branch-1",
      length: 3,
    });

    const root = branch1[1];

    const branch2 = makeBranch({
      name: "branch-2",
      length: 2,
      base: root,
    });

    const join = joinBranches(branch1, branch2);

    const { write, stream } = newLocalOnlyStream();
    const branch1Reses = await Promise.all(
      branch1.map((commit) => stream.write(commit)),
    );
    const branch1Res = branch1Reses.flatMap((c) => c);

    const mergeRes = await stream.write(join);
    write(mergeRes);
    // we don't have the commits of the branch we are joining yet
    expect(mergeRes.length).toEqual(0);

    // this is in order, but not enough to resolve the join
    const branch2Res1 = await stream.write(branch2[0]);
    write(branch2Res1);
    expect(branch2Res1.length).toEqual(1);

    const branch2Res2 = await stream.write(branch2[1]);
    write(branch2Res2);
    // in order, AND recovers the join
    expect(branch2Res2.length).toEqual(2);
    expect(branch2Res2[0].ref).toEqual(branch2[1].ref);
    expect(branch2Res2[1].ref).toEqual(join.ref);
    const inCallOrder = [
      ...branch1Res,
      ...mergeRes,
      ...branch2Res1,
      ...branch2Res2,
    ];
    console.log(inCallOrder.map((c) => printCommit(c)));
    expect(topologicallySorted([...inCallOrder])).toBeTruthy();
    expect(inCallOrder.length).toEqual(branch1.length + branch2.length + 1); // + 1 for the merge
  });

  const topSortPropertyWithOrderedPromises = fc.asyncProperty(
    new CommitDAGArb(),
    async (dag) => {
      // commits are never evicted
      const cache = new Map<string, Commit>();
      const fetchItem = (ref: string) => {
        return Promise.resolve(cache.get(ref));
      };

      const uut = new TopologicalSortStream(fetchItem);
      const orderedNodes: Commit[] = [];

      // example usage where orderedNodes represents our 'sink'
      // that assumes topological order.
      // NOTE: this test never flushes emitted commits anywhere the
      // lookup can find them, so it deliberately does NOT acknowledge
      // (hence "no cache invalidation"): the stream's internal cache is
      // the only record that a dep was already emitted. Acknowledging
      // here would drop that record before late-arriving children could
      // be satisfied, jailing them forever.
      const writeInOrder = async (commit: Commit) => {
        const orderedBatch = await uut.write(commit);
        orderedNodes.push(...orderedBatch);
      };

      const unorderedNodes = dag.commitsShuffled();

      // consumer writes without waiting for results
      await Promise.all(unorderedNodes.map((commit) => writeInOrder(commit)));

      expect(orderedNodes.length).toEqual(dag.size);
      expect(topologicallySorted(orderedNodes)).toBeTruthy();
    },
  );

  it("PROPERTY: outgoing topological order (no cache invalidation, unscheduled)", async () => {
    await fc.assert(topSortPropertyWithOrderedPromises, {
      numRuns: 1000,
    });
  });

  const topolgicalSortProperty = fc.asyncProperty(
    new CommitDAGArb(),
    fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 50 }),
    fc.scheduler(),
    async (dag, batchSizes, s) => {
      const downstream = new Map<string, Commit>();
      const fetchItem = async (ref: string) => {
        return downstream.get(ref);
      };
      const fetchItemScheduled = (id: string) => s.schedule(fetchItem(id));
      const flush = async (c: Commit) => downstream.set(c.ref, c);

      const flushScheduled = (c: Commit) => s.schedule(flush(c));
      const uut = new TopologicalSortStream(fetchItemScheduled);

      const orderedNodes: Commit[] = [];

      const write = async (c: Commit) => {
        const res = await uut.write(c);
        // Record emission order BEFORE the awaited flush: uut.write
        // resolves in topological order (serialized, children emitted in
        // their parent's batch), but awaiting flushScheduled lets the
        // scheduler complete a child's flush loop before its parent's,
        // which would invert orderedNodes. flush-then-ack still runs so
        // the stream's cache stays bounded.
        orderedNodes.push(...res);
        for (const commit of res) {
          await flushScheduled(commit);
          uut.acknowledge(commit.ref);
        }
      };

      const unorderedNodes = dag.commitsShuffled();

      const batches = makeBatches(unorderedNodes, batchSizes);

      let maxCacheSize = 0;
      let maxJailSize = 0;
      for (const batch of batches) {
        for (const commit of batch) {
          void write(commit);
          maxCacheSize = Math.max(maxCacheSize, uut.cacheSize());
          maxJailSize = Math.max(maxJailSize, uut.currentOrphans().length);
        }

        // causes any fetchItem calls to resolve in order
        // unrelated to call order
        await s.waitIdle();
      }

      const currentOrphans = uut.currentOrphans();
      expect(currentOrphans.length).toEqual(0);
      expect(orderedNodes.length).toEqual(dag.size);
      expect(topologicallySorted(orderedNodes)).toBeTruthy();
      console.log(
        `DAG size: ${dag.size}, max cache size: ${maxCacheSize}, max jail size: ${maxJailSize}`,
      );
    },
  );

  it("PROPERTY: outgoing topological order (with cache invalidation, scheduled promises)", async () => {
    await fc.assert(topolgicalSortProperty, {
      numRuns: 1000,
      endOnFailure: true,
    });
  });

  it("repro unscehduled", async () => {
    await fc.assert(topSortPropertyWithOrderedPromises, {
      seed: 351836540,
      path: "1",
      endOnFailure: true,
    });
  });
});
