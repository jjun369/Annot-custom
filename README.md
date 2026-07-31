# PageDock

개인 메모를 위키로 정리하는 기능은 [지식 정리 한국어 사용 설명서](./docs/KNOWLEDGE_USER_GUIDE_KO.md)를 참고하세요.

PageDock은 PDF를 한곳에 모아 읽고, 표시하고, 논문·특허를 프로젝트별로 조사하며, 선택적으로 AI와 함께 공부하는 Windows용 로컬 작업 공간입니다.

> 현재 버전은 지인 대상 초기 배포판입니다. 설치 파일은 아직 코드 서명되지 않았으므로 Windows SmartScreen 경고가 나타날 수 있습니다.

## 일반 사용자 설치

1. GitHub Releases에서 `PageDock-Setup-버전.exe`를 받습니다.
2. 설치 파일을 실행하고 기본 위치에 설치합니다.
3. PageDock의 첫 실행 안내를 따라 라이브러리와 선택적 AI 연결을 준비합니다.

사용자가 Node.js, npm, Python 명령어 또는 터미널을 직접 사용할 필요는 없습니다.

### 첫 실행에서 일어나는 일

- 새 사용자의 기본 라이브러리는 `문서\PageDock Library`입니다.
- 기존 `~/Annot` 라이브러리나 설정이 있으면 그대로 이어서 사용합니다.
- PDF를 추가하면 원본은 건드리지 않고 PageDock Library로 복사합니다.
- 같은 내용의 PDF는 SHA-256으로 감지해 중복 복사하지 않습니다.
- 파일명이나 폴더가 바뀌어도 안정적인 문서 ID와 SHA-256으로 메모·하이라이트·프로젝트 연결을 복구합니다.
- PDF 원본 주석 기능에 필요한 Python/PyMuPDF는 Windows의 공식 패키지 경로를 통해 자동 준비합니다.
- AI는 선택 사항입니다. 연결하지 않아도 PDF 읽기, 검색, 하이라이트와 메모를 사용할 수 있습니다.
- Codex 연결을 선택하면 OpenAI 공식 Windows 설치 스크립트와 브라우저 로그인 흐름을 사용합니다.

## 데이터와 백업

- PDF와 공부 기록은 설치 폴더가 아닌 PageDock Library에 저장됩니다.
- 앱을 삭제해도 라이브러리는 자동으로 삭제하지 않습니다.
- PDF를 제외한 연구 데이터는 하루 한 번 자동 백업하며 최근 7개를 유지합니다. 리서치 DB는 이식 가능한 JSON으로 저장됩니다.
- 전체 ZIP 내보내기에는 PDF와 메모, 하이라이트, 대화 기록이 포함됩니다.
- 로그인 토큰은 백업 파일에 포함하지 않습니다.
- 기존 Annot 백업 형식과 내부 `.annot` 데이터는 호환성을 위해 계속 지원합니다.

## 리서치와 AI

상단의 **리서치**에서 프로젝트를 만들고, 내 PDF 전문검색과 Crossref/OpenAlex 논문 검색, 특허번호·URL·PDF 추가를 사용할 수 있습니다. 공개 PDF는 사용자가 승인해야 라이브러리로 복사됩니다. 유료 원문 우회 기능은 제공하지 않습니다.

Codex 정밀분석은 사용자가 선택한 자료만 분석하며 원문 근거, 도면 해석, 기술적 추정, 불확실을 구분합니다. AI 연결이 없어도 PDF 읽기와 일반 전문검색은 동작합니다.

## AI 모델과 업데이트

모델 선택기의 **자동 (Codex 권장 모델)** 은 모델 ID를 고정하지 않습니다. Codex가 계정과 설치 버전에 맞는 권장 모델을 선택하므로 후속 모델이 제공되어도 PageDock 소스를 수정할 필요가 없습니다.

PageDock은 실행 후 GitHub Releases에서 새 버전을 확인합니다. 업데이트가 있으면 사용자 동의를 받은 뒤 백그라운드에서 받고, 재시작 또는 앱 종료 시 설치합니다. PDF와 공부 기록은 업데이트 대상에 포함되지 않습니다.

Codex 자체는 설정 화면의 **업데이트** 버튼으로 공식 최신 안정 버전을 준비할 수 있습니다.

## 개발

요구 사항:

- Node.js 24 이상
- npm
- Windows 10/11 x64 데스크톱 빌드 환경

```powershell
npm install
npm run dev
```

Electron 개발 창과 Next.js 개발 서버를 함께 실행하려면:

```powershell
npm run dev:desktop
```

정적 검사와 웹 빌드, 아이콘 생성을 한 번에 확인하려면:

```powershell
npm run verify:release
```

Windows 설치 파일을 로컬에서 만들려면:

```powershell
npm run build:desktop
```

결과물은 `dist\PageDock-Setup-버전.exe`에 생성됩니다.

## 새 버전 배포

애플리케이션 버전의 단일 기준은 `package.json`입니다. 백업 설명 파일과 Electron 설치 파일도 이 버전을 사용합니다.

```powershell
npm version patch
git push origin main --follow-tags
```

`v*` 태그가 GitHub에 올라오면 `.github/workflows/release.yml`이 Windows 설치 파일과 자동 업데이트 메타데이터를 검사·빌드해 공개 `PageDock-Releases` 저장소에 게시합니다. 비공개 소스 저장소에는 해당 공개 저장소에 쓸 수 있는 `PAGEDOCK_RELEASE_TOKEN` secret이 필요합니다. 기능 추가는 `minor`, 호환되지 않는 변경은 `major` 버전을 사용합니다.

초기 지인 테스트 이후 공개 배포 전에는 Windows 코드 서명 인증서를 연결해 SmartScreen 경고를 줄여야 합니다.

## 환경 변수

- `PAGEDOCK_ROOT`: 라이브러리 경로 강제 지정
- `PAGEDOCK_PYTHON_BIN`: Python 실행 파일 경로 지정
- `CODEX_BIN`: Codex 실행 파일 경로 지정

기존 `ANNOT_ROOT`, `ANNOT_PYTHON_BIN`도 이전 사용자 호환을 위해 계속 인식합니다.

## 기술 구성

- Electron 데스크톱 셸
- Next.js / React / Tailwind CSS
- react-pdf / pdf.js
- Codex CLI 및 선택적 Claude Code CLI
- PyMuPDF PDF 주석 도구

## 라이선스와 원작 고지

PageDock은 [Annot](https://github.com/rkka02/Annot)을 기반으로 수정한 파생 작업입니다. 원작과 이 저장소의 배포 조건은 Apache License 2.0이며, 자세한 내용은 [LICENSE](./LICENSE)와 [NOTICE](./NOTICE)를 확인하세요.
