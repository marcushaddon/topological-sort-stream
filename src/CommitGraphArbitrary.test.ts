import * as fc from "fast-check";
import { CommitGraph, CommitGraphArb } from "./CommitGraphArbitrary";

/**
 * Bookmarking this for now. This will be useful for testing our
 * actual LC code, but our commit stream should work on *any* dag.
 */
const noCycles = (g: CommitGraph): boolean => {
  throw new Error("not implemented");
};
const monotonicMain = (g: CommitGraph): boolean => {
  throw new Error("not implemented");
};
const connected = (g: CommitGraph): boolean => {
  throw new Error("not implemented");
};
const monotonicMeetSemiLattice = (g: CommitGraph): boolean => {
  throw new Error("not implemented");
};

describe("GraphArbitrary", () => {
  fc.assert(
    fc.property(new CommitGraphArb(), (graph) => {
      expect(noCycles(graph)).toBeTruthy();
      expect(monotonicMain(graph)).toBeTruthy();
      expect(connected(graph)).toBeTruthy();
    })
  );
});
