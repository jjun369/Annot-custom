import { getResearchSourceSettings } from '@/lib/research-settings';

export interface OnlineResearchResult {
  source: 'crossref' | 'openalex' | 'unpaywall' | 'kipris' | 'epo';
  externalId: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  abstractText: string;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  venue?: string;
  kind: 'paper' | 'patent';
}

function cleanAbstract(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    cache: 'no-store',
    signal: controller.signal,
    headers: {
      'User-Agent': 'PageDock/0.4 (local research workspace)',
      Accept: 'application/json',
      ...init.headers,
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`자료 공급자 요청 실패 (${response.status})`);
    return response.json() as Promise<unknown>;
  }).finally(() => clearTimeout(timeout));
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new Error('특허 API 인증에 실패했습니다. 설정의 키를 확인해 주세요.');
    if (response.status === 429) throw new Error('특허 API 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    if (!response.ok) throw new Error(`특허 API 요청 실패 (${response.status})`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlValue(block: string, ...names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<(?:(?:[^:>]+):)?${name}[^>]*>([\\s\\S]*?)<\\/(?:(?:[^:>]+):)?${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return '';
}

export async function searchCrossref(query: string, limit = 20): Promise<OnlineResearchResult[]> {
  const settings = await getResearchSourceSettings();
  const params = new URLSearchParams({
    'query.bibliographic': query,
    rows: String(Math.min(50, Math.max(1, limit))),
    select: 'DOI,title,author,published,URL,abstract,container-title,type',
  });
  if (settings.unpaywallEmail) params.set('mailto', settings.unpaywallEmail);
  const payload = await fetchJson(`https://api.crossref.org/works?${params}`) as {
    message?: { items?: Array<Record<string, unknown>> };
  };
  return (payload.message?.items || []).map((item) => {
    const dateParts = (item.published as { 'date-parts'?: number[][] } | undefined)?.['date-parts'];
    const authors = Array.isArray(item.author)
      ? item.author.map((author) => {
        const record = author as Record<string, unknown>;
        return [record.given, record.family].filter((value) => typeof value === 'string').join(' ').trim();
      }).filter(Boolean)
      : [];
    const doi = typeof item.DOI === 'string' ? item.DOI.toLowerCase() : undefined;
    return {
      source: 'crossref' as const,
      externalId: doi || String(item.URL || ''),
      title: Array.isArray(item.title) ? String(item.title[0] || '제목 없음') : '제목 없음',
      authors,
      publicationYear: dateParts?.[0]?.[0],
      abstractText: cleanAbstract(item.abstract),
      doi,
      url: typeof item.URL === 'string' ? item.URL : doi ? `https://doi.org/${doi}` : undefined,
      venue: Array.isArray(item['container-title']) ? String(item['container-title'][0] || '') : undefined,
      kind: 'paper' as const,
    };
  });
}

export async function searchOpenAlex(query: string, limit = 20): Promise<OnlineResearchResult[]> {
  const settings = await getResearchSourceSettings();
  if (!settings.openAlexKey) throw new Error('OpenAlex API 키를 먼저 설정해 주세요.');
  const params = new URLSearchParams({
    search: query,
    per_page: String(Math.min(50, Math.max(1, limit))),
    api_key: settings.openAlexKey,
  });
  const payload = await fetchJson(`https://api.openalex.org/works?${params}`) as {
    results?: Array<Record<string, unknown>>;
  };
  return (payload.results || []).map((item) => {
    const authorships = Array.isArray(item.authorships) ? item.authorships : [];
    const authors = authorships.map((authorship) => {
      const author = (authorship as { author?: Record<string, unknown> }).author;
      return typeof author?.display_name === 'string' ? author.display_name : '';
    }).filter(Boolean);
    const ids = item.ids as Record<string, unknown> | undefined;
    const bestLocation = item.best_oa_location as Record<string, unknown> | undefined;
    const doiUrl = typeof ids?.doi === 'string' ? ids.doi : undefined;
    return {
      source: 'openalex' as const,
      externalId: String(item.id || doiUrl || ''),
      title: String(item.title || item.display_name || '제목 없음'),
      authors,
      publicationYear: typeof item.publication_year === 'number' ? item.publication_year : undefined,
      abstractText: '',
      doi: doiUrl?.replace(/^https?:\/\/doi\.org\//i, ''),
      url: typeof item.doi === 'string' ? item.doi : typeof item.id === 'string' ? item.id : undefined,
      pdfUrl: typeof bestLocation?.pdf_url === 'string' ? bestLocation.pdf_url : undefined,
      venue: undefined,
      kind: 'paper' as const,
    };
  });
}

export async function lookupUnpaywall(doi: string): Promise<OnlineResearchResult> {
  const settings = await getResearchSourceSettings();
  if (!settings.unpaywallEmail) throw new Error('Unpaywall 조회용 이메일을 먼저 설정해 주세요.');
  const payload = await fetchJson(
    `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(settings.unpaywallEmail)}`,
  ) as Record<string, unknown>;
  const bestLocation = payload.best_oa_location as Record<string, unknown> | undefined;
  return {
    source: 'unpaywall',
    externalId: String(payload.doi || doi),
    title: String(payload.title || '제목 없음'),
    authors: [],
    publicationYear: typeof payload.year === 'number' ? payload.year : undefined,
    abstractText: '',
    doi: String(payload.doi || doi),
    url: typeof bestLocation?.url === 'string' ? bestLocation.url : undefined,
    pdfUrl: typeof bestLocation?.url_for_pdf === 'string' ? bestLocation.url_for_pdf : undefined,
    venue: typeof payload.journal_name === 'string' ? payload.journal_name : undefined,
    kind: 'paper',
  };
}

export async function searchKipris(query: string, limit = 20): Promise<OnlineResearchResult[]> {
  const settings = await getResearchSourceSettings();
  if (!settings.kiprisKey) throw new Error('KIPRIS Plus API 키를 먼저 설정해 주세요.');
  const params = new URLSearchParams({
    free: query,
    docsCount: String(Math.min(50, Math.max(1, limit))),
    currentPage: '1',
    accessKey: settings.kiprisKey,
  });
  const xml = await fetchText(`https://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/freeSearch?${params}`, {
    headers: { Accept: 'application/xml' },
  });
  const error = xmlValue(xml, 'returnReasonCode', 'resultCode');
  if (error && !/^(?:0|00|success)$/i.test(error)) throw new Error(`KIPRIS Plus 응답 오류: ${xmlValue(xml, 'returnAuthMsg', 'resultMsg') || error}`);
  const items = xml.match(/<(?:[^:>]+:)?item\b[\s\S]*?<\/(?:[^:>]+:)?item>/gi) || [];
  return items.map((item) => {
    const applicationNumber = xmlValue(item, 'applicationNumber', 'ApplicationNumber');
    const publicationNumber = xmlValue(item, 'publicationNumber', 'PublicationNumber');
    const date = xmlValue(item, 'publicationDate', 'applicationDate');
    const applicants = xmlValue(item, 'applicantName', 'applicant');
    return {
      source: 'kipris' as const,
      externalId: publicationNumber || applicationNumber,
      title: xmlValue(item, 'inventionTitle', 'title') || '제목 없음',
      authors: applicants ? applicants.split(/[;,|]/).map((value) => value.trim()).filter(Boolean) : [],
      publicationYear: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
      abstractText: xmlValue(item, 'astrtCont', 'abstract'),
      url: applicationNumber ? `https://patents.google.com/?q=${encodeURIComponent(applicationNumber)}` : undefined,
      kind: 'patent' as const,
    };
  });
}

export async function searchEpo(query: string, limit = 20): Promise<OnlineResearchResult[]> {
  const settings = await getResearchSourceSettings();
  if (!settings.epoClientId || !settings.epoClientSecret) throw new Error('EPO OPS Client ID와 Secret을 먼저 설정해 주세요.');
  const authorization = Buffer.from(`${settings.epoClientId}:${settings.epoClientSecret}`).toString('base64');
  const tokenPayload = await fetchText('https://ops.epo.org/3.2/auth/accesstoken', {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  let token = '';
  try { token = String((JSON.parse(tokenPayload) as { access_token?: string }).access_token || ''); } catch { token = ''; }
  if (!token) throw new Error('EPO OPS OAuth 토큰을 받지 못했습니다.');
  const xml = await fetchText(`https://ops.epo.org/3.2/rest-services/published-data/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/exchange+xml' },
  });
  const documents = (xml.match(/<(?:[^:>]+:)?exchange-document\b[\s\S]*?<\/(?:[^:>]+:)?exchange-document>/gi) || [])
    .slice(0, Math.min(50, Math.max(1, limit)));
  return documents.map((document) => {
    const country = document.match(/country="([^"]+)"/i)?.[1] || xmlValue(document, 'country');
    const docNumber = document.match(/doc-number="([^"]+)"/i)?.[1] || xmlValue(document, 'doc-number');
    const kind = document.match(/kind="([^"]+)"/i)?.[1] || xmlValue(document, 'kind');
    const date = xmlValue(document, 'date');
    const publication = `${country}${docNumber}${kind}`;
    const applicants = [...document.matchAll(/<(?:[^:>]+:)?applicant-name[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?applicant-name>/gi)]
      .map((match) => decodeXml(match[1])).filter(Boolean);
    return {
      source: 'epo' as const,
      externalId: publication,
      title: xmlValue(document, 'invention-title') || publication || '제목 없음',
      authors: applicants,
      publicationYear: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined,
      abstractText: xmlValue(document, 'abstract'),
      url: publication ? `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(publication)}` : undefined,
      kind: 'patent' as const,
    };
  });
}

export function patentSearchLinks(query: string): Array<{ provider: string; url: string }> {
  return [
    { provider: 'KIPRIS', url: `https://www.kipris.or.kr/khome/search/searchResult.do?queryText=${encodeURIComponent(query)}` },
    { provider: 'Espacenet', url: `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(query)}` },
    { provider: 'Google Patents', url: `https://patents.google.com/?q=${encodeURIComponent(query)}` },
  ];
}
