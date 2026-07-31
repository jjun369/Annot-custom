import { NextRequest, NextResponse } from 'next/server';

import { searchDocuments } from '@/lib/research-db';
import {
  lookupUnpaywall,
  patentSearchLinks,
  searchCrossref,
  searchOpenAlex,
  searchKipris,
  searchEpo,
} from '@/lib/research-sources';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim() || '';
    const source = request.nextUrl.searchParams.get('source') || 'local';
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    if (query.length < 2) return NextResponse.json({ error: '검색어를 두 글자 이상 입력해 주세요.' }, { status: 400 });
    if (source === 'crossref') return NextResponse.json({ results: await searchCrossref(query) });
    if (source === 'openalex') return NextResponse.json({ results: await searchOpenAlex(query) });
    if (source === 'unpaywall') return NextResponse.json({ results: [await lookupUnpaywall(query)] });
    if (source === 'kipris') return NextResponse.json({ results: await searchKipris(query) });
    if (source === 'epo') return NextResponse.json({ results: await searchEpo(query) });
    if (source === 'patent-links') return NextResponse.json({ links: patentSearchLinks(query) });
    return NextResponse.json({ results: await searchDocuments(query, projectId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '검색에 실패했습니다.' }, { status: 500 });
  }
}
