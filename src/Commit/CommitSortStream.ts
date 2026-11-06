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
export class TopologicalSortStream2 {
  private lookup: (ref: string) => Promise<Commit | undefined>;
  // reverse index of missing dep -> commit

  private prison = new CommitJail();

  private tasks = new TaskSerializer<Commit, Commit[]>(
    this.writeInner.bind(this),
  );

  private passed = new Set<string>();
  // BOOKMARCUS: we need to also track 'in progress'
  // we also need to be careful once we are recovering children
  // from jail, keep in mind what the passed/inProgress/jail status of
  // the parent is based on the current status of the commit that started this
  // loop (and that we will need to also do another async lookup for those children
  // and during THAT, those childrens children could come it). Also note that
  // if we just 'recurse' while attempting to recover a child, if it sees that
  // the parent trying to recover it is in progress it will put itself back
  // in jail.
  // maybe write all states a commit can be in x the states its parent can be in x
  // the states it's child can be in and make a decision table like thing?

  private debug: boolean;

  public constructor(
    lookup: (ref: string) => Promise<Commit | undefined>,
    debug = false,
  ) {
    this.lookup = lookup;
    this.debug = debug;
  }

  private dbg(...args: any[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  public currentOrphans(): string[] {
    return this.prison.contents();
  }

  public currentOrphanCount(): number {
    return this.prison.size;
  }

  public acknowledge(ref: string) {
    this.passed.delete(ref);
    this.dbg(`Acknowledged ${ref}`);
  }

  public async write(commit: Commit): Promise<Commit[]> {
    this.dbg(`Enqueueing ${printCommit(commit)}`);
    const prom = this.tasks.add(commit);
    this.dbg(`Eqneue'd ${printCommit(commit)}`);
    return prom;
  }

  private async writeInner(commit: Commit): Promise<Commit[]> {
    this.dbg(`Writing ${printCommit(commit)}`);
    const initialRes = await this.writeSingle(commit);
    if (!initialRes) {
      this.dbg(`OUT OF ORDER ${printCommit(commit)}`);
      return [];
    }
    this.dbg(`IN ORDER: ${printCommit(commit)}`);

    const totalRes: Commit[] = [initialRes];
    const stack: Commit[] = [initialRes];
    while (stack.length > 0) {
      this.dbg(`Freeing children of ${printCommit(commit)}`);
      const next = stack.pop();
      const newlyFreed = this.prison.markResolved(next!.ref);
      if (newlyFreed.length > 0)
        this.dbg(`Freed ${newlyFreed.map((c) => c.ref)}`);
      totalRes.push(...newlyFreed);
      stack.push(...newlyFreed);
    }

    // Mark all results as processed BEFORE returning, so subsequent
    // writes in the TaskSerializer chain can find them
    for (const c of totalRes) {
      this.passed.add(c.ref);
    }

    return totalRes;
  }

  private async writeSingle(commit: Commit): Promise<Commit | undefined> {
    const commitDeps = deps(commit);

    if (commitDeps.length === 0) {
      return commit;
    }

    // Check which deps need external lookup (not already known to be processed)
    const needsLookup = commitDeps.filter((dep) => !this.passed.has(dep));

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
      this.dbg(`${printCommit(commit)} missing ${actuallyMissing}`);
      this.prison.add(commit, actuallyMissing);
      return undefined;
    }

    return commit;
  }

  public cacheSize() {
    return this.passed.size;
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
