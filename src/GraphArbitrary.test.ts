import * as fc from "fast-check";
import { Graph, CommitGraphArb } from "./GraphArbitrary";

const noCycles = (g: Graph): boolean => {};
const monotonicMain = (g: Graph): boolean => {};
const connected = (g: Graph): boolean => {};
const monotonicMeetSemiLattice = (g: Graph): boolean => {};

describe("GraphArbitrary", () => {
  fc.assert(fc.property(new CommitGraphArb(), (graph) => {}));
});
