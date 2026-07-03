export interface Commit {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  main: boolean;
}

export const ancestors = (c: Commit): string[] => {
  const res: string[] = [];
  if (c.baseRef) {
    res.push(c.baseRef);
  }

  if (c.mergeRef) {
    res.push(c.mergeRef);
  }

  return res;
};

export interface CommitCache {
  set(ref: string, commit: Commit): CommitCache;
  has(ref: string): boolean;
  delete(ref: string): void;
}

type WriteResult =
  | {
      name: "success";
    }
  | {
      name: "missingDep";
      dep: string;
    };
const writeSuccess = (): WriteResult => ({ name: "success" });
const missingDep = (dep: string): WriteResult => ({ name: "missingDep", dep });

type WriteSingleResult =
  | { name: "success"; commit: Commit }
  | { name: "orphaned"; commit: Commit }
  | { name: "noop" };

/**
 * TopologicalSortStream allows you to write commits. If the
 * commit was in topological order, it will be returned in the result,
 * along with possibly other commits that had previously received
 * out of order. The result array will be in topoligical order.
 *
 * If the commit was not in topological order, the result will
 * be empty.
 */
export class TopologicalSortStream {
  private commitCache: CommitCache;
  private lookupCommit: (ref: string) => Promise<Commit | undefined>;
  // reverse index of missing dep -> commit
  private unresolvedCommits: Map<string, Commit> = new Map<string, Commit>();

  public constructor(
    itemCache: CommitCache = new Map<string, Commit>(),
    lookupCommit: (ref: string) => Promise<Commit | undefined>
  ) {
    this.commitCache = itemCache;
    this.lookupCommit = lookupCommit;
  }

  /**
   * TODO: wrap writeInner in try/finally to make sure always removed from processing
   */
  public async write(commit: Commit): Promise<Commit[]> {
    const initialResult = await this.writeSingle(commit);
    if (initialResult.name !== "success") {
      return [];
    }
    const result: Commit[] = [initialResult.commit];

    const stack: Commit[] = [commit];
    while (stack.length > 0) {
      const current = stack.pop()!;

      const orphanedChildren = Array.from(
        this.unresolvedCommits.values()
      ).filter((c) => ancestors(c).find((a) => a === current.ref));

      for (const child of orphanedChildren) {
        const childResult = await this.writeSingle(child);
        if (childResult.name === "success") {
          this.clearOrphan(childResult.commit);
          // SAFETY: if we are adding this to the result,
          // the result already contains our ancestor
          result.push(childResult.commit);
          stack.push(childResult.commit);
        }
        // If noop or orphaned, we don't add to result
      }
    }

    return result;
  }

  private async writeSingle(commit: Commit): Promise<WriteSingleResult> {
    this.recordOrphan(commit);
    const res = await this.writeSingleInner(commit);

    switch (res.name) {
      case "success":
        this.commitCache.set(commit.ref, commit);
        this.clearOrphan(commit);
        return { name: "success", commit };
      case "missingDep":
        return { name: "orphaned", commit };
    }
  }

  /**
   * Returns the commit if it is next in a valid top-sort.
   * Otherwise indexes it under the first missing ancestor
   */
  private async writeSingleInner(commit: Commit): Promise<WriteResult> {
    const deps = ancestors(commit);
    if (deps.length === 0) {
      // DING DING DING, we could have a child in processing
      return writeSuccess();
    }

    for (const ancestor of deps) {
      const seen = await this.hasSeen(ancestor);
      if (!seen) {
        return missingDep(ancestor);
      }
    }

    return writeSuccess();
  }

  private async hasSeen(ref: string) {
    if (this.commitCache.has(ref)) {
      return true;
    }

    // TODO: try/catch for actual errors
    const fetchedRes = await this.lookupCommit(ref);
    if (fetchedRes) {
      this.commitCache.set(fetchedRes.ref, fetchedRes);
      return true;
    }

    return false;
  }

  private recordOrphan(commit: Commit) {
    this.unresolvedCommits.set(commit.ref, commit);
  }

  private clearOrphan(commit: Commit) {
    this.unresolvedCommits.delete(commit.ref);
  }

  public currentOrphans(): string[] {
    return Array.from(this.unresolvedCommits.keys());
  }
}
