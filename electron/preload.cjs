/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pageDockDesktop', Object.freeze({
  selectDirectory: () => ipcRenderer.invoke('pagedock:select-directory'),
}));
