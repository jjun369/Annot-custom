import { NextRequest, NextResponse } from 'next/server';

import { extractJsonObject, runPaperAiTask } from '@/lib/paper-ai';
import { updatePaperMetadata } from '@/lib/paper-metadata';
import { AIProvider } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      pdfPath?: string;
      model?: string;
      provider?: AIProvider;
    };
    if (!body.pdfPath?.trim()) {
      return NextResponse.json({ error: 'PDF 경로가 필요합니다.' }, { status: 400 });
    }

    const result = await runPaperAiTask({
      pdfPath: body.pdfPath,
      model: body.model,
      provider: body.provider,
      prompt: [
        '현재 PDF 논문을 직접 읽고 한국어로 분석하세요.',
        '논문의 핵심을 정확히 나타내는 키워드 3~7개와, 비전공자도 이해할 수 있는 짧은 3줄 요약을 만드세요.',
        '과장하거나 PDF에 없는 내용을 추측하지 마세요.',
        '다음 JSON만 출력하세요. 마크다운 코드 블록은 사용하지 마세요.',
        '{"keywords":["키워드"],"summary":"첫째 줄\\n둘째 줄\\n셋째 줄"}',
      ].join('\n'),
    });
    const parsed = extractJsonObject(result.content);
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((value): value is string => typeof value === 'string').slice(0, 7)
      : [];
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (keywords.length === 0 || !summary) {
      throw new Error('AI가 유효한 키워드와 요약을 반환하지 않았습니다.');
    }
    const metadata = await updatePaperMetadata(body.pdfPath, {
      aiKeywords: keywords,
      summaryKo: summary,
      analyzedAt: new Date().toISOString(),
      analysisModel: result.model,
    });
    return NextResponse.json(metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : '논문 분석에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
