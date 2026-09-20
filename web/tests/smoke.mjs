/**
 * Renders every page of the ERP with a stub session and no network, to catch
 * broken imports and render-time errors across the whole UI.
 *
 *   npm run test -w web
 */
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, '.smoke-build.cjs');

console.log('\nVignan ERP — UI render smoke test\n');

await build({
  entryPoints: [path.join(here, 'smoke-entry.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  logLevel: 'error',
});

// Bundled as CommonJS: recharts is CJS and requires React dynamically.
const require_ = createRequire(import.meta.url);
const { run } = require_(outfile);
const { passed, failures } = run();

fs.rmSync(outfile, { force: true });

console.log(`  ${passed} renders succeeded`);
if (failures.length) {
  console.log(`  ${failures.length} failed:\n`);
  for (const failure of failures) console.log(`    - ${failure}`);
  console.log('');
  process.exit(1);
}
console.log('  0 failed\n');
