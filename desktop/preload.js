/**
 * Preload bridge for the renderer (Settings folder picker, etc.).
 * Kept minimal: contextIsolation stays on; only expose what the UI needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myFitnessPlan', {
  /** Opens a native folder dialog; resolves to an absolute path or null if cancelled. */
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  /** Share on Local Network, the same switch as the tray's: read it, or turn it on/off. */
  sharing: {
    get: () => ipcRenderer.invoke('sharing-get'),
    set: (enabled) => ipcRenderer.invoke('sharing-set', Boolean(enabled)),
  },
});
