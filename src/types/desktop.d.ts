export {};

declare global {
  interface Window {
    pageDockDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}
