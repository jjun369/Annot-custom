import { NextRequest, NextResponse } from 'next/server';

import { getResearchSourceStatus, updateResearchSourceSettings } from '@/lib/research-settings';

export async function GET() {
  return NextResponse.json(await getResearchSourceStatus());
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Partial<Record<'unpaywallEmail' | 'openAlexKey' | 'kiprisKey' | 'epoClientId' | 'epoClientSecret', string | null>>;
    await updateResearchSourceSettings(body);
    return NextResponse.json(await getResearchSourceStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '자료 공급자 설정을 저장하지 못했습니다.' }, { status: 500 });
  }
}
