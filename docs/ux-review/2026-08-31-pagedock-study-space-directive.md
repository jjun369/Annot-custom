# PageDock UX/개발 지시서 v1 — 2026-08-31

## 결정

> **PageDock은 한 학습 공간 안에서 선택한 로컬 PDF를 읽고, 검색하고,
> 표시하고, 메모하며, 필요할 때만 그 출처 범위 안에서 검증 가능한 근거를
> 가진 AI 답변을 얻는 Windows 개인 연구 도구다.**

Google NotebookLM/Gemini Notebook에서 참고할 것은 *명확한 자료 경계와
출처 기반 대화*다. Studio 생성물, 클라우드 의존성, AI 중심 화면을 복제하지
않는다. PageDock에서는 언제나 원문 PDF Reader가 중심이다.

이 문서는 2026-08-31 현재 UI 캡처, 고심도 제품·아키텍처 검토, 그 결과를
반영한 웹 UX 검토의 합의 지시서다. 화면 근거는
[`2026-08-31-current-ux-inventory.md`](2026-08-31-current-ux-inventory.md)에
있다.
현재 책임 파일의 실사 결과는
[`2026-08-31-p0-0-code-ownership-audit.md`](2026-08-31-p0-0-code-ownership-audit.md)에
있다.

## 제품 구조와 용어

최종 primary navigation은 **학습 공간 / 라이브러리 / 지식**이다.

- **학습 공간 (Study Space)**: 현재 공부 맥락. Sources, Reader, 공간 내
  검색, 하이라이트/주석, Study Note, 명시적 Ask, Saved Answer를 한 곳에 둔다.
- **라이브러리 (Library)**: 전역 `Document` 저장소. PDF 추가, 모든 문서와
  전역 검색, 문서 관리를 담당한다. 학습 공간으로 강제 변환하지 않는다.
- **지식 (Knowledge)**: 기존 수집함 → 검토함 → 충돌함 → wiki의 검토된 장기
  지식 흐름이다. Study Note와 절대 합치지 않는다.
- **고급 리서치 (Advanced Research)**: 현재 Research 기능의 호환성 경로다.
  한 release 이상 기존 route와 deep-link를 보존하고, 이후 학습 공간의 더보기
  메뉴에서 진입시킨다.

### 반드시 지킬 기존 identity

`Study Space`는 새로운 저장소 루트가 아니다.

```text
StudySpace.id      = existing Project.id
StudySpace.sources = ProjectDocument membership → global Document
```

따라서 새 `study_spaces` table, `Project`/`Document` 복제, `Project.id` 변경,
Knowledge 이동, Analysis/Evidence의 polymorphic 재작성은 P0에서 금지한다.
기존 annotation, highlight, index, `AnalysisReport`, `Evidence`, Knowledge pipeline도
그대로 유지한다.

## P0 완료 범위

P0의 완결 흐름은 다음이다.

```text
학습 공간 열기 → Sources 선택 → Reader에서 읽기 → 로컬 검색
→ highlight/note → 질문용 Sources를 명시적으로 선택 → Ask
→ 검증된 citation으로 원문 복귀 → 필요한 답변을 Saved Answer로 저장
```

포함:

- recovery/backup/migration 안전망과 현재 신뢰성 버그 수정
- `Project → StudySpace` domain/UI adapter
- Sources, 기존 Reader 재사용, Study Note, 공간 내 local FTS
- immutable scope, 근거 검증을 거친 explicit Ask, Saved Answer

명시적 제외:

- 새 study-space root/table, 데이터 복제/이동, Knowledge 자동 승격/직접 저장
- Briefing, FAQ, Study Guide, 퀴즈, 마인드맵, 오디오/비디오, 자동 요약
- 자동/백그라운드 AI, 일반지식 fallback, 자동 크롤링·대량 수집
- 클라우드 동기화·협업, OCR/벡터 DB 전면 교체, detached floating chat 신규 UX

## 데이터·백업·AI 계약

### P0에서 추가 가능한 persistence는 세 종류뿐

1. `SourceScopeSnapshot`: AI turn마다 생성하는 불변 scope.
   `spaceId`, 선택 `documentId[]`, 각 source SHA/revision와 index revision/timestamp,
   `createdAt`을 가진다. 다음 질문에서 선택을 바꾸면 기존 snapshot을 수정하지
   않고 새로 만든다.
2. `StudyArtifact`: `note` 또는 `saved_answer`만 허용한다. Note는 수정 가능한
   작업 기억이며, Saved Answer는 질문·답변·scope를 보존하는 스냅샷이다.
3. `StudyArtifactEvidence`: Artifact와 원문 근거를 연결한다. 기존 Evidence의
   locator taxonomy와 검증 로직을 재사용한다.

저장 가능한 citation은 `documentId`, source SHA/revision, page/section/figure
locator, retrieved chunk 또는 quote, evidence type을 모두 검증해야 한다. 근거
검증에 실패하면 답변을 저장하지 않고 다음을 정상 결과로 표시한다.

> 선택한 자료에서 이 답변을 뒷받침할 근거를 찾지 못했습니다.

source가 질문 중 변경되면 새 파일에 자동 재연결하지 않고 `stale` 처리한다.

> 질문하는 동안 원문이 변경되었습니다. 이 답변의 근거를 현재 문서에 연결하지
> 않았습니다. 다시 질문해 주세요.

AI 요청은 사용자가 **Ask**를 실행했을 때만 허용한다. 앱 실행, Space/PDF 열기,
source checkbox, local search, highlight, annotation, note, Library search, citation
이동은 외부 AI 요청 0회여야 한다. 신뢰 경계(back-end/IPC)는 renderer 선택값을
믿지 않고 `ProjectDocument` membership을 확인한다. 외부 전송은 질문, 선택된
source에서 retrieval한 필요한 chunk, 최소 citation metadata로 제한한다. 전체
Library, 비선택 PDF, Knowledge, 절대경로, 진단 로그, 자격증명과 backup 정보는
전송 금지다.

새 entity를 쓰기 전에 backup export/import도 동시에 지원한다. migration은
additive·idempotent여야 하며, 첫 schema write 직전 safety snapshot을 만든다.
portable export, clean restore, old-backup import, snapshot rollback을 자동화한다.
최소 한 release 동안 dual-read / single-new-write를 적용하고 legacy chat은
공간을 추측해 reparent하지 않는다.

## 화면 지시

학습 공간의 기본은 `Sources | Reader | Notes / Ask` 3-pane이다. Reader는 가장
넓고 항상 중앙에 둔다.

| Logical viewport | Sources | Reader | Right pane |
| --- | --- | --- | --- |
| 1280–1439 | 기본 200px (176–240) | 최소 640px, 남는 폭 우선 | 기본 300px (280–340) |
| 1440 이상 | 240px | flex, 가장 넓음 | 360px |
| 1280 미만 | 필요 시 접기 | 우선 보호 | drawer/side sheet |

Pane gutter는 8–12px, 전역 horizontal scrollbar는 금지한다. 720px 높이에서
PDF 본문 실사용 높이를 약 500px 이상 남기고 각 side pane은 독립 scroll한다.
Source가 열렸다고 Ask source에 자동 포함하지 않는다. Right pane 기본 tab은
**메모**이며 `메모 | 질문`으로 전환한다.

### 상태와 오류 문구

| 상태 | 제목 | 설명/행동 |
| --- | --- | --- |
| Library 문서 0개 | 라이브러리가 비어 있습니다 | `PDF를 추가하면 읽기, 검색, 하이라이트와 메모를 로컬에서 사용할 수 있습니다.` / **PDF 추가** |
| PDF는 있으나 선택 없음 | 읽을 문서를 선택하세요 | `왼쪽 라이브러리에서 PDF를 선택하면 여기에서 바로 열립니다.` |
| Space Sources 0개 | 이 학습 공간에 아직 자료가 없습니다 | PDF 추가 / 라이브러리에서 선택 |
| Space에서 Reader 선택 없음 | 읽을 자료를 선택하세요 | 왼쪽 Sources에서 문서를 선택하면 원문을 연다 |
| Note 없음 | 아직 메모가 없습니다 | 읽다가 중요한 부분을 하이라이트하거나 생각을 기록 |
| Ask source 없음 | 질문에 사용할 자료를 하나 이상 선택하세요 | 모든 source 자동 선택 금지 |
| AI 미연결 | AI가 연결되어 있지 않습니다 | `PDF 읽기·검색·하이라이트·메모에는 영향이 없습니다.` / AI 설정 열기 |
| 텍스트 분석 capability 실패 | 텍스트 분석 기능을 사용할 수 없습니다 | `PDF 열람과 주석은 계속 사용할 수 있습니다.` / 다시 확인, 진단 정보 복사 |

Python/Microsoft Store/stderr/stack trace/executable path는 UI 본문, reader header,
metadata에 절대 출력하지 않는다. 필요하면 명시적 diagnostics에만 보관한다.

Detached chat은 primary UX에서 제거한다. 새 문맥 key는
`spaceId + documentId + conversationId`이며, turn의 source 문맥은 immutable
`SourceScopeSnapshot`이 담당한다. 현재 BroadcastChannel moving context에 새 기능이
의존하면 안 된다. 기존 detached chat은 legacy conversation으로 보존만 한다.

## 구현 순서와 release gates

1. **Phase 0 — Recovery**: 실제 기존 schema 기반 old-data fixture (PDF 2개,
   Project 2개, M:N Source, annotation/highlight, Knowledge, Analysis/Evidence,
   legacy chat, backup)를 만들고 portable backup, clean restore, old-backup import,
   snapshot rollback과 migration interruption을 통과시킨다. 실패하면 schema write 금지.
2. **Phase 1 — Trust bugs**: Library의 `document count == 0`과
   `selectedDocument == null`을 분리, reader raw error 차단, detached chat 신규
   진입 봉인, auto-backup owner를 page mount에서 application persistence lifecycle
   singleton으로 이동한다.
3. **Phase 2 — Adapter & persistence**: Project adapter와 세 additive entity,
   backup serialization을 함께 구현한다.
4. **Phase 3 — Offline Study Space**: Sources/Reader/Notes를 AI 없이 처음부터
   끝까지 유용하게 만든다.
5. **Phase 4 — Grounded Ask**: explicit scope → membership 확인 → local retrieval
   → minimal payload → AI → citation/source-version validation → commit 순서로 구현한다.
6. **Phase 5 — Saved Answer**: 사용자 클릭에서만 `saved_answer` snapshot을 저장하고
   citation navigation을 제공한다.
7. **Phase 6 — IA 전환**: 위 parity 후 `학습 공간 / 라이브러리 / 지식`을 primary
   nav로 전환한다. Research route는 최소 한 release 호환 유지한다.

## 자동화 acceptance

- Document가 하나 이상이면 `라이브러리가 비어 있습니다` 또는 첫 PDF 추가가 나타나지 않는다.
- Python 미설치/실행 실패 때 UI DOM에 `Python was not found`, Microsoft Store,
  stack trace, 절대 executable path가 없다.
- route를 50회 전환해도 page mount가 auto-backup job을 더 만들지 않는다.
- 새 primary flow는 detached chat route/BroadcastChannel에 의존하지 않는다.
- 네트워크 차단 상태에서도 Space, Sources, Reader, annotation/highlight, local FTS,
  Study Note, Saved Answer 열기, citation 이동, Library 검색, backup/export/restore가
  동작한다.
- 1280×720 logical viewport에서는 Sources/Reader/Notes가 보이고 Reader 폭은 640px
  이상이며 root horizontal scrollbar가 없다.
- Ask가 아닌 동작에서 AI endpoint 요청 횟수는 0이고, 조작된 비-member document
  요청은 trusted backend가 거부한다.

## 지금 시작할 작업 묶음 — P0-0 Recovery & Trust Foundation

1. Project, ProjectDocument, Document, Analysis/Evidence, Knowledge, chat,
   backup/import/export, migration, auto backup, Library empty selector, reader
   subprocess error, BroadcastChannel의 실제 owner file을 실사해 문서화한다.
2. recovery fixture와 복구 테스트를 먼저 설계한다. 아직 새 StudyArtifact schema는
   만들거나 쓰지 않는다.
3. 동시에 독립적이고 안전한 사용자 신뢰성 버그를 닫는다.
   - populated Library의 잘못된 "첫 PDF 추가" 상태를 **문서 선택 안내**로 변경
   - reader에서 raw dependency error가 보이지 않게 generic capability 안내로 변경
   - 이후 auto-backup lifecycle과 detached chat 의존성은 현재 소유 구조를 실사한 뒤
     별도 작은 변경으로 옮긴다.

첫 구현 PR은 3번의 두 항목과 단위/통합 검증으로 제한한다. 이는 데이터 migration
전에 사용자에게 즉시 보이는 거짓 상태와 정보 누출을 제거하고, recovery 기반 작업을
손상시키지 않는 가장 작은 안전한 시작점이다.
