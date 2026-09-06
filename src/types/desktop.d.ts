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
    };
  }
}
