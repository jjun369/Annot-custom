import { NextRequest, NextResponse } from 'next/server';

import { runPaperAiTask } from '@/lib/paper-ai';
import { addPaperTranslation, deletePaperTranslation } from '@/lib/paper-metadata';
import { extractPdfTextByPage, PdfTextPage } from '@/lib/pdf-text';
import { AIProvider, PaperTranslation, ReasoningEffort } from '@/types';

function splitPageText(text: string, maxCharacters = 12000): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return [''];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxCharacters) {
    const boundary = Math.max(
      remaining.lastIndexOf('\n', maxCharacters),
      remaining.lastIndexOf(' ', maxCharacters),
    );
    const cutAt = boundary > Math.floor(maxCharacters * 0.65) ? boundary : maxCharacters;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function translateFullPdf(
  pdfPath: string,
  model?: string,
  provider?: AIProvider,
  reasoningEffort?: ReasoningEffort,
): Promise<{ sourceMarkdown: string; translatedMarkdown: string; bilingualMarkdown: string; model?: string }> {
  let pages: PdfTextPage[] = [];
  try {
    pages = await extractPdfTextByPage(pdfPath);
  } catch {
    // A scanned PDF may not expose a text layer. The provider can still use
    // the attached PDF, so fall back to a single document-level request.
    const fallback = await runPaperAiTask({
      pdfPath,
      model,
      provider,
      reasoningEffort,
      prompt: [
        '현재 PDF 논문 전체를 페이지와 절 구조를 유지한 한영 대조 Markdown으로 번역하세요.',
        '각 페이지는 `## 페이지 N`, 원문은 `### 원문`, 번역은 `### 한국어 번역`으로 표시하세요.',
        '수식, 표 번호, 그림 번호, 인용 번호와 전문 용어를 보존하세요.',
        '설명은 추가하지 말고 번역 문서만 출력하세요.',
      ].join('\n'),
    });
    return {
      sourceMarkdown: '',
      translatedMarkdown: fallback.content.trim(),
      bilingualMarkdown: fallback.content.trim(),
      model: fallback.model,
    };
  }

  if (pages.length === 0) {
    throw new Error('PDF에서 번역할 페이지를 찾지 못했습니다.');
  }

  const bilingualSections: string[] = [];
  const translatedSections: string[] = [];
  let lastModel = model;

  for (const page of pages) {
    const chunks = splitPageText(page.text);
    const translations: string[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const result = await runPaperAiTask({
        pdfPath,
        model,
        provider,
        reasoningEffort,
        prompt: [
          `현재 PDF의 ${page.page}페이지 ${chunks.length > 1 ? `${index + 1}/${chunks.length}번째 원문 블록` : '원문'}을 번역하세요.`,
          '자연스럽고 정확한 한국어로 번역하고, 수식·기호·인용 번호·전문 용어의 의미를 보존하세요.',
          '번역문만 출력하세요. 원문을 반복하거나 해설을 추가하지 마세요.',
          '',
          '--- 원문 시작 ---',
          chunk,
          '--- 원문 끝 ---',
        ].join('\n'),
      });
      translations.push(result.content.trim());
      lastModel = result.model;
    }

    const sourceText = page.text.trim() || '(텍스트 레이어 없음)';
    const translatedText = translations.filter(Boolean).join('\n\n');
    bilingualSections.push([
      `## 페이지 ${page.page}`,
      '',
      '### 원문',
      '',
      sourceText,
      '',
      '### 한국어 번역',
      '',
      translatedText,
    ].join('\n'));
    translatedSections.push([
      `## 페이지 ${page.page}`,
      '',
      translatedText,
    ].join('\n'));
  }

  const sourceMarkdown = pages.map((page) => [
    `## 페이지 ${page.page}`,
    '',
    page.text.trim() || '(텍스트 레이어 없음)',
  ].join('\n')).join('\n\n');
  return {
    sourceMarkdown,
    translatedMarkdown: translatedSections.join('\n\n'),
    bilingualMarkdown: bilingualSections.join('\n\n'),
    model: lastModel,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      pdfPath?: string;
      kind?: 'selection' | 'full';
      sourceText?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      provider?: AIProvider;
    };
    if (!body.pdfPath?.trim() || (body.kind !== 'selection' && body.kind !== 'full')) {
      return NextResponse.json({ error: 'PDF 경로와 번역 종류가 필요합니다.' }, { status: 400 });
    }
    if (body.kind === 'selection' && !body.sourceText?.trim()) {
      return NextResponse.json({ error: '번역할 원문을 선택해 주세요.' }, { status: 400 });
    }

    if (body.kind === 'full') {
      const result = await translateFullPdf(body.pdfPath, body.model, body.provider, body.reasoningEffort);
      return NextResponse.json({
        kind: 'full',
        title: '전체 논문 한영 대조 번역',
        ...result,
      });
    }

    const prompt = body.kind === 'selection'
      ? [
        '다음 논문 발췌문을 자연스럽고 정확한 한국어로 번역하세요.',
        '수식, 기호, 인용 번호와 전문 용어의 의미를 보존하세요.',
        '번역문만 출력하세요.',
        '',
        body.sourceText!.trim(),
      ].join('\n')
      : [
        '현재 PDF 논문 전체를 한국어로 번역하세요.',
        '원문의 페이지와 절 구조를 유지하고, 각 부분에서 영어 원문 다음에 한국어 번역을 배치한 대조 Markdown을 작성하세요.',
        '페이지는 `## 페이지 N`, 절은 원문 제목을 사용하세요.',
        '수식, 표 번호, 그림 번호, 참고문헌 번호를 보존하세요.',
        '누락 없이 번역하되 장식적인 설명은 추가하지 마세요.',
      ].join('\n');
    const result = await runPaperAiTask({
      pdfPath: body.pdfPath,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      provider: body.provider,
      prompt,
    });
    const sourceMarkdown = body.sourceText!.trim();
    const translatedMarkdown = result.content.trim();
    const bilingualMarkdown = `## 원문\n\n${sourceMarkdown}\n\n## 번역\n\n${translatedMarkdown}`;
    return NextResponse.json({
      kind: body.kind,
      title: body.kind === 'selection' ? '선택 영역 번역' : '전체 논문 한영 대조 번역',
      sourceMarkdown,
      translatedMarkdown,
      bilingualMarkdown,
      model: result.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '번역에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      pdfPath?: string;
      translation?: Omit<PaperTranslation, 'id' | 'createdAt'>;
    };
    if (!body.pdfPath?.trim() || !body.translation?.bilingualMarkdown) {
      return NextResponse.json({ error: '저장할 번역 내용이 없습니다.' }, { status: 400 });
    }
    return NextResponse.json(await addPaperTranslation(body.pdfPath, body.translation));
  } catch (error) {
    const message = error instanceof Error ? error.message : '번역을 저장하지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const pdfPath = req.nextUrl.searchParams.get('path')?.trim();
    const translationId = req.nextUrl.searchParams.get('id')?.trim();
    if (!pdfPath || !translationId) {
      return NextResponse.json({ error: 'PDF 경로와 번역 ID가 필요합니다.' }, { status: 400 });
    }
    return NextResponse.json(await deletePaperTranslation(pdfPath, translationId));
  } catch (error) {
    const message = error instanceof Error ? error.message : '번역을 삭제하지 못했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
