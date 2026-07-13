import { NextRequest, NextResponse } from 'next/server';

import { readPortablePreferences, updatePortablePreferences } from '@/lib/library-preferences';

export async function GET() {
  return NextResponse.json(await readPortablePreferences());
}

export async function PATCH(req: NextRequest) {
  try {
    return NextResponse.json(await updatePortablePreferences(await req.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '설정을 저장하지 못했습니다.' }, { status: 500 });
  }
}
