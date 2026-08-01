import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { getKnowledgeSnapshot } from '@/lib/knowledge-store';
import { KNOWLEDGE_EXPORT_MARKER } from '@/lib/knowledge-folder';
import { readKnowledgeImportSettings } from '@/lib/knowledge-import-settings';

export interface KnowledgeExportResult {
  directory: string;
  topicCount: number;
  files: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function exportFolderName(date = new Date()): string {
  return `PageDock-Knowledge-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeFileName(value: string, fallback: string): string {
  let result = value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[ .]+$/g, '').trim();
  if (!result) result = fallback;
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(result)) result = `_${result}`;
  return result.slice(0, 120) || fallback;
}

function uniqueFileName(base: string, used: Set<string>): string {
  let candidate = `${base}.md`;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase('ko-KR'))) {
    candidate = `${base} (${suffix}).md`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase('ko-KR'));
  return candidate;
}

function markdownLinkTitle(value: string): string {
  return value.replace(/[\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function topicMarkdown(topic: {
  id: string;
  revision: number;
  updatedAt: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
}): string {
  return [
    '---',
    `topic_id: ${JSON.stringify(topic.id)}`,
    `revision: ${topic.revision}`,
    `updated_at: ${JSON.stringify(topic.updatedAt)}`,
    '---',
    '',
    `# ${topic.title.trim() || '제목 없는 지식'}`,
    '',
    topic.summary.trim() ? `> ${topic.summary.trim().replace(/\r?\n/g, '\n> ')}` : '',
    '',
    topic.bodyMarkdown.trim(),
    '',
  ].join('\n');
}

function isSameOrInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

async function chooseOutputDirectory(destination: string): Promise<string> {
  const base = path.normalize(path.resolve(destination.trim()));
  const stat = await fs.stat(base);
  if (!stat.isDirectory()) throw new Error('Markdown 내보내기 목적지는 폴더여야 합니다.');
  const settings = await readKnowledgeImportSettings();
  if (settings.directory && isSameOrInside(settings.directory, base)) {
    throw new Error('연결된 메모 폴더 안으로는 내보낼 수 없습니다. 다른 폴더를 선택하세요.');
  }
  const baseName = exportFolderName();
  let folder = path.join(base, baseName);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(folder);
      folder = path.join(base, `${baseName}-${suffix}`);
      suffix += 1;
    } catch {
      return folder;
    }
  }
}

export async function exportKnowledgeMarkdown(destination: string): Promise<KnowledgeExportResult> {
  const outputDirectory = await chooseOutputDirectory(destination);
  const temporaryDirectory = path.join(path.dirname(outputDirectory), `.pagedock-knowledge-export-${randomUUID()}.tmp`);
  const snapshot = await getKnowledgeSnapshot();
  const topics = [...snapshot.topics].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const usedNames = new Set<string>();
  const entries: Array<{ title: string; fileName: string; summary: string }> = [];
  try {
    await fs.mkdir(temporaryDirectory, { recursive: true });
    await fs.writeFile(path.join(temporaryDirectory, KNOWLEDGE_EXPORT_MARKER), 'PageDock knowledge export. Do not auto-import this folder.\n', 'utf8');
    for (const topic of topics) {
      const baseName = safeFileName(topic.slug || topic.title, 'topic');
      const fileName = uniqueFileName(baseName, usedNames);
      await fs.writeFile(path.join(temporaryDirectory, fileName), topicMarkdown(topic), 'utf8');
      entries.push({ title: topic.title, fileName, summary: topic.summary });
    }
    const indexLines = [
      '# PageDock 지식 내보내기',
      '',
      `- 내보낸 시각: ${new Date().toLocaleString('ko-KR')}`,
      `- 문서 수: ${topics.length}`,
      '',
      '## 문서 목록',
      '',
      ...(entries.length ? entries.map((entry) => `- [${markdownLinkTitle(entry.title)}](${encodeURI(entry.fileName)})${entry.summary.trim() ? ` — ${markdownLinkTitle(entry.summary.split(/\r?\n/, 1)[0])}` : ''}`) : ['내보낼 위키 문서가 없습니다.']),
      '',
    ];
    await fs.writeFile(path.join(temporaryDirectory, 'INDEX.md'), indexLines.join('\n'), 'utf8');
    await fs.rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { directory: outputDirectory, topicCount: topics.length, files: ['INDEX.md', ...entries.map((entry) => entry.fileName)] };
}
