export interface Commit {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  main: boolean;
}

const deps = (c: Commit): string[] =>
  c.baseRef && c.mergeRef
    ? [c.baseRef, c.mergeRef]
    : c.baseRef
      ? [c.baseRef]
      : [];

export const printCommit = (c: Commit) =>
  (c.mergeRef
    ? `${c.mergeRef}+${c.baseRef}->`
    : c.baseRef
      ? `${c.baseRef}->`
      : "|->") + c.ref;

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

export interface ITopologicalSortStream {
  write(commit: Commit): Promise<Commit[]>;
}

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
    lookupCommit: (ref: string) => Promise<Commit | undefined>,
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
        this.unresolvedCommits.values(),
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

//
export class TopologicalSortStream2 {
  private lookup: (ref: string) => Promise<Commit | undefined>;
  // reverse index of missing dep -> commit

  private prison = new CommitJail();

  private tasks = new TaskSerializer<Commit, Commit[]>(
    this.writeInner.bind(this),
  );

  // Track refs we've returned - bridges the gap between "stream processed it"
  // and "caller updated external lookup"
  private processed = new Set<string>();

  public constructor(lookup: (ref: string) => Promise<Commit | undefined>) {
    this.lookup = lookup;
  }

  public currentOrphans(): string[] {
    return this.prison.contents();
  }

  public async write(commit: Commit): Promise<Commit[]> {
    console.log(`Enqueueing ${printCommit(commit)}`);
    const prom = this.tasks.add(commit);
    console.log(`Eqneue'd ${printCommit(commit)}`);
    return prom;
  }

  private async writeInner(commit: Commit): Promise<Commit[]> {
    console.log(`Writing ${printCommit(commit)}`);
    const initialRes = await this.writeSingle(commit);
    if (!initialRes) {
      console.log(`OUT OF ORDER ${printCommit(commit)}`);
      return [];
    }
    console.log(`IN ORDER: ${printCommit(commit)}`);

    const totalRes: Commit[] = [initialRes];
    const stack: Commit[] = [initialRes];
    while (stack.length > 0) {
      console.log(`Freeing children of ${printCommit(commit)}`);
      const next = stack.pop();
      const newlyFreed = this.prison.markResolved(next!.ref);
      if (newlyFreed.length > 0)
        console.log(`Freed ${newlyFreed.map((c) => c.ref)}`);
      totalRes.push(...newlyFreed);
      stack.push(...newlyFreed);
    }

    // Mark all results as processed BEFORE returning, so subsequent
    // writes in the TaskSerializer chain can find them
    for (const c of totalRes) {
      this.processed.add(c.ref);
    }

    return totalRes;
  }

  private async writeSingle(commit: Commit): Promise<Commit | undefined> {
    const commitDeps = deps(commit);

    if (commitDeps.length === 0) {
      return commit;
    }

    // Check which deps need external lookup (not already known to be processed)
    const needsLookup = commitDeps.filter((dep) => !this.processed.has(dep));

    let actuallyMissing: string[] = [];

    if (needsLookup.length > 0) {
      const lookUpResults = await Promise.all(
        needsLookup.map((dep) => this.lookup(dep)),
      );

      actuallyMissing = needsLookup.filter(
        (dep) => !lookUpResults.find((res) => res?.ref === dep),
      );
    }

    if (actuallyMissing.length > 0) {
      console.log(`${printCommit(commit)} missing ${actuallyMissing}`);
      this.prison.add(commit, actuallyMissing);
      return undefined;
    }

    return commit;
  }
}

class TaskSerializer<T, R> {
  private processor: (item: T) => Promise<R>;
  private current: Promise<R> | undefined;
  constructor(processor: (item: T) => Promise<R>) {
    this.processor = processor;
  }

  public async add(item: T): Promise<R> {
    const next = this.current
      ? this.current.then(() => this.processor(item))
      : this.processor(item);
    this.current = next;

    return next;
  }
}

// class OrderedMap<T> {
//   private map = new Map<string, T>();

//   public set(key: string, item: T) {
//     return this.map.set(key, item);
//   }

//   public has(key: string) {
//     return this.map.has(key);
//   }

//   public delete(key: string) {
//     return this.map.delete(key);
//   }

//   public deleteMultiple(keys: string[]) {
//     for (const key of keys) {
//       this.delete(key);
//     }
//   }

//   public get size() {
//     return this.map.size;
//   }

//   public pop(): T | undefined {
//     if (this.size === 0) {
//       return undefined;
//     }
//     const items = [...this.map.entries()];
//     const [lastKey, lastVal] = items[items.length - 1];
//     this.delete(lastKey);

//     return lastVal;
//   }

//   public filter(pred: (item: T) => boolean): T[] {
//     return [...this.map.values()].filter(pred);
//   }

//   public keys(): string[] {
//     return [...this.map.keys()];
//   }

//   public values() {
//     return [...this.map.values()];
//   }
// }

class CommitJail {
  // commitRef -> missing baseRef, mergeRef
  private deps = new Map<string, string[]>();
  private prisoners = new Map<string, Commit>();

  public add(commit: Commit, deps: string[]) {
    this.deps.set(commit.ref, deps);
    this.prisoners.set(commit.ref, commit);
  }

  public markResolved(ref: string) {
    const freed: Commit[] = [];
    for (const [prisoner, deps] of this.deps) {
      const remaining = deps.filter((dep) => dep !== ref);
      if (remaining.length === 0) {
        // FREE ME
        freed.push(this.prisoners.get(prisoner)!);
        this.prisoners.delete(prisoner);
        this.deps.delete(prisoner);
        continue;
      }
      this.deps.set(prisoner, remaining);
    }

    return freed;
  }

  public contents() {
    return [...this.prisoners.keys()];
  }

  public get size() {
    return this.prisoners.size;
  }
}
