export interface DAGNode<T> {
  id(): string;
  ancestors(): string[];
  data: T;
}

/**
 * TopologicalCommitStream allows you to write commits. If the
 * commit was in topological order, it will be returned in the result,
 * along with possibly other commits that had previously received
 * out of order. The result array will be in topoligical order.
 *
 * If the commit was not in topological order, the result will
 * be empty.
 */
export class TopologicalSortStream<T> {
  private nodeCache: Map<string, DAGNode<T>>;
  private fetchNode: (ref: string) => Promise<DAGNode<T> | undefined>;
  // reverse index of missing dep -> commit
  private orphans: Map<string, Map<string, DAGNode<T>>> = new Map<
    string,
    Map<string, DAGNode<T>>
  >();
  private inProcessing = new Set<string>();

  public constructor(
    itemCache: Map<string, DAGNode<T>> = new Map<string, DAGNode<T>>(),
    fetchItem: (id: string) => Promise<DAGNode<T> | undefined>
  ) {
    this.nodeCache = itemCache;
    this.fetchNode = fetchItem;
  }

  /**
   * TODO: wrap writeInner in try/finally to make sure always removed from processing
   */
  public async write(node: DAGNode<T>): Promise<DAGNode<T>[]> {
    const initialResult = await this.writeSingle(node);
    if (!initialResult) {
      return [];
    }
    const result: DAGNode<T>[] = [initialResult];

    const stack: DAGNode<T>[] = [node];
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

  private async writeSingle(
    commit: DAGNode<T>
  ): Promise<DAGNode<T> | undefined> {
    this.inProcessing.add(commit.id());
    const res = await this.writeSingleInner(commit);
    this.inProcessing.delete(commit.id());

    return res;
  }

  /**
   * Returns the commit if it is next in a valid top-sort.
   * Otherwise indexes it under the first missing ancestor
   */
  private async writeSingleInner(
    node: DAGNode<T>
  ): Promise<DAGNode<T> | undefined> {
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

  private recordOrphan(ancestorRef: string, commit: DAGNode<T>) {
    if (this.orphans.has(ancestorRef)) {
      this.orphans.get(ancestorRef)!.set(commit.id(), commit);
    } else {
      this.orphans.set(
        ancestorRef,
        new Map<string, DAGNode<T>>([[ancestorRef, commit]])
      );
    }
  }
}
