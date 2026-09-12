import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test.each([1, 2])('restores complete Knowledge records into an empty Library from portable v%i', async (version) => {
  const source = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-backup-source-'));
  const destination = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-backup-restore-'));
  const config = await mkdtemp(path.join(tmpdir(), 'pagedock-knowledge-backup-config-'));
  vi.stubEnv('PAGEDOCK_ROOT', source);
  vi.stubEnv('ANNOT_ROOT', source);
  vi.stubEnv('PAGEDOCK_CONFIG_DIR', config);
  vi.resetModules();
  const store = await import('@/lib/knowledge-store');
  const captured = await store.captureKnowledgeNotes([{
    text: '합성 장기 보관 메모입니다. 휴대폰 사본과 복구 백업은 다릅니다.',
    sourceName: 'synthetic-memo.md', provenance: { kind: 'personal_hypothesis' },
  }]);
  const note = captured.captured[0];
  const [review] = await store.saveKnowledgeProposals(note.id, {
    title: '합성 보관 주제', summary: '합성 요약', proposals: [{
      kind: 'create', topicId: '', title: '합성 정리 노트', rationale: '테스트', conflictSummary: '',
      proposedSummary: '합성 요약', proposedBodyMarkdown: '## 읽기와 복구\n\n선택한 메모를 휴대폰에서 읽습니다.',
      sourceClaims: [note.rawText],
    }],
  });
  const accepted = await store.resolveKnowledgeReview(review.id, 'accept');
  const topic = accepted.topic!;
  await store.editKnowledgeTopic(topic.id, {
    title: topic.title, summary: topic.summary,
    bodyMarkdown: `${topic.bodyMarkdown}\n\n수정 이력도 복구합니다.`,
  });
  await store.trashKnowledgeTopicRevision(topic.id, 1);
  const original = await readFile(path.join(source, '.annot', 'knowledge-store.json'));
  const trash = await readFile(path.join(source, '.annot', 'knowledge-revision-trash.json'));
  await mkdir(config, { recursive: true });
  await writeFile(path.join(config, 'mobile-bridge.json'), JSON.stringify({ version: 1, shelfNoteIds: [note.id] }));
  const backup = await import('@/lib/library-backup');
  const zip = await JSZip.loadAsync(await backup.createPortableBackup(false));
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  expect(manifest.version).toBe(2);
  expect(Object.keys(zip.files).some((name) => name.endsWith('mobile-bridge.json'))).toBe(false);
  if (version === 1) {
    // Exercise the supported v1 reader with the same lossless Library entries.
    // This synthetic archive is not evidence of every historical v1 variant.
    manifest.version = 1;
    zip.file('manifest.json', JSON.stringify(manifest));
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  vi.stubEnv('PAGEDOCK_ROOT', destination);
  vi.stubEnv('ANNOT_ROOT', destination);
  vi.resetModules();
  await (await import('@/lib/library-backup')).importPortableBackup(bytes);
  expect(await readFile(path.join(destination, '.annot', 'knowledge-store.json'))).toEqual(original);
  expect(await readFile(path.join(destination, '.annot', 'knowledge-revision-trash.json'))).toEqual(trash);
  const restored = await (await import('@/lib/knowledge-store')).getKnowledgeSnapshot();
  expect(restored.notes[0].rawText).toBe(note.rawText);
  expect(restored.notes[0].provenance?.kind).toBe('personal_hypothesis');
  expect(restored.topics[0].revisions).toHaveLength(1);
  expect(restored.topics[0].revision).toBe(2);
  const restoredTrash = await (await import('@/lib/knowledge-store')).getKnowledgeRevisionTrash();
  expect(restoredTrash.items[0].revision.revision).toBe(1);
  expect(restored.topics[0].sourceNoteIds).toContain(note.id);
  expect(await readFile(path.join(source, '.annot', 'knowledge-store.json'))).toEqual(original);
});
