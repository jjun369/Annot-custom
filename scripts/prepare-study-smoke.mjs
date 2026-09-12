// Synthetic-only isolated Library for manual Windows Reader verification.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Provide a synthetic PDF fixture path, never a user paper.');
const base = await mkdtemp(path.join(os.tmpdir(), 'pagedock-study-smoke-'));
const root = path.join(base, 'library');
const userData = path.join(base, 'user-data');
const bridge = path.join(base, 'bridge');
const pdfPath = 'synthetic-study.pdf';
await Promise.all([mkdir(path.join(root, '.annot', 'annotations'), { recursive: true }), mkdir(userData), mkdir(bridge)]);
await copyFile(path.resolve(source), path.join(root, pdfPath));
const now = new Date().toISOString();
const rect = { x: 0.1, y: 0.2, width: 0.65, height: 0.04 };
const highlights = ['important', 'unclear', 'concept', 'memorize', 'question'].map((studyKind, index) => ({
  id: randomUUID(), pdfPath, page: index % 2 + 1, studyKind,
  type: ['unclear', 'question'].includes(studyKind) ? 'unknown' : 'important',
  text: `Synthetic study evidence ${index + 1}`, note: `합성 메모 ${index + 1}: 열처리 조건을 다시 확인합니다.`,
  position: rect, rects: [rect], createdAt: now, updatedAt: now,
}));
const cards = [1, 2, 3].map((index) => ({
  id: randomUUID(), sourceContext: { id: randomUUID(), scope: 'selection', page: index % 2 + 1, text: 'Synthetic recall source', rects: [rect] },
  front: `합성 복습 ${index}: 원문에서 확인할 조건은?`, back: `답 ${index}: 측정 조건과 근거를 원문에서 확인합니다.`,
  origin: 'selection', createdAt: now, updatedAt: now, review: { reviewCount: 0 },
}));
const digest = createHash('sha256').update(pdfPath).digest('hex').slice(0, 24);
await writeFile(path.join(root, '.annot', 'annotations', `${digest}.json`), JSON.stringify({ version: 1, pdfPath, highlights, study: { version: 1, cards }, updatedAt: now }));
const noteId = randomUUID();
await writeFile(path.join(root, '.annot', 'knowledge-store.json'), JSON.stringify({ version: 2, notes: [{ id: noteId, rawText: '휴대폰에서 읽을 합성 학습 메모입니다. 실제 회사 자료가 아닙니다.', title: '합성 모바일 메모', sourceName: 'synthetic.md', summary: '', status: 'inbox', createdAt: now, updatedAt: now, contentHash: 'synthetic', provenance: { kind: 'personal_hypothesis' } }], topics: [], reviews: [], conflicts: [] }));
await writeFile(path.join(root, '.annot', 'settings.json'), JSON.stringify({ onboardingCompleted: true, libraryImportExplained: true }));
await writeFile(path.join(userData, 'config.json'), JSON.stringify({ workspaceRoot: root }));
await writeFile(path.join(userData, 'mobile-bridge.json'), JSON.stringify({ version: 1, bridgeRoot: bridge, shelfDocumentIds: [], shelfTopicIds: [], shelfNoteIds: [noteId], autoPublishEnabled: false }));
console.log(JSON.stringify({ base, root, userData, bridge, pdfPath }));
