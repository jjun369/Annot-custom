/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const { app, BrowserWindow, WebContentsView, clipboard, dialog, ipcMain, Menu, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const isDevelopment = process.argv.includes('--dev') || !app.isPackaged;
const isSmokeTest = process.argv.includes('--smoke-test');
let mainWindow = null;
let deepSeekWindow = null;
let sideChatWindow = null;
const sideChatWebViews = new Map();
const sideChatWebViewRequests = new Map();
let activeSideChatWebProvider = null;
let sideChatWebRequestId = 0;
let serverProcess = null;
let baseUrl = null;
let isQuitting = false;

app.setName('PageDock');
app.setAppUserModelId('app.pagedock.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const DEEPSEEK_WEB_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_WEB_PARTITION = 'persist:pagedock-deepseek-web';
const MAX_DEEPSEEK_PROMPT_CHARS = 16_000;
const SIDE_CHAT_WEB_PARTITIONS = new Map([
  ['deepseek', 'persist:pagedock-sidechat-deepseek-web'],
  ['chatgpt', 'persist:pagedock-sidechat-chatgpt-web'],
  ['claude', 'persist:pagedock-sidechat-claude-web'],
  ['gemini', 'persist:pagedock-sidechat-gemini-web'],
]);
const SIDE_CHAT_WEB_PROVIDERS = new Map([
  ['deepseek', { url: 'https://chat.deepseek.com/', hostnames: ['chat.deepseek.com', 'deepseek.com'] }],
  ['chatgpt', { url: 'https://chatgpt.com/', hostnames: ['chatgpt.com', 'www.chatgpt.com'] }],
  ['claude', { url: 'https://claude.ai/', hostnames: ['claude.ai', 'www.claude.ai'] }],
  ['gemini', { url: 'https://gemini.google.com/', hostnames: ['gemini.google.com'] }],
]);
const MAX_SIDE_CHAT_COPY_CHARS = 100_000;

function isDeepSeekUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === 'https:' && (
      parsed.hostname === 'deepseek.com'
      || parsed.hostname.endsWith('.deepseek.com')
    );
  } catch {
    return false;
  }
}

function getSideChatProvider(providerId) {
  return typeof providerId === 'string' ? SIDE_CHAT_WEB_PROVIDERS.get(providerId) : undefined;
}

function isSideChatProviderUrl(providerId, targetUrl) {
  const provider = getSideChatProvider(providerId);
  if (!provider) return false;
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === 'https:' && provider.hostnames.some((hostname) => (
      parsed.hostname === hostname || parsed.hostname.endsWith(`.${hostname}`)
    ));
  } catch {
    return false;
  }
}

function getWindowIcon() {
  return isDevelopment
    ? path.join(__dirname, '..', 'build', 'icon.png')
    : path.join(process.resourcesPath, 'assets', 'icon.png');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(url, token, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`${url}/api/health`, {
        headers: { 'x-pagedock-desktop-token': token },
        timeout: 1500,
      }, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.once('timeout', () => request.destroy());
      request.once('error', retry);
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('PageDock 내부 서버를 시작하지 못했습니다.'));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function startProductionServer() {
  const port = await getFreePort();
  const token = randomBytes(32).toString('hex');
  const serverDirectory = path.join(process.resourcesPath, 'app');
  const serverEntry = path.join(serverDirectory, 'server.js');
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverDirectory,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PAGEDOCK_DESKTOP: '1',
      PAGEDOCK_DESKTOP_TOKEN: token,
      PAGEDOCK_CONFIG_DIR: app.getPath('userData'),
      PAGEDOCK_DOCUMENTS_DIR: app.getPath('documents'),
      PAGEDOCK_APP_VERSION: app.getVersion(),
    },
  });

  serverProcess.stdout?.on('data', (chunk) => console.log(`[PageDock server] ${chunk}`));
  serverProcess.stderr?.on('data', (chunk) => console.error(`[PageDock server] ${chunk}`));
  serverProcess.once('exit', (code) => {
    serverProcess = null;
    if (!isQuitting && code !== 0) {
      void dialog.showMessageBox({
        type: 'error',
        title: 'PageDock 실행 오류',
        message: 'PageDock 내부 서비스가 예기치 않게 종료되었습니다.',
        detail: `종료 코드: ${code ?? '알 수 없음'}`,
      });
    }
  });

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${baseUrl}/*`] },
    (details, callback) => {
      details.requestHeaders['x-pagedock-desktop-token'] = token;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  await waitForServer(baseUrl, token);
  return baseUrl;
}

function createWindow(url) {
  const internalOrigin = new URL(url).origin;
  const isInternalUrl = (targetUrl) => {
    try {
      return new URL(targetUrl).origin === internalOrigin;
    } catch {
      return false;
    }
  };
  const windowIcon = getWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'PageDock',
    icon: windowIcon,
    backgroundColor: '#f5f8f7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isInternalUrl(targetUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#f5f8f7',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isInternalUrl(targetUrl)) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(url);
}

async function openDeepSeekWebWindow() {
  if (deepSeekWindow && !deepSeekWindow.isDestroyed()) {
    if (deepSeekWindow.isMinimized()) deepSeekWindow.restore();
    deepSeekWindow.focus();
    return { mode: 'focused' };
  }

  const window = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'DeepSeek 웹 보조 · PageDock',
    icon: getWindowIcon(),
    backgroundColor: '#f5f8f7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: DEEPSEEK_WEB_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  deepSeekWindow = window;

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (deepSeekWindow === window) deepSeekWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (!isDeepSeekUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isDeepSeekUrl(targetUrl)) return;
    event.preventDefault();
    void shell.openExternal(targetUrl);
  });

  try {
    await window.loadURL(DEEPSEEK_WEB_URL);
    return { mode: 'window' };
  } catch {
    if (!window.isDestroyed()) window.close();
    await shell.openExternal(DEEPSEEK_WEB_URL);
    return { mode: 'external-fallback' };
  }
}

async function clearDeepSeekWebSession() {
  const deepSeekSession = session.fromPartition(DEEPSEEK_WEB_PARTITION);
  await deepSeekSession.clearStorageData({
    storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'websql', 'cachestorage'],
  });
  await deepSeekSession.clearCache();

  if (deepSeekWindow && !deepSeekWindow.isDestroyed()) {
    await deepSeekWindow.loadURL(DEEPSEEK_WEB_URL).catch(() => undefined);
  }
}

function encodeSideChatHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object') return '';
  try {
    const sourceContext = handoff.sourceContext;
    if (!sourceContext || typeof sourceContext !== 'object') return '';
    const rawPdfPath = typeof handoff.pdfPath === 'string' ? handoff.pdfPath.trim().replace(/\\/g, '/') : '';
    const pdfPath = rawPdfPath
      && !path.isAbsolute(rawPdfPath)
      && !rawPdfPath.startsWith('/')
      && !/^[A-Za-z]:\//.test(rawPdfPath)
      && !rawPdfPath.split('/').some((part) => part === '..')
      ? rawPdfPath
      : undefined;
    return `?handoff=${encodeURIComponent(JSON.stringify({ sourceContext, ...(pdfPath ? { pdfPath } : {}) }))}`;
  } catch {
    return '';
  }
}

async function openSideChatWindow(handoff) {
  if (sideChatWindow && !sideChatWindow.isDestroyed()) {
    if (sideChatWindow.isMinimized()) sideChatWindow.restore();
    sideChatWindow.focus();
    if (handoff && typeof handoff === 'object') {
      sideChatWindow.webContents.send('pagedock:sidechat-handoff', handoff);
    }
    return { mode: 'focused' };
  }

  const window = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'PageDock 사이드채팅',
    icon: getWindowIcon(),
    backgroundColor: '#f5f8f7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  sideChatWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    sideChatWebRequestId += 1;
    for (const view of sideChatWebViews.values()) {
      try { window.contentView.removeChildView(view); } catch { /* already detached */ }
      try { view.webContents.close({ waitForBeforeUnload: false }); } catch { /* already closed */ }
    }
    sideChatWebViews.clear();
    sideChatWebViewRequests.clear();
    activeSideChatWebProvider = null;
    if (sideChatWindow === window) sideChatWindow = null;
  });
  const internalOrigin = baseUrl ? new URL(baseUrl).origin : null;
  const isInternalUrl = (targetUrl) => {
    if (!internalOrigin) return false;
    try {
      return new URL(targetUrl).origin === internalOrigin;
    } catch {
      return false;
    }
  };
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isInternalUrl(targetUrl)) return { action: 'allow' };
    void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isInternalUrl(targetUrl)) return;
    event.preventDefault();
    void shell.openExternal(targetUrl);
  });

  try {
    await window.loadURL(`${baseUrl}/side-chat${encodeSideChatHandoff(handoff)}`);
    return { mode: 'window' };
  } catch {
    if (!window.isDestroyed()) window.close();
    throw new Error('사이드채팅 창을 열지 못했습니다.');
  }
}

async function showSideChatWebProvider(providerId) {
  const provider = getSideChatProvider(providerId);
  if (!provider) throw new Error('지원하지 않는 웹 AI입니다.');
  if (!sideChatWindow || sideChatWindow.isDestroyed()) {
    throw new Error('사이드채팅 창이 열려 있지 않습니다.');
  }
  if (!WebContentsView) {
    await shell.openExternal(provider.url);
    return { mode: 'external-fallback' };
  }

  const requestId = sideChatWebRequestId + 1;
  sideChatWebRequestId = requestId;
  for (const candidate of sideChatWebViews.values()) candidate.setVisible(false);
  activeSideChatWebProvider = null;

  let view = sideChatWebViews.get(providerId);
  let createdView = false;
  if (!view) {
    const partition = SIDE_CHAT_WEB_PARTITIONS.get(providerId);
    view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    sideChatWebViews.set(providerId, view);
    createdView = true;
    sideChatWindow.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isSideChatProviderUrl(providerId, targetUrl)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: {
              partition,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: true,
            },
          },
        };
      }
      void shell.openExternal(targetUrl);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, targetUrl) => {
      if (isSideChatProviderUrl(providerId, targetUrl)) return;
      event.preventDefault();
      void shell.openExternal(targetUrl);
    });
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && sideChatWebViewRequests.get(providerId) === sideChatWebRequestId && activeSideChatWebProvider === providerId && sideChatWindow && !sideChatWindow.isDestroyed()) {
        sideChatWindow.webContents.send('pagedock:sidechat-web-failed', { providerId, errorCode, errorDescription });
      }
    });
    sideChatWebViewRequests.set(providerId, requestId);
    try {
      await view.webContents.loadURL(provider.url);
    } catch {
      const windowStillOpen = sideChatWindow && !sideChatWindow.isDestroyed();
      if (sideChatWebViewRequests.get(providerId) === requestId && windowStillOpen) {
        sideChatWindow.contentView.removeChildView(view);
        sideChatWebViews.delete(providerId);
        sideChatWebViewRequests.delete(providerId);
      }
      if (sideChatWebRequestId !== requestId || !windowStillOpen) return { mode: 'cancelled' };
      await shell.openExternal(provider.url);
      return { mode: 'external-fallback' };
    }
  } else {
    sideChatWebViewRequests.set(providerId, requestId);
  }

  if (sideChatWebRequestId !== requestId || !sideChatWindow || sideChatWindow.isDestroyed()) {
    if (createdView && sideChatWebViews.get(providerId) === view && sideChatWindow && !sideChatWindow.isDestroyed()) {
      sideChatWindow.contentView.removeChildView(view);
      sideChatWebViews.delete(providerId);
      sideChatWebViewRequests.delete(providerId);
    }
    return { mode: 'cancelled' };
  }

  for (const [id, candidate] of sideChatWebViews) {
    candidate.setVisible(id === providerId);
  }
  activeSideChatWebProvider = providerId;
  view.setBounds({ x: 0, y: 118, width: sideChatWindow.getContentBounds().width, height: Math.max(160, sideChatWindow.getContentBounds().height - 118) });
  view.webContents.focus();
  return { mode: 'embedded' };
}

function hideSideChatWebProvider() {
  sideChatWebRequestId += 1;
  for (const view of sideChatWebViews.values()) view.setVisible(false);
  activeSideChatWebProvider = null;
}

function setSideChatWebBounds(bounds) {
  if (!sideChatWindow || sideChatWindow.isDestroyed() || !activeSideChatWebProvider) return;
  const view = sideChatWebViews.get(activeSideChatWebProvider);
  if (!view || !bounds || typeof bounds !== 'object') return;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(bounds[key]));
  if (values.some((value) => !Number.isFinite(value)) || values[2] < 120 || values[3] < 100) return;
  view.setBounds({ x: Math.floor(values[0]), y: Math.floor(values[1]), width: Math.floor(values[2]), height: Math.floor(values[3]) });
}

function validateSideChatSourceJump(request) {
  if (!request || typeof request !== 'object' || typeof request.pdfPath !== 'string' || !request.pdfPath.trim()) return null;
  const page = Number(request.page);
  if (!Number.isFinite(page) || page < 1 || page > 1_000_000) return null;
  if (path.isAbsolute(request.pdfPath) || request.pdfPath.includes('..')) return null;
  const rects = Array.isArray(request.rects) ? request.rects.slice(0, 128).filter((rect) => (
    rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key])))
  )).map((rect) => ({
    x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height),
  })) : undefined;
  return { id: typeof request.id === 'string' && request.id ? request.id : `sidechat-source-${Date.now()}`, pdfPath: request.pdfPath.trim().replace(/\\/g, '/'), page: Math.floor(page), ...(rects?.length ? { rects } : {}) };
}

function configureDesktopIpc() {
  ipcMain.handle('pagedock:select-directory', async () => {
    const options = {
      title: 'PageDock Library 폴더 선택',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('pagedock:deepseek-web-open', async () => openDeepSeekWebWindow());
  ipcMain.handle('pagedock:deepseek-web-clear-session', async () => {
    await clearDeepSeekWebSession();
    return true;
  });
  ipcMain.handle('pagedock:deepseek-web-copy-prompt', (_event, text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_DEEPSEEK_PROMPT_CHARS) {
      throw new Error('DeepSeek에 복사할 질문 내용이 올바르지 않습니다.');
    }
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('pagedock:deepseek-web-read-clipboard', () => clipboard.readText());
  ipcMain.handle('pagedock:sidechat-open', async (_event, handoff) => openSideChatWindow(handoff));
  ipcMain.handle('pagedock:sidechat-web-show', async (_event, providerId) => showSideChatWebProvider(providerId));
  ipcMain.handle('pagedock:sidechat-web-hide', () => hideSideChatWebProvider());
  ipcMain.on('pagedock:sidechat-web-bounds', (_event, bounds) => setSideChatWebBounds(bounds));
  ipcMain.handle('pagedock:sidechat-copy-text', (_event, text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_SIDE_CHAT_COPY_CHARS) {
      throw new Error('복사할 사이드채팅 내용이 올바르지 않습니다.');
    }
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('pagedock:sidechat-source-jump', (_event, request) => {
    const safeRequest = validateSideChatSourceJump(request);
    if (!safeRequest || !mainWindow || mainWindow.isDestroyed()) return { delivered: false };
    mainWindow.webContents.send('pagedock:sidechat-source-jump', safeRequest);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return { delivered: true };
  });
}

function configureApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '파일',
      submenu: [
        { role: 'close' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]));
}

function configureAutoUpdate() {
  if (!app.isPackaged) return;
  // macOS friend-test artifacts are unsigned and private; enable Mac updates only
  // after Developer ID signing, notarization, and latest-mac metadata are verified.
  if (process.platform === 'darwin') return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', async (info) => {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'PageDock 업데이트',
      message: `새 버전 ${info.version}을 사용할 수 있습니다.`,
      detail: '지금 다운로드해도 작업 중인 PDF와 공부 기록은 그대로 유지됩니다.',
      buttons: ['다운로드', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) void autoUpdater.downloadUpdate();
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: `PageDock ${info.version} 설치 준비가 끝났습니다.`,
      detail: '지금 다시 시작하거나, 앱을 종료할 때 자동으로 설치할 수 있습니다.',
      buttons: ['지금 다시 시작', '종료할 때 설치'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 15000);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && baseUrl) createWindow(baseUrl);
});

void app.whenReady().then(async () => {
  configureDesktopIpc();
  configureApplicationMenu();
  try {
    const url = isDevelopment
      ? (process.env.PAGEDOCK_DEV_URL || 'http://127.0.0.1:3000')
      : await startProductionServer();
    baseUrl = url;
    if (isSmokeTest) {
      app.exit(0);
      return;
    }
    createWindow(url);
    configureAutoUpdate();
  } catch (error) {
    if (isSmokeTest) {
      console.error(error);
      app.exit(1);
      return;
    }
    await dialog.showMessageBox({
      type: 'error',
      title: 'PageDock를 시작하지 못했습니다',
      message: error instanceof Error ? error.message : String(error),
      detail: '앱을 다시 실행해 주세요. 문제가 계속되면 설치 파일로 복구 설치해 주세요.',
    });
    app.quit();
  }
});
