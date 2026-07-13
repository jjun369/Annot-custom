import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getProviderRuntime } from '@/lib/ai-providers';
import { DEFAULT_AI_PROVIDER, parseAIProvider } from '@/lib/ai-providers/config';

// GET /api/models — Fetch available models from the active runtime provider
export async function GET(req: NextRequest) {
  try {
    const provider = parseAIProvider(req.nextUrl.searchParams.get('provider')) ?? DEFAULT_AI_PROVIDER;
    const runtime = getProviderRuntime(provider);
    const models = await runtime.listModels();
    return NextResponse.json({ provider, models }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const message = rawMessage.includes('Not authenticated')
      ? 'Codex 로그인이 필요합니다.'
      : '사용 가능한 모델 목록을 가져오지 못했습니다. 잠시 후 새로고침하거나 모델 ID를 직접 입력해 주세요.';
    const status = rawMessage.includes('Not authenticated') ? 401 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
