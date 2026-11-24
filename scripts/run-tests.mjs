import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(rootDir, 'tests');
const outDir = path.join(rootDir, '.tmp-test-build');

const testFiles = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => path.join(testsDir, name));

if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

try {
  await esbuild.build({
    entryPoints: testFiles,
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outExtension: { '.js': '.mjs' },
    packages: 'external',
  });

  const builtFiles = readdirSync(outDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => path.join(outDir, name));

  const result = spawnSync(process.execPath, ['--test', ...builtFiles], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
