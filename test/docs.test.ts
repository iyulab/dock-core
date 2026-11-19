import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** The documentation is code a reader copies: it must be the files that are tested, and its links must lead somewhere. */
const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(repo, ...parts), 'utf8').replace(/\r\n/g, '\n');

test('every example file appears in docs/HOSTS.md exactly as it is tested', () => {
  const hosts = read('docs', 'HOSTS.md');
  const files = readdirSync(join(repo, 'docs', 'examples'));
  assert.ok(files.length >= 3, 'the examples HOSTS.md embeds are missing');
  for (const file of files) {
    assert.ok(hosts.includes(read('docs', 'examples', file).trimEnd()), `${file} differs from its copy in docs/HOSTS.md`);
  }
});

test('relative links in README.md and docs/*.md point at files that exist', () => {
  const docs = [join(repo, 'README.md'), ...readdirSync(join(repo, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join(repo, 'docs', f))];
  const missing: string[] = [];
  for (const doc of docs) {
    for (const m of readFileSync(doc, 'utf8').matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = m[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!existsSync(join(dirname(doc), target))) missing.push(`${doc.slice(repo.length)} -> ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});
