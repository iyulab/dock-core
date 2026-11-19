// TypeScript rewrites relative `.ts` import specifiers in emitted JavaScript but not in declaration files.
// Consumers (older compilers, bundlers) expect `.js` there, so point declarations at the files they describe.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const specifier = /(\bfrom\s+['"]|\bimport\(\s*['"])(\.{1,2}\/[^'"]*)\.ts(['"])/g;

let changed = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.d.ts')) {
      const before = readFileSync(path, 'utf8');
      const after = before.replace(specifier, '$1$2.js$3');
      if (after !== before) {
        writeFileSync(path, after);
        changed++;
      }
    }
  }
};
walk(root);
console.log(`rewrote relative specifiers in ${changed} declaration file(s)`);
