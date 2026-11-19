import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Dependency policy as a test: the library has no runtime dependencies, and the development tooling is an explicit
 * allow-list. Anything else that appears in a manifest or the lockfile fails here, so it is a conscious decision.
 */
const read = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as Record<string, unknown>;

const ALLOWED_DEV = ['typescript', '@types/node'];
/** Packages the allowed tooling itself brings (TypeScript ships its compiler as per-platform packages; the Node typings need one types-only helper). */
const ALLOWED_LOCKED = [
  /^node_modules\/typescript$/,
  /^node_modules\/@typescript\/typescript-[a-z0-9-]+$/,
  /^node_modules\/@types\/node$/,
  /^node_modules\/undici-types$/,
];

test('there are no runtime dependencies', () => {
  const pkg = read('package.json');
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies']) {
    assert.equal(Object.keys((pkg[field] as object | undefined) ?? {}).length, 0, `${field} must stay empty`);
  }
});

test('development dependencies are limited to the allow-list', () => {
  const dev = Object.keys((read('package.json').devDependencies as object | undefined) ?? {});
  assert.deepEqual(dev.filter((d) => !ALLOWED_DEV.includes(d)), [], 'a new devDependency needs a decision first');
});

test('the lockfile contains nothing outside the allow-list', () => {
  const packages = Object.keys((read('package-lock.json').packages as Record<string, unknown>) ?? {}).filter((k) => k !== '');
  const unexpected = packages.filter((k) => !ALLOWED_LOCKED.some((re) => re.test(k)));
  assert.deepEqual(unexpected, []);
});
