// Builds the app for Vercel using the Build Output API:
//   - the Vite frontend becomes static files
//   - the Express app (server.ts) is bundled into one serverless function at /api
// WebSockets are not available on Vercel, so the frontend simply shows "disconnected".
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const out = path.join(root, '.vercel', 'output');
const funcDir = path.join(out, 'functions', 'api.func');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(funcDir, { recursive: true });

// 1. Frontend
execSync('npx vite build', { stdio: 'inherit' });
fs.cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true });

// 2. API function: bundle server.ts and its dependencies into a single file
await build({
  entryPoints: [path.join(root, 'server.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // vite is only used for the local dev server; ws's native add-ons are optional
  external: ['vite', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

fs.writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      maxDuration: 30,
    },
    null,
    2
  )
);
fs.writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));

// 3. Routing: /api/* -> function, everything else -> the SPA
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/api/(.*)', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2
  )
);

console.log('Vercel output ready in .vercel/output');
