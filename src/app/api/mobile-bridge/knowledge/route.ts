import { NextRequest, NextResponse } from 'next/server';

import {
  addMobileKnowledgeSelection,
  getMobileBridgeInfo,
  removeMobileKnowledgeSelection,
} from '@/lib/mobile-bridge';
import { getKnowledgeSnapshot } from '@/lib/knowledge-store';
import { listMobileKnowledgeItems } from '@/lib/mobile-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const MAX_OFFSET = 1_000_000;

function parsePagination(value: string | null, fallback: number, max: number): number {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error('페이지 범위가 올바르지 않습니다.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error('페이지 범위가 올바르지 않습니다.');
  return parsed;
}
function parseKind(value: unknown): 'topic' | 'note' {
  if (value !== 'topic' && value !== 'note') throw new Error('kind는 topic 또는 note여야 합니다.');
  return value;
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('id 값이 올바르지 않습니다.');
  return value.trim();
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') ?? '';
    if (query.length > 200) return NextResponse.json({ error: '검색어가 너무 깁니다.' }, { status: 400 });
    const offset = parsePagination(request.nextUrl.searchParams.get('offset'), 0, MAX_OFFSET);
    const limit = parsePagination(request.nextUrl.searchParams.get('limit'), 50, MAX_LIMIT);
    if (limit < 1) throw new Error('limit은 1 이상이어야 합니다.');
    const result = listMobileKnowledgeItems(await getKnowledgeSnapshot(), query, offset, limit);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Knowledge 목록을 읽지 못했습니다.' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { kind?: unknown; id?: unknown };
    const kind = parseKind(body.kind);
    const id = parseId(body.id);
    await addMobileKnowledgeSelection(kind, id);
    return NextResponse.json({ bridge: await getMobileBridgeInfo() }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Knowledge를 선택하지 못했습니다.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const kind = parseKind(request.nextUrl.searchParams.get('kind'));
    const id = parseId(request.nextUrl.searchParams.get('id'));
    await removeMobileKnowledgeSelection(kind, id);
    return NextResponse.json({ bridge: await getMobileBridgeInfo() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Knowledge 선택을 제거하지 못했습니다.' }, { status: 400 });
  }
}
