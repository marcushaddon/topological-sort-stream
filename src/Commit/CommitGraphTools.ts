import { Commit } from "./CommitSortStream";
import { CommitDAG } from "./CommitGraphArbitrary";

export const walkBaseRefs = (
  c: Commit,
  g: CommitDAG,
  pred: (c: Commit) => boolean
) => {
  const path: Commit[] = [];
  let current: string | undefined = c.ref;
  while (current) {
    const commit = g.getCommit(current);
    if (!commit) {
      throw new Error(`Could not find commit ${current}`);
    }

    if (pred(commit)) {
      return { commit, path };
    }
    current = commit.baseRef;
    path.push(commit);
  }

  return undefined;
};
