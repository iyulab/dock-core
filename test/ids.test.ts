import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { createIdSource, type IdEnvironment } from '../src/element/ids.ts';

/** A context without `randomUUID`, as a page served over plain http has: the fallback path. */
const insecure = (overrides: Partial<IdEnvironment> = {}): IdEnvironment => ({
  now: () => 1_700_000_000_000,
  crypto: { getRandomValues: (a) => webcrypto.getRandomValues(a) },
  random: () => Math.random(),
  ...overrides,
});

test('two windows that mint an id in the same millisecond do not collide without randomUUID', () => {
  // Each window is a separate JavaScript context: its own counter, and the same clock reading.
  const first = createIdSource(insecure());
  const second = createIdSource(insecure());
  assert.notEqual(first('group'), second('group'));
  assert.notEqual(first('split'), second('split'));
});

test('the fallback works where getRandomValues is missing too', () => {
  const draws = [0.1, 0.2, 0.3, 0.4];
  let i = 0;
  const a = createIdSource({ now: () => 5, random: () => draws[i++ % 2]! });
  const b = createIdSource({ now: () => 5, random: () => draws[2 + (i++ % 2)]! });
  assert.notEqual(a('group'), b('group'));
});

test('one source never repeats an id, even with a frozen clock', () => {
  const source = createIdSource(insecure({ now: () => 1 }));
  const seen = new Set(Array.from({ length: 500 }, () => source('group')));
  assert.equal(seen.size, 500);
});

test('ids are safe to use as identifiers and keep their kind', () => {
  const source = createIdSource(insecure());
  assert.match(source('group'), /^group-[a-zA-Z0-9_-]+$/);
  assert.match(source('split'), /^split-[a-zA-Z0-9_-]+$/);
  const uuid = createIdSource({ now: () => 1, crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' }, random: () => 0.5 });
  assert.equal(uuid('group'), 'group-11111111-2222-3333-4444-555555555555');
});
