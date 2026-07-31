import { promises as dns } from 'dns';
import { isIP } from 'net';
import path from 'path';

import { saveUploadedPdf } from '@/lib/workspace-tree';
import type { TreeNode } from '@/types';

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0
    || parts[0] >= 224;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) === 6) {
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

async function validatePublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('공개 PDF는 HTTPS 주소만 가져올 수 있습니다.');
  if (url.username || url.password) throw new Error('인증정보가 포함된 URL은 사용할 수 없습니다.');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('로컬 주소는 사용할 수 없습니다.');
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('공개 인터넷 주소가 아닌 URL은 사용할 수 없습니다.');
  }
  return url;
}

function filenameFromResponse(url: URL, contentDisposition: string | null, preferredName?: string): string {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainMatch = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  const candidate = preferredName || (encodedMatch ? decodeURIComponent(encodedMatch) : plainMatch) || path.posix.basename(url.pathname) || 'document.pdf';
  const sanitized = candidate
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140) || 'document.pdf';
  return sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
}

async function fetchWithSafeRedirects(initialUrl: string): Promise<{ response: Response; finalUrl: URL }> {
  let current = await validatePublicUrl(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'User-Agent': 'PageDock/0.4 (public PDF importer)', Accept: 'application/pdf' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('PDF 다운로드 리디렉션 주소가 없습니다.');
      current = await validatePublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`PDF 다운로드 실패 (${response.status})`);
    return { response, finalUrl: current };
  }
  throw new Error('PDF 다운로드 리디렉션이 너무 많습니다.');
}

export async function downloadPublicPdf(input: {
  url: string;
  folderPath?: string;
  preferredName?: string;
}): Promise<TreeNode & { duplicate?: boolean }> {
  const { response, finalUrl } = await fetchWithSafeRedirects(input.url);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PDF_BYTES) throw new Error('PDF가 200MB 제한을 초과합니다.');
  if (!response.body) throw new Error('PDF 응답 본문이 없습니다.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error('PDF가 200MB 제한을 초과합니다.');
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('pdf') && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('해당 주소가 PDF 파일을 반환하지 않았습니다.');
  }
  const fileName = filenameFromResponse(finalUrl, response.headers.get('content-disposition'), input.preferredName);
  const file = new File([buffer], fileName, { type: 'application/pdf' });
  return saveUploadedPdf(input.folderPath || '', file);
}
