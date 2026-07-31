import path from 'path';

import { extractPdfTextByPage } from '@/lib/pdf-text';
import {
  getDocumentById,
  getPatentMetadata,
  replaceDocumentChunks,
  updateDocument,
} from '@/lib/research-db';

const MAX_CHUNK_LENGTH = 6000;

function splitText(value: string): string[] {
  const text = value.replace(/\u0000/g, '').trim();
  if (!text) return [];
  if (text.length <= MAX_CHUNK_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK_LENGTH) {
    const boundary = Math.max(
      remaining.lastIndexOf('\n', MAX_CHUNK_LENGTH),
      remaining.lastIndexOf('. ', MAX_CHUNK_LENGTH),
      remaining.lastIndexOf('。', MAX_CHUNK_LENGTH),
    );
    const cut = boundary > MAX_CHUNK_LENGTH * 0.5 ? boundary + 1 : MAX_CHUNK_LENGTH;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function inferFirstPageTitle(text: string): string | null {
  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 12 && line.length <= 220)
    .filter((line) => !/^(abstract|초록|doi[:\s]|copyright|www\.)/i.test(line));
  return candidates[0] || null;
}

export async function indexResearchDocument(documentId: string): Promise<{ pages: number; chunks: number }> {
  const document = await getDocumentById(documentId);
  if (!document) throw new Error('문서를 찾지 못했습니다.');
  if (!document.currentPath) throw new Error('PDF 원문이 연결되지 않은 문서입니다.');
  const pages = await extractPdfTextByPage(document.currentPath);
  const chunks = pages.flatMap((page) => splitText(page.text).map((text) => ({
    page: page.page,
    kind: 'page',
    text,
  })));
  await replaceDocumentChunks(documentId, chunks);
  const fileStem = path.posix.basename(document.currentPath).replace(/\.pdf$/i, '');
  if (document.displayTitle === fileStem) {
    const inferredTitle = inferFirstPageTitle(pages[0]?.text || '');
    if (inferredTitle) await updateDocument(documentId, { displayTitle: inferredTitle });
  }
  return { pages: pages.length, chunks: chunks.length };
}

export function sanitizeFilenamePart(value: string, maxLength: number): string {
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export async function suggestResearchFilename(documentId: string): Promise<{ fileName: string; confident: boolean }> {
  const document = await getDocumentById(documentId);
  if (!document) throw new Error('문서를 찾지 못했습니다.');
  const title = sanitizeFilenamePart(document.displayTitle, 85) || '제목 없음';
  if (document.kind === 'patent') {
    const patent = await getPatentMetadata(documentId);
    const assignee = sanitizeFilenamePart(patent?.assignees[0] || '출원인 미상', 35);
    const patentNumber = sanitizeFilenamePart(patent?.publicationNumber || patent?.applicationNumber || '번호 미상', 30);
    return {
      fileName: `${assignee} - ${patentNumber} - ${title}.pdf`,
      confident: assignee !== '출원인 미상' && patentNumber !== '번호 미상',
    };
  }
  const year = document.publicationYear ? String(document.publicationYear) : '연도 미상';
  const author = sanitizeFilenamePart(document.authors[0] || '저자 미상', 35);
  return {
    fileName: `${year} - ${author} - ${title}.pdf`,
    confident: year !== '연도 미상' && author !== '저자 미상' && title !== '제목 없음',
  };
}
