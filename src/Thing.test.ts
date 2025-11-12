// import * as fc from "fast-check";
import { TopologicalCommitStream } from "./TopologicalCommitStream";
import type { Commit } from "./TopologicalCommitStream";

// const refFn = () => {
//   let i = 0;
//   return () => `${i++}_ref`;
// };

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
    expect(firstRes[0].ref).toEqual(branch[1].ref);

    expect(thirdRes.length).toEqual(1);
    expect(thirdRes[0].ref).toEqual(branch[2].ref);
  });
});
