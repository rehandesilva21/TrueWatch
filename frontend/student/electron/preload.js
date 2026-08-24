// electron/preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  isElectron: true,

  getFocusedApp: () => ipcRenderer.invoke('truewatch:get-focused-app'),
});
