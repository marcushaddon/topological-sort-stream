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
  private orphans: Map<string, Map<string, Commit>> = new Map<
    string,
    Map<string, Commit>
  >();
  private inProcessing = new Map<string, Commit>();

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
    if (!initialResult) {
      return [];
    }
    const result: Commit[] = [initialResult];

    const stack: Commit[] = [commit];
    while (stack.length > 0) {
      const current = stack.pop()!;
      // DING DING DING pt2, our children can be in processing!!!!!
      const orphanedChildren = [
        ...(this.orphans.get(current.ref)?.values() ?? []),
      ];
      const inProcessChildren = [...this.inProcessing.values()].filter(
        (commit) => ancestors(commit).includes(current.ref)
      );

      const combined = [...orphanedChildren, ...inProcessChildren];
      for (const child of combined) {
        const added = await this.writeSingle(child);
        if (added) {
          this.clearOrphan(current.ref, added);
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
    this.inProcessing.set(commit.ref, commit);
    const res = await this.writeSingleInner(commit);

    if (!this.inProcessing.has(commit.ref)) {
      // we have been liberated by another call while waiting for this promise
      // BUG: this results in emitting this commit a second time
      return commit;
    }
    switch (res.name) {
      case "success":
        this.commitCache.set(commit.ref, commit);
        break;
      case "missingDep":
        // HERE: there is a chance that we have already processed our missing dep,
        // and have been liberated from inProcessing!!!
        this.recordOrphan(res.dep, commit);
    }
    this.inProcessing.delete(commit.ref);

    return res.name === "success" ? commit : undefined;
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

    const ancestorInProcessing = deps.find((ref) => this.inProcessing.has(ref));
    if (ancestorInProcessing) {
      return missingDep(ancestorInProcessing);
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

  private recordOrphan(ancestorRef: string, commit: Commit) {
    if (this.orphans.has(ancestorRef)) {
      this.orphans.get(ancestorRef)!.set(commit.ref, commit);
    } else {
      this.orphans.set(
        ancestorRef,
        new Map<string, Commit>([[commit.ref, commit]])
      );
    }
  }

  private clearOrphan(ancestorRef: string, commit: Commit) {
    const dependency = this.orphans.get(ancestorRef);
    if (dependency) {
      dependency.delete(commit.ref);
    }
  }

  public currentOrphans(): string[] {
    return Array.from(this.orphans.values()).flatMap((orphans) =>
      Array.from(orphans.keys())
    );
  }
}
