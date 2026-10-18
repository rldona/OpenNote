// Exposes a tiny, fixed API to the quick-note and settings windows. The main OpenNote window gets no preload API.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('opennote', {
  quickSave: (text: string) => ipcRenderer.invoke('quick:save', text) as Promise<void>,
  quickClose: () => ipcRenderer.invoke('quick:close') as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<unknown>,
  setShortcut: (accelerator: string) => ipcRenderer.invoke('settings:shortcut', accelerator) as Promise<{ ok: boolean; error?: string }>,
  chooseDataDir: () => ipcRenderer.invoke('settings:dataDir') as Promise<{ changed: boolean }>,
  closeSettings: () => ipcRenderer.invoke('settings:close') as Promise<void>,
});
