import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The package as a consumer gets it: packed, installed into an empty project, imported and type-checked there.
 * This is the contract the source tree cannot show (the source runs through type stripping; consumers do not).
 */
const repo = fileURLToPath(new URL('..', import.meta.url));
let work = '';
let project = '';

before(() => {
  work = mkdtempSync(join(tmpdir(), 'dock-core-pack-'));
  execSync('npm run build', { cwd: repo, stdio: 'pipe' });
  const out = execSync(`npm pack --json --ignore-scripts --pack-destination "${work}"`, { cwd: repo, encoding: 'utf8' });
  const tarball = (JSON.parse(out) as { filename: string }[])[0]!.filename;
  project = join(work, 'consumer');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  execSync(`npm install --offline --no-audit --no-fund --ignore-scripts "${join(work, tarball)}"`, { cwd: project, stdio: 'pipe' });
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

test('publishing builds first (prepack runs the build) and ships only the build output', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string>; files: string[] };
  assert.equal(pkg.scripts['prepack'], 'npm run build');
  assert.deepEqual(pkg.files, ['dist']);
});

test('the tarball ships the built package and nothing from the source tree', () => {
  const root = join(project, 'node_modules', '@iyulab', 'dock-core');
  const files = readdirSync(root).sort();
  assert.deepEqual(files, ['LICENSE', 'README.md', 'dist', 'package.json']);
});

test('an installed copy runs without type stripping and behaves like the source', () => {
  writeFileSync(
    join(project, 'run.mjs'),
    `import { createStore, createWorkspace, serialize } from '@iyulab/dock-core';
const s = createStore();
s.dispatch({ type: 'add-root', root: 'main' });
s.dispatch({ type: 'add-panel', panel: { id: 'a', title: 'A' }, to: { kind: 'root', root: 'main', ids: { group: 'g1' } } });
const r = s.dispatch({ type: 'activate', panel: 'ghost' });
console.log(JSON.stringify({ panels: Object.keys(s.getState().panels), rejected: r.ok === false && r.error.code, empty: serialize(createWorkspace()).length > 0 }));
`,
  );
  const out = execFileSync(process.execPath, ['--no-experimental-strip-types', 'run.mjs'], { cwd: project, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { panels: ['a'], rejected: 'unknown-panel', empty: true });
});

test('a consumer type-checks against the declarations, strictly and without skipLibCheck', () => {
  writeFileSync(
    join(project, 'use.ts'),
    `import { apply, createStore, createWorkspace, hitTest, type Op, type Workspace } from '@iyulab/dock-core';
const op: Op = { type: 'add-root', root: 'main' };
const ws: Workspace = apply(createWorkspace(), op);
const store = createStore(ws);
store.subscribe((state, change) => { const n: number = Object.keys(state.roots).length; void n; void change.kind; });
const hit = hitTest([], { x: 0, y: 0 });
void hit;
// @ts-expect-error unknown operation types are rejected at compile time
apply(ws, { type: 'nope' });
`,
  );
  writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022'], strict: true, skipLibCheck: false, noEmit: true, types: [] }, include: ['use.ts'] }),
  );
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: project, stdio: 'pipe' });
});

test('the element entry point type-checks for a consumer with DOM types, and the model entry needs none', () => {
  writeFileSync(
    join(project, 'element.ts'),
    `import { createStore } from '@iyulab/dock-core';
import { attachStore, defineDockRoot, type DockDragDetail, type DragSession } from '@iyulab/dock-core/element';
const Root = defineDockRoot();
const el = new Root();
el.root = 'main';
el.idSource = (kind) => kind + '-1';
const off: () => void = attachStore(el, createStore());
el.addEventListener('dock-drag', (e) => { const d = (e as CustomEvent<DockDragDetail>).detail; const s: DragSession = d.session; void s; });
off();
`,
  );
  writeFileSync(
    join(project, 'tsconfig.element.json'),
    JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], strict: true, skipLibCheck: false, noEmit: true, types: [] }, include: ['element.ts'] }),
  );
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.element.json'], { cwd: project, stdio: 'pipe' });
});

test('the examples in docs/ type-check strictly for a consumer, and the runnable examples print what HOSTS.md says', () => {
  const examples = join(repo, 'docs', 'examples');
  for (const file of ['ordered-replicas.ts', 'drag-relay.ts', 'unknown-panels.ts']) writeFileSync(join(project, file), readFileSync(join(examples, file), 'utf8'));
  writeFileSync(
    join(project, 'tsconfig.examples.json'),
    JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: [], allowImportingTsExtensions: false },
      include: ['ordered-replicas.ts', 'drag-relay.ts', 'unknown-panels.ts'],
    }),
  );
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.examples.json'], { cwd: project, stdio: 'pipe' });

  const out = execFileSync(process.execPath, ['ordered-replicas.ts'], { cwd: project, encoding: 'utf8' }).trim();
  const documented = /It prints `(\{[^`]+\})`/.exec(readFileSync(join(repo, 'docs', 'HOSTS.md'), 'utf8'))?.[1];
  assert.ok(documented, 'HOSTS.md must state what the example prints');
  assert.deepEqual(JSON.parse(out), JSON.parse(documented));
  assert.equal((JSON.parse(out) as { same: boolean }).same, true, 'the copies must end up equal');

  const recipe = execFileSync(process.execPath, ['unknown-panels.ts'], { cwd: project, encoding: 'utf8' }).trim();
  const documentedRecipe = /It prints `({"removed"[^`]+})`/.exec(readFileSync(join(repo, 'docs', 'HOSTS.md'), 'utf8'))?.[1];
  assert.ok(documentedRecipe, 'HOSTS.md must state what the unknown-panels example prints');
  assert.deepEqual(JSON.parse(recipe), JSON.parse(documentedRecipe));
});

test('the declarations never point at .ts files', () => {
  const dist = join(project, 'node_modules', '@iyulab', 'dock-core', 'dist');
  const bad: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|d\.ts)$/.test(e.name) && /from '\.{1,2}\/[^']*\.ts'/.test(readFileSync(p, 'utf8'))) bad.push(p.slice(dist.length));
    }
  };
  walk(dist);
  assert.deepEqual(bad, []);
});
