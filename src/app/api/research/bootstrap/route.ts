import { NextResponse } from 'next/server';

import {
  listDocumentConflicts,
  listProfiles,
  listProjects,
  syncWorkspaceDocuments,
} from '@/lib/research-db';
import { getResearchSourceStatus } from '@/lib/research-settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [{ documents, conflicts }, projects, profiles, conflictItems, sources] = await Promise.all([
      syncWorkspaceDocuments(),
      listProjects(),
      listProfiles(),
      listDocumentConflicts(),
      getResearchSourceStatus(),
    ]);
    return NextResponse.json({ documents, projects, profiles, conflicts, conflictItems, sources });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '리서치 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
