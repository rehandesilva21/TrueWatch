// electron/preload.js
//
// Runs in an isolated context with access to both Node.js and the
// renderer's `window` object, but the renderer itself can never touch
// Node directly (contextIsolation: true in main.js enforces this). This
// file is the ONLY bridge between them, and it deliberately exposes the
// smallest possible surface: one flag and one on-demand query.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Lets the app detect "am I running inside the Electron shell right
  // now, or a plain browser tab" — used to decide whether to even
  // attempt the real-app-name lookup below.
  isElectron: true,

  // Fetches the CURRENTLY focused window/app fresh, right now — not a
  // cached value from a background poll. Call this at the moment a
  // blur/visibilitychange fires, not on a timer. Resolves to
  // { appName, windowTitle } for a genuine other application, or null
  // if the OS query is unavailable or the focused window is still our
  // own app (main.js filters that out before this ever resolves).
  getFocusedApp: () => ipcRenderer.invoke('truewatch:get-focused-app'),
});
