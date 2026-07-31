import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'README.md', 'AGENTS.md', 'CHANGELOG.md',
  'docs/PRODUCT_DIRECTION.md', 'docs/ARCHITECTURE.md', 'docs/DATA_MODEL.md',
  'docs/features/TECHNOLOGY_RESEARCH.md', 'docs/ROADMAP.md', 'docs/CURRENT_STATE.md',
  'docs/KNOWLEDGE_USER_GUIDE_KO.md', 'docs/features/PERSONAL_KNOWLEDGE.md',
  'docs/decisions/0001-electron-local-first.md', 'docs/decisions/0002-stable-document-identity.md',
  'docs/decisions/0003-search-ai-and-public-sources.md', 'docs/decisions/0004-backup-and-credentials.md',
  'docs/decisions/0005-release-separation.md', 'docs/decisions/0006-knowledge-inbox-codex-review.md',
  'docs/decisions/0007-manual-knowledge-revisions-and-trash.md',
  'docs/decisions/0008-macos-arm64-port.md',
];

for (const file of required) await access(path.join(root, file));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const currentState = await readFile(path.join(root, 'docs/CURRENT_STATE.md'), 'utf8');
if (!currentState.includes(`App version: ${packageJson.version}`)) {
  throw new Error(`CURRENT_STATE.md app version must match package.json (${packageJson.version}).`);
}

const markdownLink = /\[[^\]]*\]\((?!https?:|mailto:|#)([^)]+)\)/g;
for (const file of required) {
  const source = await readFile(path.join(root, file), 'utf8');
  for (const match of source.matchAll(markdownLink)) {
    const target = match[1].split('#')[0];
    if (!target) continue;
    await access(path.resolve(path.dirname(path.join(root, file)), target));
  }
}
console.log(`Documentation check passed for PageDock ${packageJson.version}.`);
