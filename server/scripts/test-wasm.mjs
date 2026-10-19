// Runs the whole server test suite on sqlite-wasm (the engine the browser build uses). A script rather than an inline
// `VAR=value vitest` so it also works on Windows.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENNOTE_TEST_DRIVER: 'wasm' },
});
process.exit(r.status ?? 1);
