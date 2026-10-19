// Bundles the main process (including the OpenNote server and every dependency) and the preload script.
// Nothing needs node_modules at runtime, which keeps the installers small and the asar simple.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: { main: 'src/main.ts' },
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Google OAuth client for Drive sync (public for installed apps). Empty: the sync panel says it is not set up.
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.OPENNOTE_GOOGLE_CLIENT_ID ?? ''),
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.OPENNOTE_GOOGLE_CLIENT_SECRET ?? ''),
  },
  logLevel: 'info',
});

// Sandboxed preload scripts cannot be ES modules.
await build({
  entryPoints: { preload: 'src/preload.ts' },
  outfile: 'dist/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  logLevel: 'info',
});

await cp('static', 'dist/static', { recursive: true });
await cp('build/icon.png', 'dist/icon.png');
