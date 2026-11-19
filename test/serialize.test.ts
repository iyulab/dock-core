import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspace, parseWorkspace, serialize, validateWorkspace, SCHEMA_VERSION } from '../src/index.ts';
import { layout, must, sample } from './helpers.ts';

const withParams = () =>
  must(sample(), { type: 'add-panel', panel: { id: 'pp', title: 'With params', params: { path: '/a/b', n: [1, 2, { x: null }] } }, to: { kind: 'root', root: 'B', ids: { group: 'gpp' } } });

test('a workspace survives serialization unchanged, from text or from a parsed value', () => {
  const ws = withParams();
  const text = serialize(ws);
  for (const input of [text, JSON.parse(text)]) {
    const r = parseWorkspace(input);
    assert.ok(r.ok);
    if (r.ok) assert.equal(serialize(r.workspace), text);
  }
});

test('an empty workspace round-trips', () => {
  const r = parseWorkspace(serialize(createWorkspace()));
  assert.ok(r.ok);
});

test('a valid workspace has no invariant violations', () => {
  assert.deepEqual(validateWorkspace(withParams()), []);
});

test('text that is not JSON is a syntax error, never a throw', () => {
  const r = parseWorkspace('{not json');
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.error.code, 'syntax');
});

test('a newer schema version is reported with both versions', () => {
  const r = parseWorkspace({ version: 3, roots: {}, panels: {} });
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.error.code, 'version');
    assert.match(r.error.message, new RegExp(`version 3 is newer than the supported version ${SCHEMA_VERSION}`));
  }
});

test('wrong shapes are reported with what is wrong', () => {
  for (const bad of [null, 5, [], { version: 'x' }, { version: 1 }, { version: 1, roots: {}, panels: [] }]) {
    const r = parseWorkspace(bad);
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.error.code, 'shape');
  }
  const r = parseWorkspace({
    version: 1,
    roots: { A: { id: 'A', node: { kind: 'tabs', id: 'g', panels: [1], active: 'x' } } },
    panels: { p: { id: 'p', title: 't', params: { f: () => 1 } } },
  });
  assert.ok(!r.ok);
  if (!r.ok) assert.ok((r.error.details?.length ?? 0) >= 2);
});

test('broken invariants are reported', () => {
  const dup = {
    version: 1,
    roots: { A: { id: 'A', node: { kind: 'split', id: 's', direction: 'row', sizes: [1, 1], children: [
      { kind: 'tabs', id: 'g1', panels: ['p'], active: 'p' },
      { kind: 'tabs', id: 'g2', panels: ['p'], active: 'p' },
    ] } } },
    panels: { p: { id: 'p', title: 'P' } },
  };
  const r = parseWorkspace(dup);
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.equal(r.error.code, 'invariant');
    assert.ok(r.error.details?.some((d) => d.includes('more than one place')));
  }
  const orphan = parseWorkspace({ version: 1, roots: {}, panels: { p: { id: 'p', title: 'P' } } });
  assert.ok(!orphan.ok);
  if (!orphan.ok) assert.ok(orphan.error.details?.some((d) => d.includes('not placed')));
  const unregistered = parseWorkspace({ version: 1, roots: { A: { id: 'A', node: { kind: 'tabs', id: 'g', panels: ['q'], active: 'q' } } }, panels: {} });
  assert.ok(!unregistered.ok);
});

test('a layout with an empty group is repaired by normalization instead of rejected', () => {
  const r = parseWorkspace({
    version: 1,
    roots: { A: { id: 'A', node: { kind: 'split', id: 's', direction: 'row', sizes: [1, 1], children: [
      { kind: 'tabs', id: 'g1', panels: ['p'], active: 'p' },
      { kind: 'tabs', id: 'g2', panels: [], active: 'none' },
    ] } } },
    panels: { p: { id: 'p', title: 'P' } },
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(layout(r.workspace, 'A'), '[p*]');
});

test('a failed restore does not touch the caller\'s object', () => {
  const input = { version: 1, roots: { A: { id: 'A', node: { kind: 'tabs', id: 'g', panels: [], active: 'x' } } }, panels: {} };
  const before = JSON.stringify(input);
  parseWorkspace(input);
  assert.equal(JSON.stringify(input), before);
});
