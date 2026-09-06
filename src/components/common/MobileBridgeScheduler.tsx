'use client';

import { useEffect } from 'react';

const STARTUP_MOBILE_BRIDGE_DELAY_MS = 5_000;

/** Resumes only an explicitly enabled, pending derived-PDF publication. */
export function MobileBridgeScheduler() {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetch('/api/mobile-bridge/schedule', { method: 'POST' }).catch(() => undefined);
    }, STARTUP_MOBILE_BRIDGE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
