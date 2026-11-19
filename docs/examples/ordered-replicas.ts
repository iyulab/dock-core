import { createWorkspace, parseWorkspace, serialize, tryApply, type Op, type Workspace } from '@iyulab/dock-core';

/** An operation after the ordering layer has given it its place in the one global order. */
interface Applied {
  seq: number;
  origin: string;
  op: Op;
}

/** What a copy needs to catch up: a stored snapshot (when its own state is older than the snapshot) and every operation after it. */
interface Catchup {
  snapshot: { seq: number; blob: string } | null;
  tail: Applied[];
}

/**
 * The ordering layer. It is the one place that decides the order: it numbers operations densely (1, 2, 3, ...), keeps
 * them until a snapshot covers them, and announces each one to every attached copy. It never looks inside an operation.
 */
class Sequencer {
  #seq = 0;
  #snapshot: { seq: number; blob: string } | null = null;
  #tail: Applied[] = [];
  readonly #copies = new Set<Replica>();
  /** Announcements the transport will lose, as `copy:seq` (a stand-in for a slow or restarting window). */
  readonly lose = new Set<string>();

  attach(copy: Replica): void {
    this.#copies.add(copy);
  }

  submit(origin: string, op: Op): void {
    const applied: Applied = { seq: ++this.#seq, origin, op: structuredClone(op) };
    this.#tail.push(applied);
    for (const copy of this.#copies) {
      if (!this.lose.has(`${copy.name}:${applied.seq}`)) copy.announce(applied);
    }
  }

  /** Any copy may report its state at its own sequence number. Operations up to that number need not be kept. */
  storeSnapshot(seq: number, blob: string): void {
    if (seq > this.#seq) throw new Error('a snapshot cannot come from the future');
    this.#snapshot = { seq, blob };
    this.#tail = this.#tail.filter((a) => a.seq > seq);
  }

  /** `after` is the last sequence number the copy has applied (0: nothing yet). */
  catchup(after: number): Catchup {
    if (this.#snapshot === null || after >= this.#snapshot.seq) {
      return { snapshot: null, tail: structuredClone(this.#tail.filter((a) => a.seq > after)) };
    }
    return { snapshot: this.#snapshot, tail: structuredClone(this.#tail) };
  }
}

/** One copy of the workspace, for example the one inside a window. It applies operations in order and never before. */
class Replica {
  workspace: Workspace = createWorkspace();
  seq = 0;
  resyncs = 0;
  readonly rejected: number[] = [];
  readonly name: string;
  readonly #sequencer: Sequencer;

  constructor(name: string, sequencer: Sequencer) {
    this.name = name;
    this.#sequencer = sequencer;
  }

  /** Sending is not applying: the copy that sends an operation applies it like everyone else, when its announcement arrives. */
  submit(op: Op): void {
    this.#sequencer.submit(this.name, op);
  }

  /** The transport hands over each announcement. */
  announce(applied: Applied): void {
    if (applied.seq <= this.seq) return; // already applied (a repeat)
    if (applied.seq > this.seq + 1) return this.catchUp(); // a gap: an announcement was lost
    this.#apply(applied);
  }

  /** Late join and recovery are the same step: ask for what is missing. */
  catchUp(): void {
    this.resyncs++;
    const { snapshot, tail } = this.#sequencer.catchup(this.seq);
    if (snapshot) {
      const parsed = parseWorkspace(snapshot.blob);
      if (!parsed.ok) throw new Error(`the stored snapshot cannot be restored: ${parsed.error.message}`);
      this.workspace = parsed.workspace;
      this.seq = snapshot.seq;
    }
    for (const applied of tail) this.#apply(applied);
  }

  #apply(applied: Applied): void {
    // The same operations in the same order give the same result everywhere, including the same refusals.
    const result = tryApply(this.workspace, applied.op);
    if (result.ok) this.workspace = result.workspace;
    else this.rejected.push(applied.seq);
    this.seq = applied.seq;
  }
}

const sequencer = new Sequencer();
const a = new Replica('a', sequencer);
const b = new Replica('b', sequencer);
sequencer.attach(a);
sequencer.attach(b);

// Operations carry the ids they create, so every copy creates the same ones.
a.submit({ type: 'add-root', root: 'main' }); // 1
a.submit({ type: 'add-panel', panel: { id: 'editor', title: 'Editor' }, to: { kind: 'root', root: 'main', ids: { group: 'g1' } } }); // 2
a.submit({
  type: 'add-panel',
  panel: { id: 'terminal', title: 'Terminal' },
  to: { kind: 'edge', group: 'g1', side: 'right', ids: { group: 'g2', split: 's1' } },
}); // 3
b.submit({ type: 'move-panel', panel: 'ghost', to: { kind: 'tabs', group: 'g1' } }); // 4: refused by every copy, identically

sequencer.lose.add('b:5'); // window b never hears about 5
a.submit({ type: 'detach', panel: 'terminal', root: 'side', ids: { group: 'g3' } }); // 5: the terminal moves to a new root
a.submit({ type: 'activate', panel: 'editor' }); // 6: b sees 6 right after 4, notices the gap and catches up

sequencer.storeSnapshot(a.seq, serialize(a.workspace)); // from now on 1..6 are not kept
a.submit({ type: 'add-panel', panel: { id: 'inspector', title: 'Inspector' }, to: { kind: 'tabs', group: 'g1' } }); // 7

const late = new Replica('late', sequencer); // a window that opens now: the snapshot at 6, then 7
sequencer.attach(late);
late.catchUp();

const same = serialize(a.workspace) === serialize(b.workspace) && serialize(a.workspace) === serialize(late.workspace);
console.log(
  JSON.stringify({
    same,
    seq: [a.seq, b.seq, late.seq],
    rejected: a.rejected,
    resyncs: { a: a.resyncs, b: b.resyncs, late: late.resyncs },
    roots: Object.keys(late.workspace.roots),
  }),
);
