export {};

declare global {
  interface Window {
    pageDockDesktop?: {
      selectDirectory: () => Promise<string | null>;
      deepseekWeb: {
        open: () => Promise<{ mode: 'window' | 'focused' | 'external-fallback' }>;
        clearStoredSession: () => Promise<boolean>;
        copyPrompt: (text: string) => Promise<boolean>;
        readClipboardOnUserAction: () => Promise<string>;
      };
      sideChat: {
        open: (handoff?: { sourceContext?: import('@/types').ChatSourceContext; pdfPath?: string }) => Promise<{ mode: 'window' | 'focused' }>;
        showWebProvider: (providerId: import('@/types').SideChatWebProviderId) => Promise<{ mode: 'embedded' | 'external-fallback' }>;
        hideWebProvider: () => Promise<void>;
        setWebViewBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
        copyText: (text: string) => Promise<boolean>;
        sourceJump: (request: { id?: string; pdfPath?: string; documentId?: string; page: number; rects?: import('@/types').HighlightRect[] }) => Promise<{ delivered: boolean }>;
        onHandoff: (callback: (handoff: { sourceContext?: import('@/types').ChatSourceContext; pdfPath?: string }) => void) => () => void;
        onWebFailed: (callback: (failure: { providerId: import('@/types').SideChatWebProviderId; errorCode: number; errorDescription: string }) => void) => () => void;
        onSourceJump: (callback: (request: { id: string; pdfPath: string; documentId?: string; page: number; rects?: import('@/types').HighlightRect[] }) => void) => () => void;
      };
    };
  }
}
