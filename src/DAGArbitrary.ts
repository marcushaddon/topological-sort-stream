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
  private nodeMap: Map<string, FloatNode>;
  private nodeOrder: FloatNode[];
  private shrinkStep: number;
  private shrinkIdx = 0;

  constructor(random: fc.Random, bias: number | undefined) {
    // generate
    const count = random.nextInt(1, 10_000);
    const nodes = new Array<FloatNode>(count);
    const maxVal = count * (bias ?? 1);
    for (let i = 0; i < count; i++) {
      const num = Math.floor(random.nextDouble() * maxVal);
      nodes[i] = new FloatNode(num);
    }

    nodes.sort((a, b) => (a.lt(b) ? -1 : 0));
    this.nodeOrder = nodes;
    this.nodeMap = new Map(this.nodeOrder.map((node) => [node.id(), node]));
    this.shrinkStep = random.nextInt();
  }

  get size(): number {
    return this.nodeOrder.length;
  }

  public shrinkOnce() {
    // remove node and all edges
    // we should find a wa
    this.shrinkIdx = (this.shrinkIdx + this.shrinkStep) % this.size;
    const toRemove = this.nodeOrder.splice(this.shrinkIdx, 1)![0];
    // safety: should always have length > 1 due to canShrinkWithoutContext
    this.nodeMap.delete(toRemove.id());
  }
}

export class DAGArb extends fc.Arbitrary<FloatDAG> {
  generate(
    mrng: fc.Random,
    biasFactor: number | undefined
  ): fc.Value<FloatDAG> {
    return new fc.Value(new FloatDAG(mrng, biasFactor), undefined);
  }

  canShrinkWithoutContext(value: unknown): value is FloatDAG {
    return false; // todo
  }

  shrink(
    value: FloatDAG,
    context: unknown | undefined
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
