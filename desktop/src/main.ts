/**
 * OpenNote desktop: runs the OpenNote server inside Electron's main process on a loopback port and shows the
 * web UI in a window. Notes never leave the computer.
 */
import {
  BrowserWindow, Menu, Tray, app, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, session, shell,
  type IpcMainInvokeEvent, type MenuItemConstructorOptions,
} from 'electron';
import { accessSync, chmodSync, constants, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '../../server/src/start.js';
import {
  bundlePath, checkForUpdate, downloadAsset, isTransientLocation, launchMacSwap, launchWindowsInstaller, macSwapScript, pickAsset, stageMacApp,
  type CheckResult, type Release,
} from './updater.js';
import { DEFAULT_SHORTCUT, loadSettings, resolveDataDir, saveSettings, visibleBounds, type Settings } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';
const PREFERRED_PORT = 37370; // keeps the origin (and so localStorage, notification permission) stable between launches
const REPO_URL = 'https://github.com/rldona/OpenNote';
const SMOKE = process.env.OPENNOTE_SMOKE === '1';
/** Google OAuth client (desktop type) baked in at build time by scripts/bundle.mjs; the environment can override it. */
declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;
const GOOGLE = {
  clientId: process.env.OPENNOTE_GOOGLE_CLIENT_ID || __GOOGLE_CLIENT_ID__,
  clientSecret: process.env.OPENNOTE_GOOGLE_CLIENT_SECRET || __GOOGLE_CLIENT_SECRET__,
};

// ------------------------------------------------------------------- text

const es = {
  file: 'Archivo', newNote: 'Nueva nota', quickNote: 'Nota rápida', search: 'Buscar', importEnex: 'Importar ENEX…',
  importFiles: 'Importar Markdown / HTML / zip…', settings: 'Ajustes…', view: 'Ver', help: 'Ayuda', github: 'OpenNote en GitHub',
  openFolder: 'Abrir carpeta de notas', show: 'Mostrar OpenNote', imported: 'Importadas {n} notas', importFailed: 'No se pudo importar',
  chooseFolder: 'Elige la carpeta de notas', restarting: 'OpenNote se reiniciará para usar la nueva carpeta.',
  restartNeeded: 'La variable OPENNOTE_DATA manda sobre este ajuste; cámbiala o quítala.', quit: 'Salir',
  checkUpdates: 'Buscar actualizaciones…', updateAvailable: 'Hay una nueva versión de OpenNote: {version}',
  updateDetail: 'Tienes la versión {current}. Tus notas no se tocan.', updateNow: 'Actualizar', cancel: 'Cancelar',
  upToDate: 'OpenNote está al día', upToDateDetail: 'Tienes la última versión ({current}).', updateCheckFailed: 'No se pudo buscar actualizaciones',
  updateFailed: 'No se pudo actualizar', openReleasePage: 'Abrir la página de descarga', close: 'Cerrar',
  downloading: 'Descargando actualización… {n}%', dmgOpened: 'He abierto el instalador. Arrastra OpenNote a Aplicaciones para terminar.',
  debOpened: 'He abierto el instalador de paquetes. Sigue sus pasos para terminar.',
} as const;
const en: Record<keyof typeof es, string> = {
  file: 'File', newNote: 'New note', quickNote: 'Quick note', search: 'Search', importEnex: 'Import ENEX…',
  importFiles: 'Import Markdown / HTML / zip…', settings: 'Settings…', view: 'View', help: 'Help', github: 'OpenNote on GitHub',
  openFolder: 'Open notes folder', show: 'Show OpenNote', imported: 'Imported {n} notes', importFailed: 'Import failed',
  chooseFolder: 'Choose the notes folder', restarting: 'OpenNote will restart to use the new folder.',
  restartNeeded: 'The OPENNOTE_DATA environment variable overrides this setting; change or remove it.', quit: 'Quit',
  checkUpdates: 'Check for updates…', updateAvailable: 'A new version of OpenNote is available: {version}',
  updateDetail: 'You have version {current}. Your notes are not touched.', updateNow: 'Update', cancel: 'Cancel',
  upToDate: 'OpenNote is up to date', upToDateDetail: 'You have the latest version ({current}).', updateCheckFailed: 'Could not check for updates',
  updateFailed: 'Could not update', openReleasePage: 'Open the download page', close: 'Close',
  downloading: 'Downloading update… {n}%', dmgOpened: 'I opened the installer. Drag OpenNote to Applications to finish.',
  debOpened: 'I opened the package installer. Follow its steps to finish.',
};
const tr = (key: keyof typeof es, vars: Record<string, string | number> = {}) =>
  (app.getLocale().toLowerCase().startsWith('es') ? es : en)[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

// ------------------------------------------------------------------ state

let settings: Settings;
let server: RunningServer;
let mainWindow: BrowserWindow | null = null;
let quickWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shortcutRegistered = false;
let updating = false;
/** Set once the user chose to update: runs after the app has closed its database and is about to exit. */
let pendingInstall: (() => void) | null = null;

const webDist = () => (app.isPackaged ? join(process.resourcesPath, 'web') : resolve(here, '../../web/dist'));
const appIcon = () => nativeImage.createFromPath(join(here, 'icon.png'));
const origin = () => new URL(server.url).origin;

/** Only web links and mail links ever leave the app, and only through the system browser. */
function openExternal(url: string): void {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) void shell.openExternal(u.toString());
  } catch {
    // not a URL: ignore
  }
}

/** Locks a window to its own content: other pages open in the browser, never inside the app. */
function lockNavigation(win: BrowserWindow, allowed: (url: string) => boolean): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

const runInMain = (js: string) => mainWindow?.webContents.executeJavaScript(js).catch(() => undefined);
const refreshMain = () => runInMain("window.dispatchEvent(new Event('focus'))");

// ---------------------------------------------------------------- windows

function createMainWindow(): BrowserWindow {
  const state = settings.windowState;
  const win = new BrowserWindow({
    ...visibleBounds(state),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'OpenNote',
    icon: appIcon(),
    // Same colour as the sidebar, so nothing flashes before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111413' : '#f6f7f5',
    // macOS: no separate title bar. The page draws under it and the window buttons sit on the sidebar, like one block.
    ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (isMac) {
    // The page adapts its top spacing and drag areas to this class (see "desktop-mac" in web/src/styles.css).
    const mark = (fullscreen: boolean) =>
      void win.webContents
        .executeJavaScript(`document.documentElement.classList.add('desktop-mac');document.documentElement.classList.toggle('desktop-fs',${fullscreen})`)
        .catch(() => undefined);
    win.webContents.on('did-finish-load', () => mark(win.isFullScreen()));
    win.on('enter-full-screen', () => mark(true));
    win.on('leave-full-screen', () => mark(false));
  }
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  lockNavigation(win, (url) => new URL(url).origin === origin());

  let timer: ReturnType<typeof setTimeout> | undefined;
  const remember = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const maximized = win.isMaximized();
      settings.windowState = { ...(maximized ? settings.windowState : win.getBounds()), maximized };
      saveSettings(settings);
    }, 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('closed', () => {
    mainWindow = null;
  });
  void win.loadURL(server.url);
  return win;
}

function showMainWindow(): void {
  if (!mainWindow) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function auxiliaryWindow(file: string, options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    icon: appIcon(),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  lockNavigation(win, () => false);
  void win.loadFile(join(here, 'static', file));
  return win;
}

function openQuickNote(): void {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    return;
  }
  quickWindow = auxiliaryWindow('quick.html', {
    width: 460, height: 300, alwaysOnTop: true, title: tr('quickNote'), minimizable: false, maximizable: false, fullscreenable: false,
  });
  quickWindow.on('closed', () => {
    quickWindow = null;
  });
}

function openSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) return void settingsWindow.focus();
  settingsWindow = auxiliaryWindow('settings.html', {
    width: 520, height: 600, title: 'OpenNote', minimizable: false, maximizable: false, fullscreenable: false, parent: mainWindow ?? undefined,
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// --------------------------------------------------------------- shortcuts

function registerQuickShortcut(accelerator: string): { ok: boolean; error?: string } {
  try {
    if (!globalShortcut.register(accelerator, openQuickNote)) {
      return { ok: false, error: 'This shortcut is taken by another app or not allowed by your desktop.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Not a valid shortcut. Example: CommandOrControl+Alt+N' };
  }
}

// -------------------------------------------------------------------- IPC

/** Only our own bundled pages (file://) in the window they belong to may use the IPC API. */
function fromWindow(event: IpcMainInvokeEvent, win: BrowserWindow | null): boolean {
  return !!win && !win.isDestroyed() && event.sender === win.webContents && (event.senderFrame?.url ?? '').startsWith('file://');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function setupIpc(): void {
  ipcMain.handle('quick:save', (event, text: unknown) => {
    if (!fromWindow(event, quickWindow) || typeof text !== 'string') throw new Error('not allowed');
    const lines = text.slice(0, 200_000).split(/\r?\n/);
    const first = lines.findIndex((l) => l.trim());
    const title = (lines[first] ?? '').trim().slice(0, 80) || tr('quickNote');
    const body = lines.slice(first + 1).map((l) => `<p>${escapeHtml(l)}</p>`).join('');
    server.store.createNote({ title, content: body });
    void refreshMain();
  });
  ipcMain.handle('quick:close', (event) => {
    if (fromWindow(event, quickWindow)) quickWindow?.close();
  });

  ipcMain.handle('settings:get', (event) => {
    if (!fromWindow(event, settingsWindow)) throw new Error('not allowed');
    return {
      dataDir: server.dataDir,
      quickNoteShortcut: settings.quickNoteShortcut,
      shortcutRegistered,
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      autoUpdateCheck: settings.autoUpdateCheck !== false,
      canUpdate: app.isPackaged,
    };
  });
  ipcMain.handle('settings:autoUpdate', (event, on: unknown) => {
    if (!fromWindow(event, settingsWindow) || typeof on !== 'boolean') throw new Error('not allowed');
    settings.autoUpdateCheck = on;
    saveSettings(settings);
  });
  ipcMain.handle('update:check', async (event) => {
    if (!fromWindow(event, settingsWindow)) throw new Error('not allowed');
    const r = await checkUpdates(true);
    return r.status === 'available' ? { status: r.status, version: r.release.version } : r.status === 'error' ? { status: r.status, message: r.message } : { status: r.status };
  });
  ipcMain.handle('settings:shortcut', (event, accelerator: unknown) => {
    if (!fromWindow(event, settingsWindow) || typeof accelerator !== 'string' || !accelerator || accelerator.length > 60) {
      return { ok: false, error: 'Not a valid shortcut' };
    }
    const previous = settings.quickNoteShortcut;
    globalShortcut.unregister(previous);
    const result = registerQuickShortcut(accelerator);
    if (result.ok) {
      settings.quickNoteShortcut = accelerator;
      shortcutRegistered = true;
      saveSettings(settings);
    } else {
      shortcutRegistered = registerQuickShortcut(previous).ok;
    }
    return result;
  });
  ipcMain.handle('settings:dataDir', async (event) => {
    if (!fromWindow(event, settingsWindow) || !settingsWindow) throw new Error('not allowed');
    if (process.env.OPENNOTE_DATA) {
      await dialog.showMessageBox(settingsWindow, { message: tr('restartNeeded') });
      return { changed: false };
    }
    const picked = await dialog.showOpenDialog(settingsWindow, {
      title: tr('chooseFolder'), properties: ['openDirectory', 'createDirectory'], defaultPath: server.dataDir,
    });
    if (picked.canceled || !picked.filePaths[0]) return { changed: false };
    settings.dataDir = picked.filePaths[0];
    saveSettings(settings);
    await dialog.showMessageBox(settingsWindow, { message: tr('restarting') });
    app.relaunch();
    app.quit();
    return { changed: true };
  });
  ipcMain.handle('settings:close', (event) => {
    if (fromWindow(event, settingsWindow)) settingsWindow?.close();
  });
}

// ---------------------------------------------------------------- updates

const DAY = 24 * 60 * 60 * 1000;
const dialogParent = () => BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
const showBox = (options: Electron.MessageBoxOptions) => {
  const parent = dialogParent();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};

/** Asks, in a modal window, whether to update now. Two buttons: update or cancel. */
async function offerUpdate(current: string, release: Release): Promise<void> {
  const notes = release.notes.trim().slice(0, 700);
  const { response } = await showBox({
    type: 'info',
    title: 'OpenNote',
    message: tr('updateAvailable', { version: release.version }),
    detail: `${tr('updateDetail', { current })}${notes ? `\n\n${notes}` : ''}`,
    buttons: [tr('updateNow'), tr('cancel')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) await installUpdate(release);
}

async function updateFailed(release: Release, err: unknown): Promise<void> {
  const { response } = await showBox({
    type: 'error',
    title: 'OpenNote',
    message: tr('updateFailed'),
    detail: err instanceof Error ? err.message : String(err),
    buttons: [tr('openReleasePage'), tr('close')],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) openExternal(release.pageUrl);
}

async function installUpdate(release: Release): Promise<void> {
  const asset = pickAsset(release, process.platform, process.arch);
  if (!asset || !app.isPackaged) return openExternal(release.pageUrl);
  if (updating) return;
  updating = true;
  const win = mainWindow;
  const title = win?.getTitle() ?? 'OpenNote';
  try {
    const dir = join(app.getPath('temp'), 'opennote-update');
    rmSync(dir, { recursive: true, force: true });
    const file = await downloadAsset(asset, dir, (f) => {
      win?.setProgressBar(f);
      win?.setTitle(`OpenNote — ${tr('downloading', { n: Math.round(f * 100) })}`);
    });
    win?.setProgressBar(-1);
    win?.setTitle(title);

    if (process.platform === 'darwin') {
      const bundle = bundlePath(app.getPath('exe'));
      let writable = false;
      try {
        if (bundle) {
          accessSync(dirname(bundle), constants.W_OK);
          accessSync(bundle, constants.W_OK);
          writable = true;
        }
      } catch {
        writable = false;
      }
      if (!bundle || !writable || isTransientLocation(bundle)) {
        // Cannot replace ourselves here (read-only location, or running from the disk image): hand over to the user.
        await shell.openPath(file);
        await showBox({ type: 'info', title: 'OpenNote', message: tr('dmgOpened'), buttons: [tr('close')] });
        return;
      }
      const staged = await stageMacApp(file, dir);
      const script = join(dir, 'swap.sh');
      writeFileSync(script, macSwapScript);
      chmodSync(script, 0o755);
      pendingInstall = () => launchMacSwap(script, process.pid, bundle, staged);
      app.quit();
    } else if (process.platform === 'win32') {
      pendingInstall = () => launchWindowsInstaller(file);
      app.quit();
    } else {
      await shell.openPath(file);
      await showBox({ type: 'info', title: 'OpenNote', message: tr('debOpened'), buttons: [tr('close')] });
    }
  } catch (err) {
    win?.setProgressBar(-1);
    win?.setTitle(title);
    pendingInstall = null;
    await updateFailed(release, err);
  } finally {
    updating = false;
  }
}

/** Looks for a newer release. `manual` also reports "up to date" and errors; the automatic check stays silent. */
async function checkUpdates(manual: boolean): Promise<CheckResult> {
  const result = await checkForUpdate(app.getVersion());
  settings.lastUpdateCheck = Date.now();
  saveSettings(settings);
  if (result.status === 'available') {
    await offerUpdate(result.current, result.release);
  } else if (manual && result.status === 'uptodate') {
    await showBox({ type: 'info', title: 'OpenNote', message: tr('upToDate'), detail: tr('upToDateDetail', { current: result.current }), buttons: [tr('close')] });
  } else if (manual && result.status === 'error') {
    await showBox({ type: 'warning', title: 'OpenNote', message: tr('updateCheckFailed'), detail: result.message, buttons: [tr('close')] });
  }
  return result;
}

/** Once a day at most, a little after start-up, unless the user turned it off. */
function scheduleUpdateCheck(): void {
  if (!app.isPackaged || SMOKE || settings.autoUpdateCheck === false) return;
  if (Date.now() - (settings.lastUpdateCheck ?? 0) < DAY) return;
  setTimeout(() => void checkUpdates(false), 20_000);
}

// ------------------------------------------------------------------- menu

async function importWith(kind: 'enex' | 'files'): Promise<void> {
  if (!mainWindow) return;
  const picked = await dialog.showOpenDialog(mainWindow, {
    properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: kind === 'enex'
      ? [{ name: 'Evernote export', extensions: ['enex', 'xml'] }]
      : [{ name: 'Markdown, HTML, zip', extensions: ['md', 'markdown', 'html', 'htm', 'zip'] }],
  });
  if (picked.canceled) return;
  let notes = 0;
  try {
    for (const file of picked.filePaths) {
      const name = file.split(/[\\/]/).pop() ?? 'Imported';
      const label = encodeURIComponent(kind === 'enex' ? name.replace(/\.[^.]+$/, '') : 'Imported');
      const url = kind === 'enex'
        ? `${server.url}/api/import/enex?notebook=${label}`
        : `${server.url}/api/import/markdown?notebook=${label}&filename=${encodeURIComponent(name)}`;
      const res = await fetch(url, { method: 'POST', body: readFileSync(file) });
      const data = (await res.json()) as { notes?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      notes += data.notes ?? 0;
    }
    await dialog.showMessageBox(mainWindow, { message: tr('imported', { n: notes }) });
    void refreshMain();
  } catch (err) {
    await dialog.showMessageBox(mainWindow, { type: 'error', message: tr('importFailed'), detail: (err as Error).message });
  }
}

function buildMenu(): void {
  const newNote = () => {
    showMainWindow();
    void runInMain("document.querySelector('.new-note')?.click()");
  };
  const focusSearch = () => {
    showMainWindow();
    void runInMain("document.querySelector('.search input')?.focus()");
  };
  const updatesItem: MenuItemConstructorOptions = { label: tr('checkUpdates'), click: () => void checkUpdates(true) };
  const settingsItem: MenuItemConstructorOptions = { label: tr('settings'), accelerator: 'CmdOrCtrl+,', click: openSettings };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' }, updatesItem, { type: 'separator' }, settingsItem, { type: 'separator' },
            { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
            { type: 'separator' }, { role: 'quit' },
          ],
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: tr('file'),
      submenu: [
        { label: tr('newNote'), accelerator: 'CmdOrCtrl+N', click: newNote },
        { label: tr('quickNote'), click: openQuickNote },
        { label: tr('search'), accelerator: 'CmdOrCtrl+F', click: focusSearch },
        { type: 'separator' },
        { label: tr('importEnex'), click: () => void importWith('enex') },
        { label: tr('importFiles'), click: () => void importWith('files') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' } as const] : [settingsItem, { type: 'separator' } as const, { role: 'quit' } as const]),
      ],
    },
    { role: 'editMenu' },
    {
      label: tr('view'),
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: tr('github'), click: () => openExternal(REPO_URL) },
        { label: tr('openFolder'), click: () => void shell.openPath(server.dataDir) },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'about' } as const]),
        ...(isMac ? [] : [updatesItem]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTray(): void {
  const size = isMac ? 18 : 20;
  tray = new Tray(appIcon().resize({ width: size, height: size }));
  tray.setToolTip('OpenNote');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr('show'), click: showMainWindow },
      { label: tr('quickNote'), click: openQuickNote },
      { label: tr('settings'), click: openSettings },
      { label: tr('checkUpdates'), click: () => void checkUpdates(true) },
      { type: 'separator' },
      { label: tr('quit'), click: () => app.quit() },
    ]),
  );
  tray.on('click', () => (mainWindow?.isVisible() && mainWindow.isFocused() ? mainWindow.hide() : showMainWindow()));
}

// ---------------------------------------------------------------- security

function lockDownSession(): void {
  const ses = session.defaultSession;
  // The local UI may show notifications (reminders), record audio notes and copy to the clipboard. Nothing else.
  const allowed = new Set(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen']);
  const isOurs = (url: string | undefined) => {
    try {
      return !!url && new URL(url).origin === origin();
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && isOurs(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(permission) && isOurs(requestingOrigin));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

// ------------------------------------------------------------------- start

async function smokeTest(): Promise<void> {
  try {
    const notebooks = await (await fetch(`${server.url}/api/notebooks`)).json();
    if (!Array.isArray(notebooks) || notebooks.length < 1) throw new Error('no notebooks');
    const html = await (await fetch(server.url)).text();
    if (!html.includes('id="root"')) throw new Error('web UI is not served');
    const note = server.store.createNote({ title: 'smoke', content: '<p>fts check</p>' });
    if (server.store.listNotes({ q: 'fts' })[0]?.id !== note.id) throw new Error('full-text search failed');
    console.log(`SMOKE OK ${process.platform}/${process.arch} electron ${process.versions.electron} node ${process.versions.node}`);
    quitting = true;
    await server.close();
    app.exit(0);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    app.exit(1);
  }
}

async function boot(): Promise<void> {
  settings = loadSettings();
  const options = { dataDir: resolveDataDir(settings), webDist: webDist(), lang: app.getLocale(), google: GOOGLE, log: console.warn };
  server = await startServer({ ...options, port: PREFERRED_PORT }).catch(() => startServer({ ...options, port: 0 }));

  lockDownSession();
  setupIpc();
  buildMenu();
  mainWindow = createMainWindow();
  if (!SMOKE) buildTray();
  const registered = registerQuickShortcut(settings.quickNoteShortcut);
  shortcutRegistered = registered.ok;
  if (!registered.ok) console.warn(`Quick note shortcut not registered: ${registered.error}`);
  if (SMOKE) void smokeTest();
  scheduleUpdateCheck();
}

app.setAppUserModelId('app.opennote.desktop');
app.setAboutPanelOptions({ applicationName: 'OpenNote', applicationVersion: app.getVersion(), copyright: 'MIT License', website: REPO_URL });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('activate', showMainWindow);
  // macOS keeps the app (and its tray icon) running without windows; elsewhere closing the window quits.
  app.on('window-all-closed', () => {
    if (!isMac && !quickWindow && !settingsWindow) app.quit();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // The database is closed by now, so the installer can replace the files.
    pendingInstall?.();
  });
  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    // Close the database cleanly first: on Windows SQLite keeps its files locked until then.
    event.preventDefault();
    quitting = true;
    void server.close().finally(() => app.quit());
  });
  void app.whenReady().then(boot).catch((err) => {
    console.error(err);
    dialog.showErrorBox('OpenNote', String(err instanceof Error ? err.message : err));
    app.exit(1);
  });
}

void DEFAULT_SHORTCUT;
