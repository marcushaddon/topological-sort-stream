import * as fc from "fast-check";
import { DAGNode } from "./TopologicalSortStream";

export class FloatNode implements DAGNode<number> {
  val: number;
  _ancestors = new Set<number>();

  constructor(val: number) {
    this.val = val;
  }

  get data() {
    return this.val;
  }

  public addAncestor(ancestor: number) {
    this._ancestors.add(ancestor);
  }

  public removeAncestor(ancestor: number) {
    this._ancestors.delete(ancestor);
  }

  public id() {
    return this.val.toString();
  }

  public ancestors(): string[] {
    return [...this._ancestors.values()].map((v) => v.toString());
  }

  public eq(other: FloatNode) {
    return other.val === this.val;
  }

  public lt(other: FloatNode) {
    return Math.trunc(this.val) < Math.trunc(other.val);
  }
}

export class FloatDAG {
  private bias: number;
  private random: fc.Random;
  private nodeMap: Map<string, FloatNode>;
  private topSortedNodes: FloatNode[];
  private shrinkStep: number;
  private shrinkIdx = 0;
  public maxVal: number;
  // mostly for testing the arb itself

  public getAdjacencies() {
    const outgoingEdges = new Map<string, Set<string>>();
    for (const toNode of this.topSortedNodes) {
      for (const fromNode of toNode.ancestors()) {
        outgoingEdges.set(
          fromNode,
          (outgoingEdges.get(fromNode) || new Set<string>()).add(
            toNode.val.toString()
          )
        );
      }
    }

    return outgoingEdges;
  }

  public getNodeIds(): string[] {
    return this.topSortedNodes.map((node) => node.id());
  }

  constructor(random: fc.Random, bias: number | undefined) {
    this.bias = bias || 1;
    this.random = random;
    const count = random.nextInt(1, 4000);
    const nodes = new Array<FloatNode>(count);
    this.maxVal = count * (bias ?? 1);
    for (let i = 0; i < count; i++) {
      const num = random.nextDouble() * this.maxVal;
      nodes[i] = new FloatNode(num);
    }

    nodes.sort((a, b) => (a.lt(b) ? -1 : 0));
    this.topSortedNodes = nodes;
    this.nodeMap = new Map(
      this.topSortedNodes.map((node) => [node.id(), node])
    );
    // my reasoning is that each time we shrink, we dont want to
    // just take something off the end or front, because we wont
    // be maximizing how far we can shrink (assuming it stops shrinking
    // as soon as it fails to repro, but that needs validating). This method
    // of shrinking is deterministic but less pathological than just
    // working from the front or back of the sort
    this.shrinkStep = Math.abs(random.nextInt());

    const IN_DEGREE_MAX = 5; // TODO: derive this from bias or something
    const OUT_DEGREE_MAX = 5; // same

    // how can we
    const connectionProbability = bias ?? OUT_DEGREE_MAX / count; // really guessing here
    for (let i = 0; i < count; i++) {
      const fromNode = this.topSortedNodes[i];
      // only create an edge a->b where a < b in top sort
      let outDegree = 0;
      for (let j = i + 1; j < count && outDegree < OUT_DEGREE_MAX; j++) {
        const toCandidate = this.topSortedNodes[j];
        const incomparable = !fromNode.lt(toCandidate);
        const inDegree = this.topSortedNodes[j].ancestors.length;
        if (
          incomparable &&
          inDegree < IN_DEGREE_MAX &&
          random.nextDouble() < connectionProbability
        ) {
          this.connect(this.topSortedNodes[i], this.topSortedNodes[j]);
          outDegree++;
        }
      }
    }
  }

  private connect(from: FloatNode, to: FloatNode) {
    to.addAncestor(from.val);
  }

  get size(): number {
    return this.nodeMap.size;
  }

  public shrinkOnce() {
    // remove node and all edges
    // we should find a wa
    this.shrinkIdx = (this.shrinkIdx + this.shrinkStep) % this.size;
    // safety: should always have length > 1 due to canShrinkWithoutContext
    const toRemove = this.topSortedNodes.splice(this.shrinkIdx, 1)![0];
    this.nodeMap.delete(toRemove.id());
    for (const remaining of this.topSortedNodes) {
      remaining.removeAncestor(toRemove.val);
    }
  }

  public nodesShuffled(bias = this.bias): FloatNode[] {
    // returning 1 when a < b puts nodes out of order
    // randomly decide whether to disorder nodes, with
    // probability approaching 1 with bias
    return [...this.topSortedNodes].sort((a, b) => {
      // the result that will maybe result in these
      // two items being out of or in order
      const [maybeSwapResult, maybeOrderResult] = a.lt(b) ? [1, -1] : [-1, 1];
      return this.random.nextDouble() < bias || true
        ? maybeSwapResult
        : maybeOrderResult;
    });
  }
}

export class DAGArb extends fc.Arbitrary<FloatDAG> {
  generate(
    mrng: fc.Random,
    biasFactor: number | undefined
  ): fc.Value<FloatDAG> {
    return new fc.Value(new FloatDAG(mrng, biasFactor), undefined);
  }

  canShrinkWithoutContext(_value: unknown): _value is FloatDAG {
    return false; // todo
  }

  shrink(
    value: FloatDAG,
    _context: unknown | undefined
  ): fc.Stream<fc.Value<FloatDAG>> {
    return new fc.Stream(
      (function* () {
        while (value.size > 1) {
          value.shrinkOnce();
          yield new fc.Value(value, undefined);
        }
      })()
    );
  }
}
