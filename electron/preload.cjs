/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pageDockDesktop', Object.freeze({
  selectDirectory: () => ipcRenderer.invoke('pagedock:select-directory'),
  deepseekWeb: Object.freeze({
    open: () => ipcRenderer.invoke('pagedock:deepseek-web-open'),
    clearStoredSession: () => ipcRenderer.invoke('pagedock:deepseek-web-clear-session'),
    copyPrompt: (text) => ipcRenderer.invoke('pagedock:deepseek-web-copy-prompt', text),
    readClipboardOnUserAction: () => ipcRenderer.invoke('pagedock:deepseek-web-read-clipboard'),
  }),
}));
