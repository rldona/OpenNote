// Writes latest.json: the file the app's updater reads. Run by the release job after the installers are built:
//   node desktop/scripts/make-update-manifest.mjs <version> <folder with the installers> <release-notes.md> <output.json>
// The manifest lists each installer with its size and SHA-256, so the app can verify what it downloads.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildManifest(version, dir, notes) {
  const assets = readdirSync(dir)
    .filter((n) => /\.(dmg|exe|deb)$/.test(n))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      return { name, size: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
    });
  return { version, notes: notes.trim().slice(0, 4000), assets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [version, dir, notesFile, out] = process.argv.slice(2);
  if (!version || !dir || !notesFile || !out) throw new Error('usage: make-update-manifest.mjs <version> <dir> <notes.md> <out.json>');
  const manifest = buildManifest(version, dir, readFileSync(notesFile, 'utf8'));
  if (manifest.assets.length === 0) throw new Error(`no installers found in ${dir}`);
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`latest.json: ${manifest.version}, ${manifest.assets.length} installers`);
}
