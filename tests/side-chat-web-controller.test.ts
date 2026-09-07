import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createSideChatWebController } = require('../electron/side-chat-web-controller.cjs');

function fixture() {
  const loads: Array<{ resolve: () => void; reject: () => void }> = [];
  const views: FakeView[] = [];
  class FakeView {
    visible = false;
    bounds = {};
    webContents = Object.assign(new EventEmitter(), { focus: vi.fn(), close: vi.fn(), setWindowOpenHandler: vi.fn(), loadURL: vi.fn(() => new Promise<void>((resolve, reject) => loads.push({ resolve, reject: () => reject(new Error('offline')) }))) });
    constructor() { views.push(this); }
    setVisible(v: boolean) { this.visible = v; }
    setBounds(b: object) { this.bounds = b; }
  }
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, isMinimized: () => false, getContentBounds: () => ({ width: 1280, height: 720 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, webContents: { focus: vi.fn(), send: vi.fn() } });
  const external = vi.fn();
  const controller = createSideChatWebController({ window, WebContentsView: FakeView, providers: new Map([['a', { url: 'https://example.com/a' }], ['b', { url: 'https://example.com/b' }]]), partitions: new Map(), isProviderUrl: () => true, openExternal: external });
  return { controller, views, loads, window, external };
}
describe('native web view lifecycle', () => {
  it('deduplicates loading and never reveals late A after selecting B or local UI', async () => {
    const f = fixture();
    const a = f.controller.show('a'); const a2 = f.controller.show('a');
    expect(f.loads).toHaveLength(1);
    const b = f.controller.show('b'); f.controller.setBounds({ x: 0, y: 400, width: 1280, height: 300 });
    f.loads[1].resolve(); expect((await b).mode).toBe('embedded'); expect(f.views[1].visible).toBe(true);
    f.loads[0].resolve(); expect((await a).mode).toBe('cancelled'); expect((await a2).mode).toBe('cancelled'); expect(f.views[0].visible).toBe(false);
    f.controller.hide(); expect(f.views.every((v) => !v.visible)).toBe(true);
    expect(f.views.every((v) => v.webContents.focus.mock.calls.length === 0)).toBe(true);
  });
  it('hides without valid bounds, on too-short hosts and on close; retries offline without external spam', async () => {
    const f = fixture(); const a = f.controller.show('a'); f.loads[0].reject(); expect((await a).mode).toBe('failed');
    expect(f.external).not.toHaveBeenCalled();
    const retry = f.controller.show('a'); f.loads[1].resolve(); await retry; expect(f.views[0].visible).toBe(false);
    f.controller.setBounds({ x: 0, y: 400, width: 1280, height: 300 }); expect(f.views[0].visible).toBe(true);
    f.controller.setBounds({ x: 0, y: 700, width: 1280, height: 20 }); expect(f.views[0].visible).toBe(false);
    f.window.emit('closed'); expect(f.views[0].webContents.close).toHaveBeenCalledOnce();
  });
});
