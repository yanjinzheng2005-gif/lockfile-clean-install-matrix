import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/cli-entry.js'],
  outfile: 'dist/cli.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  legalComments: 'none',
});

await build({
  entryPoints: ['src/action-entry.js'],
  outfile: 'dist/action.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  legalComments: 'none',
});

await chmod('dist/cli.cjs', 0o755);
