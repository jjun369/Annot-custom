# Annot

> 이 저장소는 개인 연구 흐름에 맞게 확장한 Annot 개조판입니다. 원본 PDF와 기존 라이브러리를 직접 바꾸기 전에 별도 폴더에서 시험하는 것을 권장합니다.

## 개조판 주요 기능

- 화면 주변 페이지만 렌더링하고 연속 확대 입력을 묶어 처리하는 PDF 성능 개선
- 폭·페이지 맞춤, Ctrl+휠 확대, 페이지 번호 이동, 하이라이트 목록 사이드바와 키보드 단축키
- Codex 구독 로그인 기반 모델 자동 조회, 모델 새로고침, 세션별 모델 보존
- 목록에서 AI 키워드·한글 3줄 요약 생성 및 직접 수정
- 개인 태그, Markdown 노트, 읽음 상태, 품질 별점과 중요도
- 논문 목록 통합 검색, 폴더 검색·상태 필터·정렬, 입력 중단 후 자동 저장
- 선택 영역 번역과 전체 논문 한영 대조 Markdown 번역
- AI 대화창을 별도 창으로 분리해 다중 모니터에서 사용
- 이동 가능한 `.annot` 데이터 구조와 개인 설정 동기화, 하이라이트 sidecar 보관
- 대용량 PDF도 메모리에 통째로 올리지 않는 ZIP 내보내기·가져오기, PDF를 제외한 연구 데이터 자동 백업 최근 7개 유지
- 삭제 항목을 30일간 보관하는 휴지통
- 한국어 사용자 화면

## OneDrive에서 사용

1. OneDrive 안에 `Annot Library` 같은 폴더를 만듭니다.
2. Annot 설정의 **라이브러리와 백업**에서 해당 폴더의 전체 경로를 입력합니다.
3. Annot을 다시 시작합니다.
4. 양쪽 노트북에서 그 폴더를 **이 장치에 항상 유지**로 설정합니다.
5. 한 번에 한 노트북에서만 사용하고, 다른 노트북으로 옮기기 전에 OneDrive 동기화 완료를 확인합니다.

환경 변수 방식도 계속 지원합니다.

```powershell
$env:ANNOT_ROOT = "$env:OneDrive\Annot Library"
npm run dev
```

Codex 로그인 정보와 토큰은 라이브러리나 ZIP 백업에 포함되지 않습니다. 새 노트북에서는 Codex/ChatGPT 구독 로그인을 별도로 완료해야 합니다.

## Windows에서 실제 사용

`start-annot.cmd`를 더블클릭하면 필요한 패키지와 최적화 빌드를 확인한 뒤 Annot을 실행합니다. 평소 논문을 읽을 때는 개발용 `npm run dev`보다 이 방식을 권장합니다.

소스 코드를 수정한 뒤에는 기존 `.next` 폴더를 지우는 대신 다음 명령으로 새 빌드를 만든 후 실행해도 됩니다.

```powershell
npm run build
npm run start
```

Annot is a local-first PDF reading workspace with a built-in AI chat panel.

It now supports both macOS and Windows development/runtime workflows.

It is designed for a simple loop:

1. organize papers in folders
2. open a PDF and read it in place
3. highlight and annotate while you read
4. ask questions in a chat session tied to that folder or PDF

Annot uses your existing local Codex or Claude Code login on the same machine. No `OPENAI_API_KEY` setup is required.

## Screenshots

### PDF reading + chat

![Annot workspace](https://raw.githubusercontent.com/rkka02/Annot/b2c5cfe1f4c6bad7aa82cfc1194269f33d95ed93/screenshots/1.png)

### Highlight markdown export preview

![Highlight markdown preview](https://raw.githubusercontent.com/rkka02/Annot/codex/highlight-summary-export/screenshots/highlight-markdown.png)

### LLM summary markdown export preview

![LLM summary markdown preview](https://raw.githubusercontent.com/rkka02/Annot/codex/highlight-summary-export/screenshots/llm-markdown.png)

### Settings

![Annot settings](https://raw.githubusercontent.com/rkka02/Annot/main/screenshots/settings.png?rev=20260330-1540)

## What It Does

- Real filesystem-backed workspace rooted at your home directory's `Annot` folder by default
- Folder tree with create, rename, move, and delete actions
- Real PDF rendering with vertical scroll mode and page mode
- Text selection, PDF highlights, memo-attached highlights, and eraser mode inside the PDF viewer
- Separate folder sessions and PDF-specific chat sessions
- Provider-based chat runtime with support for Codex and Claude Code
- Streaming chat output with resumable session state
- Math rendering in chat via KaTeX
- PDF highlights written back into the original PDF as native annotations
- Per-PDF markdown export for yellow/red highlights with preview before download
- Session-level markdown export for LLM-generated chat summaries with preview before download
- Adjustable chat font size and resizable chat panel

## Requirements

Before you start, make sure you have:

- Node.js 20+ installed
- npm installed
- Python 3 available on your system
- Codex installed locally if you want to use Codex
- Claude Code installed locally if you want to use Claude Code
- `PyMuPDF` installed for reading and writing PDF annotations
- `poppler` installed if you want reliable PDF page rendering utilities outside the browser viewer

Annot reuses your local CLI authentication state. Sign in through the provider you want to use before opening the app.

For the best paper-reading experience, it is also recommended to install the official PDF or document-reading skill/package for the agent runtime you plan to use most. Annot works without those extras, but Codex and Claude Code generally do better on PDF-heavy workflows when their official PDF-focused tools are available.

For example:

```bash
python3 -m pip install --user pymupdf pdfplumber pypdf reportlab
brew install poppler
```

On Windows PowerShell:

```powershell
py -3 -m pip install --user pymupdf pdfplumber pypdf reportlab
```

If you need Poppler on Windows too, install a Windows build and make sure its `bin` directory is on `PATH`.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

## First-Time Setup

If this is your first time opening Annot:

1. Go to `Settings`.
2. Choose your default provider: `Codex` or `Claude Code`.
3. Click `Validate and set as default`.
4. Confirm the provider test succeeds.
5. Return to the workspace.
6. Create a folder in the explorer.
7. Upload one or more PDF files.
8. Open a PDF and start reading.
9. Ask your first question in the chat panel.

Annot creates its workspace under your home directory by default:

- macOS/Linux: `~/Annot`
- Windows: `%USERPROFILE%\Annot`

If you want to use a different root directory, start the app with:

```bash
ANNOT_ROOT=/your/path npm run dev
```

On Windows PowerShell, the equivalent is:

```powershell
$env:ANNOT_ROOT = 'C:\path\to\Annot'
npm run dev
```

## How Sessions Work

Annot has two kinds of chat sessions:

- Folder sessions: broader discussions that can span a folder and its papers
- PDF sessions: focused discussions tied to one specific PDF

Each session is also tied to the provider that created it. This keeps paper-specific conversations from mixing with broader folder-level research threads and avoids switching a live session between runtimes unexpectedly.

Session summaries are generated on demand when you export them. Annot uses the full saved chat history for that session, writes per-turn summaries back into the session record, and then lets you review the generated markdown before downloading it.

## Typical Workflow

### 1. Build your workspace

Use the explorer on the left to create folders and upload PDFs.

### 2. Read in the viewer

Open a paper and read it directly in Annot. You can switch between page mode and vertical scroll mode.

### 3. Mark important passages

Select text to highlight it. Use the eraser mode to remove highlights by selecting overlapping text. Annot stores these as native PDF highlight annotations in the original file, and you can click any saved highlight to attach a memo directly to that annotation.

### 4. Ask context-aware questions

Use the chat panel to ask for:

- summaries
- section explanations
- equation walkthroughs
- translations
- comparisons across papers

### 5. Export what matters

Annot supports two markdown export paths:

- highlight export: generate a mechanical markdown list of yellow and red highlights for the current PDF
- summary export: generate LLM-written turn summaries from the full saved chat history for the current session

Both exports open a preview dialog before download so you can inspect the markdown first.

### 6. Return later

Annot restores the right session for the current folder or PDF so you can continue where you left off.

## Notes

- Annot is designed to work with your local Codex or Claude Code authentication state.
- The app reads and manages files locally.
- On Windows, Annot will automatically look for `codex`, `codex.exe`, `claude`, `claude.exe`, `python`, and `py`.
- If your preferred agent has an official PDF/document-reading skill, install that too for better PDF-specific assistance.
- The default provider is configured in `Settings` and only saved after a live validation check succeeds.
- Existing sessions stay on the provider they were created with.
- Highlights are stored in the portable `.annot` sidecar immediately and written back into the original PDF when the local PDF worker is available.
- Highlight memos are stored with the native PDF annotations.
- Summary markdown export is generated from saved chat messages when you click `Export` in the chat panel.
- The development flow is the main supported setup here:

```bash
npm run dev
```

## Tech Stack

- Next.js
- React
- Tailwind CSS
- react-pdf / pdf.js
- Codex CLI
- Claude Code CLI
- PyMuPDF

## License

Apache-2.0. See [LICENSE](./LICENSE).
