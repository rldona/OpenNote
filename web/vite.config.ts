import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const shim = (file: string) => fileURLToPath(new URL(`./src/standalone/shims/${file}`, import.meta.url));

/**
 * Two builds from the same sources:
 *  - default: the UI served by the local OpenNote server (CLI, desktop app);
 *  - `--mode standalone`: static files that run the whole app in the browser, no server (see src/standalone and
 *    docs/SYNC-BACKENDS.md). The server code is bundled into a worker, with browser stand-ins for the Node modules.
 *  - `--mode embed`: only the note editor (src/embed), for the WebView of the mobile apps (mobile/).
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  if (mode === 'embed') {
    // One classic script and one stylesheet next to src/embed/public/index.html: the iOS app loads the page from a file URL,
    // where module scripts are not allowed.
    return {
      publicDir: 'src/embed/public',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: 'dist-embed',
        target: 'es2020',
        cssCodeSplit: false,
        lib: { entry: 'src/embed/main.ts', formats: ['iife'], name: 'OpenNoteEmbed', fileName: () => 'embed.js', cssFileName: 'embed' },
      },
    };
  }
  return {
    plugins: [react()],
    base: standalone ? './' : '/',
    publicDir: standalone ? 'public-standalone' : 'public',
    define: { __STANDALONE__: JSON.stringify(standalone) },
    build: standalone ? { outDir: 'dist-standalone', target: 'es2022' } : {},
    worker: { format: 'es' as const },
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
    resolve: {
      alias: standalone
        ? [
            { find: /^node:crypto$/, replacement: shim('crypto.ts') },
            { find: /^node:(fs|fs\/promises|path|os|net|dns\/promises|child_process)$/, replacement: shim('node-stub.ts') },
          ]
        : [],
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: 'http://127.0.0.1:3737', changeOrigin: false } },
    },
  };
});
