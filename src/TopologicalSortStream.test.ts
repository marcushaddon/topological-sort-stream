// import * as fc from "fast-check";
import { TopologicalSortStream } from "./TopologicalSortStream";
import type { DAGNode } from "./TopologicalSortStream";

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

describe("Thing", () => {
  it("happy path", async () => {
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
});
