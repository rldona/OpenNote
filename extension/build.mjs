// Bundles the TypeScript sources into dist/, ready for "Load unpacked" (Chrome/Edge) or
// "Load Temporary Add-on" (Firefox, use dist-firefox/).
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';

const common = { bundle: true, format: 'iife', target: 'es2022', sourcemap: false, logLevel: 'info' };

for (const [dir, manifest] of [['dist', 'manifest.json'], ['dist-firefox', 'manifest.firefox.json']]) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await build({
    ...common,
    entryPoints: { background: 'src/background.ts', popup: 'src/popup.ts', content: 'src/content.ts' },
    outdir: dir,
  });
  await cp('static/popup.html', `${dir}/popup.html`);
  await cp('static/popup.css', `${dir}/popup.css`);
  await writeFile(`${dir}/manifest.json`, await readFile(`static/${manifest}`));
}
