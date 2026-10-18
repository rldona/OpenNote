import { app, screen } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Settings {
  /** Where notes live. Defaults to ~/.opennote, the same folder the command line version uses. */
  dataDir?: string;
  quickNoteShortcut: string;
  /** Look for a new release once a day. On unless set to false. */
  autoUpdateCheck?: boolean;
  lastUpdateCheck?: number;
  windowState: WindowState;
}

export const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+N';

const defaults = (): Settings => ({
  quickNoteShortcut: DEFAULT_SHORTCUT,
  windowState: { width: 1280, height: 820, maximized: false },
});

const file = () => join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>;
    return { ...defaults(), ...raw, windowState: { ...defaults().windowState, ...raw.windowState } };
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: Settings): void {
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2));
  renameSync(tmp, file()); // atomic: a crash cannot leave half a settings file
}

/** OPENNOTE_DATA wins, then the saved folder, then ~/.opennote. */
export function resolveDataDir(settings: Settings): string {
  return process.env.OPENNOTE_DATA || settings.dataDir || join(homedir(), '.opennote');
}

/** Restores a saved window position only if it is still on a connected screen. */
export function visibleBounds(state: WindowState): { x?: number; y?: number; width: number; height: number } {
  const { x, y, width, height } = state;
  if (x === undefined || y === undefined) return { width, height };
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return x < b.x + b.width - 40 && x + width > b.x + 40 && y < b.y + b.height - 40 && y + 40 > b.y;
  });
  return onScreen ? { x, y, width, height } : { width, height };
}

export const isDir = (p: string) => existsSync(p);
