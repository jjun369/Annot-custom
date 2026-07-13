import path from 'path';

import { getProviderRuntime } from '@/lib/ai-providers';
import { DEFAULT_AI_PROVIDER } from '@/lib/ai-providers/config';
import { AIProvider } from '@/types';

export interface PaperAiInput {
  pdfPath: string;
  model?: string;
  provider?: AIProvider;
  prompt: string;
}

export async function runPaperAiTask(input: PaperAiInput): Promise<{ content: string; model: string }> {
  const provider = input.provider ?? DEFAULT_AI_PROVIDER;
  const runtime = getProviderRuntime(provider);
  const models = input.model ? null : await runtime.listModels();
  const model = input.model || models?.[0]?.id;
  if (!model) {
    throw new Error('사용할 수 있는 AI 모델을 찾지 못했습니다. 설정에서 연결 상태를 확인해 주세요.');
  }
  const folderPath = path.posix.dirname(input.pdfPath.replace(/\\/g, '/'));
  const result = await runtime.runTurn({
    model,
    folderPath: folderPath === '.' ? '' : folderPath,
    sessionKind: 'pdf',
    prompt: input.prompt,
    currentPdfPath: input.pdfPath,
  });
  return { content: result.content, model };
}

export function extractJsonObject(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('AI 분석 결과 형식을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}
