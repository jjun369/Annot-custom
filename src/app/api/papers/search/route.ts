import { NextRequest, NextResponse } from 'next/server';

import { getWorkspaceTree } from '@/lib/workspace-tree';
import { collectPdfs } from '@/lib/tree-utils';
import { getPaperMetadataBatch } from '@/lib/paper-metadata';
import { PaperMetadata, TreeNode } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchResult {
  pdf: TreeNode;
  metadata: PaperMetadata;
  matches: string[];
}

function searchableFields(pdf: TreeNode, metadata: PaperMetadata): Array<[string, string]> {
  return [
    ['파일명', pdf.name],
    ['경로', pdf.path],
    ['AI 키워드', metadata.aiKeywords.join(' ')],
    ['개인 태그', metadata.personalTags.join(' ')],
    ['AI 요약', metadata.summaryKo],
    ['개인 메모', metadata.noteMarkdown],
  ];
}

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q')?.trim().toLocaleLowerCase('ko-KR') || '';
    if (query.length < 2) return NextResponse.json({ results: [] });

    const tree = await getWorkspaceTree();
    const pdfs = collectPdfs(tree);
    const metadata = await getPaperMetadataBatch(pdfs.map((pdf) => pdf.path));
    const results: SearchResult[] = [];

    for (const pdf of pdfs) {
      const paperMetadata = metadata[pdf.path];
      const matches = searchableFields(pdf, paperMetadata)
        .filter(([, value]) => value.toLocaleLowerCase('ko-KR').includes(query))
        .map(([label]) => label);
      if (matches.length > 0) results.push({ pdf, metadata: paperMetadata, matches });
    }

    results.sort((a, b) => {
      const aExact = a.pdf.name.toLocaleLowerCase('ko-KR').includes(query) ? 0 : 1;
      const bExact = b.pdf.name.toLocaleLowerCase('ko-KR').includes(query) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return (b.metadata.lastOpenedAt || '').localeCompare(a.metadata.lastOpenedAt || '');
    });

    return NextResponse.json({ results: results.slice(0, 50) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '논문을 검색하지 못했습니다.',
    }, { status: 500 });
  }
}
