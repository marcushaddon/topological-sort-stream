import {
  TopologicalSortStream,
  DAGNode,
  NodeCache,
} from "../Generic/TopologicalSortStream";
import { Commit, ancestors } from "./CommitSortStream";

export type CommitNode = DAGNode<Commit>;
export const toNode = (c: Commit): CommitNode => ({
  id: () => c.ref,
  ancestors: () => ancestors(c),
  data: c,
});

export const makeStream = (
  cache: NodeCache<CommitNode>,
  fetch: (ref: string) => Promise<CommitNode | undefined>
): TopologicalSortStream<CommitNode> => {
  return new TopologicalSortStream<CommitNode>(cache, fetch);
};
