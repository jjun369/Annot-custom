import {
  getDocumentById,
  getDocumentChunks,
  getPatentMetadata,
  listProfiles,
  saveAnalysisReport,
} from '@/lib/research-db';
import { runCodexStructured } from '@/lib/codex-exec';
import type { EvidenceLevel, ReasoningEffort, ResearchAnalysisReport } from '@/types';

interface StructuredAnalysis {
  oneSentenceIdea: string;
  existingProblem: string;
  structureAndDevices: string;
  implementationOrProcess: string;
  additionalSteps: string;
  performanceImpact: string;
  tradeoffs: string;
  independentClaimScope: string;
  embodimentDifferences: string;
  similarWork: string;
  uncertainty: string;
  relatedDocuments: string;
  conclusion: string;
  evidence: Array<{
    level: EvidenceLevel;
    page: number | null;
    section: string;
    claim: string;
    figure: string;
    quote: string;
    note: string;
  }>;
}

const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'oneSentenceIdea', 'existingProblem', 'structureAndDevices', 'implementationOrProcess',
    'additionalSteps', 'performanceImpact', 'tradeoffs', 'independentClaimScope',
    'embodimentDifferences', 'similarWork', 'uncertainty', 'relatedDocuments', 'conclusion', 'evidence',
  ],
  properties: {
    oneSentenceIdea: { type: 'string' },
    existingProblem: { type: 'string' },
    structureAndDevices: { type: 'string' },
    implementationOrProcess: { type: 'string' },
    additionalSteps: { type: 'string' },
    performanceImpact: { type: 'string' },
    tradeoffs: { type: 'string' },
    independentClaimScope: { type: 'string' },
    embodimentDifferences: { type: 'string' },
    similarWork: { type: 'string' },
    uncertainty: { type: 'string' },
    relatedDocuments: { type: 'string' },
    conclusion: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'page', 'section', 'claim', 'figure', 'quote', 'note'],
        properties: {
          level: { type: 'string', enum: ['explicit', 'figure_inference', 'technical_inference', 'uncertain'] },
          page: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          section: { type: 'string' },
          claim: { type: 'string' },
          figure: { type: 'string' },
          quote: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
};

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function validateEvidence(
  evidence: StructuredAnalysis['evidence'],
  chunks: Awaited<ReturnType<typeof getDocumentChunks>>,
  claimsText: string,
): StructuredAnalysis['evidence'] {
  return evidence.filter((anchor) => {
    if (!anchor.page && !anchor.claim) return false;
    if (anchor.page && !chunks.some((chunk) => chunk.page === anchor.page)) return false;
    if (anchor.claim && !normalizedText(claimsText).includes(normalizedText(anchor.claim))) return false;
    if (anchor.quote) {
      const quote = normalizedText(anchor.quote);
      const candidateText = chunks
        .filter((chunk) => !anchor.page || chunk.page === anchor.page)
        .map((chunk) => normalizedText(chunk.text))
        .join(' ');
      if (!candidateText.includes(quote)) return false;
    }
    return true;
  });
}

export async function analyzeResearchDocument(input: {
  reportId: string;
  documentId: string;
  projectId?: string;
  profileId: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  imagePaths?: string[];
}): Promise<ResearchAnalysisReport> {
  const document = await getDocumentById(input.documentId);
  if (!document) throw new Error('문서를 찾지 못했습니다.');
  const chunks = await getDocumentChunks(input.documentId);
  if (chunks.length === 0) throw new Error('먼저 PDF 본문을 색인해 주세요.');
  const profile = (await listProfiles()).find((item) => item.id === input.profileId);
  if (!profile) throw new Error('분석 프로필을 찾지 못했습니다.');
  const patent = await getPatentMetadata(input.documentId);
  const source = chunks
    .slice(0, 80)
    .map((chunk) => `[PAGE ${chunk.page || '?'}${chunk.section ? ` | ${chunk.section}` : ''}]\n${chunk.text}`)
    .join('\n\n');
  const prompt = [
    'You are PageDock\'s evidence-grounded technology research analyst.',
    'Write every report field in Korean, preserving important English technical terms.',
    'Use only the provided source excerpts. Never invent a page, claim, figure, quote, or legal conclusion.',
    'For evidence, quote the source verbatim and use the exact PDF page number shown in [PAGE n].',
    'Legal status is reference information only; never decide freedom to operate.',
    '',
    `Document title: ${document.displayTitle}`,
    `Document type: ${document.kind}`,
    `Analysis profile: ${profile.name}`,
    `Focus areas: ${profile.focusAreas.join(', ')}`,
    `Questions: ${profile.questions.join(' | ')}`,
    `Metrics: ${profile.metrics.join(', ')}`,
    patent?.claimsText ? `Claims text:\n${patent.claimsText.slice(0, 30000)}` : 'Claims text: not available',
    '',
    'Source excerpts:',
    source.slice(0, 120000),
  ].join('\n');
  await saveAnalysisReport({
    id: input.reportId,
    documentId: input.documentId,
    projectId: input.projectId,
    profileId: input.profileId,
    status: 'running',
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  try {
    const result = await runCodexStructured<StructuredAnalysis>({
      prompt,
      schema: ANALYSIS_SCHEMA,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      imagePaths: input.imagePaths,
    });
    const validEvidence = validateEvidence(result.evidence || [], chunks, patent?.claimsText || '');
    return await saveAnalysisReport({
      id: input.reportId,
      documentId: input.documentId,
      projectId: input.projectId,
      profileId: input.profileId,
      status: 'succeeded',
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      report: result as unknown as Record<string, unknown>,
      evidence: validEvidence.map((anchor) => ({
        level: anchor.level,
        page: anchor.page || undefined,
        section: anchor.section || undefined,
        claim: anchor.claim || undefined,
        figure: anchor.figure || undefined,
        quote: anchor.quote,
        note: anchor.note,
      })),
    });
  } catch (error) {
    return await saveAnalysisReport({
      id: input.reportId,
      documentId: input.documentId,
      projectId: input.projectId,
      profileId: input.profileId,
      status: 'failed',
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      error: error instanceof Error ? error.message : '분석에 실패했습니다.',
    });
  }
}
