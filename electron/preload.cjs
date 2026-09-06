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
    sideChat: Object.freeze({
      open: (handoff) => ipcRenderer.invoke('pagedock:sidechat-open', handoff),
      showWebProvider: (providerId) => ipcRenderer.invoke('pagedock:sidechat-web-show', providerId),
      hideWebProvider: () => ipcRenderer.invoke('pagedock:sidechat-web-hide'),
      setWebViewBounds: (bounds) => ipcRenderer.send('pagedock:sidechat-web-bounds', bounds),
      copyText: (text) => ipcRenderer.invoke('pagedock:sidechat-copy-text', text),
      sourceJump: (request) => ipcRenderer.invoke('pagedock:sidechat-source-jump', request),
      onHandoff: (callback) => {
        const listener = (_event, handoff) => callback(handoff);
        ipcRenderer.on('pagedock:sidechat-handoff', listener);
        return () => ipcRenderer.removeListener('pagedock:sidechat-handoff', listener);
      },
      onWebFailed: (callback) => {
        const listener = (_event, failure) => callback(failure);
        ipcRenderer.on('pagedock:sidechat-web-failed', listener);
        return () => ipcRenderer.removeListener('pagedock:sidechat-web-failed', listener);
      },
      onSourceJump: (callback) => {
        const listener = (_event, request) => callback(request);
        ipcRenderer.on('pagedock:sidechat-source-jump', listener);
        return () => ipcRenderer.removeListener('pagedock:sidechat-source-jump', listener);
      },
    }),
  }));
