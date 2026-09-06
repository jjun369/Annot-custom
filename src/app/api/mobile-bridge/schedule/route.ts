import { NextResponse } from 'next/server';

import { scheduleMobileBridgePublish } from '@/lib/mobile-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resumes an already-opted-in derived-artifact timer after application start.
 * It never writes the Library and does nothing when the bridge is clean/off.
 */
export async function POST() {
  try {
    await scheduleMobileBridgePublish();
    return NextResponse.json({ ok: true });
  } catch {
    // Startup must stay quiet: Settings exposes any bridge problem when the user opens it.
    return NextResponse.json({ ok: false });
  }
}
