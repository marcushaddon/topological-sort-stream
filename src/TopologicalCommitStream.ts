export type Commit = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
};

/**
 * Commithing allows you to write edits. Edits can be based on other edits,
 * or merge two edits together. Edits form a DAG.
 *
 * We also need to send edits to subscribers, but subscribers
 * must only ever see edits in valid top-sort. Sometimes our subscribers
 * are unavailable.
 */
export class TopologicalCommitStream {
  private commitCache: Map<string, Commit>;
  private fetchCommit: (ref: string) => Promise<Commit | undefined>;
  // reverse index of missing dep -> commit
  private orphans: Map<string, Map<string, Commit>> = new Map<
    string,
    Map<string, Commit>
  >();
  private inProcessing = new Set<string>();

  public constructor(
    itemCache: Map<string, Commit> = new Map<string, Commit>(),
    fetchItem: (id: string) => Promise<Commit | undefined>
  ) {
    this.commitCache = itemCache;
    this.fetchCommit = fetchItem;
  }

  /**
   * TODO: method to try to write commit. If it succeeds, try to drain buffer into .write,
   * return all commits that were writable.
   */
  public async write(commit: Commit): Promise<Commit[]> {
    const initialResult = await this.writeSingle(commit);
    if (!initialResult) {
      return [];
    }
    const result: Commit[] = [initialResult];

    const stack: Commit[] = [commit];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = this.orphans.get(current.ref);
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

  private async writeSingle(commit: Commit): Promise<Commit | undefined> {
    this.inProcessing.add(commit.ref);
    const res = await this.writeSingleInner(commit);
    this.inProcessing.delete(commit.ref);

    return res;
  }

  /**
   * Returns the commit if it is next in a valid top-sort.
   * Otherwise indexes it under the first missing ancestor
   */
  private async writeSingleInner(commit: Commit): Promise<Commit | undefined> {
    if (!commit.baseRef) {
      this.commitCache.set(commit.ref, commit);
      return commit;
    }

    if (this.inProcessing.has(commit.baseRef)) {
      this.recordOrphan(commit.baseRef, commit);
      return;
    }

    if (commit.mergeRef && this.inProcessing.has(commit.mergeRef)) {
      this.recordOrphan(commit.mergeRef, commit);
      return;
    }

    const baseSeen = await this.hasSeen(commit.baseRef);
    if (!baseSeen) {
      this.recordOrphan(commit.baseRef, commit);
      return;
    }

    if (!commit.mergeRef) {
      this.commitCache.set(commit.ref, commit);
      return commit;
    }

    const mergeSeen = await this.hasSeen(commit.mergeRef);
    if (mergeSeen) {
      this.commitCache.set(commit.ref, commit);
      return commit;
    }

    this.recordOrphan(commit.mergeRef, commit);
    return;
  }

  private async hasSeen(ref: string) {
    if (this.commitCache.has(ref)) {
      return true;
    }

    // TODO: try/catch for actual errors
    const fetchedRes = await this.fetchCommit(ref);
    if (fetchedRes) {
      this.commitCache.set(fetchedRes.ref, fetchedRes);
      return true;
    }

    return false;
  }

  private recordOrphan(ancestorRef: string, commit: Commit) {
    if (this.orphans.has(ancestorRef)) {
      this.orphans.get(ancestorRef)!.set(commit.ref, commit);
    } else {
      this.orphans.set(
        ancestorRef,
        new Map<string, Commit>([[ancestorRef, commit]])
      );
    }
  }
}
