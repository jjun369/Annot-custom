import path from 'path';

import { getProviderRuntime } from '@/lib/ai-providers';
import { DEFAULT_AI_PROVIDER } from '@/lib/ai-providers/config';
import { AUTO_MODEL_ID, normalizeModelPreference } from '@/lib/ai-providers/model-policy';
import { normalizeReasoningEffort } from '@/lib/ai-providers/reasoning-policy';
import { AIProvider, ReasoningEffort } from '@/types';

export interface PaperAiInput {
  pdfPath: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  provider?: AIProvider;
  prompt: string;
}

export async function runPaperAiTask(input: PaperAiInput): Promise<{ content: string; model: string }> {
  const provider = input.provider ?? DEFAULT_AI_PROVIDER;
  const runtime = getProviderRuntime(provider);
  const model = input.model
    ? normalizeModelPreference(input.model)
    : AUTO_MODEL_ID;
  const folderPath = path.posix.dirname(input.pdfPath.replace(/\\/g, '/'));
  const result = await runtime.runTurn({
    model,
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
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
