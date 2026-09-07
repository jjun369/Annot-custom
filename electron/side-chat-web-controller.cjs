// Remote contents never get the PageDock preload. Only lifecycle is managed here.
function createSideChatWebController({ window, WebContentsView, providers, partitions, isProviderUrl, openExternal }) {
  const entries = new Map();
  let generation = 0;
  let active = null;
  let bounds = null;
  let disposed = false;
  const alive = () => !disposed && !window.isDestroyed();
  const hideViews = () => { for (const entry of entries.values()) entry.view.setVisible(false); };
  const apply = () => {
    hideViews();
    const entry = entries.get(active);
    if (!alive() || window.isMinimized() || !bounds || !entry || entry.state !== 'ready') return;
    const content = window.getContentBounds();
    const width = Math.min(bounds.width, content.width - bounds.x);
    const height = Math.min(bounds.height, content.height - bounds.y);
    if (width < 120 || height < 100) return;
    entry.view.setBounds({ ...bounds, width, height });
    entry.view.setVisible(true);
  };
  const hide = () => { generation += 1; active = null; bounds = null; hideViews(); if (alive()) window.webContents.focus(); };
  const setBounds = (value) => {
    const values = value && ['x', 'y', 'width', 'height'].map((k) => Number(value[k]));
    bounds = values && values.every(Number.isFinite) && values[0] >= 0 && values[1] >= 0 && values[2] >= 120 && values[3] >= 100
      ? { x: Math.floor(values[0]), y: Math.floor(values[1]), width: Math.floor(values[2]), height: Math.floor(values[3]) } : null;
    apply();
  };
  const show = async (id) => {
    const provider = providers.get(id);
    if (!provider || !alive()) throw new Error('웹 탭을 열 수 없습니다.');
    const intent = ++generation;
    active = id; hideViews();
    if (!WebContentsView) return { mode: 'external-fallback' };
    let entry = entries.get(id);
    if (!entry) {
      const partition = partitions.get(id);
      const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      entry = { view, state: 'idle', loading: null };
      entries.set(id, entry); window.contentView.addChildView(view); view.setVisible(false);
      view.webContents.setWindowOpenHandler(({ url }) => {
        if (isProviderUrl(id, url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } } };
        if (/^https?:\/\//i.test(url)) void openExternal(url);
        return { action: 'deny' };
      });
      view.webContents.on('will-navigate', (event, url) => { if (!isProviderUrl(id, url)) { event.preventDefault(); if (/^https?:\/\//i.test(url)) void openExternal(url); } });
      view.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
        if (!mainFrame || code === -3 || !alive()) return;
        entry.state = 'failed'; view.setVisible(false);
        if (active === id) window.webContents.send('pagedock:sidechat-web-failed', { providerId: id, errorCode: code, errorDescription: description });
      });
    }
    if (entry.state !== 'ready' && !entry.loading) {
      entry.state = 'loading';
      entry.loading = entry.view.webContents.loadURL(provider.url).then(() => { entry.state = 'ready'; }).catch(() => { entry.state = 'failed'; }).finally(() => { entry.loading = null; });
    }
    if (entry.loading) await entry.loading;
    if (!alive() || generation !== intent || active !== id) return { mode: 'cancelled' };
    apply();
    return { mode: entry.state === 'ready' ? 'embedded' : 'failed' };
  };
  const dispose = () => {
    disposed = true; generation += 1; active = null;
    for (const entry of entries.values()) {
      try { window.contentView.removeChildView(entry.view); } catch { /* window closed */ }
      try { entry.view.webContents.close({ waitForBeforeUnload: false }); } catch { /* already closed */ }
    }
    entries.clear();
  };
  window.on('minimize', hideViews);
  window.on('restore', apply);
  window.on('resize', apply);
  window.on('closed', dispose);
  return { show, hide, setBounds, dispose };
}
module.exports = { createSideChatWebController };
