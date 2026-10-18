// Regenerates docs/assets/cover.png (the repository cover / GitHub social preview, 1280x640).
//
//   1. start OpenNote with demo notes (any data folder) on port 3811
//   2. node_modules/.bin/electron docs/assets/make-cover.cjs http://localhost:3811
//
// It screenshots the real app (in English) and lays it out in cover.html.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const base = process.argv[2] ?? 'http://localhost:3811';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const html = join(__dirname, 'cover.html');

app.whenReady().then(async () => {
  try {
    // The cover window goes first and stays alive: it is a plain local page with no external resources.
    const win = new BrowserWindow({ width: 1280, height: 640, show: false, useContentSize: true });
    await win.loadFile(html);

    // The app itself, screenshotted in English at 1280x800.
    const appWin = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true });
    const notes = await (await fetch(`${base}/api/notes`)).json();
    const id = (notes.find((n) => n.pinned) ?? notes[0]).id;
    await appWin.loadURL(`${base}/?lang=en#/note/${id}`);
    await wait(2500);
    const shot = (await appWin.webContents.capturePage()).toPNG();

    await win.webContents.executeJavaScript(`document.getElementById('app').src = 'data:image/png;base64,${shot.toString('base64')}'; new Promise(r => setTimeout(r, 500))`);
    const image = await win.webContents.capturePage();
    const png = image.resize({ width: 1280, height: 640, quality: 'best' }).toPNG();
    writeFileSync(join(__dirname, 'cover.png'), png);
    console.log(`wrote docs/assets/cover.png (${(png.length / 1024).toFixed(0)} KB, 1280x640)`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
