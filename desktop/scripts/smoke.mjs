// Boots the real Electron app with a throw-away data folder and checks that the embedded server, the web UI,
// SQLite and full-text search work. Used locally and in CI (on Linux run it under xvfb-run).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
const data = mkdtempSync(join(tmpdir(), 'opennote-smoke-'));
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])];
const child = spawn(electron, args, {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, OPENNOTE_SMOKE: '1', OPENNOTE_DATA: data },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => { child.kill('SIGKILL'); }, 60_000);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  rmSync(data, { recursive: true, force: true });
  const ok = code === 0 && out.includes('SMOKE OK');
  console.log(out.split('\n').filter((l) => /SMOKE|Error|error/.test(l)).join('\n'));
  console.log(ok ? 'smoke test passed' : `smoke test FAILED (code ${code}, signal ${signal})`);
  process.exit(ok ? 0 : 1);
});
