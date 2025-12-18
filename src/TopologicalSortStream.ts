export interface DAGNode<T> {
  id(): string;
  ancestors(): string[];
  data: T;
}

export interface NodeCache<T extends DAGNode<unknown>> {
  set(id: string, node: T): NodeCache<T>;
  has(id: string): boolean;
  delete(id: string): void;
}

/**
 * TopologicalSortStream allows you to write nodes. If the
 * node was in topological order, it will be returned in the result,
 * along with possibly other nodes that had previously received
 * out of order. The result array will be in topoligical order.
 *
 * If the node was not in topological order, the result will
 * be empty.
 */
export class TopologicalSortStream<T extends DAGNode<unknown>> {
  private nodeCache: NodeCache<T>;
  private fetchNode: (ref: string) => Promise<T | undefined>;
  // reverse index of missing dep -> node
  private orphans: Map<string, Map<string, T>> = new Map<
    string,
    Map<string, T>
  >();
  private inProcessing = new Set<string>();

  public constructor(
    itemCache: NodeCache<T> = new Map<string, T>(),
    fetchItem: (id: string) => Promise<T | undefined>
  ) {
    this.nodeCache = itemCache;
    this.fetchNode = fetchItem;
  }

  /**
   * TODO: wrap writeInner in try/finally to make sure always removed from processing
   */
  public async write(node: T): Promise<T[]> {
    const initialResult = await this.writeSingle(node);
    if (!initialResult) {
      return [];
    }
    const result: T[] = [initialResult];

    const stack: T[] = [node];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = this.orphans.get(current.id());
      if (!children || children.size === 0) {
        continue;
      }
      for (const [, child] of children) {
        const added = await this.writeSingle(child);
        if (added) {
          // SAFETY: if we are adding this to the result,
          // the result already contains our ancestor
          result.push(added);
          stack.push(added);
        }
      }
    }

    return result;
  }

  private async writeSingle(node: T): Promise<T | undefined> {
    this.inProcessing.add(node.id());
    const res = await this.writeSingleInner(node);
    this.inProcessing.delete(node.id());

    return res;
  }

  /**
   * Returns the node if it is next in a valid top-sort.
   * Otherwise indexes it under the first missing ancestor
   */
  private async writeSingleInner(node: T): Promise<T | undefined> {
    const ancestors = node.ancestors();
    if (ancestors.length === 0) {
      this.nodeCache.set(node.id(), node);
      return node;
    }

    const ancestorInProcessing = ancestors.find((id) =>
      this.inProcessing.has(id)
    );
    if (ancestorInProcessing) {
      this.recordOrphan(ancestorInProcessing, node);
      return undefined;
    }

    let orphaned = false;
    for (const ancestor of ancestors) {
      const seen = await this.hasSeen(ancestor);
      if (!seen) {
        this.recordOrphan(ancestor, node);
        orphaned = true;
        break;
      }
    }

    if (orphaned) {
      return undefined;
    }

    this.nodeCache.set(node.id(), node);
    return node;
  }

  private async hasSeen(ref: string) {
    if (this.nodeCache.has(ref)) {
      return true;
    }

    // TODO: try/catch for actual errors
    const fetchedRes = await this.fetchNode(ref);
    if (fetchedRes) {
      this.nodeCache.set(fetchedRes.id(), fetchedRes);
      return true;
    }

    return false;
  }

  private recordOrphan(ancestorRef: string, node: T) {
    if (this.orphans.has(ancestorRef)) {
      this.orphans.get(ancestorRef)!.set(node.id(), node);
    } else {
      this.orphans.set(ancestorRef, new Map<string, T>([[ancestorRef, node]]));
    }
  }
}
