import { NextResponse } from 'next/server';

// GET /api/auth — Start OAuth flow, returns redirect URL
export async function GET() {
  return NextResponse.json(
    {
      error: 'PageDock uses the official Codex CLI browser login flow.',
    },
    { status: 410 }
  );
}
