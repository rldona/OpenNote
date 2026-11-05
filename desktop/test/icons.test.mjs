// The Linux .deb installs build/icons/NxN.png as hicolor/NxN/apps/opennote.png. hicolor only looks in the sizes it
// declares (up to 512x512), so the set must match them exactly and each file must really be that size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { HICOLOR_SIZES } from '../scripts/make-icons.mjs';

const dir = new URL('../build/icons/', import.meta.url);
const pngSize = (file) => {
  const bytes = readFileSync(new URL(file, dir));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test('the hicolor sizes are the ones the theme declares', () => {
  assert.deepEqual(HICOLOR_SIZES, [16, 22, 24, 32, 48, 64, 128, 256, 512]);
});

test('build/icons holds one PNG per hicolor size and nothing else', () => {
  assert.deepEqual(readdirSync(dir).sort(), HICOLOR_SIZES.map((n) => `${n}x${n}.png`).sort());
});

test('each PNG header declares the size in its file name', () => {
  for (const n of HICOLOR_SIZES) assert.deepEqual(pngSize(`${n}x${n}.png`), { width: n, height: n });
});
