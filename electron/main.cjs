/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const isDevelopment = process.argv.includes('--dev') || !app.isPackaged;
const isSmokeTest = process.argv.includes('--smoke-test');
let mainWindow = null;
let serverProcess = null;
let baseUrl = null;
let isQuitting = false;

app.setName('PageDock');
app.setAppUserModelId('app.pagedock.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
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
  const windowIcon = isDevelopment
    ? path.join(__dirname, '..', 'build', 'icon.png')
    : path.join(process.resourcesPath, 'assets', 'icon.png');
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

function configureAutoUpdate() {
  if (!app.isPackaged) return;
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

app.on('window-all-closed', () => app.quit());

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
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
