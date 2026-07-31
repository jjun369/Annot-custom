import { NextRequest, NextResponse } from 'next/server';

import {
  createProject,
  deleteProject,
  listProjects,
  setProjectDocument,
  updateProject,
} from '@/lib/research-db';

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; description?: string; profileId?: string };
    if (!body.name?.trim()) return NextResponse.json({ error: '프로젝트 이름이 필요합니다.' }, { status: 400 });
    return NextResponse.json(await createProject({ name: body.name, description: body.description, profileId: body.profileId }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      id?: string;
      name?: string;
      description?: string;
      profileId?: string;
      documentId?: string;
      linked?: boolean;
    };
    if (!body.id) return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 });
    if (body.documentId) {
      await setProjectDocument(body.id, body.documentId, body.linked !== false);
      return NextResponse.json({ ok: true, projects: await listProjects() });
    }
    return NextResponse.json(await updateProject(body.id, body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '프로젝트를 수정하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 });
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '프로젝트를 삭제하지 못했습니다.' }, { status: 500 });
  }
}
