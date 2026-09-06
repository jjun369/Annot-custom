import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

let store: typeof import('@/lib/knowledge-store');

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-test-'));
  process.env.PAGEDOCK_ROOT = root;
  process.env.ANNOT_ROOT = root;
  process.env.PAGEDOCK_CONFIG_DIR = path.join(root, 'config');
  store = await import('@/lib/knowledge-store');
});

async function createDockerTopic(): Promise<{ noteId: string; topicId: string }> {
  const note = await store.captureKnowledgeNote('Docker volume은 컨테이너를 지워도 유지된다.');
  const [review] = await store.saveKnowledgeProposals(note.id, {
    title: 'Docker 볼륨 메모',
    summary: 'Docker 볼륨의 생명주기 메모',
    proposals: [{
      kind: 'create', topicId: '', title: 'Docker 볼륨', rationale: '새 주제', conflictSummary: '',
      proposedSummary: '컨테이너와 분리된 Docker 데이터 저장 방식',
      proposedBodyMarkdown: '## 생명주기\n\n컨테이너를 삭제해도 볼륨은 유지된다.',
      sourceClaims: ['Docker volume은 컨테이너를 지워도 유지된다.'],
    }],
  });
  const result = await store.resolveKnowledgeReview(review.id, 'accept');
  return { noteId: note.id, topicId: result.topic!.id };
}

describe('knowledge store v2', () => {
  test('preserves source provenance and creates revision history', async () => {
    const { noteId, topicId } = await createDockerTopic();
    const snapshot = await store.getKnowledgeSnapshot();
    expect(snapshot.version).toBe(2);
    const topic = snapshot.topics.find((item) => item.id === topicId)!;
    expect(topic.sourceNoteIds).toContain(noteId);
    expect(topic.revision).toBe(1);
    expect(topic.revisions.map((item) => item.revision)).toEqual([1]);
  });

  test('deduplicates identical text even when imported under another filename', async () => {
    const first = await store.captureKnowledgeNotes([{ text: 'SQLite는 단일 파일 데이터베이스다.', sourceName: 'a.md' }]);
    const second = await store.captureKnowledgeNotes([{ text: 'SQLite는 단일 파일 데이터베이스다.', sourceName: 'copy.txt' }]);
    expect(first.captured).toHaveLength(1);
    expect(second.captured).toHaveLength(0);
    expect(second.duplicates[0].existingNoteId).toBe(first.captured[0].id);
  });

  test('rejects a stale update instead of overwriting a newer revision', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    const firstNote = await store.captureKnowledgeNote('Docker volume은 별도 백업이 필요하다.');
    const secondNote = await store.captureKnowledgeNote('Docker volume에는 named volume 방식이 있다.');
    const proposal = (body: string) => ({
      kind: 'update' as const, topicId: topic.id, title: topic.title, rationale: '보완', conflictSummary: '',
      proposedSummary: topic.summary, proposedBodyMarkdown: body, sourceClaims: [body],
    });
    const [firstReview] = await store.saveKnowledgeProposals(firstNote.id, {
      title: '백업', summary: '', proposals: [proposal(`${topic.bodyMarkdown}\n\n## 백업\n\n별도 백업이 필요하다.`)],
    });
    const [staleReview] = await store.saveKnowledgeProposals(secondNote.id, {
      title: '방식', summary: '', proposals: [proposal(`${topic.bodyMarkdown}\n\n## 방식\n\nNamed volume이 있다.`)],
    });
    await store.resolveKnowledgeReview(firstReview.id, 'accept');
    await expect(store.resolveKnowledgeReview(staleReview.id, 'accept')).rejects.toThrow(/다시 분석/);
  });

  test('records a conflict without changing the current wiki body', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    const before = topic.bodyMarkdown;
    const note = await store.captureKnowledgeNote('내 환경에서는 컨테이너 삭제 시 볼륨도 사라졌다.');
    const [review] = await store.saveKnowledgeProposals(note.id, {
      title: 'Docker 볼륨 삭제 충돌', summary: '', proposals: [{
        kind: 'conflict', topicId: topic.id, title: '볼륨 생명주기 충돌', rationale: '같은 조건인지 불명확',
        conflictSummary: '볼륨 유지 여부에 상반된 관찰이 있다.', proposedSummary: topic.summary,
        proposedBodyMarkdown: '이 본문은 충돌 등록 시 적용되면 안 된다.', sourceClaims: [note.rawText],
      }],
    });
    const result = await store.resolveKnowledgeReview(review.id, 'accept');
    expect(result.conflict?.status).toBe('open');
    const after = (await store.getKnowledgeSnapshot()).topics.find((item) => item.id === topic.id)!;
    expect(after.bodyMarkdown).toBe(before);
  });

  test('restores an older state as a new monotonic revision', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    const currentRevision = topic.revision;
    const restored = await store.restoreKnowledgeTopicRevision(topic.id, 1);
    expect(restored.revision).toBe(currentRevision + 1);
    expect(restored.revisions.at(-1)?.restoredFromRevision).toBe(1);
    expect(restored.bodyMarkdown).toContain('생명주기');
  });

  test('manual edits create a new user revision without losing sources', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    const previousRevision = topic.revision;
    const previousSources = [...topic.sourceNoteIds];
    const edited = await store.editKnowledgeTopic(topic.id, {
      title: topic.title,
      summary: `${topic.summary} 직접 보완`,
      bodyMarkdown: `${topic.bodyMarkdown}\n\n## 직접 메모\n\n사용자가 직접 수정했습니다.`,
      changeNote: '직접 수정 테스트',
    });
    expect(edited.revision).toBe(previousRevision + 1);
    expect(edited.sourceNoteIds).toEqual(previousSources);
    expect(edited.revisions.at(-1)).toMatchObject({
      revision: previousRevision + 1,
      editedBy: 'user',
      changeNote: '직접 수정 테스트',
    });
  });

  test('moves only historical revisions to recoverable trash', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    await expect(store.trashKnowledgeTopicRevision(topic.id, topic.revision)).rejects.toThrow(/현재 revision/);

    const historical = topic.revisions.find((item) => item.revision !== topic.revision)!;
    const trashed = await store.trashKnowledgeTopicRevision(topic.id, historical.revision);
    expect((await store.getKnowledgeSnapshot()).topics.find((item) => item.id === topic.id)!
      .revisions.some((item) => item.revision === historical.revision)).toBe(false);
    expect((await store.getKnowledgeRevisionTrash()).items.map((item) => item.id)).toContain(trashed.id);

    await store.restoreTrashedKnowledgeRevision(trashed.id);
    expect((await store.getKnowledgeSnapshot()).topics.find((item) => item.id === topic.id)!
      .revisions.some((item) => item.revision === historical.revision)).toBe(true);
    expect((await store.getKnowledgeRevisionTrash()).items).toHaveLength(0);
  });

  test('permanently deletes an explicitly trashed historical revision', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === 'Docker 볼륨')!;
    const historical = topic.revisions.find((item) => item.revision !== topic.revision)!;
    const trashed = await store.trashKnowledgeTopicRevision(topic.id, historical.revision);
    await store.permanentlyDeleteTrashedKnowledgeRevision(trashed.id);
    expect((await store.getKnowledgeRevisionTrash()).items.some((item) => item.id === trashed.id)).toBe(false);
    const info = await store.getKnowledgeStoreInfo();
    expect(info.activeBytes).toBeGreaterThan(0);
    expect(info.revisionTrashCount).toBe(0);
  });

  test('scans a recursive folder, captures small files, and previews long files', async () => {
    const folder = path.join(process.env.PAGEDOCK_ROOT!, 'incoming');
    await mkdir(path.join(folder, 'nested'), { recursive: true });
    await writeFile(path.join(folder, 'small.md'), '폴더에서 수집하는 작은 메모', 'utf8');
    await writeFile(path.join(folder, 'nested', 'long.md'), `## 긴 주제\n\n${'긴 내용 '.repeat(6_000)}`, 'utf8');
    const folderModule = await import('@/lib/knowledge-folder');
    const settingsModule = await import('@/lib/knowledge-import-settings');
    await settingsModule.setKnowledgeImportDirectory(folder);
    const first = await folderModule.scanKnowledgeImportFolder();
    expect(first.available).toBe(true);
    expect(first.captured.map((item) => item.sourceName)).toContain('small.md');
    expect(first.pending.map((item) => item.relativePath)).toContain('nested/long.md');
    const second = await folderModule.scanKnowledgeImportFolder();
    expect(second.captured).toHaveLength(0);
    const preview = await folderModule.previewKnowledgeFolderFile('nested/long.md');
    expect(preview.segments.length).toBeGreaterThan(1);
    const imported = await folderModule.importKnowledgeFolderFile('nested/long.md', preview.contentHash, 'split');
    expect(imported.segmentCount).toBe(preview.segments.length);
    expect((await folderModule.scanKnowledgeImportFolder()).pending).toHaveLength(0);
  });

  test('exports current topics and blocks the connected import folder', async () => {
    const folder = path.join(process.env.PAGEDOCK_ROOT!, 'export-source');
    const destination = path.join(process.env.PAGEDOCK_ROOT!, 'exports');
    await mkdir(folder, { recursive: true });
    await mkdir(destination, { recursive: true });
    const settingsModule = await import('@/lib/knowledge-import-settings');
    const exportModule = await import('@/lib/knowledge-export');
    await settingsModule.setKnowledgeImportDirectory(folder);
    const result = await exportModule.exportKnowledgeMarkdown(destination);
    expect(result.topicCount).toBeGreaterThan(0);
    expect(await readFile(path.join(result.directory, 'INDEX.md'), 'utf8')).toContain('PageDock 지식 내보내기');
    await expect(exportModule.exportKnowledgeMarkdown(folder)).rejects.toThrow(/메모 폴더 안으로/);
  });
});

describe('knowledge provenance and human review attention', () => {
  test('keeps provenance and reader anchors additive through the inbox and accepted topic', async () => {
    const note = await store.captureKnowledgeNote(
      '논문 원문에서 확인한 공정 조건은 장비 조건에 따라 달라질 수 있다.',
      'process-paper.pdf · p.12',
      {
        provenance: { kind: 'literature_claim', originDate: '2020-04' },
        sourceAnchors: [{
          id: 'knowledge-test-anchor', scope: 'selection', documentId: 'document-1', page: 12,
          text: '공정 조건은 장비 조건에 따라 달라질 수 있다.', rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.04 }],
        }],
      },
    );
    expect(note.provenance).toEqual({ kind: 'literature_claim', originDate: '2020-04' });
    expect(note.sourceAnchors?.[0]).toMatchObject({ id: 'knowledge-test-anchor', page: 12, scope: 'selection' });

    const [review] = await store.saveKnowledgeProposals(note.id, {
      title: '공정 조건의 적용 범위', summary: '', proposals: [{
        kind: 'create', topicId: '', title: '공정 조건의 적용 범위', rationale: '원문 근거 수집', conflictSummary: '',
        proposedSummary: '공정 조건은 적용 환경에 따라 달라질 수 있다.',
        proposedBodyMarkdown: '## 원문 근거\n\n장비 조건과 적용 환경을 함께 확인한다.',
        sourceClaims: [note.rawText],
      }],
    });
    const accepted = await store.resolveKnowledgeReview(review.id, 'accept');
    expect(accepted.topic?.provenance).toEqual({ kind: 'literature_claim', originDate: '2020-04' });
    expect(accepted.topic?.revisions[0]?.provenance).toEqual({ kind: 'literature_claim', originDate: '2020-04' });
  });

  test('never infers expiry from an old source date and records only explicit human review attention', async () => {
    const snapshot = await store.getKnowledgeSnapshot();
    const topic = snapshot.topics.find((item) => item.title === '공정 조건의 적용 범위')!;
    const before = { revision: topic.revision, body: topic.bodyMarkdown, updatedAt: topic.updatedAt };

    const requested = await store.requestKnowledgeTopicReview(topic.id);
    expect(requested.revision).toBe(before.revision);
    expect(requested.bodyMarkdown).toBe(before.body);
    expect(requested.updatedAt).toBe(before.updatedAt);
    expect(requested.trust?.reviewReason).toBe('manual');
    expect(requested.trust?.reviewRequestedAt).toBeTruthy();

    const completed = await store.completeKnowledgeTopicReview(topic.id);
    expect(completed.revision).toBe(before.revision);
    expect(completed.bodyMarkdown).toBe(before.body);
    expect(completed.updatedAt).toBe(before.updatedAt);
    expect(completed.trust?.reviewRequestedAt).toBeUndefined();
    expect(completed.trust?.lastReviewedAt).toBeTruthy();
    expect(completed.provenance?.originDate).toBe('2020-04');
  });

  test('loads older knowledge JSON without assigning a provenance class or review state', async () => {
    const legacy = await store.captureKnowledgeNote('유형이 없던 기존 지식 메모', '기존 메모');
    const snapshot = await store.getKnowledgeSnapshot();
    const loaded = snapshot.notes.find((note) => note.id === legacy.id)!;
    expect(loaded.provenance).toBeUndefined();
    expect(loaded.sourceAnchors).toBeUndefined();
  });

  test('normalizes invalid provenance and malformed source anchors away at the persistence boundary', () => {
    expect(store.normalizeKnowledgeProvenance({ kind: 'truth', originDate: '1900-01-01' })).toBeUndefined();
    expect(store.normalizeKnowledgeProvenance({ kind: 'ai_inference', originDate: '2026-09-01', ai: { answerId: 'answer-1' } })).toEqual({
      kind: 'ai_inference', originDate: '2026-09-01', ai: { answerId: 'answer-1' },
    });
    expect(store.normalizeKnowledgeSourceAnchors([{ id: 'bad', scope: 'selection', page: 0 }])).toBeUndefined();
  });
});
