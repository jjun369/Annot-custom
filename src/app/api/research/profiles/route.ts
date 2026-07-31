import { NextRequest, NextResponse } from 'next/server';

import { listProfiles, upsertProfile } from '@/lib/research-db';
import type { AnalysisProfile } from '@/types';

export async function GET() {
  return NextResponse.json({ profiles: await listProfiles() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<AnalysisProfile>;
    if (!body.name?.trim()) return NextResponse.json({ error: '프로필 이름이 필요합니다.' }, { status: 400 });
    return NextResponse.json(await upsertProfile({ ...body, name: body.name }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '프로필을 저장하지 못했습니다.' }, { status: 500 });
  }
}
