import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeWebCopy, prepareWebRequest, WebRequestError } from '@/lib/side-chat-requests';
import { getWorkspaceRoot } from '@/lib/annot-sessions';
import { createHash } from 'node:crypto';

export async function GET() {
  return NextResponse.json({ namespace: createHash('sha256').update(getWorkspaceRoot().toLowerCase()).digest('hex') });
}

function failure(error: unknown) {
  const status = error instanceof WebRequestError ? error.status : error instanceof Error && error.message.startsWith('Session not found:') ? 404 : 500;
  return NextResponse.json({ error: error instanceof WebRequestError ? error.message : '요청을 로컬에 저장하지 못했습니다. 초안을 유지한 채 다시 시도해 주세요.' }, { status });
}
export async function POST(req: NextRequest) {
  try { return NextResponse.json({ request: await prepareWebRequest(await req.json()) }); } catch (error) { return failure(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.sessionId !== 'string' || typeof body.requestId !== 'string') throw new WebRequestError(400, '요청 ID가 필요합니다.');
    return NextResponse.json({ request: await acknowledgeWebCopy(body.sessionId, body.requestId) });
  } catch (error) { return failure(error); }
}
