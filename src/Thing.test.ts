// import * as fc from "fast-check";
import { TopologicalCommitStream } from "./TopologicalCommitStream";
import type { Commit } from "./TopologicalCommitStream";

export const makeBranch = ({
  name,
  length,
  base,
  main,
}: {
  name: string;
  length: number;
  base?: Commit;
  main?: boolean | undefined;
}): Commit[] =>
  [...Array(length)].reduce((branch: Commit[], _, n) => {
    const prev = branch.length === 0 ? base : branch[branch.length - 1];
    return [
      ...branch,
      {
        ref: `${name}${n}`,
        baseRef: prev?.ref,
        metadata: {
          message: `${name}-${n}`,
          main,
        },
      },
    ];
  }, []);

export const makeMerge = (branch1: Commit[], branch2: Commit[]): Commit => {
  if (branch1.length === 0 || branch2.length === 0) {
    throw new Error("Cant merge empty branches");
  }

  const head1 = branch1[branch1.length - 1];
  const head2 = branch2[branch2.length - 1];

  return {
    ref: `merge(${head1.ref}+${head2.ref})`,
    baseRef: head1.ref,
    mergeRef: head2.ref,
  };
};

const newLocalOnlyStream = () =>
  new TopologicalCommitStream(new Map(), async () => undefined);

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

    expect(firstRes.length).toEqual(2);
    expect(firstRes[0].ref).toEqual(branch[0].ref);
    expect(firstRes[1].ref).toEqual(branch[1].ref);

    const thirdRes = await stream.write(branch[2]);

    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].ref).toEqual(branch[2].ref);
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
    expect(branch2Res2[0].ref).toEqual(branch2[1].ref);
    expect(branch2Res2[1].ref).toEqual(mergeCommit.ref);
  });
});
