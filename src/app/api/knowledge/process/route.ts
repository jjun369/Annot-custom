import { NextRequest, NextResponse } from 'next/server';

import { getCodexCliAuthStatus } from '@/lib/codex-exec';
import { analyzeKnowledgeNote } from '@/lib/knowledge-ai';
import { isKnowledgeChatGptOAuth } from '@/lib/knowledge-auth';
import {
  findKnowledgeTopicCandidates,
  getKnowledgeNote,
  markKnowledgeNoteError,
  resetKnowledgeNoteToInbox,
  saveKnowledgeProposals,
} from '@/lib/knowledge-store';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let noteId = '';
  try {
    const body = await request.json() as { noteId?: string };
    noteId = body.noteId?.trim() ?? '';
    if (!noteId) return NextResponse.json({ error: 'noteId가 필요합니다.' }, { status: 400 });

    // Knowledge processing is intentionally OAuth-only. Do not relax this to
    // `authenticated === true`; that would silently allow API-key billing.
    const auth = await getCodexCliAuthStatus();
    if (!isKnowledgeChatGptOAuth(auth)) {
      return NextResponse.json({
        error: '지식 정리는 ChatGPT OAuth로 로그인한 Codex만 사용할 수 있습니다. API key 인증은 허용하지 않습니다.',
      }, { status: 401 });
    }

    const note = await getKnowledgeNote(noteId);
    if (!note) return NextResponse.json({ error: '메모를 찾을 수 없습니다.' }, { status: 404 });
    const candidates = await findKnowledgeTopicCandidates(note.rawText);
    const analysis = await analyzeKnowledgeNote(note, candidates, {
      signal: request.signal,
      timeoutMs: 285_000,
    });
    if (request.signal.aborted) {
      const error = new Error('사용자가 AI 정리를 취소했습니다.');
      error.name = 'AbortError';
      throw error;
    }
    const reviews = await saveKnowledgeProposals(note.id, analysis);
    return NextResponse.json({ analysis, reviews });
  } catch (error) {
    const message = error instanceof Error ? error.message : '메모를 분석하지 못했습니다.';
    if (noteId) {
      try {
        if (error instanceof Error && error.name === 'AbortError') await resetKnowledgeNoteToInbox(noteId);
        else await markKnowledgeNoteError(noteId, message);
      } catch {
        // Preserve the original processing error.
      }
    }
    return NextResponse.json({ error: message }, {
      status: error instanceof Error && error.name === 'AbortError' ? 499 : 500,
    });
  }
}
